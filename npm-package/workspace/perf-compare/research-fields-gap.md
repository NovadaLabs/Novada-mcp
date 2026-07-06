# Field Extraction Gap Analysis: 25% vs Firecrawl 75%

**Date:** 2026-06-25
**Build:** v0.8.2-dev (local)
**Ref:** 10-final-scoreboard.md footnote on field extraction

---

## Current Architecture

### What We Have (fields.ts — 4 layers)

```
extractFields(fields, structuredData, markdown):
  1. Structured Data (JSON-LD via extractStructuredData)
     → Exact + fuzzy key match against schema.org types
     → Product, Article, Event, Person, Organization, WebPage
  2. Known Pattern Matching (PATTERN_MAP)
     → price, date, author, rating, availability, title,
       description, stars, language, license
     → 10 field types with hand-tuned regexes
  3. Generic Key-Value ("field: value" in markdown)
     → RegExp: /(?:\*\*)?FieldName(?:\*\*)?[:\s]+(.{3,100})/im
  4. Heading Section Fallback ("## FieldName\nvalue")
     → Finds markdown heading matching field, returns first line
```

### Why It Scores 25%

The 25% figure comes from the FIFA/sports benchmark: 7 domain-specific fields
(player stats, squad data, etc.) all returned null. The system works for
**generic e-commerce/article fields** (price, author, rating — ~80% hit rate)
but fails completely on **domain-specific or semantically arbitrary fields**
(e.g., "top scorer", "stadium capacity", "release date" on a movie page).

Root cause: **layers 1-4 are all deterministic**. They can only find what they
already have patterns for. No semantic understanding of page content.

---

## Why Firecrawl Gets 75%

Firecrawl's `/scrape` endpoint with `formats: ["json"]` + `jsonOptions.schema`:

1. Scrapes page to markdown (same as us)
2. Sends markdown + user's JSON schema + optional prompt to an LLM
3. LLM extracts fields semantically — no patterns needed
4. Cost: 5 credits/page (1 base + 4 for LLM extraction)

**This works on ANY page regardless of JSON-LD, meta tags, or HTML structure.**
The LLM understands "top scorer" means the person with the most goals in a table,
even if the table header says "Leading Goal Scorer" or "Goleador."

Firecrawl also has a **deterministic `product` format** that merges JSON-LD +
schema.org without LLM — similar to our layer 1. Their 75% score comes from the
LLM path, not the deterministic path.

---

## What We Can Do WITHOUT an LLM (Code-Only Fixes)

### Fix 1: OpenGraph + Twitter Card Meta Tags → Field Extraction

**Current state:** `extractDescription()` reads `og:description` but
`extractStructuredData()` does NOT surface OG/Twitter tags as field candidates.

**Change:** In `extractStructuredData()` (or a new `extractMetaTags()` function),
parse all `og:*` and `twitter:*` meta tags as a fallback structured data source.

```
og:title → title
og:description → description
og:image → image
og:site_name → site_name
og:type → type
og:url → url
article:published_time → datePublished
article:author → author
twitter:title → title (lower priority than og)
twitter:description → description
twitter:image:src → image
```

**Estimated improvement:** +5% overall. Many pages have OG tags but no JSON-LD.
News sites (BBC, CNN, NYT) all have rich OG tags. Currently these are extracted
for `title`/`description` display but NOT wired into the field extraction pipeline.

**Effort:** ~2 hours. Add `extractMetaTags(html): StructuredData | null` in
html.ts, call it as fallback when `extractStructuredData()` returns null, pass
the result to `extractFields()`.

---

### Fix 2: Wikipedia Infobox Parser

**Current state:** Wikipedia infoboxes ARE rendered as markdown tables (the table
extraction in html.ts already handles `class="infobox"` tables via the general
table renderer). But the field extraction layer doesn't parse markdown tables
to match field names against table headers/keys.

**Change:** Add a new extraction layer between layer 3 (generic key-value) and
layer 4 (heading section):

```
Layer 3.5: Markdown Table Key-Value Extraction
  For each table in markdown:
    If table has 2 columns (key-value pattern like infoboxes):
      For each row: if column[0] fuzzy-matches requested field → return column[1]
    If table has N columns with headers:
      For each header: if header fuzzy-matches requested field → return that column data
```

**Estimated improvement:** +10% overall. Covers:
- Wikipedia infoboxes (population, area, capital, date of birth, etc.)
- Comparison tables (specs, features, pricing)
- Sports stats tables (goals, assists, caps)
- Any page using HTML tables for structured data

**Effort:** ~4 hours. Parse markdown pipe-table format. Handle both `| Key | Value |`
(infobox) and `| Header1 | Header2 | ... |` (data table) patterns. Fuzzy match
field names against keys/headers (normalize whitespace, case-insensitive,
substring match).

---

### Fix 3: Schema.org Microdata + RDFa (Not Just JSON-LD)

**Current state:** `extractStructuredData()` ONLY parses
`<script type="application/ld+json">`. Many sites use Microdata
(`itemprop="price"`) or RDFa (`property="schema:name"`) instead of JSON-LD.

**Change:** Add Microdata extraction using cheerio:

```typescript
// Microdata: <span itemprop="price">$49.99</span>
$('[itemprop]').each((_, el) => {
  const prop = $(el).attr('itemprop');
  const value = $(el).attr('content') || $(el).text().trim();
  if (prop && value) fields[prop] = value;
});

// RDFa: <span property="schema:price">$49.99</span>
$('[property^="schema:"]').each((_, el) => {
  const prop = $(el).attr('property')?.replace('schema:', '');
  const value = $(el).attr('content') || $(el).text().trim();
  if (prop && value) fields[prop] = value;
});
```

**Estimated improvement:** +5% overall. Sites like Best Buy, Walmart, Target use
Microdata heavily. Recipe sites use Microdata for ingredients, prep time, etc.
The improvement is concentrated on e-commerce and recipe sites where JSON-LD is
absent but Microdata is present.

**Effort:** ~3 hours. Add to `extractStructuredData()` as a fallback when no
JSON-LD candidates are found. Map itemprop values to the same StructuredData
interface.

---

### Fix 4: Expanded Regex Patterns for Common Fields

**Current state:** PATTERN_MAP covers 10 field types. Common fields that agents
request but aren't covered:

```
Missing patterns:
- email: /[\w.+-]+@[\w-]+\.[\w.-]+/
- phone: /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
- address: /\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)/i
- version: /v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?/
- size/weight: /\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB|kg|lbs?|oz|g|cm|mm|inches?)/i
- duration: /\d+:\d{2}(?::\d{2})?|\d+\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)/i
- count/number: /(?:followers?|subscribers?|members?|users?|downloads?)[:\s]+([\d,.]+[kKmM]?)/i
```

**Estimated improvement:** +3% overall. These are low-frequency but high-value
for specific domains (contact pages, software pages, media pages).

**Effort:** ~2 hours. Add patterns to PATTERN_MAP + tests.

---

### Fix 5: Proximity-Based Field Extraction

**Current state:** Pattern matching is global (scans entire markdown). This causes
false positives on long pages and misses fields that are only identifiable by
their proximity to a label.

**Change:** When a field isn't found by layers 1-4, scan for the field name as a
label and extract the nearest value:

```
- Look for "{field}" or "**{field}**" anywhere in text
- Extract the text immediately after it (same line or next line)
- Cap at 200 chars, stop at next label or blank line
```

This is essentially a more aggressive version of layer 3, without requiring a
colon separator. Handles cases like:

```
**Population**
8.3 million

Stadium  Wembley Stadium
Capacity  90,000
```

**Estimated improvement:** +5% overall. Covers label-value layouts without colons,
wiki-style info sections, and spec sheets.

**Effort:** ~2 hours.

---

## Cumulative Code-Only Improvement Estimate

| Fix | Est. Improvement | Effort | Cumulative |
|-----|-----------------|--------|------------|
| Fix 1: OG/Twitter meta tags | +5% | 2h | 30% |
| Fix 2: Markdown table parsing | +10% | 4h | 40% |
| Fix 3: Microdata + RDFa | +5% | 3h | 45% |
| Fix 4: Expanded regex patterns | +3% | 2h | 48% |
| Fix 5: Proximity-based extraction | +5% | 2h | 53% |
| **Total (code-only)** | **+28%** | **~13h** | **~53%** |

**Realistic ceiling without LLM: ~50-55%.** Pattern matching fundamentally cannot
handle arbitrary field names on arbitrary pages. "top scorer" on a football page
requires semantic understanding — no regex or table parser will generalize.

---

## What We Could Do WITH an LLM (INC-179)

### Architecture

```
extractFields(fields, structuredData, markdown):
  1. Structured Data (JSON-LD) → existing
  2. Meta Tags (OG/Twitter) → Fix 1
  3. Microdata/RDFa → Fix 3
  4. Pattern Matching → existing + Fix 4
  5. Table Key-Value → Fix 2
  6. Generic + Proximity → existing + Fix 5
  7. ★ LLM Fallback (NEW) → for fields still not_found after 1-6
     → Send: first 3000 chars of markdown + field names
     → Receive: JSON { field: value } for each requested field
     → Model: Claude Haiku 3.5 or GPT-4o-mini
     → Cost: ~$0.001-0.003 per extraction call
     → Latency: +300-800ms
```

### Why LLM Fallback as Layer 7 (Not Layer 1)

- Layers 1-6 are free, fast (<1ms), and deterministic
- Only unresolved fields hit the LLM — typically 0-2 per request
- Most extractions (e-commerce, articles) resolve at layers 1-4 with 0 LLM calls
- LLM is only invoked for domain-specific fields on unfamiliar page types
- Preserves our latency advantage on the common path

### Cost Analysis

```
Current (pattern-only):     $0.000 per extraction
With LLM fallback:          $0.001-0.003 per extraction (only when needed)
Firecrawl:                  5 credits = $0.005 per extraction (always)

Estimated LLM invocation rate: ~30% of extractions (70% resolve deterministically)
Effective cost:             $0.0003-0.001 per extraction (blended)
```

### Estimated Improvement

| Approach | Field Extraction Rate | Latency Impact | Cost/Extract |
|----------|----------------------|---------------|-------------|
| Current | 25% | 0ms | $0 |
| Code-only fixes (1-5) | ~53% | 0ms | $0 |
| Code + LLM fallback | **~80%** | +300-800ms (30% of calls) | ~$0.001 |
| Firecrawl | ~75% | included in 761ms P50 | $0.005 |

### Implementation Requirements

1. **API key routing:** Need to accept an LLM API key (user's own or Novada's)
2. **Prompt engineering:** "Extract these fields from the page content. Return
   JSON. If a field is not present, return null."
3. **Cost control:** Only invoke when >=1 field is `not_found` after layers 1-6
4. **Timeout:** Hard ceiling of 3s on LLM call — return partial results on timeout
5. **Caching:** Cache LLM results per URL+fields combo (already have session cache)

**Effort:** ~8 hours for MVP. Includes prompt, routing, error handling, tests.

---

## Recommended Execution Order

### Phase 1: Code-only quick wins (est. 25% → 45%)

Priority by ROI:

1. **Fix 2: Markdown table parsing** — highest impact (+10%), covers the exact
   failure case from the benchmark (FIFA player stats in tables)
2. **Fix 1: OG/Twitter meta tags** — easy win (+5%), many pages have OG but no JSON-LD
3. **Fix 5: Proximity-based extraction** — catches label-value without colons (+5%)

These three fixes (~8h) should move the needle from 25% to ~45%.

### Phase 2: Complete deterministic coverage (est. 45% → 53%)

4. **Fix 3: Microdata/RDFa** — e-commerce sites without JSON-LD
5. **Fix 4: Expanded regex patterns** — long tail of common field types

### Phase 3: LLM fallback (est. 53% → 80%)

6. **INC-179: LLM extraction layer** — catches everything else
   - Gate: requires API key management decision
   - Gate: requires cost/billing decision (pass-through vs Novada-subsidized)

---

## Decision Required

**Can we close the gap through code alone?**

**Partially.** Code-only fixes can roughly double our rate from 25% to ~50-55%.
This is meaningful but will not match Firecrawl's 75%.

**To match or exceed Firecrawl, we need the LLM fallback (Phase 3).**
The good news: our layered architecture means the LLM is only invoked on ~30%
of requests (the hard ones), keeping our cost at ~$0.001 vs Firecrawl's $0.005.
The latency impact is also minimal — most extractions still resolve in <1ms
deterministically.

**Recommendation:** Ship Phase 1 now (3 fixes, ~8h, gets us to ~45%). Track the
actual field-not-found rate in production. If it's >30%, proceed with Phase 3.
If it drops below 20% (meaning our deterministic layers cover most real usage),
defer the LLM work.
