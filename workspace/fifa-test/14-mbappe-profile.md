# Test 14: Mbappe Player Profile Extract

## Command
```bash
NOVADA_API_KEY=*** node extract.js \
  url=https://en.wikipedia.org/wiki/Kylian_Mbapp%C3%A9 \
  format=json render=auto \
  fields=[birth_date,age,position,club,goals,caps,height,nationality]
```

## Result

| Metric | Value |
|--------|-------|
| Latency | 1090ms |
| Content length | 100,114 chars (truncated from 260,351) |
| Quality score | 80 (excellent) |
| Mode | static (auto escalation not needed) |
| Title | Kylian Mbappe - Wikipedia |

## Field Extraction

| Field | Extracted | Expected |
|-------|-----------|----------|
| birth_date | null | 20 December 1998 |
| age | null | 27 |
| position | null | Forward |
| club | "*As of match played 23 May 2026*" (wrong match) | Real Madrid |
| goals | null | ~300+ |
| caps | null | ~90+ |
| height | null | 1.78m |
| nationality | null | French |

**Field extraction: 0/8 correct.** The tool returned nulls for all target fields. The `club` field matched a footnote string instead of the actual club name.

## Root Cause

Wikipedia infobox data is rendered as HTML table markup, not embedded in JSON-LD structured data. The `fields` extraction logic checks:
1. JSON-LD schema.org data first (only has `headline`, `author`, `datePublished`)
2. Pattern matching on content second (failed -- likely because the content is markdown with links, not plain key-value pairs)

The actual data IS present in the markdown content:
- `"born 20 December 1998"` -- found in intro paragraph
- `"plays as a forward"` -- found in intro paragraph
- `"La Liga club Real Madrid"` -- found in intro paragraph
- `"captains the France national team"` -- found in intro paragraph
- Career stats section exists but was in the table-of-contents area (truncated)

## Structured Data (JSON-LD)

```json
{
  "type": "Article",
  "fields": {
    "headline": "French footballer (born 1998)",
    "author": "Contributors to Wikimedia projects",
    "datePublished": "2015-12-02T20:19:19Z",
    "dateModified": "2026-06-25T20:49:24Z",
    "publisher": "Wikimedia Foundation, Inc."
  }
}
```

## Verdict

- **Content extraction: PASS** -- full Wikipedia article retrieved at 1090ms, excellent quality
- **Field extraction: FAIL** -- 0/8 fields correctly extracted from Wikipedia infobox
- **Severity: MEDIUM** -- fields feature needs improved pattern matching for Wikipedia-style infobox tables; the raw content contains all requested data

## Suggested Fix

The `fields` extraction should:
1. Parse Wikipedia infobox patterns (key-value pairs in table markup)
2. Use NLP/regex on the intro paragraph ("born X", "plays as a Y", "for Z club")
3. Fall back to content scanning when JSON-LD lacks the requested fields
