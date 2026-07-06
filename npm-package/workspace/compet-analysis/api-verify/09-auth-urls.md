# API Auth & URL Compliance Audit

Audited: 2026-06-23
Sources: `/tmp/novada-api-pages/01-overview.md`, `02-quickstart.md`, `03-authentication.md`
Code scanned: `~/Projects/novada-mcp/src/`

---

## Spec Summary (from docs)

| Product | Base Domain | Auth |
|---------|-------------|------|
| Management / Developer APIs | `api-m.novada.com` | `Authorization: Bearer YOUR_API_KEY` |
| Scraper API | `scraper.novada.com` | `Authorization: Bearer YOUR_API_KEY` |
| Web Unblocker | `webunlocker.novada.com` | `Authorization: Bearer YOUR_API_KEY` |
| Default Content-Type | — | `application/json` (some endpoints: `application/x-www-form-urlencoded`) |
| Note from docs | — | `developer-api.novada.com` is GitBook docs only — NOT callable |

---

## Findings by Check

### 1. Management APIs → `api-m.novada.com`

**PASS.**

`src/_core/developer_api.ts` sets:
```ts
export const DEVELOPER_API_BASE = "https://api-m.novada.com";
```
All `devApiPost()` calls build URLs from this constant. Correctly noted in code that `developer-api.novada.com` is the GitBook docs domain and returns 405 on `/v1/*` — not used as a callable endpoint.

### 2. Scraper API → `scraper.novada.com`

**PASS.**

`src/config.ts`:
```ts
export const SCRAPER_API_BASE = "https://scraper.novada.com";
```
`scrape.ts`, `search.ts`, `health.ts`, `health_all.ts` all consume `SCRAPER_API_BASE` — no hardcoded alternatives.

### 3. Web Unblocker → `webunlocker.novada.com`

**PASS.**

`src/config.ts`:
```ts
export const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";
```
`src/utils/http.ts` (`fetchWithRender`) and `health.ts`/`health_all.ts` consume this constant. Auth is `Bearer ${unblockerKey}` with `Content-Type: application/json`. Correct.

### 4. `/v1/` prefix on all management endpoints

**PASS.**

All `devApiPost` calls pass paths like `/v1/wallet/balance`, `/v1/capture/get_apikey`, `/v1/proxy_account/list`, `/v1/wallet/usage_record`, etc. Verified in `developer_api.ts` — path construction handles leading slash correctly.

Exception: Scraper API (`scraper.novada.com/request`) and Web Unblocker (`webunlocker.novada.com/request`) use `/request` — docs show no `/v1/` prefix for these endpoints, which is correct.

### 5. Auth header: `Authorization: Bearer YOUR_API_KEY`

**PASS** with one correct intentional deviation.

All Bearer-authenticated calls use:
```ts
Authorization: `Bearer ${apiKey}`,
```
Found in: `scrape.ts`, `search.ts`, `health.ts`, `health_all.ts`, `browser_flow.ts`, `scraper_status.ts` (fallback), `developer_api.ts`.

**Intentional exception:** Scraper download endpoint (`api.novada.com/g/api/proxy/scraper_download`) uses `apikey` as a **query parameter** — not a Bearer header. This is documented in code comments as the correct auth mode for this specific endpoint, distinct from the submission API.

### 6. Content-Type per endpoint

**PASS** — correct differentiation in all cases.

| Endpoint | Content-Type Used | Expected |
|----------|-------------------|----------|
| `scraper.novada.com/request` | `application/x-www-form-urlencoded` | Correct (scrape.ts, search.ts, health.ts) |
| `webunlocker.novada.com/request` | `application/json` | Correct (http.ts, health.ts) |
| `api-m.novada.com` (developer API) | `multipart/form-data` (via FormData) | Confirmed correct per fudong 2026-06-05; docs state some endpoints use `application/x-www-form-urlencoded` — this discrepancy is resolved in code comments noting the multipart was smoke-tested live |
| Browser flow (`api-m.novada.com`) | `application/json` | `browser_flow.ts` line 138 — correct for that specific endpoint |

**Minor note:** `01-overview.md` docs list "Default Content-Type: `application/json` (some endpoints use `application/x-www-form-urlencoded`)". The developer API using `multipart/form-data` is not listed in overview but is verified empirically in code comments. Not a compliance bug — empirically confirmed correct.

### 7. Hardcoded wrong URLs

**ONE FLAG — low severity, documentation-only string.**

`src/tools/capture_apikey.ts` line 58, agent_instruction string:
```
"scraperapi.novada.com / webunlocker.novada.com"
```
`scraperapi.novada.com` is the SERP/Search API domain (defined as `SCRAPERAPI_BASE` in config.ts), not the scraper submission domain. The capture API key is used for `scraper.novada.com` (Scraper) and `webunlocker.novada.com` (Unblocker). The mention of `scraperapi.novada.com` in this agent_instruction string is **inaccurate** — it should read `scraper.novada.com`.

This is an agent-facing instruction string only; it does not affect any actual HTTP call. No live URL is wrong. Still worth fixing to avoid agent confusion.

No other hardcoded wrong URLs found.

---

## Summary

| Check | Result |
|-------|--------|
| Management APIs → `api-m.novada.com` | PASS |
| Scraper API → `scraper.novada.com` | PASS |
| Web Unblocker → `webunlocker.novada.com` | PASS |
| All management paths use `/v1/` | PASS |
| Auth header `Authorization: Bearer` | PASS |
| Content-Type correct per endpoint | PASS |
| Hardcoded wrong URLs | 1 FLAG (doc string only) |

## Action Required

**One fix:** `src/tools/capture_apikey.ts` line 58 — change `scraperapi.novada.com` to `scraper.novada.com` in the agent_instruction string.

No functional HTTP calls are broken. All live API calls use correct base URLs, correct auth headers, and correct Content-Type values.
