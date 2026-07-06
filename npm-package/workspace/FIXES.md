# Fix Log — novada-mcp

Every fix applied to the codebase, in reverse chronological order.

---

## 2026-05-20 — Bing: `num` param breaks submit; DDG: URL at `source.link`
**Commit:** (this session)
**Files:** `src/tools/search.ts`

**Bing fix:**
- Root cause: Bing Scraper API returns `data.data=null` when `num` is included in the form params. The playground curl example doesn't include `num`. Adding `num` silently corrupts the request.
- Fix: Added `supports_num: boolean` to `ScraperSearchEngine` interface. Set `bing: supports_num=false`, `yandex: supports_num=false`. Updated `submitSearchScrapeTask` to skip `num` when flag is false.
- Verified: PASS — 10 results returned.

**DDG fix:**
- Root cause: DDG results use `result.source.link` for URL, not `result.url` or `result.link`. `parseScraperSearchResults` checked `url` and `link` only, so all DDG results had empty URLs and were skipped in rendering.
- Fix: Added `(item.source as Record<string, unknown>)?.link` fallback to both `url` and `link` fields in the result map.
- Verified: PASS — 10 results with URLs returned.

---

## 2026-05-20 — Bing + DDG search: wrong query param
**Commit:** (this session)
**File:** `src/tools/search.ts`
**Root cause:** `ENGINE_MAP` used `query_param: "keyword"` for bing and duckduckgo. Novada Scraper API requires `q` for both. With `keyword`, the backend returned `data.data = null` (no task_id). The task_id lives at `data.data.task_id`, not `data.task_id`.
**Fix:**
- Changed `query_param: "keyword"` → `"q"` for bing and duckduckgo
- Added `no_cache=false` for all search engine submits
- Added `safe=off` for bing (as per dashboard curl example)
**Verified:** Bing curl end-to-end: 9 organic results returned. Dashboard "My Scrapers" shows both Bing and DDG tasks succeed at 100%.

---

## 2026-05-19 — Search parse: flat-object response from download endpoint
**Commit:** `eb98a83`
**File:** `src/tools/search.ts` — `pollSearchResult()`
**Root cause:** Download endpoint sometimes returns a flat object `{organic_results: [...]}` instead of an array. Code expected array only.
**Fix:** Added flat-object branch that checks for `organic_results`, `organic`, `results`, `search_metadata` at top level.

## 2026-05-19 — health_all: probe timeout too short + broken activation link
**Commit:** `eb98a83`
**File:** `src/tools/health_all.ts`
**Fix:** Probe timeout 8s → 20s. Fixed activation link defaulting to incorrect URL.

## 2026-05-19 — map.ts: false-positive SPA diagnosis removed
**Commit:** `eb98a83`
**File:** `src/tools/map.ts`
**Fix:** Removed heuristic that incorrectly flagged normal pages as SPAs.

## 2026-05-19 — verify.ts: explicit "Verify Unavailable" when all queries fail
**Commit:** `eb98a83`
**File:** `src/tools/verify.ts`
**Fix:** Instead of silently returning empty, now returns clear "Verify Unavailable" message with agent_instruction.

## 2026-05-19 — research.ts: explicit error when totalResults === 0
**Commit:** `eb98a83`
**File:** `src/tools/research.ts`
**Fix:** Returns structured error message instead of empty output when no results found.

## 2026-05-19 — credentials.ts: auto-fetch via management API
**Commit:** `eb98a83`
**File:** `src/utils/credentials.ts`
**Fix:** Added `fetchProxyCredentials()` + `resolveProxyCredentials()` — credentials auto-fetched from management API when not in env.

## 2026-05-19 — proxy zones: wrong zone names
**Commit:** `eb98a83`
**Files:** `src/tools/proxy_residential.ts`, `proxy_datacenter.ts`, `proxy_mobile.ts`, `proxy_isp.ts`
**Fix:** Zone format corrected to `zone-res`, `zone-dcp`, `zone-mob`, `zone-isp` + `region-XX` suffix pattern.

## 2026-05-19 — proxy_static/dedicated: per-IP model
**Commit:** `eb98a83`
**Files:** `src/tools/proxy_static.ts`, `proxy_dedicated.ts`
**Fix:** Now reads from `NOVADA_STATIC_PROXY_LIST` / `NOVADA_DEDICATED_PROXY_LIST` env vars. Per-IP selection model.

## 2026-05-19 — DDG/Yandex scraper_ids corrected
**Commit:** `83e44ac`
**File:** `src/tools/search.ts`
**Fix:** `duckduckgo_search` → `duckduckgo`, `yandex_search` → `yandex`. Added per-engine `query_param` field to ENGINE_MAP.
**Note:** This commit introduced `query_param: "keyword"` for bing/DDG which was later found to be wrong (see 2026-05-20 fix above).

## 2026-05-19 — scraper_submit: correct API format
**Commit:** `d5ba2dc`
**File:** `src/tools/scraper_submit.ts`
**Fix:** Submit was sending flat form fields. Changed to wrap params in `scraper_params=[{...}]` JSON array for non-search platforms (Format B). Search engines use flat fields (Format A).

## 2026-05-18 — search: route directly to Scraper API (remove SERP fallback)
**Commit:** `79ad0ef`
**File:** `src/tools/search.ts`
**Fix:** Removed dead SERP probe. All search now routes via Scraper API directly.

## 2026-05-18 — 11006 error message: clearer agent guidance
**Commit:** `e256081`
**File:** `src/tools/scrape.ts`
**Fix:** Code 11006 now explains: invalid operation ID OR Scraper not activated. Points to `novada://scraper-platforms` resource.

## 2026-05-18 — amazon op IDs: aliased stale names
**Commit:** `e256081`
**Files:** `src/resources/index.ts`
**Fix:** Added aliases for deprecated amazon operation IDs that still appear in agent memory.
