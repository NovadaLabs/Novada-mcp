# Research Metadata Stripping Verification (v3)

**Date**: 2026-06-26
**Tool**: `novadaResearch`
**Query**: "best proxy API for web scraping 2026" (depth: quick)

## Test Results

| # | Test | Result | Notes |
|---|------|--------|-------|
| T1 | No mode/quality metadata in body | PASS | No `mode: static`, `quality:X/100` leaked |
| T2 | No raw `url:` lines in synthesis | PASS | No `^url: https://...` metadata lines |
| T3 | File path at header | PASS | Output saved with file path prefix |
| T4 | Sources table present | PASS | `| # |` table format found |
| T5 | Project folder exists | PASS | `~/Downloads/novada-mcp/<date>/verify-research-v2/` created |
| T6 | No structured data in Summary | PASS | No `type: Article`, `headline:`, `datePublished:`, `author:` leaked |
| T7 | No `## Extracted Content` header | PASS | Extract header stripped |
| T8 | No `## Structured Data` header | PASS | JSON-LD block stripped |
| T9 | No `## Agent Memory` header | PASS | Memory block stripped |
| T10 | No `source:` markers in Summary | PASS | No `source: live/cache/wayback` in synthesis |

## Bug Found & Fixed

**Before fix**: The `## Structured Data` block from `novadaExtract` was leaking into research Summary.
This block contains JSON-LD metadata like:
```
type: Article
headline: 16 Best Web Scraping APIs of 2026 (In-Depth Review)
author: [{"@type":"Person","name":"Batuhan Ozyon"}]
datePublished: 2025-10-01T00:00:00.000Z
dateModified: 2026-05-31T00:00:00.000Z
```

**Root cause**: Line 171 of `src/tools/research.ts` only stripped the `## Extracted Content` metadata header block.
It did NOT strip these additional extract-output sections:
- `## Structured Data` (JSON-LD metadata)
- `## Requested Fields`
- `## Same-Domain Links`
- `## Extraction Diagnostics`
- `## Agent Memory`

**Fix applied**: Added regex stripping for all extract-output metadata sections before synthesis:
```typescript
// Strip ## Structured Data block (JSON-LD: type, headline, author, datePublished etc.)
cleaned = cleaned.replace(/^## Structured Data\n(?:.*\n)*?---\n\n?/m, "");
// Strip ## Requested Fields block
cleaned = cleaned.replace(/^## Requested Fields[^\n]*\n(?:.*\n)*?---\n\n?/m, "");
// Strip ## Same-Domain Links block
cleaned = cleaned.replace(/## Same-Domain Links[^\n]*\n(?:[\s\S]*?)(?=\n## |\n---\n|$)/, "");
// Strip ## Extraction Diagnostics block
cleaned = cleaned.replace(/## Extraction Diagnostics\n(?:[\s\S]*?)(?=\n## |\n---\n|$)/, "");
// Strip ## Agent Memory block
cleaned = cleaned.replace(/## Agent Memory\n(?:[\s\S]*?)(?=\n## |\n---\n|$)/, "");
// Strip trailing metadata sections: Agent Hints, Agent Action
const cleanContent = cleaned.split("## Agent Hints")[0].split("## Agent Action")[0].trim();
```

## File Changed

- `/Users/tongwu/Projects/novada-mcp/src/tools/research.ts` (lines 168-180)

## Performance

- Test run time: ~10s (cached search results from prior run)
- Output size: 6764 chars
- All 3/3 queries succeeded
