# CC-03-REV — review: yahoo fallback

## Role
Claude Code reviewer. Read only.

## Repo
/Users/tongwu/Projects/novada-mcp

## What to review
Read src/tools/search.ts after cc-03-impl has run.

## Review checklist

### If Option A (added yahoo to scraper set)
- [ ] `"yahoo"` is in `SCRAPER_SEARCH_ENGINES`
- [ ] The source name passed to the scraper API is correct (verify against other engines' pattern)
- [ ] `parseScraperSearchResults` handles yahoo response format (or confirm it's the same as google/bing)
- [ ] Output label includes `(via scraper-api fallback)` for yahoo queries

### If Option B (explicit redirect message)
- [ ] The redirect message includes `suggested_alternative` pointing to google or bing
- [ ] Message format is consistent with other `## Search Unavailable` blocks
- [ ] `Retry:` line gives exact tool call with engine substituted
- [ ] Yahoo does NOT fall into the silent SERP_UNAVAILABLE path anymore

### Either option
- [ ] google/bing/duckduckgo/yandex behavior unchanged
- [ ] `npm run build` passes
- [ ] No new imports or deps

## Output
PASS or FAIL, which option was implemented, specific issues.
