# worker-search fix status

## Status: DONE

## Fix 1 — Forward filter params to Scraper API (INC-167)
- Added `SearchFilterParams` interface at module level
- Extended `submitSearchScrapeTask` signature with optional `filterParams: SearchFilterParams = {}`
- Appended `time_range`, `start_date`, `end_date`, `country`, `language` to URLSearchParams form body
- Updated call site in `novadaSearch` to pass these from `params`

## Fix 2 — 300ms pre-wait before first poll (INC-174)
- Added `await new Promise(r => setTimeout(r, 300))` at the top of `pollSearchResult`, before the while loop

## Fix 3 — 60s in-memory dedup cache (INC-174)
- Added `_searchCache` Map and `SEARCH_CACHE_TTL = 60_000` at module level (after imports)
- Cache read at start of `novadaSearch` (after engine check, before any API call)
- Cache write + size-bounded eviction (cap 100) added before both return paths:
  - JSON format path
  - Markdown format path (end of function)
- Empty-results and error paths intentionally NOT cached

## tsc result
`npx tsc --noEmit` — no errors (clean output)
