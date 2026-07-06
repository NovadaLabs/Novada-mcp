# Novada Developer API Reference

> Source: https://developer-api.novada.com/ — fetched 2026-05-18
> This is the OFFICIAL API, separate from the dashboard internal API.

## Two API Tiers

### Tier 1 — Direct API (what MCP currently uses)
- **Submit:** `POST https://scraper.novada.com/request` — Bearer token = API key directly
- **Download:** `GET https://api.novada.com/g/api/proxy/scraper_download?task_id=...&file_type=json&apikey=...`
- No OAuth required. API key works directly.
- This is the dashboard's internal API. Works but has quirks (file_type issues when wrong submit format).

### Tier 2 — Official Developer API (api-m.novada.com)
- Requires OAuth token flow (see below)
- More endpoints: task_list, task_status, task_download (returns download URLs)
- More reliable, supports batch operations
- **We cannot use this yet** — OAuth requires dashboard username/password, not just API key

---

## Authentication

### Direct API Key (Tier 1)
```bash
# Submit endpoint accepts API key as Bearer token
Authorization: Bearer 1f35b477c9e1802778ec64aee2a6adfa

# Download endpoint uses apikey query param
?apikey=1f35b477c9e1802778ec64aee2a6adfa
```

### OAuth Token (Tier 2) — NOT YET AVAILABLE TO US
```bash
POST https://api-m.novada.com/v1/oauth2/token
# Basic Auth: username:api_key (username = dashboard account, NOT the API key)
# Returns: access_token valid 7 days (604800s)
```

---

## Scraper API — Create Task

**Endpoint:** `POST https://scraper.novada.com/request`
**Auth:** `Authorization: Bearer <api_key>`
**Content-Type:** `application/x-www-form-urlencoded`

### Request Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| scraper_name | string | yes | Platform domain (e.g. `amazon.com`) |
| scraper_id | string | yes | Operation ID (e.g. `amazon_product_keywords`) |
| scraper_params | string | conditional | JSON array: `[{"key":"value"}]`. **Required for NON-SEARCH platforms.** |
| scraper_errors | boolean | yes | Include error details in response |
| is_auto_push | boolean | no | Auto-push results to configured destination |
| file_name | string | no | Custom result file name |
| scraper_universal | string | no | YouTube video parameters (undocumented) |

### TWO Param Formats (CRITICAL)

**Search engines** (google.com, bing.com, duckduckgo.com, yandex.com):
```bash
-d "q=test" -d "json=1" -d "device=desktop" -d "domain=google.com" -d "country=us"
```
- Flat form fields (no scraper_params wrapper)
- `json=1` required to get JSON-format output
- Response uses `{spider_code: 200, rest: {...}}` wrapper

**All other platforms** (amazon, linkedin, youtube, instagram, facebook, tiktok, x, walmart, github):
```bash
-d 'scraper_params=[{"keyword":"iphone 15"}]'
```
- JSON array wrapper required
- Response uses flat record array `[{title: "...", error: null, ...}]`

### Response (Success)
```json
{
  "code": 0,
  "data": {
    "code": 200,
    "data": { "task_id": "330ae83bcff7479b9c97e586dbf93801" },
    "msg": "success"
  },
  "msg": "success",
  "timestamp": 1775099126
}
```

---

## Scraper API — Download Result (Tier 1 — Current)

**Endpoint:** `GET https://api.novada.com/g/api/proxy/scraper_download`
**Auth:** `?apikey=<api_key>` (query param)

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| task_id | string | yes | Task ID from submit response |
| file_type | string | yes | `json` (primary) |
| apikey | string | yes | API key |

### Response States

- **Pending:** `{"code": 27202, "data": null, "msg": ""}` — poll again
- **Complete (search engines):** `[{"spider_code": 200, "rest": {"search_metadata": {...}, "organic_results": [...]}}]`
- **Complete (other platforms):** `[{"title": "...", "asin": "...", "error": null, "success": true, ...}]`
- **Error 10001:** `{"code": 10001, "msg": "Invalid file type"}` — wrong submit format was used
- **Error 27203:** Server-side task failure — retry

---

## Scraper API — Download Result (Tier 2 — Official)

**Endpoint:** `POST https://api-m.novada.com/v1/scraper/task_download`
**Auth:** `Authorization: Bearer <oauth_token>` (NOT api_key)

### Request Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| task_ids | string | yes | Comma-separated task IDs (max 200) |
| file_type | string | yes | `json`, `csv`, or `xlsx` |

### Response
```json
{
  "code": 0,
  "data": [
    {
      "download": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/...",
      "task_id": "32ab51b7fb48480f9f4fdb6e0d797956"
    }
  ]
}
```
Returns download URLs, not data directly. Fetch the URL to get the actual file.

---

## Scraper API — Task Status (Tier 2)

**Endpoint:** `POST https://api-m.novada.com/v1/scraper/task_status`
**Auth:** Bearer OAuth token

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| task_ids | string | yes | Comma-separated (max 200) |

**Status values:** `Ready`, `Failed`

---

## Scraper API — Task List (Tier 2)

**Endpoint:** `POST https://api-m.novada.com/v1/scraper/task_list`
**Auth:** Bearer OAuth token

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| limit | string | yes | Page size (max 100) |
| page | string | yes | Page number |

---

## Known Error Codes

| Code | Meaning | Source |
|------|---------|--------|
| 0 | Success | All endpoints |
| 400 | Authorization failure (10003) | OAuth endpoint |
| 401 | Authentication failure (10000) | api-m endpoints without OAuth |
| 10001 | Invalid file type / incompatible download format | Download endpoint |
| 11000 | Invalid API key | Submit endpoint |
| 11006 | Scraper API not activated OR invalid scraper_id | Submit endpoint |
| 11008 | Unknown platform (scraper_name) | Submit endpoint |
| 11009 | Invalid scraper parameters | Submit endpoint |
| 27202 | Task still pending (poll again) | Download endpoint |
| 27203 | Server-side task execution error | Download endpoint |

---

## Product Codes (for proxy API)

| Code | Product |
|------|---------|
| 1 | Residential Proxy |
| 2 | Rotating ISP |
| 3 | Rotating Datacenter |
| 4 | Unlimited |
| 7 | Web Unblocker |
| 9 | Mobile |

---

## Web Unlocker API

**Endpoint:** `POST https://webunlocker.novada.com/request`
- Supports JS rendering, custom headers, redirects, CSS cleaning
- Separate from Scraper API

## Browser API

- JavaScript-enabled proxy service with country selection
- Traffic monitoring endpoints available

---

## Future Migration Path

When we get OAuth credentials (ask fudong for dashboard username):
1. Switch to `api-m.novada.com/v1/scraper/task_download` for downloads
2. Use `task_status` for checking instead of polling download
3. Support batch task downloads (up to 200 task IDs)
4. More reliable file_type handling (json/csv/xlsx all supported)
