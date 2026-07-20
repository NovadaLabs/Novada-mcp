#!/usr/bin/env python3
"""
diff-golden.py <baseline_dir> <after_dir>

Extraction of deploy-hosted.sh's inline Python heredoc — the "TWO-TIER VERDICT"
block inside PHASE 5 (VERIFY), originally ~lines 245-367 of that script — into a
standalone, independently runnable/testable module. This is a PORT, not a
redesign: the same two-tier verdict logic is preserved exactly —

    TIER 1 (HARD GATE, zero-diff required): 7 deterministic, security/contract
    files — refused-set.json (firewall), toolslist-default/all/groups.json (tool
    contract), error-path.json, redaction-probe.json (also hard-fails on
    leaked=true), initialize.json (capabilities).

    TIER 2 (ADVISORY, printed not gated): dispatch-matrix.json per-tool shape —
    EXCEPT a tool's routing status crossing INTO or OUT OF a refused/unknown
    state (ROUTING_BAD_STATES), which escalates that specific finding to the
    hard-gate tier.

deploy-hosted.sh keeps its OWN inline copy of this logic for this pass (left
fully intact, byte-for-byte, on purpose). FOLLOW-UP, flagged not done here:
deploy-hosted.sh's VERIFY phase should be refactored to shell out to this
script (`python3 scripts/golden/diff-golden.py "$GOLDEN_BASELINE" "$GOLDEN_TMP"`)
instead of maintaining a second inline copy of the same verdict logic. Until
that follow-up lands, the two copies must be kept in sync by hand if the
verdict logic ever changes.

One deliberate, narrow behavior change from the heredoc, made during this
extraction (not a change to the two-tier *architecture* — only to missing-file
handling for the 7 hard-gate files):

    The original heredoc treats a hard-gate file MISSING FROM BASELINE as soft
    ("note but don't fail — baseline maintenance issue") regardless of whether
    after_dir has it. That was a reasonable default while baseline/ was still
    being built up incrementally. Today baseline/ is a frozen, checked-in
    artifact (see BASELINE.md — a specific captured version is pinned), so a
    hard-gate file missing from baseline_dir is itself a broken/corrupted
    baseline — a real regression in the regression net, not baseline
    maintenance noise. This script therefore FAILS LOUD (hard gate) in BOTH
    missing-file directions for the 7 HARD_GATE_FILES: baseline missing a file
    after_dir has, after_dir missing a file baseline has, or missing in both.
    dispatch-matrix.json (advisory tier) keeps the original asymmetric
    behavior: missing in baseline is a soft warning (advisory files never
    hard-gate on their own absence), missing in after_dir is still a hard fail
    (a fresh capture that omits a file it should always produce is a capture
    bug, not baseline drift).

Usage:
    python3 diff-golden.py <baseline_dir> <after_dir>

Exit codes:
    0  VERDICT: CLEAN        — no hard-gate failures (dispatch-matrix advisory
                               diff may still be non-empty; that's expected)
    1  VERDICT: NEEDS_REVIEW — one or more hard-gate failures, OR a usage/path
                               error (missing/invalid baseline_dir or after_dir)
"""

import json
import sys
import difflib
from pathlib import Path

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
#
# "timeout" added (NOV-854 hardening, 2026-07-19): capture-golden.py's dispatch
# exception handler (_run_dispatch, the try/except wrapping call_tool()) is the
# ONLY place dispatch-matrix.json's "status" field gets a value other than "ok"/
# "err" — see its `except Exception as e: return name, {"status": "timeout", ...}`
# branch. A mass paid-tool breakage from rate-limiting or wallet depletion (a
# malformed/non-JSON-RPC response that fails _parse_sse, or a hung request) lands
# a tool in this exact "timeout" state. Before this fix that crossing was invisible
# to the hard gate — dispatch-matrix.json is advisory-tier, so a swath of tools
# flipping ok -> timeout would only ever print in the human-glance advisory diff
# (VERDICT: CLEAN), never fail CI. Confirmed by reading capture-golden.py directly:
# no other status string ("refused"/"not_enabled"/"unknown"/"unknown_tool"/
# "no_handler") is ever actually written to dispatch-matrix.json today — those
# values are reserved for other routing-bad producers — so "timeout" is the one
# real gap this pass closes; the four pre-existing entries are left untouched.
ROUTING_BAD_STATES = {"refused", "not_enabled", "unknown", "unknown_tool", "no_handler", "timeout"}


def _tier1_hard_gate(baseline_dir: Path, after_dir: Path) -> list:
    """Compare the 7 HARD_GATE_FILES. Returns a list of hard_issues (empty = clean).
    Prints a clear per-file verdict line for each of the 7 files as it goes.
    """
    hard_issues = []

    for fname in HARD_GATE_FILES:
        bpath = baseline_dir / fname
        apath = after_dir / fname
        b_exists = bpath.exists()
        a_exists = apath.exists()

        # ── missing-file handling (see module docstring for the deliberate
        # deviation from the original heredoc: fail loud, both directions) ──
        if not b_exists and not a_exists:
            hard_issues.append(f"MISSING in both baseline and after (hard-gate file): {fname}")
            print(f"  [FAIL] {fname}: missing in BOTH baseline_dir and after_dir")
            continue
        if not b_exists:
            hard_issues.append(
                f"MISSING in baseline (hard-gate file): {fname} — after_dir has it, "
                f"baseline_dir does not (broken/incomplete baseline, not skippable)")
            print(f"  [FAIL] {fname}: missing in baseline_dir (present in after_dir)")
            continue
        if not a_exists:
            hard_issues.append(f"MISSING in after (hard-gate file): {fname}")
            print(f"  [FAIL] {fname}: missing in after_dir (present in baseline_dir)")
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
            print(f"  [FAIL] {fname}: differs from baseline (hard gate)")
        else:
            print(f"  [OK]   {fname}: identical to baseline")

        # Extra hard check: redaction-probe must never report leaked=true
        if fname == "redaction-probe.json":
            try:
                probe = json.loads(a_txt)
                if probe.get("leaked") is True:
                    hard_issues.append("redaction-probe.json: leaked=true — SECRET LEAK ON HOSTED")
                    print("  [FAIL] redaction-probe.json: leaked=true — SECRET LEAK ON HOSTED")
            except Exception as e:
                hard_issues.append(f"redaction-probe.json parse error: {e}")
                print(f"  [FAIL] redaction-probe.json: parse error: {e}")

    return hard_issues


def _tier2_advisory(baseline_dir: Path, after_dir: Path) -> tuple:
    """Compare dispatch-matrix.json (ADVISORY tier).
    Returns (routing_regression_issues, ) — a list to be appended to hard_issues
    by the caller ONLY for the routing-escalation sub-check; the rest of the
    per-tool diff is printed for a human glance, never gated.
    """
    routing_regressions = []
    advisory_diff = ""
    escalation_issues = []

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
    elif not dm_b.exists() and not dm_a.exists():
        print("  [WARN] dispatch-matrix.json missing in both baseline_dir and after_dir "
              "— advisory tier, not gated")
    elif not dm_b.exists():
        print("  [WARN] baseline missing dispatch-matrix.json (advisory tier — not gated)")
    elif not dm_a.exists():
        escalation_issues.append("MISSING in after: dispatch-matrix.json")
        print("  [FAIL] dispatch-matrix.json: missing in after_dir "
              "(a fresh capture must always produce it)")

    if advisory_diff.strip():
        print("\n--- ADVISORY: routing/shape changes (human glance) ---")
        print(advisory_diff)
        print("--- END ADVISORY ---")
    else:
        print("\n--- ADVISORY: dispatch-matrix.json identical to baseline ---")

    # Routing regressions escalate to the hard tier
    if routing_regressions:
        escalation_issues.append(
            "ROUTING REGRESSION in dispatch-matrix (status crossed a refused/unknown boundary):\n"
            + "\n".join(routing_regressions))
        print("\n  [FAIL] dispatch-matrix.json: routing regression ESCALATED to HARD GATE:")
        for r in routing_regressions:
            print(r)

    return escalation_issues


def compare(baseline_dir: Path, after_dir: Path) -> int:
    """Run the full two-tier verdict. Returns 0 (CLEAN) or 1 (NEEDS_REVIEW)."""
    print(f"[diff-golden] baseline={baseline_dir}  after={after_dir}")
    print("\n--- TIER 1: HARD GATE (7 deterministic + security/contract files) ---")
    hard_issues = _tier1_hard_gate(baseline_dir, after_dir)

    print("\n--- TIER 2: ADVISORY (dispatch-matrix.json) ---")
    hard_issues += _tier2_advisory(baseline_dir, after_dir)

    if hard_issues:
        print("\n--- HARD GATE FAILURES ---")
        for iss in hard_issues:
            print(iss)
        print("--- END HARD GATE ---\n")
        print("VERDICT: NEEDS_REVIEW")
        return 1

    print("\n[HARD GATE] all 7 deterministic + security/contract files clean; no routing regression.")
    print("VERDICT: CLEAN")
    return 0


def main(argv: list) -> int:
    if len(argv) < 3:
        print("Usage: diff-golden.py <baseline_dir> <after_dir>", file=sys.stderr)
        return 1

    baseline_dir = Path(argv[1])
    after_dir = Path(argv[2])

    # Fail loud on a bad invocation rather than let a typo'd path silently
    # compare against nothing (Path.exists()/read_text() on a missing dir
    # would raise deep inside the loop with a much less useful traceback).
    if not baseline_dir.is_dir():
        print(f"ERROR: baseline_dir does not exist or is not a directory: {baseline_dir}",
              file=sys.stderr)
        return 1
    if not after_dir.is_dir():
        print(f"ERROR: after_dir does not exist or is not a directory: {after_dir}",
              file=sys.stderr)
        return 1

    return compare(baseline_dir, after_dir)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
