# Test 09: Extract Structured Player Data as JSON

**Date:** 2026-06-26
**Target:** `https://en.wikipedia.org/wiki/France_national_football_team`
**Tool:** `novadaExtract` with `format: "json"`, `render: "auto"`
**Fields requested:** player, squad, coach, captain, ranking, goals, wins

---

## Result Summary

| Metric | Value |
|--------|-------|
| Status | PARTIAL -- page extracted, fields all null |
| Elapsed | 1261ms |
| Response size | 103,322 chars |
| Mode | static |
| Quality | 70/100 (good) |
| Content OK | true |
| Content chars | 100,114 (truncated from 159,160) |
| Structured data | Article schema (headline, author, dates, publisher) |

## Fields Extraction

All 7 requested fields returned `null`:

```json
{
  "player": null,
  "squad": null,
  "coach": null,
  "captain": null,
  "ranking": null,
  "goals": null,
  "wins": null
}
```

### Root Cause

The field extraction pipeline (`src/utils/fields.ts`) uses a 4-step fallback chain:

1. **Structured data lookup** -- Wikipedia's JSON-LD schema only has `headline`, `author`, `datePublished`, `dateModified`, `publisher`. No football-specific keys.
2. **Pattern matching** -- `PATTERN_MAP` covers: title, description, price, date, author, rating, availability, stars, language, license. No patterns for player/squad/coach/captain/ranking/goals/wins.
3. **Generic inline pattern** -- Regex looking for `field: value` or `**field**: value` on a line. Wikipedia's content doesn't use this format for these fields.
4. **Heading section match** -- Looks for `## coach` or `## captain` headings. The Wikipedia page has `## Current squad` but the heading regex requires exact match (`^#+\s+squad\s*$`), and the actual heading is "Current squad" which does not match "squad" exactly.

The content itself contains all the data -- the extraction layer simply lacks domain-specific patterns for sports data. The "Current squad" heading nearly matches but fails the exact-heading check.

### Data Actually Present in Content

Manual regex against the extracted markdown confirms the data exists:

- **Coach mentions:** Raymond Domenech, Laurent Blanc, Henri Michel, Michel Platini (historical)
- **Captain mentions:** Thierry Henry, Didier Deschamps (historical)
- **Ranking:** FIFA ranking reference found in footnotes
- **Squad:** "Current squad" section exists in table of contents but actual squad table is in the body content
- **Content truncated:** Full page is 159K chars, response capped at 100K -- some squad/player data may be in the truncated portion

## Structured Data Returned

```json
{
  "type": "Article",
  "fields": {
    "headline": "national association football team representing France",
    "author": "Contributors to Wikimedia projects",
    "datePublished": "2003-06-20T13:37:02Z",
    "dateModified": "2026-06-24T14:39:14Z",
    "publisher": "Wikimedia Foundation, Inc."
  }
}
```

## Hints from Tool

- Content truncated at 100,000 chars (full: 159,160). Pass `max_chars=100000` to get more.
- Discover more pages: `novada_map(url="https://en.wikipedia.org")`

## Output Saved

`/Users/tongwu/Downloads/novada-mcp/2026-06-26/en-wikipedia-org/2026-06-26_191445377_en-wikipedia-org.json`

---

## Assessment

**What works:**
- Page fetched successfully in ~1.3s (static mode, no render needed)
- JSON output is valid and well-structured
- 100K chars of content extracted
- Structured data (JSON-LD) correctly parsed
- Quality scoring (70/100) is reasonable

**What does not work:**
- Field extraction returns null for all domain-specific fields
- The `PATTERN_MAP` only covers generic web fields (price, author, rating, etc.)
- Heading-section matching requires exact heading text -- "Current squad" does not match "squad"
- No fuzzy/substring heading matching

**Potential improvements:**
1. **Fuzzy heading match:** Change heading regex from `^#+\s+${field}\s*$` to allow substring matches like `^#+\s+.*${field}.*$`
2. **Broader pattern coverage:** Add sport-specific patterns or make the generic pattern more flexible
3. **LLM-based extraction:** For arbitrary fields, fall back to an LLM extraction step (like Firecrawl's `jsonOptions.prompt` approach)
4. **Content truncation:** Wikipedia pages are large; the 100K cap may cut off the actual squad table data

**Verdict:** The JSON extraction works for pages with matching structured data or common field patterns (e-commerce, articles, GitHub repos). For domain-specific data like sports statistics, the pattern-based approach is insufficient. The content is there but the extraction layer cannot surface it into structured fields.
