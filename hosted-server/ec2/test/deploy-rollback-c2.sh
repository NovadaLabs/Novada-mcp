#!/usr/bin/env bash
# deploy-rollback-c2.sh — scripted regression test for C2 (2026-10-29 round-2
# incident-fix review): "rollback must never take down an instance that is
# healthy on the target release."
#
# This does NOT reimplement deploy-ec2.sh's logic — it extracts the REAL
# remote script body (the exact text inside deploy-ec2.sh's `<<'REMOTE'`
# heredoc, the thing that actually runs on the box over ssh) and runs it
# unmodified in a local sandbox, with only the ONE Linux-only OS primitive
# (_proc_cwd, which reads /proc and therefore can't run on macOS) swapped
# for a portable equivalent. Every decision — instance_release,
# converge_instance, which instance gets restarted, which gets rolled back —
# is the production code, verbatim. If deploy-ec2.sh's logic ever drifts
# from what this test exercises, that is a real production change, not a
# test-only reimplementation going stale on its own.
#
# Scenario (the exact one the incident-fix review traced):
#   1. Forward deploy (PREV -> NEWREL): instance @3000 restarts and is
#      healthy on NEWREL. Instance @3001 restarts (the process starts) but
#      its health check fails — a "bad release that starts but doesn't
#      serve" shape, not a restart-command failure.
#   2. deploy-ec2.sh's own rollback logic then rolls back ONLY @3001 (to its
#      own prior release, PREV) — @3000 must be left running NEWREL,
#      untouched, the ENTIRE time.
#
# Assertions:
#   - @3000 is restarted/spawned EXACTLY ONCE across the whole run (proves
#     it is never touched again during @3001's failure/rollback).
#   - @3000's recorded cwd (the sandboxed instance_release()) is NEWREL at
#     every point after its one restart — it never reverts.
#   - @3001 ends the run back on PREV and healthy (rollback succeeded for
#     the instance that actually needed it).
#   - The extracted script's own exit code is 1 (a partial failure is still
#     a reported failure, even though the rollback itself succeeded) and
#     its output explicitly names @3001 as rolled back and @3000 as
#     untouched.
#
# Usage: ./deploy-rollback-c2.sh   (exit 0 = PASS; prints a FAIL line and
# exits 1 on the first violated assertion)
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SELF_DIR/../deploy-ec2.sh"

# deploy-ec2.sh's extracted logic uses `declare -A` (bash 4+ — the real box
# runs bash 5.2.21, confirmed in ops-review.md). macOS ships bash 3.2 as
# /bin/bash for licensing reasons; prefer a newer bash if one is on PATH
# (e.g. Homebrew's) purely so this test can run on a macOS dev machine too —
# production never needs this, since the real box's own `bash` is already
# modern enough.
RUNNER_BASH="bash"
for candidate in /opt/homebrew/bin/bash /usr/local/bin/bash bash; do
  if command -v "$candidate" >/dev/null 2>&1; then
    ver="$("$candidate" -c 'echo "${BASH_VERSINFO[0]}"' 2>/dev/null || echo 0)"
    if [ "${ver:-0}" -ge 4 ] 2>/dev/null; then
      RUNNER_BASH="$(command -v "$candidate")"
      break
    fi
  fi
done
echo "using $RUNNER_BASH ($("$RUNNER_BASH" -c 'echo "$BASH_VERSION"')) to run the extracted logic" >&2

SANDBOX="$(mktemp -d -t novada-c2-test)"
trap 'rm -rf "$SANDBOX"' EXIT

FAILURES=0
fail() {
  FAILURES=$((FAILURES + 1))
  echo "FAIL: $1" >&2
}
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    fail "$label: expected [$expected], got [$actual]"
  else
    echo "ok: $label = [$actual]" >&2
  fi
}

# ─── 1. Extract the REAL remote script body from deploy-ec2.sh ─────────────
REMOTE_BODY="$SANDBOX/remote-body.sh"
awk "/^ssh \"\\\$HOST\" REL=\"\\\$REL\" bash -s <<'REMOTE'\$/{flag=1; next} /^REMOTE\$/{flag=0} flag" \
  "$DEPLOY_SCRIPT" > "$REMOTE_BODY"
LINES_EXTRACTED=$(wc -l < "$REMOTE_BODY" | tr -d ' ')
if [ "$LINES_EXTRACTED" -lt 50 ]; then
  echo "FAIL: extraction found only $LINES_EXTRACTED lines — deploy-ec2.sh's heredoc markers may have changed; update the awk pattern above" >&2
  exit 1
fi
echo "extracted $LINES_EXTRACTED lines from deploy-ec2.sh's REMOTE heredoc" >&2

# This test only exercises the deploy-DECISION logic (health/instance_release/
# converge_instance/the main converge+rollback+prune flow) — NOT the
# build/tar/npm-install section above it (lines before "INSTANCE_PORTS=" in
# the real script), which needs a real tarball, real npm, and a real `sudo -u
# novada` and has nothing to do with C2. Slice from "INSTANCE_PORTS=" onward
# — still the exact, unmodified production text for everything C2 is about —
# and the test wrapper below sets $R directly (the one variable the build
# section would otherwise have computed) instead of running that section.
LOGIC_ONLY="$SANDBOX/remote-logic-only.sh"
awk '/^INSTANCE_PORTS=/{flag=1} flag' "$REMOTE_BODY" > "$LOGIC_ONLY"
LOGIC_LINES=$(wc -l < "$LOGIC_ONLY" | tr -d ' ')
if [ "$LOGIC_LINES" -lt 20 ]; then
  echo "FAIL: logic slice found only $LOGIC_LINES lines — deploy-ec2.sh's INSTANCE_PORTS= marker may have moved; update the awk pattern above" >&2
  exit 1
fi

# Swap ONLY _proc_cwd (the one Linux-only primitive) for a sandbox-portable
# version that reads a side-channel file the fake systemctl writes at spawn
# time, instead of querying a real /proc. Every other function is untouched.
python3 -I - "$LOGIC_ONLY" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
old = '_proc_cwd() { readlink -f "/proc/$1/cwd" 2>/dev/null || true; }'
new = '_proc_cwd() { cat "$NOVADA_C2_TEST_STATE/pid-$1.cwd" 2>/dev/null || true; }'
assert old in content, "could not find _proc_cwd to patch — deploy-ec2.sh's implementation changed"
content = content.replace(old, new)
with open(path, "w") as f:
    f.write(content)
PYEOF

# ─── 2. Sandbox: fake root, fake PATH binaries, fake running instances ──────
# readlink -f the sandbox root ONCE, up front, and use that (not the raw
# mktemp path) for every expected-value comparison below: instance_release()
# itself goes through readlink -f (to resolve a real process's /proc/*/cwd),
# and on macOS /var is itself a symlink to /private/var — comparing a
# never-resolved path against an always-resolved one would spuriously fail
# every assertion despite both sides naming the identical file.
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
ROOT="$SANDBOX/opt/novada-mcp"
STATE="$SANDBOX/state"
BIN="$SANDBOX/bin"
mkdir -p "$ROOT/releases/PREV" "$ROOT/releases/NEWREL" "$STATE" "$BIN"
echo "prevrel" > "$ROOT/releases/PREV/RELEASE"
echo "newrel" > "$ROOT/releases/NEWREL/RELEASE"
ln -sfn "$ROOT/releases/PREV" "$ROOT/current"

export NOVADA_MCP_ROOT="$ROOT"
export NOVADA_C2_TEST_STATE="$STATE"
export NOVADA_MCP_HEALTH_POLL_S=2   # real production default is 30; shortened so a failing health check doesn't cost 30s here

# fake sudo: just exec the real command (we're not actually root in the sandbox)
cat > "$BIN/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF

# fake systemctl: understands exactly the three subcommands deploy-ec2.sh
# uses (show -p MainPID --value, restart, reset-failed) against
# novada-mcp@<port> units. "Restarting" means: stop whatever PID was
# recorded for that port, spawn a new background `sleep` process with its
# cwd set to wherever $NOVADA_MCP_ROOT/current resolves to AT THAT MOMENT
# (mirroring systemd's WorkingDirectory=current behavior), and record that
# resolved dir in a side-channel file keyed by the NEW pid (read back by the
# patched _proc_cwd above).
cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STATE="$NOVADA_C2_TEST_STATE"
cmd="$1"; shift
case "$cmd" in
  show)
    unit="$1"
    port="${unit#novada-mcp@}"; port="${port%.service}"
    pidfile="$STATE/port-${port}.pid"
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      cat "$pidfile"
    else
      echo 0
    fi
    ;;
  restart)
    unit="$1"
    port="${unit#novada-mcp@}"; port="${port%.service}"
    pidfile="$STATE/port-${port}.pid"
    countfile="$STATE/restart-count-${port}"
    old=0; [ -f "$countfile" ] && old="$(cat "$countfile")"
    echo $((old + 1)) > "$countfile"
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      kill "$(cat "$pidfile")" 2>/dev/null || true
      wait "$(cat "$pidfile")" 2>/dev/null || true
    fi
    target_dir="$(readlink -f "$NOVADA_MCP_ROOT/current")"
    ( exec sleep 600 ) &
    newpid=$!
    disown "$newpid" 2>/dev/null || true
    echo "$newpid" > "$pidfile"
    echo "$target_dir" > "$STATE/pid-${newpid}.cwd"
    exit 0
    ;;
  reset-failed)
    exit 0
    ;;
  *)
    echo "fake systemctl: unhandled subcommand: $cmd $*" >&2
    exit 1
    ;;
esac
EOF

# fake curl: only understands the one form deploy-ec2.sh issues
# (-fsS -m 3 http://127.0.0.1:<port>/health). Health is modeled on the
# (port, actually-running-release) PAIR — via the same pid/cwd side-channel
# the fake systemctl writes, not a bare port-keyed flag — so the SAME port
# can legitimately be healthy on PREV and unhealthy on NEWREL (what makes a
# real rollback meaningful) while still only failing on the ONE instance the
# scenario targets (a real bad release doesn't always reproduce identically
# on every instance). $STATE/health-fail-<port>-<release-key> (if present)
# marks that exact (port, release) pair as unhealthy.
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
STATE="$NOVADA_C2_TEST_STATE"
url=""
for a in "$@"; do
  case "$a" in http://*) url="$a" ;; esac
done
port="$(echo "$url" | sed -E 's#^http://127\.0\.0\.1:([0-9]+)/health$#\1#')"
pidfile="$STATE/port-${port}.pid"
if [ -f "$pidfile" ]; then
  pid="$(cat "$pidfile")"
  release="$(cat "$STATE/pid-${pid}.cwd" 2>/dev/null || true)"
  marker="$STATE/health-fail-${port}-$(echo "$release" | tr '/' '_')"
  if [ -n "$release" ] && [ -f "$marker" ]; then
    exit 22   # curl's own code for an HTTP failure status
  fi
fi
exit 0
EOF

# fake mv: `set_current()` in deploy-ec2.sh uses GNU coreutils' `mv -T`
# (treat the target as a plain file/symlink to be REPLACED, never traversed
# into, even if it resolves to a directory — the production box is
# Ubuntu/GNU coreutils, where `-T` does exactly this). macOS's BSD `mv` has
# no `-T` flag AND, without it, silently does the wrong thing here: `current`
# is a symlink to a directory, so a plain `mv current.new current` moves
# current.new INSIDE that directory instead of replacing the `current`
# symlink — verified empirically (a bare "strip -T and delegate" shim was
# tried first and silently broke every set_current() call in this test).
# This wrapper reproduces `-T`'s actual guarantee for the one (src dst) form
# this script ever uses: remove `dst` first (whatever it is) so the
# subsequent move can only ever be a plain rename, never a move-into.
# Local-test-only shim — the real box needs no such thing.
cat > "$BIN/mv" <<'EOF'
#!/usr/bin/env bash
args=()
for a in "$@"; do [ "$a" = "-T" ] || args+=("$a"); done
if [ "${#args[@]}" -eq 2 ]; then
  dst="${args[1]}"
  if [ -e "$dst" ] || [ -L "$dst" ]; then rm -f "$dst"; fi
fi
exec /bin/mv "${args[@]}"
EOF

# fake journalctl: only ever called as a best-effort diagnostic
# (`... || true` at the call site) on the failure path; a no-op is
# sufficient and keeps test output free of an irrelevant "not found" line.
cat > "$BIN/journalctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$BIN"/sudo "$BIN"/systemctl "$BIN"/curl "$BIN"/mv "$BIN"/journalctl

# ─── 3. Simulate initial state: both instances already running PREV ────────
for port in 3000 3001; do
  ( exec sleep 600 ) &
  pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" > "$STATE/port-${port}.pid"
  echo "$ROOT/releases/PREV" > "$STATE/pid-${pid}.cwd"
done

# ─── 4. The scenario: @3001 specifically fails its health check while
# running NEWREL (this round's actual incident shape: "a bad release caught
# on the second-iterated instance") — @3000 running the SAME NEWREL stays
# healthy (a real bad release doesn't always reproduce identically on every
# instance), and @3001 is healthy again once rolled back to PREV — this is
# what makes the ROLLBACK (not just the forward attempt) actually succeed,
# matching a real "revert to the last-known-good build."
NEWREL_MARKER_KEY="$(echo "$ROOT/releases/NEWREL" | tr '/' '_')"
touch "$STATE/health-fail-3001-${NEWREL_MARKER_KEY}"

# ─── 5. Run the extracted logic ────────────────────────────────────────────
# The real script computes R="$NOVADA_MCP_ROOT/releases/$REL" in the
# (skipped, build-only) section above INSTANCE_PORTS=. Set it directly here
# to our pre-made NEWREL — this is the one variable the build section would
# otherwise have produced; nothing about the DECISION logic below it changes.
RUNNER="$SANDBOX/runner.sh"
{
  echo "set -euo pipefail"
  echo "R=\"$ROOT/releases/NEWREL\""
  cat "$LOGIC_ONLY"
} > "$RUNNER"

OUTPUT="$SANDBOX/output.log"
PATH="$BIN:$PATH" "$RUNNER_BASH" "$RUNNER" >"$OUTPUT" 2>&1
EXIT_CODE=$?
echo "--- extracted script output ---" >&2
cat "$OUTPUT" >&2
echo "--- end output (exit code $EXIT_CODE) ---" >&2

# ─── 6. Assertions ──────────────────────────────────────────────────────────
assert_eq "overall exit code (partial failure is still a reported failure)" "1" "$EXIT_CODE"

PID_3000_AFTER="$(cat "$STATE/port-3000.pid")"

# The definitive "never touched again" proof: the fake systemctl increments
# restart-count-<port> on EVERY restart call for that port, across the ENTIRE
# run (forward converge AND the rollback phase both use the same
# systemctl/converge_instance machinery). If @3000 were restarted a second
# time for any reason during @3001's failure/rollback, this would be 2, not
# 1 — a PID-equality check alone would NOT prove this (a second restart
# could coincidentally reuse the same PID), so the count is the real
# assertion, not a redundant extra one.
RESTART_COUNT_3000="$(cat "$STATE/restart-count-3000" 2>/dev/null || echo 0)"
assert_eq "@3000 restart count (exactly one: the initial forward converge, never touched again)" "1" "$RESTART_COUNT_3000"

RESTART_COUNT_3001="$(cat "$STATE/restart-count-3001" 2>/dev/null || echo 0)"
assert_eq "@3001 restart count (forward attempt + rollback attempt)" "2" "$RESTART_COUNT_3001"

CWD_3000_AFTER="$(cat "$STATE/pid-${PID_3000_AFTER}.cwd")"
assert_eq "@3000 still running NEWREL (never reverted)" "$ROOT/releases/NEWREL" "$CWD_3000_AFTER"

PID_3001_AFTER="$(cat "$STATE/port-3001.pid")"
CWD_3001_AFTER="$(cat "$STATE/pid-${PID_3001_AFTER}.cwd")"
assert_eq "@3001 rolled back to PREV" "$ROOT/releases/PREV" "$CWD_3001_AFTER"

if ! grep -q "novada-mcp@3001" "$OUTPUT" || ! grep -qi "rolled back\|ROLLBACK OK" "$OUTPUT"; then
  fail "output does not clearly report @3001 as the rolled-back instance"
fi
if grep -qi "RESTART FAILED for novada-mcp@3000\|HEALTH CHECK FAILED for novada-mcp@3000" "$OUTPUT"; then
  fail "@3000 must never appear as failed/restarted in the output — it was never touched"
fi

echo "" >&2
if [ "$FAILURES" -gt 0 ]; then
  echo "C2 REGRESSION TEST FAILED: $FAILURES assertion(s) failed" >&2
  exit 1
fi
echo "C2 REGRESSION TEST PASSED: rollback touched only the failed instance; the healthy one was never restarted"
exit 0
