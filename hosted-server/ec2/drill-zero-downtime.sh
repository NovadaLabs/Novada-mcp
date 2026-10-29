#!/usr/bin/env bash
# drill-zero-downtime.sh — run ON the EC2 box to PROVE a rolling restart is
# actually zero-downtime, not just assume it from reading deploy-ec2.sh /
# restart-rolling.sh. Hammers GET /health and a POST /mcp (no credential —
# this exercises the real request path through nginx -> node without needing
# a real Novada API key) in a tight loop, and counts every response that
# indicates the PROXY LAYER failed to reach a working backend: a 502/503/504
# from nginx, a connection refusal, or a request timeout. Exits 1 if that
# count is ever > 0.
#
# A 401 (missing credential — the expected answer for the POST probe below)
# or a 200 (the /health probe) are both PASSES: they mean some backend was
# reachable and processed the request end-to-end. This drill measures
# AVAILABILITY of the proxy+backend pair, not application-level auth
# behavior — don't read a 401 in the log as a failure.
#
# Usage (run the drill and the restart from two different terminals/shells,
# or background the drill as shown):
#   ./drill-zero-downtime.sh https://mcp.novada.com 30 &
#   DRILL_PID=$!
#   ./restart-rolling.sh        # or deploy-ec2.sh — run from the OPERATOR machine
#   wait "$DRILL_PID"           # drill's own exit code is the pass/fail verdict
#
# This script does NOT launch the restart itself — it only measures the
# outage window while something else performs one. Designed to run directly
# on the EC2 box (hitting the public hostname over the loopback-reachable
# nginx listener is fine too; pass a base URL as the first argument).
set -uo pipefail   # deliberately NOT -e: a single failed curl must not abort the loop

BASE_URL="${1:-https://mcp.novada.com}"
DURATION_S="${2:-60}"
INTERVAL_S="${INTERVAL_S:-0.1}"
CURL_MAX_TIME_S="${CURL_MAX_TIME_S:-3}"

FAILS=0
TOTAL=0
START_TS=$(date +%s)

# True (exit 0) if this HTTP status code is a PROXY-LAYER failure signal.
# "000" / empty = curl itself couldn't get a status (connection refused,
# DNS failure, or it hit CURL_MAX_TIME_S before any response arrived).
is_failure_status() {
  case "$1" in
    502 | 503 | 504 | 000 | "") return 0 ;;
    *) return 1 ;;
  esac
}

probe() {
  local method="$1" path="$2"
  shift 2
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' -m "$CURL_MAX_TIME_S" -X "$method" "$@" "${BASE_URL}${path}" 2>/dev/null)"
  [ -n "$status" ] || status="000"
  TOTAL=$((TOTAL + 1))
  if is_failure_status "$status"; then
    FAILS=$((FAILS + 1))
    echo "$(date -u +%FT%TZ) FAIL ${method} ${path} -> ${status:-<no response>}" >&2
  fi
}

echo "drill-zero-downtime: hammering ${BASE_URL} for ${DURATION_S}s (interval ${INTERVAL_S}s)..." >&2
while [ "$(($(date +%s) - START_TS))" -lt "$DURATION_S" ]; do
  probe GET /health
  # A real MCP tool call shape (JSON-RPC over POST), deliberately with no
  # Authorization header — expected to come back 401, which is a PASS here
  # (see header comment). This is the "slow-ish POST" the brief asks for: a
  # non-idempotent request exercising the exact method that
  # proxy_next_upstream's non_idempotent carve-out (see
  # nginx-novada-mcp.conf) is about.
  probe POST /mcp -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"ping","id":1}'
  sleep "$INTERVAL_S"
done

echo "drill-zero-downtime: ${TOTAL} requests, ${FAILS} proxy-layer failure(s)" >&2
if [ "$FAILS" -gt 0 ]; then
  echo "DRILL FAILED: ${FAILS} proxy-layer failure(s) observed during the window — NOT zero-downtime" >&2
  exit 1
fi
echo "DRILL PASSED: zero proxy-layer failures across ${TOTAL} requests"
exit 0
