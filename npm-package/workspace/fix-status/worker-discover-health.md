# Fix Status — INC-169: "129 platforms" → "13 platforms"

**Worker:** discover-health
**Date:** 2026-06-23
**Status:** DONE

## Changes Applied

### src/tools/discover.ts
- Line 49 (novada_scrape catalog description): `129 supported platforms` → `13 active platforms (~78 operations)`
- Line 298 (Next Steps section): `129 platforms` → `13 active platforms (~78 operations)`

### src/tools/health.ts
- All 5 occurrences of label `"Scraper API (search + 129 platforms)"` → `"Scraper API (search + 13 active platforms)"` (lines 80, 83, 86, 88, 161 before edit)

### src/resources/index.ts
- `novada://guide` tool comparison table: `129 platforms` → `13 platforms`
- `novada://llms-txt` novada_scrape section: `129 specific platforms` → `13 active platforms (~78 operations)`
- `novada://llms-txt` novada_scraper_submit section: `129 platforms` → `13 active platforms`
- `novada://scraper-platforms` resource body at line 337 already said "13 active" — left unchanged (correct)

## Verification

```
npx tsc --noEmit
```
Exit: 0 (no output, no errors)

Residual grep for "129" in all 3 files: no matches.
