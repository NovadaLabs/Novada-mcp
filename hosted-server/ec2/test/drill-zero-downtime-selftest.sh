#!/usr/bin/env bash
# drill-zero-downtime-selftest.sh — persisted, re-runnable self-tests for
# ../drill-zero-downtime.sh's own failure-detection logic. These were
# originally run ad hoc (not saved) when drill-zero-downtime.sh was first
# written; this file is that verification made reviewable and repeatable,
# plus (per the 2026-10-29 round-2 incident-fix review) a NEW scenario that
# was missing before: "one real instance down, the other covers it via
# nginx-style failover" — the exact shape zero-downtime restarts depend on,
# as opposed to only ever testing a single backend in isolation.
#
# Each scenario starts one or more local `node:http` mock backends, points
# the drill at them (scenario 1-2 directly; scenario 3-4 through a tiny
# local failover proxy that mimics nginx's documented
# `proxy_next_upstream error timeout` default — see nginx-snippet-
# novada-mcp-proxy.conf's own comment for the real directive this mirrors),
# and asserts the drill's own exit code / pass-fail verdict.
#
# Usage: ./drill-zero-downtime-selftest.sh   (exit 0 = all 4 scenarios behaved
# as expected; exits 1 with a FAIL line on the first mismatch)
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRILL="$SELF_DIR/../drill-zero-downtime.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "SKIP: node not found on PATH — drill-zero-downtime-selftest.sh needs it only for its own local mock backends/proxy, never for the real drill" >&2
  exit 0
fi

FAILURES=0
fail() { FAILURES=$((FAILURES + 1)); echo "FAIL: $1" >&2; }

run_scenario() {
  local label="$1" url="$2" duration="$3" expect_exit="$4"
  echo "--- scenario: $label ---" >&2
  "$DRILL" "$url" "$duration" >/tmp/drill-selftest-out.$$ 2>&1
  local code=$?
  cat /tmp/drill-selftest-out.$$ >&2
  rm -f /tmp/drill-selftest-out.$$
  if [ "$code" != "$expect_exit" ]; then
    fail "$label: expected drill exit $expect_exit, got $code"
  else
    echo "ok: $label (exit $code as expected)" >&2
  fi
}

# ─── Scenario 1: always-up single backend -> drill PASSES (exit 0) ─────────
node "$SELF_DIR/fixtures/mock-backend.mjs" --port 18098 --mode up &
PID1=$!
sleep 0.3
run_scenario "always-up" "http://127.0.0.1:18098" 2 0
kill "$PID1" 2>/dev/null; wait "$PID1" 2>/dev/null

# ─── Scenario 2: a ~1s 502 window -> drill FAILS (exit 1) ───────────────────
node "$SELF_DIR/fixtures/mock-backend.mjs" --port 18099 --mode flaky &
PID2=$!
sleep 0.3
run_scenario "502-window" "http://127.0.0.1:18099" 4 1
kill "$PID2" 2>/dev/null; wait "$PID2" 2>/dev/null

# ─── Scenario 3: nothing listening at all -> drill FAILS (exit 1) ──────────
run_scenario "connection-refused" "http://127.0.0.1:18100" 1 1

# ─── Scenario 4 (NEW, round-2 incident-fix review): ONE real instance down,
# the other covers it via failover -> drill still PASSES (exit 0). This is
# the actual zero-downtime-restart shape: nginx's proxy_next_upstream
# (error timeout, the documented default — see nginx-snippet-
# novada-mcp-proxy.conf) routes around whichever instance just went down for
# a restart, so the PUBLIC endpoint the drill hammers never sees a failure
# even though one real backend genuinely is unreachable for the whole
# scenario. The local failover-proxy fixture mirrors exactly that behavior
# (round-robin, retry the other target on connection failure) — it is not a
# re-implementation of drill-zero-downtime.sh's own logic (that stays
# untouched and is exercised unmodified here), it is a stand-in for nginx.
node "$SELF_DIR/fixtures/mock-backend.mjs" --port 18101 --mode up &
PID_A=$!
# No backend started on 18102 at all for this scenario's whole duration —
# "one real instance down" for the FULL window, not a transient blip.
node "$SELF_DIR/fixtures/failover-proxy.mjs" --listen 18103 --targets 18101,18102 &
PID_PROXY=$!
sleep 0.3
run_scenario "one-real-instance-down (failover covers it)" "http://127.0.0.1:18103" 3 0
kill "$PID_A" "$PID_PROXY" 2>/dev/null
wait "$PID_A" 2>/dev/null; wait "$PID_PROXY" 2>/dev/null

echo "" >&2
if [ "$FAILURES" -gt 0 ]; then
  echo "DRILL SELF-TEST FAILED: $FAILURES scenario(s) behaved unexpectedly" >&2
  exit 1
fi
echo "DRILL SELF-TEST PASSED: all 4 scenarios (always-up, 502-window, connection-refused, one-real-instance-down-via-failover) behaved as expected"
exit 0
