# Fix: Bing + DDG search query param bug

## Context
File: `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`

The `ENGINE_MAP` uses `query_param: "keyword"` for bing and duckduckgo.
The Novada Scraper API actually requires `q` for both — confirmed from:
1. Dashboard curl examples (dashboard.novada.com/overview/scraper/api/?id=26 and ?id=28)
2. Live test: with `q` + `no_cache=false`, `data.data.task_id` is populated correctly
3. With `keyword`: backend returns `data.data = null` — no task_id, search fails

The task_id extraction code is CORRECT (`inner?.data?.task_id`). Only the query param is wrong.

## Required changes in `src/tools/search.ts`

### 1. ENGINE_MAP — change query_param for bing and duckduckgo
```typescript
// BEFORE:
bing:       { scraper_name: "bing.com",        scraper_id: "bing_search",   query_param: "keyword" },
duckduckgo: { scraper_name: "duckduckgo.com",  scraper_id: "duckduckgo",    query_param: "keyword" },

// AFTER:
bing:       { scraper_name: "bing.com",        scraper_id: "bing_search",   query_param: "q" },
duckduckgo: { scraper_name: "duckduckgo.com",  scraper_id: "duckduckgo",    query_param: "q" },
```

### 2. submitSearchScrapeTask — add no_cache=false for all engines
After `form.append("json", "1");`, add:
```typescript
form.append("no_cache", "false");
```

### 3. For bing specifically, also add safe=off
Add engine-specific extra params to ENGINE_MAP (optional: add `extraParams` field), OR
simply append `safe=off` conditionally in the novadaSearch function when engine === "bing".

Simplest approach: add to `submitSearchScrapeTask`:
```typescript
if (scraperName === "bing.com") {
  form.append("safe", "off");
}
```

## Steps
1. Read `src/tools/search.ts`
2. Apply the three changes above
3. Run `npm run build` in `/Users/tongwu/Projects/novada-mcp`
4. Verify build succeeds with no TypeScript errors
5. Report the changes made

## Do NOT
- Change any other files
- Bump version
- Push to git
- Change the polling logic (pollSearchResult) — it's correct
- Change how task_id is extracted — `inner?.data?.task_id` is correct
