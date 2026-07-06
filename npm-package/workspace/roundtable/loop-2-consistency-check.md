# Loop 2 — Consistency Check (Post-Fix Verification)
**Date:** 2026-06-22
**Role:** Verification Loop 2 — same questions as round 1, evaluated against updated source

---

## Source Verified

| File | Lines read | Fix present |
|------|-----------|-------------|
| `src/index.ts` | 640–670 (server description) | YES |
| `src/index.ts` | 225–315 (7 proxy tool Requires lines) | YES |
| `src/tools/setup.ts` | 40–70 (unified key note block) | YES |
| `src/tools/health.ts` | 200–220 (proxy not_configured message) | YES |

---

## Q1: Do you understand ONE API KEY = everything?

**Rating: CLEAR**

Evidence in updated code:
- Server description (line 648): "ONE API KEY (NOVADA_API_KEY) covers all products: search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning."
- `setup.ts` line 51: "**Unified API Key:** NOVADA_API_KEY covers search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning."
- `NOVADA_API_KEY` label note (line 41): "covers search, extract, crawl, research, scrape, monitor, verify, unblock"

Three independent signal points. The message is unambiguous.

**vs Round 1:** SAME — this was already CLEAR in round 1. No regression, no improvement needed here.

**Result: IMPROVED (maintained clarity, added setup.ts as third reinforcement)**

---

## Q2: Do you know proxy auto-provisions from API KEY?

**Rating: CLEAR**

Evidence in updated code:

All 7 proxy tool descriptions (novada_proxy, novada_proxy_residential, novada_proxy_isp, novada_proxy_datacenter, novada_proxy_mobile, novada_proxy_static, novada_proxy_dedicated) now read:

```
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
```

Additionally, `setup.ts` line 52 adds:
```
**Proxy auto-provision:** If NOVADA_PROXY_ENDPOINT is set, user/pass are auto-fetched from your account — no separate NOVADA_PROXY_USER/PASS needed.
```

And `health.ts` line 209:
```
- Proxy: Set NOVADA_PROXY_ENDPOINT (user/pass auto-provisioned from NOVADA_API_KEY). Or set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT for explicit credentials.
```

**vs Round 1:** IMPROVED. Round 1 found PARTIAL FAIL here — all 7 proxy tool descriptions said "Requires: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT" which directly contradicted the server-level auto-provisioning claim. That contradiction is now resolved. The tool-level description now matches runtime behavior.

**Result: IMPROVED — was PARTIAL FAIL, now CLEAR**

---

## Q3: What do you do if novada_extract returns low quality?

**Rating: PARTIALLY — one path present, escalation path still implicit**

The `novada_extract` description (lines 161–165) says:
```
Handles Cloudflare, DataDome, Kasada automatically via auto-escalation (static → JS render → Browser CDP).
Key rule: Leave render="auto" (default). Only set render="render" for known JS-heavy SPAs.
```

What the description provides:
- If quality is low due to JS rendering → set `render="render"` explicitly
- The auto-escalation chain is named (static → render → Browser CDP)

What is still missing:
- No explicit "if quality is still low after render=render, try..." escalation path
- No mention of `novada_scrape` as an alternative for platform-specific pages (Amazon, LinkedIn) when extract returns shallow content — this is in the description under "Not for" but framed as a routing rule, not a fallback action
- The description says "Works on anti-bot pages automatically" but does not tell an agent what to do if it still fails (i.e., escalate to novada_unblock with method="browser", or try novada_scrape)

**vs Round 1:** Round 1 (verify-1 and verify-4) found this "broken" — specifically, no recovery path described for when extract returns low quality. The description has not been changed between round 1 and now based on the source read. This was not one of the targeted fixes in `fix-proxy-descriptions.md`.

**Result: SAME — not fixed. Still lacks an explicit "if low quality, try X" escalation path in the novada_extract description itself.**

---

## Q4: What do you do if proxy shows "not configured"?

**Rating: CLEAR**

`health.ts` line 209 now reads:
```
- Proxy: Set NOVADA_PROXY_ENDPOINT (user/pass auto-provisioned from NOVADA_API_KEY). Or set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT for explicit credentials.
```

This directly tells the agent:
1. Minimum step: set `NOVADA_PROXY_ENDPOINT` only — credentials are auto-fetched
2. Alternative: set all three vars for explicit control

**vs Round 1:** IMPROVED. Round 1 found this misdirecting — the old message told agents to export all three vars (USER, PASS, ENDPOINT) without mentioning auto-provisioning. A new agent would waste time finding proxy credentials manually when only `NOVADA_PROXY_ENDPOINT` is needed. The new message corrects this.

**Result: IMPROVED — was misdirecting, now CLEAR**

---

## Q5: New confusing points found after fixes?

### 5a. "if not explicitly set" is slightly weaker than round 1's recommended fix

The fix-proxy-descriptions.md recommended:
```
NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY — no manual credential setup needed.
```

What was actually applied:
```
NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
```

The phrase "if not explicitly set" preserves optionality correctly (explicit credentials still work), but the round 1 recommended phrasing "no manual credential setup needed" was more direct for a new agent. Minor — the current wording is still clear enough.

### 5b. "Optional — needed for novada_proxy_* credential generation" in setup.ts is ambiguous

`setup.ts` line 48:
```
"optional — needed for novada_proxy_* credential generation"
```

This refers to NOVADA_PROXY_USER/PASS/ENDPOINT as a group, but the preceding line 52 says auto-provisioning only needs NOVADA_PROXY_ENDPOINT. An agent reading line 48 first might think all three are optional but still required together to unlock proxy, then read line 52 and get the correct nuance. The ordering is slightly confusing: the label note at line 48 bundles all three vars together, but line 52 separates ENDPOINT from USER/PASS. Not a blocking confusion — but if a future agent reads line 48 and stops there, they may not realize ENDPOINT alone suffices.

### 5c. novada_extract "low quality" path remains unaddressed (same as Q3)

No new confusion introduced by the fixes, but this pre-existing gap was not closed by the current round of fixes.

---

## Summary Table

| Question | Round 1 | Loop 2 | Delta |
|----------|---------|--------|-------|
| Q1: ONE API KEY = everything? | CLEAR | CLEAR | SAME (no regression) |
| Q2: Proxy auto-provisions from API KEY? | PARTIAL FAIL | CLEAR | IMPROVED |
| Q3: novada_extract low quality recovery? | BROKEN (no path) | PARTIAL (render= path present, no further escalation) | SAME (not fixed in this round) |
| Q4: Proxy "not configured" action? | MISDIRECTING | CLEAR | IMPROVED |
| Q5: New confusions? | — | 2 minor (5a, 5b) | NEW (minor, non-blocking) |

---

## Overall Verdict

**IMPROVED** — the two targeted fixes (Q2 proxy Requires lines, Q4 health.ts message) both landed correctly and eliminated the contradictions found in round 1. Q1 was already strong and remains so. Q3 was not targeted by this fix round and remains a gap. Two new minor ambiguities introduced (5a, 5b) but neither is blocking.

**Remaining action:** The novada_extract description should be extended with an explicit quality-failure escalation path (e.g., "If quality is low, try render='render'; for platform-specific pages use novada_scrape; for persistent failures use novada_unblock with method='browser'"). This is a separate fix not included in the current round.
