# Novada Scraper API — Complete Reference

> Last updated: 2026-05-08. Based on thorough reading of developer-api.novada.com docs + live curl tests.
> Save this file. Do NOT re-read the docs pages — everything relevant is here.

---

## Two-Token Authentication System

This is the most critical concept. There are **two completely separate auth systems**:

| Token Type | Domain | Used For | How to Get |
|------------|--------|----------|------------|
| **API Key** | `scraper.novada.com` | Task submission (POST /request) | Dashboard → API key section |
| **Session Token** | `api-m.novada.com` | Management APIs (task_status, task_download, get_apikey, etc.) | POST /v1/capture/login with username+password |

**Critical implication:** Being logged into the Dashboard does NOT mean your API key works on `api-m.novada.com`. They are separate auth systems with no automatic sync.

**Fudong's plan (ETA: this month, ~May 2026):** API key unification — all `api-m.novada.com` endpoints will accept the same API key, eliminating the two-token complexity. Once this lands, `novada_search` and `novada_scrape` async results can be wired without the session token.

---

## Domain Map

| Domain | What it does |
|--------|-------------|
| `scraper.novada.com` | Scraper API — task submission |
| `scraperapi.novada.com` | SERP search API (Google/Bing etc.) |
| `api-m.novada.com` | Management API — task status, download, quota, balance |
| `webunlocker.novada.com` | Web Unblocker (static + JS render) |
| `browser.novada.com` | Browser API (CDP sessions) |

---

## Scraper API — Full Async Flow

### Step 1: Submit task
```
POST scraper.novada.com/request
Authorization: Bearer <api_key>
Content-Type: application/x-www-form-urlencoded

scraper_name=google.com&scraper_id=google_search&q=test&num=10
```

Response:
```json
{
  "code": 0,
  "msg": "Request accepted",
  "data": {
    "task_id": "abc123...",
    "status": "pending"
  }
}
```

### Step 2: Poll task status
```
POST api-m.novada.com/v1/scraper/task_status
Authorization: Bearer <session_token>    ← NOTE: session token, NOT api key
Content-Type: form-data

task_ids=abc123,def456               ← comma-separated, max 200
```

Response:
```json
{
  "code": 0,
  "data": [
    { "task_id": "abc123", "status": "Ready" }   // or "Failed"
  ]
}
```

**Also available:**
- `POST /v1/scraper/last_task_status` — status of most recent task (no params)
- `POST /v1/scraper/task_list` — paginated list (`limit` max 100, `page`)

### Step 3: Get download URL
```
POST api-m.novada.com/v1/scraper/task_download
Authorization: Bearer <session_token>
Content-Type: form-data

task_ids=abc123
file_type=json                       ← json | csv | xlsx
```

Response: returns **download URL(s)** pointing to result files (COS bucket). Must then GET the URL to fetch actual content.

⚠️ Two-step: task_download gives URL → GET that URL → actual data.

---

## Session Token — How to Obtain (CONFIRMED)

**Endpoint:** `POST https://api-m.novada.com/v1/oauth2/token`

**Auth:** HTTP Basic Authentication
- Username: Novada account username
- Password: Novada API key (same key used for scraper.novada.com)

```bash
curl -X POST https://api-m.novada.com/v1/oauth2/token \
  -u "your_username:your_api_key"
```

Response:
```json
{
  "access_token": "<jwt_token>",
  "expires_in": 604800,
  "token_type": "bearer"
}
```

**Token lifetime:** 7 days (604,800 seconds). Needs periodic refresh.

**Key insight:** The API key IS the password for OAuth2 token exchange. No separate login system. You need both username + API key → exchange for Bearer token → use Bearer token on `api-m.novada.com`.

**For MCP server implementation:** Add `NOVADA_USERNAME` env var. Exchange `NOVADA_API_KEY` + `NOVADA_USERNAME` for session token on first call, cache for 7 days, auto-refresh. This CAN be implemented NOW without waiting for fudong.

### Alternative: Get API key via session token
```
POST api-m.novada.com/v1/capture/get_apikey
Authorization: Bearer <session_token>
```

This returns the API key programmatically (useful for key rotation or discovery).

---

## SERP / Search API

```
POST scraperapi.novada.com/search
Content-Type: application/json
Authorization: Bearer <api_key>          ← uses api key (same as scraper)

{
  "serpapi_query": {
    "q": "test query",
    "engine": "google",
    "num": "10",
    "api_key": "<api_key>"               ← also embedded in body
  }
}
```

**Current status (2026-05-08):** Returns 404. SERP backend not deployed yet (fudong to handle).

---

## Web Unblocker API

```
POST webunlocker.novada.com/request
Authorization: Bearer <NOVADA_WEB_UNBLOCKER_KEY>
Content-Type: application/json

{
  "target_url": "https://example.com",
  "response_format": "html",         // "html" | "png" | "html,png"
  "js_render": false,                // true = JS rendering enabled
  "country": "",                     // ISO 2-letter for geo-targeting
  "headers": "",                     // custom headers
  "cookies": "",                     // custom cookies
  "wait_ms": 0,                      // max page load time ms (up to 100,000)
  "wait_selector": "",               // CSS selector to wait for (max 30s)
  "follow_redirects": "",
  "block_resources": "",             // block images/JS/video for speed
  "clear": "",                       // strip unnecessary JS/CSS
  "auto_runs": 2                     // retry count (default 2, max 10)
}
```

Works correctly. Separate key: `NOVADA_WEB_UNBLOCKER_KEY`.

---

## Browser API (CDP)

Accessed via WebSocket: `NOVADA_BROWSER_WS=wss://...`

Connects via Chrome DevTools Protocol. Used by `novada_browser` and `novada_unblock` (render="browser").

**Current status:** Working when env var is configured.

---

## Health Check Probe — Correct Implementation

The `probeScraper()` function in `src/tools/health.ts` was broken due to wrong Content-Type. Fixed version:

```typescript
const form = new URLSearchParams();
form.append("scraper_name", "google.com");
form.append("scraper_id", "google_search");
form.append("q", "test");
form.append("num", "1");
const res = await fetch(`${SCRAPER_API_BASE}/request`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Authorization": `Bearer ${apiKey}`
  },
  body: form.toString(),
  signal: controller.signal,
});
```

Bug was: sending `Content-Type: application/json` with wrong field names (`keyword` instead of `q`, `google_search_by-keywords` instead of `google_search`). Fix committed locally, not yet published.

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | — |
| 400 | API key not found | Check key is correct |
| 402 | SERP quota not purchased | Activate in Dashboard |
| 11000 | Invalid API key | Check env var |
| 11006 | Product not activated (Scraper) | Contact support / Ethan approval |
| 401 | Unauthorized (wrong token type) | Check you're using session token for api-m.novada.com |
| 404 | Endpoint not found | Wrong domain or path |

---

## Current Status of MCP Tools (2026-05-08)

| Tool | Status | Root Cause of Block |
|------|--------|---------------------|
| `novada_extract` | ✅ Works | — |
| `novada_crawl` | ✅ Works | — |
| `novada_map` | ✅ Works | (0 results on JS SPAs is expected) |
| `novada_unblock` | ✅ Works | — |
| `novada_browser` | ✅ Works (when NOVADA_BROWSER_WS set) | — |
| `novada_proxy` | ✅ Works (when env vars set) | — |
| `novada_scrape` | ⚠️ Partial | task_status/task_download need session token → unblocked when fudong unifies API key |
| `novada_search` | ❌ 404 | SERP backend not deployed (fudong) |
| `novada_research` | ❌ | Depends on novada_search |
| `novada_verify` | ❌ | Depends on novada_search |
| `novada_health` | ✅ Fixed locally | probeScraper was sending wrong Content-Type |

---

## Universal Management Endpoints (api-m.novada.com — session token required)

```
POST /v1/capture/get_apikey        → retrieve API key for "unblocker" or "scraper"
POST /v1/capture/reset_apikey      → regenerate API key by category
POST /v1/capture/get_balance       → check remaining credits
POST /v1/capture/logs              → consumption records (params: start_time, end_time)
POST /v1/capture/unit              → per-unit pricing (scraper + unblocker tiers)

POST /v1/proxy/unblocker_area                  → available countries (optional: search_word)
POST /v1/proxy/unblocker_area_by_country       → states/provinces by country code
POST /v1/proxy/unblocker_city_by_area          → cities by country + region
POST /v1/proxy/unblocker_city_isp              → carrier/ISP options by country
```

---

## Pending Asks for Fudong

1. **Deploy SERP backend** — `scraperapi.novada.com/search` returns 404
2. ~~API key unification~~ — RESOLVED: OAuth2 token exchange works NOW. `POST api-m.novada.com/v1/oauth2/token` with Basic Auth (username + api_key) → 7-day Bearer token. Can implement without waiting.
3. **Confirm task_status/task_download endpoints** — are they `GET /v1/scraper/task_status?task_id=X` and `GET /v1/scraper/task_download?task_id=X`?
4. **Browser session error 11006** — MCP gets 11006 even though curl direct works; suspect auth code path difference
5. **Confirm Novada account username** — needed for OAuth2 token exchange (`NOVADA_USERNAME` env var)

---

## MCP Tool → Endpoint Mapping

```
novada_search   → POST scraperapi.novada.com/search
novada_extract  → POST webunlocker.novada.com/request
novada_crawl    → POST webunlocker.novada.com/request (looped)
novada_map      → POST webunlocker.novada.com/request (link discovery)
novada_scrape   → POST scraper.novada.com/request
                → GET  api-m.novada.com/v1/scraper/task_status  (pending fudong)
                → GET  api-m.novada.com/v1/scraper/task_download (pending fudong)
novada_unblock  → POST webunlocker.novada.com/request OR Browser CDP
novada_browser  → WebSocket NOVADA_BROWSER_WS (CDP)
novada_proxy    → Returns NOVADA_PROXY_USER/PASS/ENDPOINT env vars directly
novada_health   → Probes all of the above
```

---

## Product Vision: Fully Automated Async (Accepted 2026-05-08)

User confirmed: agents should never visit the dashboard. Full automation flow:
1. Agent calls `novada_scrape` → gets `task_id`
2. Agent polls `novada_scrape_status(task_id)` → waits for `success`
3. Agent calls `novada_scrape_result(task_id)` → gets JSON/HTML/text
4. Files auto-named: `{task_id}_{status}_{success_rate}_{quota_used}.json`

New tools to build (once fudong provides endpoints):
- `novada_scrape_status` — wrapper around `task_status`
- `novada_scrape_result` — wrapper around `task_download`
- OR: make `novada_scrape` blocking (poll internally, return when done)

---

## Env Vars Required

```bash
NOVADA_API_KEY=...                    # Required — all tools
NOVADA_USERNAME=...                   # Required for task_status/task_download (OAuth2 exchange)
NOVADA_WEB_UNBLOCKER_KEY=...          # Optional — render="render" mode
NOVADA_BROWSER_WS=wss://...           # Optional — render="browser" + novada_browser
NOVADA_PROXY_USER=...                 # Optional — novada_proxy
NOVADA_PROXY_PASS=...                 # Optional — novada_proxy
NOVADA_PROXY_ENDPOINT=...             # Optional — novada_proxy
```
