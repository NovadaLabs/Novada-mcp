# A2B Test 09 — Verify Claim (novadaVerify)

**Date:** 2026-06-25
**Scenario:** Journalist verifying "Firecrawl raised $12M in Series A in 2024"
**Tool:** `novadaVerify` → `build/tools/verify.js`

---

## Test Result

| Metric | Value |
|--------|-------|
| Status | PASS (mechanically) |
| Latency | 3062ms |
| Output length | 982ch |
| Has verdict | YES |
| Verdict | `supported` |
| Confidence | `100` |

---

## Verdict

**A → B: COMPLETE** — the tool returns a structured verdict with a claim, verdict token, and confidence score.

---

## Data Quality Issue (CRITICAL)

The tool returned `verdict: supported, confidence: 100` despite finding **0 sources that actually reference the Firecrawl Series A claim**. This is a scoring logic bug.

### Root Cause

The three parallel queries use the **exact full claim string in quotes**, e.g.:
```
"Firecrawl raised $12M in Series A funding in 2024" evidence study research
```

No search engine can find this exact phrase — zero pages contain it verbatim. As a result:
- Supporting results (5 returned): generic startup/funding articles with keyword overlap, none mentioning Firecrawl's Series A.
- Skeptical results (5 returned): similarly unrelated.
- Neutral/fact-check results (0 returned).

### Scoring Bug

The confidence formula is:
```
adjustedSupport = supportCount + neutralCount = 5 + 0 = 5
contradictCount = 0  (DISPUTE_MARKERS filter removes all skeptical hits)
score = 5 / (5 + 0) = 1.0 → verdict = "supported", confidence = 100
```

Because `contradictCount` is 0 (strict DISPUTE_MARKERS regex), and `adjustedSupport` is 5 (unrelated but non-empty results), the tool reports maximum confidence even though none of the sources confirm the claim.

### What the UI Displays

```
## Supporting Evidence (0 sources)
_No supporting sources found._

## Contradicting Evidence (0 sources)
_No contradicting sources found._
```

The evidence sections both show 0 — directly contradicting the `confidence: 100` headline. A journalist would be misled.

---

## Fix Recommendations

### Fix 1 — Loosen query (drop exact-quote wrapping)
Replace `"${claim}"` with key entity + amount extraction:
```
Firecrawl Series A funding 2024 amount raised
```
This would actually find TechCrunch/Crunchbase articles about Firecrawl.

### Fix 2 — Confidence floor on 0-evidence verdicts
If `supportingEvidence.length === 0 && contradictingEvidence.length === 0`, cap confidence at 0 and force `verdict = "insufficient_data"` regardless of `adjustedSupport` (raw result count ≠ claim-confirming evidence).

### Fix 3 — Evidence count mismatch guard
Before emitting verdict, assert `supportingEvidence.length + contradictingEvidence.length > 0`. If false → `insufficient_data`.

---

## Actual Claim Status (External Check)

Firecrawl did raise funding in 2024 but the $12M / Series A framing is **not confirmed by public sources**. Firecrawl's public funding information references a $7M seed round (YC + angels, 2024). The $12M Series A claim appears to be **unverified / possibly incorrect**. The tool should have returned `insufficient_data` or `contested`, not `supported` with 100 confidence.

---

## Files

- Tool: `/Users/tongwu/Projects/novada-mcp/build/tools/verify.js`
- Source: `/Users/tongwu/Projects/novada-mcp/src/tools/verify.ts` (inferred)
