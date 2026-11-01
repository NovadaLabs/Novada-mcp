#!/usr/bin/env bash
# restart-rolling.sh — zero-downtime restart of both novada-mcp@<port>
# instances with NO build/deploy step. Use this after an env-only change
# (e.g. editing /etc/novada-mcp/env) that needs the running processes
# restarted to pick up new values, but does NOT need a new release — for a
# code deploy, use deploy-ec2.sh instead (it calls this exact same
# one-at-a-time sequence after building).
#
# Same guarantee as deploy-ec2.sh's converge_instance()/set_current(): at no
# point are BOTH instances down at once — strictly sequential, and this
# script stops immediately (does not proceed to the next port) the moment
# either the restart or the health check fails on one, so the OTHER instance
# is never touched and keeps serving throughout. There is no release change
# here (no PREV/rollback concept — see deploy-ec2.sh for that), so there is
# nothing to roll back to; a failure here just means "stop, the untouched
# instance is still up, go investigate the one that failed." Uses the same
# deploy lock file, so this refuses to run concurrently with an in-progress
# deploy-ec2.sh (or another restart-rolling.sh), rather than racing it.
#
# Usage: restart-rolling.sh [ssh-host]   (default: novada-mcp from ~/.ssh/config)
set -euo pipefail
HOST="${1:-novada-mcp}"

ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
exec 9>/tmp/novada-mcp-deploy.lock
flock -n 9 || { echo "REFUSED: a deploy or rolling restart is already in progress" >&2; exit 1; }

INSTANCE_PORTS="3000 3001"

health() {
  local port="$1"
  for _ in $(seq 1 30); do
    curl -fsS -m 3 "http://127.0.0.1:${port}/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

for port in $INSTANCE_PORTS; do
  echo "restarting novada-mcp@${port}..." >&2
  sudo systemctl reset-failed "novada-mcp@${port}" 2>/dev/null || true
  if ! sudo systemctl restart "novada-mcp@${port}"; then
    echo "RESTART FAILED for novada-mcp@${port} — stopping here; the other instance is untouched and still serving" >&2
    exit 1
  fi
  if ! health "$port"; then
    echo "HEALTH CHECK FAILED for novada-mcp@${port} after restart (30s) — stopping here; the other instance is untouched and still serving" >&2
    exit 1
  fi
  echo "novada-mcp@${port} OK" >&2
done
echo "ROLLING RESTART OK: both instances healthy"
REMOTE
