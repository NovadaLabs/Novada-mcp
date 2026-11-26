#!/usr/bin/env bash
# roll-settle-selftest.sh — offline test for the nginx fail_timeout settle
# between instances in restart-rolling.sh (2026-11-26).
#
# Why: 2026-11-25 a rolling restart produced 2×502 "no live upstreams": an SSE
# GET /mcp on the OLD @3000 process hit proxy_read_timeout as @3000 came back,
# nginx's passive check (max_fails=1, fail_timeout=10s) marked @3000 down for
# 10 s, and the script began draining @3001 inside that window.
#
# How: extract the REMOTE heredoc from restart-rolling.sh and run it locally
# with stub sudo/curl/flock/sleep on PATH; assert the call order.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../restart-rolling.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
LOG="$T/calls.log"; : > "$LOG"
mkdir -p "$T/bin"
for c in sudo curl flock; do printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\nexit 0\n' "$c" "$LOG" > "$T/bin/$c"; done
printf '#!/usr/bin/env bash\necho "sleep $*" >> "%s"\nexit 0\n' "$LOG" > "$T/bin/sleep"
chmod +x "$T/bin/"*
awk "/<<'REMOTE'/{f=1;next} /^REMOTE\$/{f=0} f" "$SCRIPT" > "$T/remote.sh"
fails=0
check() { if eval "$1"; then echo "  ✓ $2"; else echo "  ✗ FAIL: $2"; fails=$((fails+1)); fi; }

run() { : > "$LOG"; env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T" "$@" bash "$T/remote.sh" > "$T/out" 2>&1; echo $?; }

echo "[roll-settle] default settle"
rc=$(run)
check '[ "$rc" = 0 ]' "remote script exits 0 with healthy stubs (rc=$rc)"
seq_=$(grep -E "^(sudo systemctl restart|sleep 12)" "$LOG" | tr '\n' '|')
check '[ "$seq_" = "sudo systemctl restart novada-mcp@3000|sleep 12|sudo systemctl restart novada-mcp@3001|" ]' "restart 3000 → settle 12s → restart 3001, no settle after the last (got: $seq_)"

echo "[roll-settle] override + validation"
rc=$(run NOVADA_MCP_ROLL_SETTLE_S=0)
check '[ "$rc" = 0 ] && ! grep -q "^sleep" "$LOG"' "NOVADA_MCP_ROLL_SETTLE_S=0 disables the settle — no sleep at all (rc=$rc)"
rc=$(run NOVADA_MCP_ROLL_SETTLE_S=20)
check 'grep -qx "sleep 20" "$LOG"' "NOVADA_MCP_ROLL_SETTLE_S=20 is honoured"
for bad in "abc" "-1" "61" "5;id" ""; do
  rc=$(run NOVADA_MCP_ROLL_SETTLE_S="$bad")
  if [ -z "$bad" ]; then check 'grep -qx "sleep 12" "$LOG"' "empty value falls back to 12"; continue; fi
  check '[ "$rc" != 0 ] && ! grep -q "^sudo systemctl restart" "$LOG"' "invalid NOVADA_MCP_ROLL_SETTLE_S='$bad' refused BEFORE any restart (rc=$rc)"
done

echo "[roll-settle] default settle covers nginx fail_timeout (static)"
CONF="$HERE/../nginx-novada-mcp.conf"
FT="$(grep -oE 'fail_timeout=[0-9]+' "$CONF" | head -1 | cut -d= -f2)"; FT="${FT:-10}"  # nginx default 10s
DEF="$(grep -oE 'NOVADA_MCP_ROLL_SETTLE_S:-[0-9]+' "$SCRIPT" | head -1 | cut -d- -f2)"
check '[ -n "$DEF" ] && [ "$DEF" -ge $((FT + 2)) ]' "default settle (${DEF}s) >= nginx fail_timeout (${FT}s, effectively up to $((FT+1))s) + margin"

echo "[roll-settle] deploy-ec2.sh carries the same settle (static)"
D="$HERE/../deploy-ec2.sh"
check 'grep -q "ROLL_SETTLE_S" "$D" && grep -q "LAST_CONVERGE_RESTARTED" "$D"' "deploy-ec2.sh defines the settle and tracks whether the previous instance was actually restarted"

[ "$fails" = 0 ] && { echo "[roll-settle] OK"; exit 0; } || { echo "[roll-settle] $fails failure(s)"; exit 1; }
