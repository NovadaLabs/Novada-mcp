#!/usr/bin/env bash
# Deploy hosted-server/vercel from THIS worktree to the EC2 host, with automatic rollback.
# Usage: deploy-ec2.sh [ssh-host]   (default: novada-mcp from ~/.ssh/config)
set -euo pipefail
HOST="${1:-novada-mcp}"
ROOT="$(git rev-parse --show-toplevel)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
DIRTY="$(git -C "$ROOT" status --porcelain -- hosted-server/vercel | grep -q . && echo -dirty || true)"
SRC="${SRC_DIR:-$ROOT/hosted-server/vercel}"   # SRC_DIR override: used by the rollback drill
REL="$(date -u +%Y%m%d-%H%M%S)-${SHA}${DIRTY}-$(openssl rand -hex 2)"
TAR="$(mktemp -t novada-mcp-rel).tgz"
trap 'rm -f "$TAR"' EXIT

COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$SRC" --exclude node_modules --exclude dist --exclude .vercel --exclude '.env*' -czf "$TAR" .
scp -q "$TAR" "$HOST:/tmp/novada-mcp-$REL.tgz"

ssh "$HOST" REL="$REL" bash -s <<'REMOTE'
set -euo pipefail
# One deploy at a time: concurrent runs would race on PREV, the symlink swap and rollback.
exec 9>/tmp/novada-mcp-deploy.lock
flock -n 9 || { echo "DEPLOY REFUSED: another deploy is in progress" >&2; rm -f "/tmp/novada-mcp-$REL.tgz"; exit 1; }

R=/opt/novada-mcp/releases/$REL
TGZ="/tmp/novada-mcp-$REL.tgz"
# Until the build succeeds, any exit removes the half-built release (current is untouched).
trap 'rm -f "$TGZ"; if [ ! -f "$R/RELEASE" ]; then sudo rm -rf "$R"; echo "BUILD FAILED: removed partial $R; current unchanged" >&2; fi' EXIT
sudo -u novada mkdir -p "$R"
sudo -u novada tar -C "$R" -xzf "$TGZ"
cd "$R"
sudo -u novada env HOME=/var/lib/novada npm ci --no-audit --no-fund --loglevel=error
sudo -u novada env HOME=/var/lib/novada npm run build:server --silent
sudo -u novada env HOME=/var/lib/novada npm prune --omit=dev --no-audit --no-fund --loglevel=error
echo "$REL" | sudo -u novada tee "$R/RELEASE" >/dev/null   # marks the release as fully built
cd /

health() {
  for _ in $(seq 1 30); do
    curl -fsS -m 3 http://127.0.0.1:3000/health >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
switch_to() {
  if ! { sudo ln -sfn "$1" /opt/novada-mcp/current.new && sudo mv -T /opt/novada-mcp/current.new /opt/novada-mcp/current; }; then
    echo "SYMLINK SWAP FAILED for $1" >&2; return 1
  fi
  # A bad release has usually just tripped StartLimitBurst (unit 'failed'); without
  # reset-failed systemd refuses the restart and the service stays down.
  sudo systemctl reset-failed novada-mcp 2>/dev/null || true
  sudo systemctl restart novada-mcp || true
}

PREV="$(readlink -f /opt/novada-mcp/current 2>/dev/null || true)"
# Healthy is not enough: the OLD release would also answer /health if the swap failed.
if ! switch_to "$R" || [ "$(readlink -f /opt/novada-mcp/current)" != "$R" ] || ! health; then
  echo "DEPLOY FAILED: /health not OK after 30s — rolling back to ${PREV:-<none>}" >&2
  sudo journalctl -u novada-mcp -n 40 --no-pager >&2 || true
  if [ -n "$PREV" ]; then
    switch_to "$PREV"
    if health; then echo "ROLLBACK OK: serving $(cat "$PREV/RELEASE")" >&2
    else echo "ROLLBACK FAILED: service still unhealthy — SERVICE DOWN, investigate now" >&2; fi
  fi
  exit 1
fi

# Keep the 5 newest fully-built releases; never delete the one being served.
CUR="$(readlink -f /opt/novada-mcp/current)"
for d in $(ls -1dt /opt/novada-mcp/releases/*/ | sed 's#/$##'); do
  [ -f "$d/RELEASE" ] || { [ "$d" != "$R" ] && sudo rm -rf "$d"; continue; }   # leftover partials
  echo "$d"
done | tail -n +6 | while read -r d; do [ "$d" != "$CUR" ] && sudo rm -rf "$d"; done
echo "DEPLOYED $REL"
REMOTE
