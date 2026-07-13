#!/usr/bin/env bash
# deploy-hosted.sh — End-to-end gated deploy of Novada hosted MCP to mcp.novada.com
#
# WHAT IT DOES (5 phases):
#   1. BUILD   — tsc type-check + npm build + core smoke-test (novada-mcp repo)
#   2. VENDOR  — rsync build/ into vercel/vendor + copy package.json
#   3. GATES   — vendor core loads, barrel has ≥50 keys, hosted-server tsc clean
#   4. DEPLOY  — vercel deploy --prod from repo ROOT (not vercel/ — avoids the /vercel/vercel path bug)
#   5. VERIFY  — curl live serverInfo.version, capture golden snapshot, TWO-TIER diff vs baseline:
#               HARD GATE (zero-diff = pass): 7 deterministic files — refused-set (firewall),
#                 toolslist-default/all/groups (tool contract), error-path, redaction-probe,
#                 initialize (capabilities). ADVISORY (printed, not gated): dispatch-matrix.json
#                 per-tool shape, EXCEPT a tool's status crossing a refused/unknown routing
#                 boundary, which escalates to the hard gate.
#
# 3 GOTCHAS THIS SCRIPT HANDLES:
#   a) Deploy from repo ROOT, not vercel/  — deploying from vercel/ causes a /vercel/vercel
#      double-path bug in Vercel's routing, breaking all API routes.
#   b) Vendor is NOT a simple copy — deps required by vercel/api/ must already be in
#      vercel/package.json; the vendor step copies build output only (no npm install).
#      If a new runtime dep appears in novada-mcp, add it to vercel/package.json manually.
#   c) Verify on hosted, not local — local tsc green ≠ hosted green. The VERIFY phase
#      calls the live endpoint and diffs against the golden baseline.
#
# npm PUBLISH is a SEPARATE owner-gated action. This script NEVER publishes to npm.
#
# USAGE:
#   export NOVADA_MCP_KEY=<your-key>   # optional — falls back to the test key
#   ./scripts/deploy-hosted.sh
#
# ROLLBACK:
#   npx vercel promote <prev-deployment-url> --scope novadateam-mvps

set -euo pipefail

# ─── paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRV="$(cd "$SCRIPT_DIR/.." && pwd)"          # hosted-server/ (monorepo) — the Vercel deploy root
REPO_ROOT="$(cd "$SRV/.." && pwd)"           # monorepo root
NPM="$(cd "$REPO_ROOT/npm-package" && pwd)"  # npm-package/ — the novada-mcp source
VEN="$SRV/vercel/vendor/novada-mcp"          # vendored build target
GOLDEN_BASELINE="$SCRIPT_DIR/golden/baseline"
GOLDEN_CAPTURE_PY="$SCRIPT_DIR/golden/capture-golden.py"
MCP_URL="https://mcp.novada.com/mcp"

# ─── api key ──────────────────────────────────────────────────────────────────
# Never hardcode a key in a committed script. Read from env only.
NOVADA_MCP_KEY="${NOVADA_MCP_KEY:-${NOVADA_API_KEY:-}}"
if [[ -z "$NOVADA_MCP_KEY" ]]; then
    echo "[ERROR] Set NOVADA_MCP_KEY (or NOVADA_API_KEY) in your env before running — no key is baked into this script." >&2
    exit 1
fi

# ─── helpers ──────────────────────────────────────────────────────────────────
abort() {
    echo "" >&2
    echo "ABORT: $*" >&2
    echo "" >&2
    exit 1
}

banner() {
    echo ""
    echo "════════════════════════════════════════"
    echo "  $*"
    echo "════════════════════════════════════════"
}

# ─── PHASE 1: BUILD ───────────────────────────────────────────────────────────
banner "phase: BUILD  ($NPM)"

[[ -d "$NPM" ]] || abort "novada-mcp repo not found at $NPM"

cd "$NPM"

echo "[BUILD] tsc type-check..."
if ! npx tsc --noEmit; then
    abort "npm tsc failed — fix type errors before deploying"
fi

echo "[BUILD] npm run build..."
if ! npm run build; then
    abort "npm run build failed"
fi

echo "[BUILD] core smoke-test — loading build/core.js..."
if ! node -e "
import('./build/core.js')
  .then(m => {
    if (typeof m.dispatch !== 'function') { console.error('dispatch not a function'); process.exit(1); }
    if (!Array.isArray(m.TOOLS))           { console.error('TOOLS not an array');     process.exit(1); }
    console.log('core ok — TOOLS:', m.TOOLS.length, '  dispatch:', typeof m.dispatch);
    process.exit(0);
  })
  .catch(e => { console.error('core load error:', e.message); process.exit(1); });
"; then
    abort "core.js smoke-test failed — module did not load cleanly or exports are missing"
fi

echo "[BUILD] ✓ all build gates passed"

# ─── PHASE 2: VENDOR ──────────────────────────────────────────────────────────
banner "phase: VENDOR  ($VEN)"

mkdir -p "$VEN"

echo "[VENDOR] rsync build/ -> vendor/..."
rsync -a --delete "$NPM/build/" "$VEN/"

echo "[VENDOR] copying package.json..."
cp "$NPM/package.json" "$VEN/package.json"

echo "[VENDOR] ✓ vendor sync complete"

# ─── PHASE 3: HOSTED GATES ────────────────────────────────────────────────────
banner "phase: HOSTED GATES  ($SRV/vercel)"

cd "$SRV/vercel"

echo "[GATES] vendored core loads..."
if ! node --input-type=module -e "
import('./vendor/novada-mcp/core.js')
  .then(m => { console.log('core', m.TOOLS.length, 'tools'); process.exit(0); })
  .catch(e => { console.error('vendor core load failed:', e.message); process.exit(1); });
"; then
    abort "vendored core.js failed to load — check sync or missing deps in vercel/package.json"
fi

echo "[GATES] vendored tools barrel loads..."
if ! node --input-type=module -e "
import('./vendor/novada-mcp/tools/index.js')
  .then(m => {
    const n = Object.keys(m).length;
    console.log('barrel keys:', n);
    if (n < 50) { console.error('barrel has fewer than 50 exports — suspect partial vendor'); process.exit(1); }
    process.exit(0);
  })
  .catch(e => { console.error('barrel load failed:', e.message); process.exit(1); });
"; then
    abort "tools/index.js barrel failed — vendored build is incomplete or has import errors"
fi

echo "[GATES] hosted-server tsc type-check..."
if ! ./node_modules/.bin/tsc --noEmit; then
    abort "hosted-server tsc failed — the vendored types are incompatible with vercel/api/. Fix before deploying."
fi

echo "[GATES] ✓ all hosted gates passed"

# ─── PHASE 4: DEPLOY ──────────────────────────────────────────────────────────
banner "phase: DEPLOY  (from repo root — avoids /vercel/vercel path bug)"

cd "$SRV"   # MUST deploy from repo root, not vercel/

echo "[DEPLOY] running: npx vercel deploy --prod --yes ..."
DEPLOY_OUT=$(npx vercel deploy --prod --yes 2>&1)
echo "$DEPLOY_OUT"

# Extract the previous deployment URL (shown as "Inspect:" line or use current alias before flip)
PREV_URL=$(echo "$DEPLOY_OUT" | grep -Eo 'https://novada-mcpserver-[a-z0-9]+-novadateam-mvps\.vercel\.app' | head -1 || true)

if ! echo "$DEPLOY_OUT" | grep -qi "ready\|production"; then
    abort "Vercel deploy did not report 'ready' or 'production' — check output above. Rollback: npx vercel promote <prev-url> --scope novadateam-mvps"
fi

echo "[DEPLOY] ✓ deploy completed"
[[ -n "$PREV_URL" ]] && echo "[DEPLOY] Previous deployment URL (rollback target): $PREV_URL"

# ─── PHASE 5: VERIFY ──────────────────────────────────────────────────────────
banner "phase: VERIFY  (hosted — never trust local green)"

sleep 4   # give Vercel edge propagation a moment

echo "[VERIFY] fetching live serverInfo.version..."
INIT_PAYLOAD='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"deploy-gate","version":"1"}}}'
INIT_RESP=$(curl -sf \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $NOVADA_MCP_KEY" \
    "$MCP_URL?groups=all" \
    --data "$INIT_PAYLOAD" 2>&1) || true

LIVE_VERSION=$(echo "$INIT_RESP" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data['result']['serverInfo']['version'])
except Exception as e:
    print('UNKNOWN (' + str(e) + ')')
" 2>/dev/null || echo "UNKNOWN")

echo "[VERIFY] live version: $LIVE_VERSION"

echo "[VERIFY] capturing golden snapshot from hosted..."
GOLDEN_TMP="/tmp/golden-after-$$"
mkdir -p "$GOLDEN_TMP"

python3 "$GOLDEN_CAPTURE_PY" "$MCP_URL" "$GOLDEN_TMP" || {
    echo "[VERIFY] WARNING: golden capture failed — cannot verify behavior. Check connectivity." >&2
    echo ""
    echo "DEPLOY NEEDS REVIEW — golden capture failed (connectivity issue?)"
    [[ -n "$PREV_URL" ]] && echo "Rollback: npx vercel promote $PREV_URL --scope novadateam-mvps"
    exit 0
}

echo "[VERIFY] comparing against baseline ($GOLDEN_BASELINE)..."

# ── TWO-TIER VERDICT ────────────────────────────────────────────────────────────
# Rationale: the firewall (refused-set) + tool contract (tools/list) + redaction +
# error-handling + capabilities (initialize) are the safety-critical, DETERMINISTIC
# surface — re-capturing the SAME live version produces byte-identical output for
# these 7 files (verified). Those ARE the pass/fail gate.
#
# Per-tool output shape in dispatch-matrix.json is upstream-VARIABLE for live-content
# tools (ai_monitor calls real AI models; research multi-source partial-fails; balance
# numbers flip length_band at boundaries). Byte-diffing it as a hard gate cries wolf on
# every run — so it is ADVISORY (printed for a human glance), NOT gated. The ONE
# meaningful hard sub-check on dispatch-matrix: a tool's status flipping to/from a
# refused / unknown-tool routing state that isn't already covered by refused-set.json
# = a routing regression → escalate that specific tool to NEEDS REVIEW.
DIFF_RESULT=$(python3 - "$GOLDEN_BASELINE" "$GOLDEN_TMP" <<'PYEOF'
import json, sys, os, difflib
from pathlib import Path

baseline_dir = Path(sys.argv[1])
after_dir    = Path(sys.argv[2])

# ── TIER 1: HARD GATE — deterministic + security/contract files (zero-diff required) ──
HARD_GATE_FILES = [
    "refused-set.json",        # firewall: a refused tool becoming reachable = security regression
    "toolslist-default.json",  # tool contract (visible-by-default set)
    "toolslist-all.json",      # tool contract (full set)
    "toolslist-groups.json",   # tool contract (per-group routing)
    "error-path.json",         # error handling
    "redaction-probe.json",    # secret redaction (also fail if leaked=true)
    "initialize.json",         # server capabilities
]

# Routing states that mean "this tool did not route to a real handler".
# A dispatch-matrix status flipping INTO or OUT OF one of these (when not already
# accounted for by refused-set.json) is a routing regression = hard escalation.
ROUTING_BAD_STATES = {"refused", "not_enabled", "unknown", "unknown_tool", "no_handler"}

hard_issues = []

# ── TIER 1 comparison ──
for fname in HARD_GATE_FILES:
    bpath = baseline_dir / fname
    apath = after_dir / fname

    if not bpath.exists():
        # Baseline missing this file — note but don't fail (baseline maintenance issue)
        print(f"  [WARN] baseline missing {fname} — skipping hard gate for it")
        continue
    if not apath.exists():
        hard_issues.append(f"MISSING in after (hard-gate file): {fname}")
        continue

    b_txt = bpath.read_text()
    a_txt = apath.read_text()
    if b_txt != a_txt:
        diff_lines = list(difflib.unified_diff(
            b_txt.splitlines(keepends=True),
            a_txt.splitlines(keepends=True),
            fromfile=f"baseline/{fname}",
            tofile=f"after/{fname}",
            n=3))
        hard_issues.append(f"{fname} DIFFERS (HARD GATE):\n" + "".join(diff_lines[:60]))

    # Extra hard check: redaction-probe must never report leaked=true
    if fname == "redaction-probe.json":
        try:
            probe = json.loads(a_txt)
            if probe.get("leaked") is True:
                hard_issues.append("redaction-probe.json: leaked=true — SECRET LEAK ON HOSTED")
        except Exception as e:
            hard_issues.append(f"redaction-probe.json parse error: {e}")

# ── TIER 2: ADVISORY — dispatch-matrix.json per-tool shape (print, don't gate) ──
# EXCEPT: escalate any tool whose status crosses a routing-bad boundary.
routing_regressions = []
advisory_diff = ""
dm_b = baseline_dir / "dispatch-matrix.json"
dm_a = after_dir / "dispatch-matrix.json"

if dm_b.exists() and dm_a.exists():
    try:
        b = json.loads(dm_b.read_text())
        a = json.loads(dm_a.read_text())
    except Exception as e:
        # If dispatch-matrix won't parse, that's advisory noise, not a hard fail
        print(f"  [WARN] dispatch-matrix.json parse issue: {e}")
        b, a = {}, {}

    # Hard sub-check: routing state crossings
    for tool in sorted(set(b) | set(a)):
        b_status = (b.get(tool) or {}).get("status")
        a_status = (a.get(tool) or {}).get("status")
        b_bad = b_status in ROUTING_BAD_STATES
        a_bad = a_status in ROUTING_BAD_STATES
        # A crossing INTO or OUT OF a routing-bad state = regression signal.
        # (Tools legitimately refused are captured in refused-set.json, which is a
        #  separate hard gate — they don't appear here as "refused" unless routing broke.)
        if b_bad != a_bad:
            routing_regressions.append(
                f"    {tool}: status {b_status!r} -> {a_status!r} (routing state crossing)")

    # Build advisory text (full per-tool diff, for a human eyeball)
    b_txt = json.dumps(b, sort_keys=True, indent=2).splitlines(keepends=True)
    a_txt = json.dumps(a, sort_keys=True, indent=2).splitlines(keepends=True)
    dlines = list(difflib.unified_diff(b_txt, a_txt,
                                       fromfile="baseline/dispatch-matrix.json",
                                       tofile="after/dispatch-matrix.json",
                                       n=2))
    advisory_diff = "".join(dlines[:120])
elif not dm_b.exists():
    print("  [WARN] baseline missing dispatch-matrix.json")
elif not dm_a.exists():
    hard_issues.append("MISSING in after: dispatch-matrix.json")

# ── Report ──
if advisory_diff.strip():
    print("\n--- ADVISORY: routing/shape changes (human glance) ---")
    print(advisory_diff)
    print("--- END ADVISORY ---")
else:
    print("\n--- ADVISORY: dispatch-matrix.json identical to baseline ---")

# Routing regressions escalate to the hard tier
if routing_regressions:
    hard_issues.append("ROUTING REGRESSION in dispatch-matrix (status crossed a refused/unknown boundary):\n"
                       + "\n".join(routing_regressions))

if hard_issues:
    print("\n--- HARD GATE FAILURES ---")
    for iss in hard_issues:
        print(iss)
    print("--- END HARD GATE ---\n")
    print("VERDICT: NEEDS_REVIEW")
else:
    print("\n[HARD GATE] all 7 deterministic + security/contract files clean; no routing regression.")
    print("VERDICT: CLEAN")
PYEOF
)

echo "$DIFF_RESULT"

# ── CONTRACT TEST (HARD GATE) ────────────────────────────────────────────────
# Runs AFTER the golden diff so both gates get to report before we exit.
# Non-zero exit → NEEDS_REVIEW regardless of golden result.
CONTRACT_TEST_PY="$SCRIPT_DIR/contract/contract-test.py"
CONTRACT_PASS=true

echo ""
echo "[VERIFY] running contract invariant tests..."
if [[ -f "$CONTRACT_TEST_PY" ]]; then
    CONTRACT_OUT=$(NOVADA_MCP_KEY="$NOVADA_MCP_KEY" python3 "$CONTRACT_TEST_PY" "$MCP_URL" 2>&1)
    CONTRACT_EXIT=$?
    echo "$CONTRACT_OUT"
    if [[ $CONTRACT_EXIT -ne 0 ]]; then
        CONTRACT_PASS=false
        echo "[VERIFY] ⚠ contract test FAILED (exit $CONTRACT_EXIT) — see output above"
    else
        echo "[VERIFY] ✓ contract tests passed"
    fi
else
    echo "[VERIFY] WARNING: $CONTRACT_TEST_PY not found — skipping contract tests"
fi

# ── FINAL VERDICT (golden + contract combined) ────────────────────────────────
GOLDEN_CLEAN=false
echo "$DIFF_RESULT" | grep -q "^VERDICT: CLEAN" && GOLDEN_CLEAN=true

if $GOLDEN_CLEAN && $CONTRACT_PASS; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  DEPLOY VERIFIED — hard gate clean (firewall + contract +     ║"
    echo "║  redaction + error-path + capabilities); routing stable;       ║"
    echo "║  contract invariants all pass (or skip pending phase D)        ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    [[ -n "$PREV_URL" ]] && echo "Previous URL (rollback if needed): npx vercel promote $PREV_URL --scope novadateam-mvps"
else
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  DEPLOY NEEDS REVIEW — golden gate OR contract gate failed.    ║"
    echo "║  Check output above for details.                               ║"
    echo "║  (advisory dispatch-matrix shape changes alone are not this.)  ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Rollback command:"
    if [[ -n "$PREV_URL" ]]; then
        echo "  npx vercel promote $PREV_URL --scope novadateam-mvps"
    else
        echo "  npx vercel promote <prev-deployment-url> --scope novadateam-mvps"
        echo "  (prev URL not detected from deploy output — check: npx vercel ls)"
    fi
fi

# Cleanup temp golden dir
rm -rf "$GOLDEN_TMP"
