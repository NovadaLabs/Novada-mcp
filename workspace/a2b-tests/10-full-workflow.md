# Test 10: Full Workflow — Business Analyst A→B

**Date:** 2026-06-26
**Scenario:** Business analyst: search for "web scraping API" → find product page → extract structured pricing data
**Goal:** A (business question) → B (structured JSON with product name, price, features)

---

## Verdict: A→B COMPLETE (partial caveat on field extraction)

---

## Step 1: Search

**Query:** `scrapingbee pricing plans per month`
**Engine:** google | **Results:** 3
**Latency:** 1997ms
**Status:** PASS

Search returned pricing data directly in snippets — the business question was answered at step 1:

| Plan | Price | Credits/mo |
|------|-------|-----------|
| Freelance | $49/mo | 250,000 |
| Startup | $99/mo | 1,000,000 |
| Business | $249/mo | 3,000,000 |
| Business+ | $599/mo | 8,000,000 |
| Custom | contact | — |

**Source in snippet:** `https://www.scrapingbee.com/pricing/`

---

## Step 2: Extract JSON

**URL:** `https://www.scrapingbee.com/pricing/`
**Format:** json | **Render:** auto (resolved to static)
**Latency:** 567ms
**Output size:** 9396 chars
**Status:** PASS (content extracted; field values null — see Finding #1)

**Extracted structured_data (schema.org Product):**
```json
{
  "type": "Product",
  "fields": {
    "name": "ScrapingBee Web Scraping API",
    "description": "Web scraping API that handles headless browsers and rotates proxies.",
    "brand": "ScrapingBee",
    "ratingValue": "4.9"
  }
}
```

**Requested fields result:**
```json
{
  "price": null,
  "plan": null,
  "requests": null,
  "features": null
}
```

**Saved to:** `/Users/tongwu/Downloads/novada-mcp/2026-06-26/scrapingbee-com/2026-06-26_145351_scrapingbee-com.json`

---

## Findings

### Finding #1 — ISSUE: Pricing data not extracted from JS-rendered pricing page

**Severity:** Medium
**What happened:** `novadaExtract` with `render: 'auto'` resolved to **static** mode for `scrapingbee.com/pricing/`. The page content in the JSON output contains only navigation and footer links — no plan names, prices, or credit counts. The `fields` block returned all nulls.

**Root cause:** ScrapingBee's pricing page renders plan cards via JavaScript. Static fetch misses it. `render: 'auto'` should have escalated to JS render given the content gap, but the quality score was reported as 85 ("excellent") — the quality heuristic is scoring based on HTML completeness, not business content completeness.

**Expected behavior:** `render: 'auto'` should detect a pricing page with no price data and escalate to `render: 'render'`.

**Workaround proven:** Step 1 (search) already surfaced the pricing data via Google snippet. The A→B flow completed via search, not extract.

**Recommended fix:** Either lower the quality threshold for pages that contain zero numeric values when `fields` includes `price`, or add a fallback: if all requested `fields` are null after static fetch, auto-escalate to render.

---

### Finding #2 — POSITIVE: Search snippets surfaced structured pricing without extraction

The Google search result snippet for `scrapingbee.com/pricing/` contained a pre-formatted pricing table (plan name + price + credits). For pricing research, `novadaSearch` alone completed the business analyst's query. This is the expected fast path.

---

### Finding #3 — POSITIVE: Output file saved correctly

JSON output auto-saved to Downloads with date-scoped directory and timestamped filename. Schema.org structured data parsed and exposed under `structured_data`. `quality.score: 85` and `quality.label: excellent` reported.

---

## Timings

| Step | Latency |
|------|---------|
| novadaSearch | 1997ms |
| novadaExtract (static) | 567ms |
| Total | ~2.6s |

---

## Overall Assessment

The A→B workflow **completes** for a business analyst asking about pricing. The search step answers the question directly. The extract step succeeds as a tool call (no errors, file saved, schema.org data returned) but fails to surface the requested price/plan fields because the pricing table is JS-rendered and `render: 'auto'` stayed in static mode.

**Action required:** Fix `render: 'auto'` escalation logic — when all requested `fields` are null, treat as JS-render candidate and retry with render mode.
