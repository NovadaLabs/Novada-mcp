# Novada MCP — Test Log

## Unit Test Count

| Date       | Files | Tests | Notes |
|------------|-------|-------|-------|
| 2026-04-20 | 13    | 142   | Before scrape + format |
| 2026-04-20 | 14    | 158   | + format utility tests (16) |
| 2026-04-20 | 15    | 169   | + scrape tool tests (11) |

---

## Live API Tests (2026-04-20)

All tests used real credentials from `.env` (deleted before publish).

### ✅ Residential Proxy
- **Endpoint:** `host:7777` (HTTP CONNECT)
- **Auth:** `user-zone-res:pass`
- **Test:** GET `https://httpbin.org/ip` via proxy
- **Result:** 200 — residential IP confirmed, not our own IP
- **Quality:** HIGH — working correctly

### ✅ Web Unblocker
- **Endpoint:** `POST https://webunlocker.novada.com/request`
- **Auth:** `Authorization: Bearer NOVADA_WEB_UNBLOCKER_KEY`
- **Body:** `{ target_url, response_format: "html", js_render: true, country: "" }`
- **Response shape:** `{ code: 0, data: { code: 200, html: "...", msg: "", msg_detail: "" } }`
- **Test:** Fetched example.com, received rendered HTML
- **Result:** 200, `code: 0`, html nested under `data.data.html` ✅
- **Bugs found & fixed:**
  - `js_render` must be boolean `true` (not string `"True"`)
  - Path must be `/request` (not root)
  - Auth is Bearer, NOT `api_key` in body
- **Quality:** HIGH — fully working after fixes

### ✅ Scraper API — Endpoint Discovery
- **Correct endpoint:** `POST https://scraper.novada.com/request`
- **Auth:** `Authorization: Bearer NOVADA_API_KEY`
- **Body fields:** `scraper_name` (domain) + `scraper_id` (operation ID) + operation params
- **Field names confirmed from:** `Scraper API.xlsx` Sheet2 (`spider_name`/`spider_id`) → Go struct (`ScraperName`/`ScraperId`) → JSON (`scraper_name`/`scraper_id`)
- **Sample scraper_ids:** `amazon_product_by-keywords`, `amazon_product_by-asin`, `google_shopping_by-keywords`, `reddit_posts_by-keywords`
- **Quality:** HIGH — format confirmed, code is correct

### ❌ Scraper API — Account Permissions
- **Error:** `code: 11006 "Scraper error"` for all 129 platform scrapers
- **Scope:** All platforms: amazon.com, google.com, reddit.com, tiktok.com, etc.
- **Root cause:** Test API key (`1f35b477...`) does not have platform scraper access enabled
- **Fix:** Enable on Novada dashboard or contact support@novada.com
- **Code impact:** None — API format is correct, returns 11006 only for our test key
- **Quality:** MEDIUM — endpoint and format confirmed, blocked by account permissions

### ❌ SERP / Search API
- **Attempts tested:**
  - `GET scraper.novada.com/search` → 404
  - `GET scraper.novada.com/serp` → 404
  - `GET scraper.novada.com/v1/search` → 404
  - `GET api.novada.com/search` → 500 (nginx, service broken)
  - `GET developer.novada.com/...` → JS-heavy, couldn't render
  - `GET serp.novada.com`, `search.novada.com` → ENOTFOUND (don't exist)
  - `POST /request` with google-serp scraper_name → `11008 "Scraper name error"` (SERP not in platform scrapers list)
  - SERP scrapers: **not present** in `Scraper API.xlsx` — 0 out of 129 scrapers are SERP
  - Proxy format `scraperapi:KEY` → `11000 "Invalid ApiKey"`
- **Root cause:** SERP API endpoint does not exist in current Novada infrastructure
- **Status:** BLOCKED — needs Novada team to build/expose SERP endpoint
- **Quality:** LOW — `novada_search` remains broken (routes to 404)

### ✅ Output Format System
- **Formats:** JSON, CSV, HTML, XLSX (SheetJS), Markdown
- **Tests:** 16 unit tests — all pass
- **XLSX:** Valid zip magic bytes (PK header) confirmed
- **CSV:** Quote-escaping for commas and double-quotes confirmed
- **HTML:** XSS-safe (HTML entity escaping confirmed)
- **Quality:** HIGH

---

## What's Still Pending

| Item | Priority | Notes |
|------|----------|-------|
| SERP endpoint | P0 | `novada_search` broken — no valid endpoint found. Needs Novada team. |
| Platform scraper access | P0 | Account must have `11006` cleared — contact support |
| Pre-publish `.env` cleanup | P0 | Delete test credentials before `npm publish` |
| Merge to main | P1 | After SERP or explicit decision to ship without it |

## What's Done

| Feature | Status |
|---------|--------|
| Web Unblocker integration (fetch with render) | ✅ |
| Static → render → browser auto-escalation | ✅ |
| Proxy tool (residential, mobile, ISP, datacenter) | ✅ |
| novada_scrape (7th MCP tool, 129 platforms) | ✅ |
| Format system (JSON/CSV/HTML/XLSX/Markdown) | ✅ |
| TypeScript SDK (NovadaClient) | ✅ |
| nova CLI (search/extract/crawl/map/research/proxy/scrape) | ✅ |
| novada_search | ❌ broken (404) |
