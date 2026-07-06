# CODEX-03-IMPL — search: yahoo fallback / explicit retry

## Role
Codex implementer. Shell + file access.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## Problem
`novada_search(engine="yahoo")` returns bare `SERP_UNAVAILABLE` with no retry path.
Agent gets stuck — no suggestion of alternatives, no retry hint.

## Investigation first
Read src/tools/search.ts:
```bash
cat src/tools/search.ts | grep -n "yahoo\|SCRAPER_SEARCH\|submitSearchScrapeTask\|source" | head -30
```

Determine: does `submitSearchScrapeTask` map engine names to scraper API `source` values?
Is "yahoo" or "yahoo_search" a valid source?

## Task — two options depending on investigation

### Option A: yahoo is supported by scraper API
Add `"yahoo"` to `SCRAPER_SEARCH_ENGINES` set. Confirm the source name passed to scraper API
matches what the API accepts (check existing engines for the pattern).

### Option B: yahoo NOT supported by scraper API
When yahoo falls through to SERP_UNAVAILABLE, replace the bare constant with a structured message:
```typescript
const YAHOO_UNAVAILABLE = `## Search Unavailable — Yahoo

Yahoo Search is not supported on this account's SERP API tier.

## Agent Hints
- engine="google" and engine="bing" support equivalent queries and return similar results.
- Retry: novada_search with engine="google" using the same query.

## Agent Notice — Engine Unavailable
engine: yahoo | fallback_available: false | suggested: google, bing`;
```
Return `YAHOO_UNAVAILABLE` instead of `SERP_UNAVAILABLE` for yahoo engine.

## Build & verify
```bash
npm run build
```
Must exit 0. Report which option was chosen and why.

## Constraints
- Only touch src/tools/search.ts
- Do NOT change google/bing/duckduckgo/yandex paths
