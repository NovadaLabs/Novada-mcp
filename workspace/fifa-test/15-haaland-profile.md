# Test 15 — Haaland Player Profile Extraction

**Tool:** `novadaExtract`
**URL:** `https://en.wikipedia.org/wiki/Erling_Haaland`
**Format:** json | **Render:** auto | **Fields:** birth_date, age, position, club, goals, caps, height, nationality

## Result

| Metric      | Value              |
|-------------|--------------------|
| Latency     | ~2175 ms           |
| Response    | 103,172 chars      |
| Full content| 222,898 chars (truncated at 100k) |
| Mode        | static (auto)      |
| Quality     | excellent          |

## Field Extraction

| Field        | Extracted Value                         | Expected                    | Match |
|--------------|-----------------------------------------|-----------------------------|-------|
| birth_date   | null                                    | 21 July 2000               | MISS  |
| age          | null                                    | 25                          | MISS  |
| position     | null                                    | Striker / Forward           | MISS  |
| club         | "As of match played 19 May 2026"        | Manchester City             | MISS  |
| goals        | null                                    | ~280+ (club career)         | MISS  |
| caps         | null                                    | ~40+ (Norway)               | MISS  |
| height       | null                                    | 1.94 m (6 ft 4 in)         | MISS  |
| nationality  | null                                    | Norwegian                   | MISS  |

**Field extraction: 0/8** -- all fields returned null or wrong value.

## Structured Data (JSON-LD from page)

```json
{
  "type": "Article",
  "fields": {
    "headline": "Norwegian association football player (born 2000)",
    "author": "Contributors to Wikimedia projects",
    "datePublished": "2017-06-18T13:54:27Z",
    "dateModified": "2026-06-26T08:20:45Z",
    "publisher": "Wikimedia Foundation, Inc."
  }
}
```

JSON-LD captured the Article schema but not the player-specific infobox data.

## Data Found in Content (manually verified)

All requested data IS present in the markdown content body:

- **Full name:** Erling Braut Haaland (ne Haland)
- **Born:** 21 July 2000 (extracted from: "born 21 July 2000")
- **Nationality:** Norwegian (extracted from: "is a Norwegian professional footballer")
- **Position:** Striker (extracted from: "plays as a striker")
- **Club:** Manchester City (extracted from: "for Premier League club Manchester City")
- **Career:** Bryne -> Molde -> Red Bull Salzburg -> Borussia Dortmund -> Manchester City
- **Records:** Fastest to 100 league goals in Europe's top 5 leagues (103 apps), Premier League season record (36 goals), 3x Golden Boot, continental treble (2022-23)

## Analysis

1. **Content retrieval: PASS** -- full Wikipedia article fetched correctly at excellent quality, ~2.2s latency.
2. **Field extraction: FAIL** -- the `fields` parameter returned 0/8 correct values. Wikipedia infoboxes use complex HTML table structures that the JSON-LD/pattern-matching extraction pipeline does not parse.
3. **Root cause:** The field extractor relies on JSON-LD structured data and simple pattern matching. Wikipedia's `Article` schema only has headline/author/date -- no player stats. The infobox is an HTML `<table>` with wiki-specific markup that falls outside the extractor's pattern set.
4. **Workaround:** For Wikipedia player profiles, use `format: 'markdown'` and parse the content body directly, or use a dedicated Wikipedia API.

## Verdict

| Aspect                 | Score |
|------------------------|-------|
| Content retrieval      | PASS  |
| Field extraction       | FAIL (0/8) |
| Structured data        | PARTIAL (Article schema only) |
| Overall                | **PARTIAL** -- data present in content but field extraction missed it |
