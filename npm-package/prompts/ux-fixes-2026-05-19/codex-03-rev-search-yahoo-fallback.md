# CODEX-03-REV — review: yahoo fallback

## Role
Codex reviewer. Read + build. Do NOT modify files.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## Checks

### Build
```bash
npm run build
```
Must exit 0.

### Determine which option was implemented
```bash
grep -n "yahoo" src/tools/search.ts
```

### If Option A
- [ ] `"yahoo"` appears in `SCRAPER_SEARCH_ENGINES`
- [ ] Source name passed to scraper API matches API's expected format (consistent with other engines)
- [ ] Output label includes "(via scraper-api fallback)" for yahoo results

### If Option B
- [ ] Yahoo has its OWN unavailable message (not the generic SERP_UNAVAILABLE)
- [ ] Message includes explicit `suggested: google, bing` hint
- [ ] Message includes actionable `Retry:` line

### Either option
- [ ] `grep -n "SERP_UNAVAILABLE" src/tools/search.ts` — yahoo path no longer routes to bare SERP_UNAVAILABLE
- [ ] google/bing/duckduckgo/yandex paths unchanged

### TypeScript
```bash
npx tsc --noEmit 2>&1 | head -20
```

## Output
PASS or FAIL.
