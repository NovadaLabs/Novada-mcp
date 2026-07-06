# CC-03-IMPL — search: yahoo fallback or explicit retry path

## Role
Claude Code implementer. TypeScript only.

## Repo
/Users/tongwu/Projects/novada-mcp

## Problem
`novada_search` with `engine="yahoo"` silently returns `SERP_UNAVAILABLE` — no retry path,
no alternative suggestion. The agent is stuck with no signal about what to do next.

Current code (src/tools/search.ts):
```typescript
const SCRAPER_SEARCH_ENGINES = new Set(["google", "bing", "duckduckgo", "yandex"]);
```
Yahoo is missing from this set.

## Required Change — src/tools/search.ts

### Option A (preferred): Add yahoo to fallback set
If the scraper API supports yahoo as a source name, simply add it:
```typescript
const SCRAPER_SEARCH_ENGINES = new Set(["google", "bing", "duckduckgo", "yandex", "yahoo"]);
```
Then in `submitSearchScrapeTask`, the `source` value passed to the scraper API should be `"yahoo"`.
Check whether the scraper API uses `"yahoo"` or `"yahoo_search"` — look at how the other engines
are mapped in `submitSearchScrapeTask`. Use the same pattern.

### Option B (fallback if yahoo not supported by scraper API): Explicit redirect
If you cannot confirm yahoo scraper support, do NOT silently fail. Instead, when yahoo returns
SERP_UNAVAILABLE, replace the bare error with:
```
## Search Unavailable — Yahoo

Yahoo Search is not available via the SERP API on this account.

## Agent Hints
- Use engine="google" or engine="bing" for equivalent results.
- Both engines support the same query syntax.
- Retry: novada_search(query="<same query>", engine="google")
```

### How to decide A vs B
Read the `submitSearchScrapeTask` function. Check what `source` values it passes to the scraper
API. If there's a `sources` list or a switch statement, see if yahoo/yahoo_search is present.
If yes → Option A. If no → Option B.

## Constraints
- Do NOT change google/bing/duckduckgo/yandex behavior
- Build must pass
- Only touch: src/tools/search.ts

## Verify
`npm run build` — report result + which option was implemented + line numbers changed.
