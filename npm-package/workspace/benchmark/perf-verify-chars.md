# Character Count Verification — R2

**Date:** 2026-06-23
**Script:** `/tmp/perf-char-test.mjs`
**Build:** `~/Projects/novada-mcp/build/tools/extract.js`

## Baselines

| Baseline | Avg chars |
|----------|-----------|
| R1 (before fix) | 7,149 |
| Firecrawl | 72,057 |

## Per-URL Results

| URL | Chars | Latency | vs Firecrawl | Code blocks | Headings |
|-----|-------|---------|--------------|-------------|----------|
| developer.mozilla.org | 26,573 | 46,771ms | 37% | ❌ | ✅ |
| nodejs.org | 16,641 | 341ms | 23% | ✅ | ✅ |
| docs.python.org | 10,158 | 412ms | 14% | ✅ | ✅ |
| expressjs.com | 20,016 | 445ms | 28% | ✅ | ✅ |
| react.dev | 22,541 | 14,732ms | 31% | ✅ | ✅ |

## Summary

| Metric | Value |
|--------|-------|
| Avg chars R2 | 19,186 |
| Improvement vs R1 | **2.7×** |
| vs Firecrawl | 27% |
| Success rate | 5/5 |

## Notes

- All 5 URLs returned > 5,000 chars (pass threshold).
- MDN had high latency (46s) likely due to JS rendering escalation; content was still substantial.
- react.dev also slow (14.7s) — JS-heavy SPA, auto-escalated to render mode.
- `developer.mozilla.org` missing code blocks — MDN uses `<pre>` not fenced markdown; likely a conversion gap, not a content gap.
- R2 is 2.7× R1 baseline (7,149 → 19,186 avg chars). Still 27% of Firecrawl — gap exists but direction is correct.
