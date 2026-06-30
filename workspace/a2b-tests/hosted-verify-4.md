# Hosted MCP Verify #4 -- Core Search + Extract Pipeline

**Date:** 2026-06-25
**Build:** local v0.8.2-dev (post vendor sync)
**API Key:** `...2a6adfa`

## Results

| # | Test | Pass | Latency | Size | Notes |
|---|------|------|---------|------|-------|
| 1 | Search (google) | PASS | 1755ms | 1849ch | Markdown with ## headings, 3 results returned |
| 2 | Full-page extract | PASS | 132ms | 102505ch | Full page content (>20K threshold met) |
| 3 | File path in header | PASS | -- | -- | Header starts with file-path prefix |
| 4 | Search cache | PASS | 0ms | -- | Instant cache hit on repeat query |

**Overall: 4/4 passed**

## Key Observations

- **Extract size fixed:** 102,505 chars vs the 7K issue flagged in the test script comment. Full-page extraction is working correctly after vendor sync.
- **Search latency:** 1.76s for a Google SERP query -- reasonable for a scraper-based pipeline.
- **Extract latency:** 132ms -- cache or static-path hit, no JS rendering needed for MDN.
- **Cache:** In-memory search cache working; 0ms on second identical query within TTL window.

## What Was Tested

```
novadaSearch({query:'novada proxy API', num:3, engine:'google'})
novadaExtract({url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript', format:'markdown', render:'auto'})
```

Both functions imported directly from `./build/tools/` and called with API key. No MCP transport layer involved -- this validates the core tool logic, not the SSE/HTTP hosting.
