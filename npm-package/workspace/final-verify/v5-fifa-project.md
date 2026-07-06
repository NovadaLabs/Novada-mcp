# FIFA Project Folder Verification — v5

## Test Scenario

3 tool calls, all tagged with `project: "fifa-france-norway-v5"`:

1. **novadaSearch** — `France vs Norway World Cup 2026` (3 results, Google)
2. **novadaExtract** — Wikipedia France national football team (fields: coach, captain)
3. **novadaExtract** — BBC Sport football page

## Result

```
Project folder: ~/Downloads/novada-mcp/2026-06-26/fifa-france-norway-v5/

  France-vs-Norway-World/
    └── 2026-06-26_200134708_France-vs-Norway.json    (search results)
  en-wikipedia-org/
    └── 2026-06-26_200135529_en-wikipedia-org.md      (extract — France team)
  bbc-com/
    └── 2026-06-26_200136357_bbc-com.md               (extract — BBC Sport)

Total: 3 files in 3 topic folders
```

**ALL DATA IN ONE PROJECT FOLDER**

## Fields Extraction

France extract with `fields: ['coach', 'captain']` returned populated values (not bare dashes).

## Bug Found & Fixed

**Search cache key did not include `project` parameter.**

- File: `src/tools/search.ts` line 360
- Before: `const cacheKey = \`${engine}:${params.query}:${params.num ?? 10}\``
- After:  `const cacheKey = \`${engine}:${params.query}:${params.num ?? 10}:${params.project ?? ""}\``

Without this fix, a search query cached from a prior call (without project) would return
the cached result and skip `saveOutput` entirely, causing the search file to NOT land in
the project folder. Extract was unaffected (no cache layer).

## Verified

- Date: 2026-06-26
- Build: clean `npm run build` succeeded (tsc, no errors)
- Node invocation: single fresh process, no stale cache
