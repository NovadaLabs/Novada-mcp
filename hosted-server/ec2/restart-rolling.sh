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
# Health gate path. Default /health/ready exercises KV, so a deploy is refused while KV is down.
# Emergency code-only fix during a KV outage: NOVADA_MCP_HEALTH_PATH=/health (static liveness only).
HEALTH_PATH="${NOVADA_MCP_HEALTH_PATH:-/health/ready}"
case "$HEALTH_PATH" in /health/ready|/health) ;; *) echo "REFUSED: NOVADA_MCP_HEALTH_PATH must be /health/ready or /health" >&2; exit 1 ;; esac
[ "$HEALTH_PATH" = /health ] && echo "WARNING: health gate = static /health — KV is NOT checked by this roll" >&2
# Settle between instances (2026-11-26): nginx's passive check (max_fails=1,
# fail_timeout=10s) can mark a just-restarted instance down for 10 s when an SSE
# stream on its OLD process hits proxy_read_timeout; touching the next instance
# inside that window = "no live upstreams" (2×502 on 2026-11-25). nginx counts
# fail_timeout in whole seconds, so "down 10 s" is effectively up to ~11 s —
# keep this default >= fail_timeout + 2 (checked by test/roll-settle-selftest.sh;
# nginx-novada-mcp.conf cross-references it). Seconds, 0-60.
ROLL_SETTLE_S="${NOVADA_MCP_ROLL_SETTLE_S:-12}"
case "$ROLL_SETTLE_S" in ''|*[!0-9]*) echo "REFUSED: NOVADA_MCP_ROLL_SETTLE_S must be an integer 0-60" >&2; exit 1 ;; esac
[ "$ROLL_SETTLE_S" -le 60 ] || { echo "REFUSED: NOVADA_MCP_ROLL_SETTLE_S must be an integer 0-60" >&2; exit 1; }

ssh "$HOST" NOVADA_MCP_ROLL_SETTLE_S="$ROLL_SETTLE_S" NOVADA_MCP_HEALTH_PATH="$HEALTH_PATH" bash -s <<'REMOTE'
set -euo pipefail
exec 9>/tmp/novada-mcp-deploy.lock
flock -n 9 || { echo "REFUSED: a deploy or rolling restart is already in progress" >&2; exit 1; }

INSTANCE_PORTS="3000 3001"
# Re-validate remotely (defense in depth; this script also runs via test harnesses).
ROLL_SETTLE_S="${NOVADA_MCP_ROLL_SETTLE_S:-12}"
case "$ROLL_SETTLE_S" in ''|*[!0-9]*) echo "REFUSED: NOVADA_MCP_ROLL_SETTLE_S must be an integer 0-60" >&2; exit 1 ;; esac
[ "$ROLL_SETTLE_S" -le 60 ] || { echo "REFUSED: NOVADA_MCP_ROLL_SETTLE_S must be an integer 0-60" >&2; exit 1; }
settle() { [ "$ROLL_SETTLE_S" -gt 0 ] || return 0; echo "settling ${ROLL_SETTLE_S}s (nginx fail_timeout) before the next instance..." >&2; sleep "$ROLL_SETTLE_S"; }

health() {
  local port="$1"
  for _ in $(seq 1 30); do
    curl -fsS -m 3 "http://127.0.0.1:${port}${NOVADA_MCP_HEALTH_PATH:-/health/ready}" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

REMAINING=$(echo $INSTANCE_PORTS | wc -w)
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
  REMAINING=$((REMAINING - 1))
  [ "$REMAINING" -gt 0 ] && settle
done
echo "ROLLING RESTART OK: both instances healthy"
REMOTE
