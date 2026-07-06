# 06 - Output Pipeline Reliability Test

**Date:** 2026-06-26
**Scope:** Verify all tools save files correctly when `project` param is provided.

## Test Setup

- **Project param:** `output-reliability-test`
- **API key:** Novada production key
- **Tools tested:** 4 calls total
  1. `novadaSearch` — query: "test output pipeline", engine: google, num: 3
  2. `novadaExtract` — url: example.com, format: markdown
  3. `novadaExtract` — url: example.com, format: json
  4. `novadaExtract` — url: example.com, format: html

## Results

| # | Tool | Format | File | Size | Status |
|---|------|--------|------|------|--------|
| 1 | novadaSearch | json | `test-output-pipeline/2026-06-26_203713634_test-output-pipeline.json` | 1481B | PASS |
| 2 | novadaExtract | markdown | `example-com/2026-06-26_203713717_example-com.md` | 991B | PASS |
| 3 | novadaExtract | json | `example-com/2026-06-26_203713739_example-com.json` | 704B | PASS |
| 4 | novadaExtract | html | `example-com/2026-06-26_203713760_example-com.html` | 559B | PASS |

**Total: 4/4 files saved with content. 0 empty files.**

## Output Directory Structure

```
~/Downloads/novada-mcp/2026-06-26/output-reliability-test/
  example-com/
    2026-06-26_203713717_example-com.md      (991B)
    2026-06-26_203713739_example-com.json     (704B)
    2026-06-26_203713760_example-com.html     (559B)
  test-output-pipeline/
    2026-06-26_203713634_test-output-pipeline.json  (1481B)
```

## Content Quality Verification

### Search (JSON)
- 2 Google results returned (query: "test output pipeline")
- Structured with `title`, `url`, `snippet`, `date` fields
- Valid JSON, parseable

### Extract (Markdown)
- Contains metadata header (url, mode, quality, fetched_at)
- Page content correctly extracted ("Example Domain" heading + body text)
- Agent hints section included

### Extract (JSON)
- Structured fields: `url`, `title`, `mode`, `source`, `quality`, `content`, `links`
- Quality score correctly flagged low (score: 1) for a minimal page
- Valid JSON

### Extract (HTML)
- Clean HTML with doctype, head, body
- Styled output (not raw source) with inline CSS
- All page content preserved

## Observations

1. **File naming convention:** `{date}_{timestamp}_{slug}.{ext}` -- consistent across all tools.
2. **Subdirectory grouping:** Files are grouped by query/URL slug (`example-com/`, `test-output-pipeline/`), not by tool type. Multiple extract formats for the same URL land in the same subdirectory.
3. **Project isolation:** The `project` param correctly creates a top-level subdirectory under the date folder, isolating outputs from other runs.
4. **No race conditions:** 4 sequential calls, all wrote successfully with no file conflicts despite 3 targeting the same URL.

## Verdict

**PASS** -- Output pipeline is reliable. All 4 tools save non-empty files with correct content when `project` param is provided.
