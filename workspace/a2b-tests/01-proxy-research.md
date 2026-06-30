# A2B Test 01: Proxy Research (A=question → B=actionable comparison)

**Date:** 2026-06-25
**Scenario:** "Which proxy API is the cheapest and most reliable in 2026?"
**Verdict:** PASS — A→B COMPLETE

---

## Test Execution

### Step 1: Search
- **Tool:** `novadaSearch` — query: `proxy API pricing comparison residential datacenter 2026`, engine: google, num: 5
- **Result:** 5 results returned, reranked, with `top_urls` chainable block
- **Timing:** ~2046–2342ms (two runs averaged)
- **Output size:** 2816 chars
- **Status:** PASS

### Step 2: Extract
- **Tool:** `novadaExtract` — url: `https://aimultiple.com/proxy-pricing`, format: markdown, render: auto
- **Result:** 13843 chars of article content with verified pricing data
- **Timing:** 354–670ms
- **Has pricing:** YES
- **Status:** PASS

---

## A→B Quality

**Search result snippets (B-level data in results themselves):**
- Result 4 (dataimpulse.com): "$1/GB residential, $0.50/GB datacenter, $2/GB mobile — pay-as-you-go"
- Result 3 (titannet.io): "residential proxies start at $4/GB with plans beginning at $499/month"
- Result 5 (Reddit): "Residential proxies that used to run $10+/GB are now often closer to $3–$4/GB"

**Extracted article pricing (aimultiple.com/proxy-pricing):**
- Residential: $3–$15/GB average; Decodo is cheapest at highest GB/$ ratio across 10GB–10TB
- Datacenter: starts as low as $0.50/IP
- Article includes full provider comparison table with volume pricing

**The search alone (Step 1) already gets the user to B** — four of five snippets contain actionable price ranges. The extract step deepens it with provider-level comparison.

---

## Issues Found

### URL Regex Bug in Test Script
The original test script uses `results.match(/https?:\/\/[^\s\)]+/)?.[0]` to extract the top URL.

**Problem:** On the first run, this accidentally matched a URL embedded in a markdown link inside the results body (worked). On subsequent runs, the first `https://` match was inside a markdown link `[text](url)` and the regex captured the closing `)` or the URL was absent from the early portion of the output, returning `undefined` — causing `novadaExtract` to fail with `url: undefined`.

**Root cause:** The search output has a `## Chainable Output` section at the bottom with clean `[1] https://...` lines. The correct extraction pattern is:
```js
results.match(/\[1\] (https?:\/\/[^\s]+)/)?.[1]
```

**Severity:** Medium — test script fragility, not an API bug. The API itself returns correct data.

### Intermittent Empty Response (351ch)
One call returned a 351-char "No results found" response (search #2 in debug sequence) before returning full 2816-char results on the next call. Likely a transient scraper-api upstream issue. Not reproducible on retry.

---

## Timing Summary

| Step | Time | Size |
|------|------|------|
| Search (google, 5 results) | 2046–2342ms | 2816 chars |
| Extract (aimultiple.com) | 354–670ms | 13843 chars |
| **Total** | **~2.4–3.0s** | **16.6KB** |

---

## Final Verdict

| Criteria | Result |
|----------|--------|
| Search returns results | PASS |
| Results contain pricing data | PASS (4/5 snippets have $ figures) |
| Extract returns full article | PASS |
| Article contains pricing comparison | PASS |
| A→B transformation complete | PASS |

**Overall: PASS.** A developer asking "which proxy API is cheapest in 2026" gets actionable price ranges ($0.50/GB datacenter, $1–$4/GB residential) from search alone, with full provider comparison table available via one extract call. Total latency ~2.4–3.0s.
