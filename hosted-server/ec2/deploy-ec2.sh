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
# NOVADA_MCP_ROOT: test-only override (mirrors NOVADA_SKIP_HOSTED_FORCE's
# convention in hosted-server/vercel/server.mts) -- defaults to the real
# production path; a local test harness (test/deploy-rollback-c2.sh) points
# this at a sandbox so the exact decision logic below can run without a real
# box. Never set in production.
NOVADA_MCP_ROOT="${NOVADA_MCP_ROOT:-/opt/novada-mcp}"
# One deploy at a time: concurrent runs would race on PREV, the symlink swap and rollback.
exec 9>/tmp/novada-mcp-deploy.lock
flock -n 9 || { echo "DEPLOY REFUSED: another deploy is in progress" >&2; rm -f "/tmp/novada-mcp-$REL.tgz"; exit 1; }

R="$NOVADA_MCP_ROOT/releases/$REL"
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

# Zero-downtime restarts (incident fix 2026-10-29): TWO independent
# novada-mcp@<port> instances (see ../novada-mcp@.service). Restarted ONE AT
# A TIME, and -- round 2, 2026-10-29 incident-fix review C2 -- an instance
# that is ALREADY correctly running the target release is never touched
# again, in EITHER direction (forward deploy or rollback). This matters
# specifically for rollback: if instance @3000 converges to the new release
# successfully and instance @3001 then fails, only @3001 is rolled back --
# @3000 is NEVER restarted a second time just to "match" @3001's rollback,
# so it never goes down. This is the fix for the exact scenario the review
# traced: restarting BOTH instances unconditionally during rollback could
# take the whole service down (both instances briefly dead at once) in
# precisely the case this redesign exists to protect against -- a bad
# release caught on the second-iterated instance.
#
# Mixed-version decision (explicitly asked for, justified here): when only
# one instance fails, the other is LEFT on the new release while the failed
# one rolls back to its own prior release -- i.e. the two instances behind
# nginx can genuinely run two different releases for the duration of this
# script (bounded by health's ~30s poll window per instance, not minutes).
# Accepted because (a) nginx already round-robins every request across both
# instances with NO session affinity configured, so a single client's
# successive calls can already land on different instances/releases during
# ANY normal one-at-a-time rolling restart, mixed-version or not -- this is
# a pre-existing property of the architecture, not something this round
# introduces; (b) this pipeline deploys one git SHA at a time (see REL's
# construction above) -- typically small diffs, and any wire-breaking change
# to the MCP JSON-RPC surface or tool registry is owner-gated separately
# (see the repo's own version-bump/REDLINE discipline), not something a
# routine deploy does silently; (c) the window is bounded by one instance's
# health-poll loop, not open-ended. The alternative -- forcing BOTH
# instances to match even when one is already fine -- is exactly the bug
# this round fixes, so "both one-at-a-time, must match" was considered and
# rejected.
INSTANCE_PORTS="3000 3001"

health_once() { curl -fsS -m 3 "http://127.0.0.1:$1/health" >/dev/null 2>&1; }
# NOVADA_MCP_HEALTH_POLL_S: test-only override of the health-poll duration
# (default unchanged at 30, matching the production 30s health-poll window
# documented throughout this file). test/deploy-rollback-c2.sh shortens this
# so a health-check-fails scenario doesn't cost 30 real wall-clock seconds
# per assertion. Never set in production -- same category as
# NOVADA_MCP_ROOT above.
health() {
  local port="$1"
  for _ in $(seq 1 "${NOVADA_MCP_HEALTH_POLL_S:-30}"); do
    health_once "$port" && return 0
    sleep 1
  done
  return 1
}

# OS primitive, factored to one line: the absolute directory a given PID's
# cwd actually resolves to. Linux-only (/proc) -- this script only ever runs
# on the Ubuntu box via ssh. A local test harness with no /proc (e.g. macOS)
# swaps ONLY this one function for a portable equivalent; every other
# function below (instance_release, converge_instance, the main flow) runs
# completely unmodified under test -- see test/deploy-rollback-c2.sh.
_proc_cwd() { readlink -f "/proc/$1/cwd" 2>/dev/null || true; }

# Which release directory is instance $1 (a port) ACTUALLY running, right
# now -- not what the `current` symlink says, which can legitimately differ
# once instances are allowed to diverge (see the mixed-version note above).
# A process's cwd is resolved to the real path at the moment it starts and
# does NOT change when `current` is later repointed elsewhere -- that
# pinning is exactly what makes it safe to flip the shared `current` symlink
# to roll back ONE instance without disturbing any instance that is not
# itself being restarted. Empty string if the instance isn't running at all.
instance_release() {
  local port="$1" pid
  pid="$(systemctl show "novada-mcp@${port}" -p MainPID --value 2>/dev/null || true)"
  [ -n "$pid" ] && [ "$pid" != "0" ] || { echo ""; return 0; }
  _proc_cwd "$pid"
}

# Point the shared `current` symlink at $1 (an absolute release dir). This
# alone does not restart anything -- it only controls what the NEXT restart
# of ANY instance will pick up. Safe to call repeatedly / out of order
# relative to which instance gets restarted next, because of the cwd-pinning
# property documented on instance_release() above.
set_current() {
  if ! { sudo ln -sfn "$1" "$NOVADA_MCP_ROOT/current.new" && sudo mv -T "$NOVADA_MCP_ROOT/current.new" "$NOVADA_MCP_ROOT/current"; }; then
    echo "SYMLINK SWAP FAILED for $1" >&2
    return 1
  fi
}

# Converge ONE instance onto $2 (an absolute release dir): if it is ALREADY
# running $2 AND healthy, do nothing at all (no reset-failed, no restart --
# this is the "never touch an already-good instance" guarantee). Otherwise
# reset-failed + restart + health-poll. Never references or touches any
# OTHER instance. Returns 1 (without retrying or touching anything else) on
# a restart or health failure -- the caller decides what to do about THAT
# ONE instance.
converge_instance() {
  local port="$1" target="$2"
  # health_once (not the 30s-retrying health()) for the skip decision: the
  # common/expected case (already on target AND healthy) resolves on one
  # fast probe; only a genuinely-unhealthy-despite-matching instance (rare)
  # falls through to a real restart below, which then gets the full 30s
  # health() poll it actually needs.
  if [ "$(instance_release "$port")" = "$target" ] && health_once "$port"; then
    echo "novada-mcp@${port} already running ${target} and healthy, skipping" >&2
    return 0
  fi
  sudo systemctl reset-failed "novada-mcp@${port}" 2>/dev/null || true
  if ! sudo systemctl restart "novada-mcp@${port}"; then
    echo "RESTART FAILED for novada-mcp@${port}" >&2
    return 1
  fi
  if ! health "$port"; then
    echo "HEALTH CHECK FAILED for novada-mcp@${port} after restart (30s)" >&2
    return 1
  fi
  echo "novada-mcp@${port} OK, serving ${target}" >&2
  return 0
}

print_fleet_status() {
  for port in $INSTANCE_PORTS; do
    echo "  novada-mcp@${port}: $(instance_release "$port")" >&2
  done
}

# Capture each instance's OWN actual prior release BEFORE touching anything
# -- the real per-instance rollback target if it fails, independent of (and
# more precise than) the single shared `current` symlink, which this round's
# design allows to go stale/advisory once instances can diverge.
declare -A PREV_RELEASE
for port in $INSTANCE_PORTS; do
  PREV_RELEASE["$port"]="$(instance_release "$port")"
done

if ! set_current "$R"; then
  exit 1
fi

FAILED_PORTS=""
for port in $INSTANCE_PORTS; do
  if ! converge_instance "$port" "$R"; then
    FAILED_PORTS="$FAILED_PORTS $port"
  fi
done

if [ -n "$FAILED_PORTS" ]; then
  echo "DEPLOY FAILED on:${FAILED_PORTS} -- rolling back ONLY the failed instance(s); every instance already converged on $R is left untouched and stays up" >&2
  sudo journalctl -u novada-mcp@3000 -u novada-mcp@3001 -n 40 --no-pager >&2 || true
  ROLLBACK_OK=1
  for port in $FAILED_PORTS; do
    target="${PREV_RELEASE[$port]}"
    if [ -z "$target" ]; then
      echo "novada-mcp@${port}: no known prior release recorded (first deploy to this instance?) -- cannot auto-rollback, manual intervention required" >&2
      ROLLBACK_OK=0
      continue
    fi
    if ! set_current "$target"; then
      echo "ROLLBACK FAILED for novada-mcp@${port}: could not repoint current to ${target}" >&2
      ROLLBACK_OK=0
      continue
    fi
    if converge_instance "$port" "$target"; then
      echo "ROLLBACK OK for novada-mcp@${port}: serving $(cat "$target/RELEASE" 2>/dev/null || echo "$target")" >&2
    else
      echo "ROLLBACK FAILED for novada-mcp@${port} -- SERVICE AT RISK on this instance, investigate now" >&2
      ROLLBACK_OK=0
    fi
  done
  echo "Final per-instance state (source of truth: instance_release(), NOT the current symlink, which is advisory once instances diverge):" >&2
  print_fleet_status
  [ "$ROLLBACK_OK" = 1 ] && echo "NOTE: the above may be a mixed-version state -- see this file's header comment above INSTANCE_PORTS for why that is an accepted, bounded tradeoff here." >&2
  exit 1
fi

# Keep the 5 newest fully-built releases, but NEVER delete a release any
# instance is ACTUALLY running (instance_release()) -- not just the
# `current` symlink target. This round's design allows instances to
# diverge, so protecting only the symlink target (the old behavior) could
# delete a release out from under a still-running, perfectly healthy
# instance if a later deploy's prune happened to run while one instance was
# still on an older release for any reason.
IN_USE="$(readlink -f "$NOVADA_MCP_ROOT/current")"
for port in $INSTANCE_PORTS; do
  rel="$(instance_release "$port")"
  [ -n "$rel" ] && IN_USE="$IN_USE
$rel"
done
for d in $(ls -1dt "$NOVADA_MCP_ROOT"/releases/*/ | sed 's#/$##'); do
  if [ ! -f "$d/RELEASE" ]; then
    echo "$IN_USE" | grep -qxF "$d" || sudo rm -rf "$d"   # leftover partial, but never an in-use dir
    continue
  fi
  echo "$d"
done | tail -n +6 | while read -r d; do
  echo "$IN_USE" | grep -qxF "$d" || sudo rm -rf "$d"
done
echo "DEPLOYED $REL"
print_fleet_status
REMOTE
