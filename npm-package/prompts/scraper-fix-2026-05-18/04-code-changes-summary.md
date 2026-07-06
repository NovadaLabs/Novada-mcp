# Code Changes Summary — Scraper Fix 2026-05-18

## Files Modified

### src/tools/scrape.ts
1. **submitScrapeTask** — dual param format:
   - Search engines (google, bing, duckduckgo, yandex) → flat form fields + `json=1`
   - All others → `scraper_params=[{...}]` array
   - Always sends `scraper_errors=true` + `is_auto_push=false`

2. **Result parsing** — handles two response formats:
   - Format A (search engines): `[{spider_code: 200, rest: {...}}]`
   - Format B (other platforms): `[{title: "...", error: null, ...}]`
   - Detects format by checking for `spider_code` or `rest` keys

### src/resources/index.ts
- Replaced all 71 operation IDs with verified values from dashboard
- Fixed examples in `novada://scraper-platforms` resource
- Fixed examples in `novada://llms-txt` resource
- Fixed workflow example

## New Files Created
- `docs/novada-api/scraper-operation-ids.md` — 71 verified IDs, 13 platforms
- `docs/novada-api/developer-api-reference.md` — Complete official API docs
- `prompts/scraper-fix-2026-05-18/` — Investigation findings, test prompts, bug reports

## Deployment
- Both npx caches updated: `~/.npm/_npx/430d3db*/` and `~/.npm/_npx/eb1018bc*/`
- MCP server restart required to activate
- npm publish NOT done (needs Ethan approval)

## Verified Working (curl)
- google.com ✓ (flat params)
- bing.com ✓ (flat params)
- amazon.com ✓ (scraper_params)
- linkedin.com ✓ (scraper_params)
- github.com ✓ (scraper_params)

## Known Issue (Novada Backend)
- youtube.com — 403 CAPTCHA on all operations
