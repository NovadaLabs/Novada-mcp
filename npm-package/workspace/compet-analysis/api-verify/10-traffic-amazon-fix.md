# API Compliance Verification — Traffic/Balance + Amazon Scrape Root Cause

Date: 2026-06-23
Verified against: /tmp/novada-api-pages/{06,07,08,09,10,14}-*.md

---

## 1. Plan Balance Endpoints

### What the docs say

| Product    | Correct endpoint                          |
|------------|-------------------------------------------|
| residential| POST /v1/residential_flow/balance         |
| isp        | POST /v1/isp_flow/balance                 |
| mobile     | POST /v1/mobile_flow/mobile_flow_balance  |
| datacenter | POST /v1/dc_flow/balance                  |
| static     | (no balance endpoint documented)          |

### What we call (plan_balance_all.ts lines 8-15)

```ts
{ key: "residential", path: "/v1/residential_flow/balance" },   // CORRECT
{ key: "isp",         path: "/v1/isp_flow/balance" },           // CORRECT
{ key: "mobile",      path: "/v1/mobile_flow/balance" },        // WRONG — should be /v1/mobile_flow/mobile_flow_balance
{ key: "datacenter",  path: "/v1/dc_flow/balance" },            // CORRECT
{ key: "static",      path: "/v1/static_flow/balance" },        // UNDOCUMENTED — no static_flow balance in docs
{ key: "capture",     path: "/v1/capture/get_balance" },        // not verifiable from provided docs
```

### BUG: Mobile balance endpoint is wrong

- Doc endpoint: `POST /v1/mobile_flow/mobile_flow_balance`
- Our endpoint: `POST /v1/mobile_flow/balance`

These are different paths. Our call will likely return 404 or an unrelated response. This is the likely cause of mobile balance always showing as error/unavailable.

### Static balance: no docs

The static ISP docs (10-static-isp.md) contain only IP management endpoints
(`/v1/static_house/*`). There is no `/v1/static_flow/balance` documented. The
endpoint may exist undocumented or may not exist at all. Currently the `unavailable`
error handler masks this gracefully — acceptable for now.

---

## 2. Traffic Consumption Endpoints

### What the docs say

| Product    | Endpoint                            | Required fields          |
|------------|-------------------------------------|--------------------------|
| residential| POST /v1/residential_flow/consume_log | start_time, end_time (REQUIRED) |
| isp        | POST /v1/isp_flow/consume_log       | start_time, end_time (REQUIRED) |
| mobile     | POST /v1/mobile_flow/mobile_flow_use| start_time, end_time, day_or_hour (ALL REQUIRED) |
| datacenter | POST /v1/dc_flow/consume_log        | start_time, end_time (REQUIRED) |
| static     | (no consume_log documented)         | —                        |

### What we call (traffic_daily.ts lines 8-13)

```ts
{ key: "residential", path: "/v1/residential_flow/consume_log" },  // CORRECT
{ key: "isp",         path: "/v1/isp_flow/consume_log" },          // CORRECT
{ key: "mobile",      path: "/v1/mobile_flow/consume_log" },       // WRONG — should be /v1/mobile_flow/mobile_flow_use
{ key: "datacenter",  path: "/v1/dc_flow/consume_log" },           // CORRECT
{ key: "static",      path: "/v1/static_flow/consume_log" },       // UNDOCUMENTED
```

### BUG 1: Mobile traffic endpoint is wrong

- Doc endpoint: `POST /v1/mobile_flow/mobile_flow_use`
- Our endpoint: `POST /v1/mobile_flow/consume_log`

### BUG 2: Mobile traffic requires extra field `day_or_hour`

The mobile endpoint requires a third mandatory field `day_or_hour` (values: "1"=hour, "2"=day) that we do not send. Even if we fix the path, requests will fail with missing parameter errors.

### BUG 3: start_time / end_time are REQUIRED on all consume endpoints

Docs mark both fields as `required` in the OpenAPI schema. Our implementation sends them only when provided (`if params.start_time !== undefined`). When called without dates, we send an empty body, which will return a 422/400 error from the server.

The `withDateRangeCompat` call only fires conditionally:
```ts
if (params.start_time !== undefined || params.end_time !== undefined) {
  baseBody = withDateRangeCompat(...)
}
```

For calls with no date args the body sent is `{}` — missing required fields.

**Mitigation already in place:** the tool's description says "Defaults to 7 days ago server-side" — this may mean the server accepts empty body with defaults (behavior would contradict the OpenAPI `required` annotation). Needs live test to confirm.

---

## 3. Capture Logs

### Endpoint

`POST /v1/capture/logs` — implementation (capture_logs.ts line 64) matches.

No local doc for this endpoint was provided for verification. Implementation sends `page`, `page_size`, and conditionally `status`, `start_time`/`end_time`. Structure looks reasonable.

---

## 4-9. Amazon Scrape Root Cause

### API architecture (from 14-scraper-api.md)

The Scraper API is a two-base-URL system:

| Step        | URL                                | Method | Auth          |
|-------------|------------------------------------|--------|---------------|
| Submit task | `https://scraper.novada.com/request` | POST   | Bearer token  |
| Download    | `https://api-m.novada.com/v1/scraper/task_download` | POST | Bearer token  |

The download endpoint from the official docs:
```
POST https://api-m.novada.com/v1/scraper/task_download
Content-Type: form-data
params: task_ids (comma-separated), file_type (json/csv/xlsx)
Auth: Bearer YOUR_API_KEY
```

### What we actually call for download (scrape.ts line 120 + config.ts line 13)

```ts
// config.ts
export const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";

// scrape.ts — pollForResult
const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=...&file_type=json&apikey=...`;
// = https://api.novada.com/g/api/proxy/scraper_download?task_id=...&file_type=json&apikey=...
```

### ROOT CAUSE: Wrong download base URL + wrong method + wrong auth

**Issue 1: Wrong base URL**
- Doc URL: `https://api-m.novada.com/v1/scraper/task_download`
- Our URL:  `https://api.novada.com/g/api/proxy/scraper_download`

These are completely different hosts and paths. `api.novada.com/g/api/proxy` is not documented anywhere in the official API docs.

**Issue 2: Wrong HTTP method**
- Doc: POST with form-data, field name `task_ids` (plural)
- Our code: GET with query params `task_id` (singular) + `apikey`

**Issue 3: Wrong auth for download**
- Doc: Bearer token in Authorization header
- Our code: apikey as query param (explicitly noted in scraper_result.ts: "Auth: apikey query param (NOT Bearer)")

**Issue 4: Wrong field name**
- Doc field: `task_ids` (comma-separated list, supports batching)
- Our field: `task_id` (singular)

**Why this produces 0 chars / empty response:**

When we GET `https://api.novada.com/g/api/proxy/scraper_download?task_id=...&apikey=...`:
- The server may return `{"code": 27202}` (pending) or an empty/null body
- Our code only recognizes code 27202 as "still pending" and keeps polling
- If the URL returns HTTP 200 with empty or null body on every poll, `pollForResult` eventually falls through to the timeout error
- Or: the URL silently returns `{"code": 0, "data": null}` which matches neither the pending check (27202) nor the array check, so it hits the "Unexpected download response" error path

The scraper_result.ts tool has the same wrong base URL (imports `SCRAPER_DOWNLOAD_BASE` from config) and also uses GET + apikey query param.

**Note on the undocumented URL:** The `api.novada.com/g/api/proxy` base URL may be a custom proxy layer that was set up internally and does work — this is why the code comment says "api-m.novada.com always 404s". If this proxy is genuinely operational, then the URL mismatch is intentional and the 0-char issue is something else. However the GET vs POST mismatch and `task_id` vs `task_ids` field name divergence are still real.

### Correct implementation per docs

```
POST https://api-m.novada.com/v1/scraper/task_download
Authorization: Bearer <apikey>
Content-Type: application/x-www-form-urlencoded
Body: task_ids=<task_id>&file_type=json
```

Expected successful response:
```json
{
  "code": 0,
  "data": [
    {
      "download": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/...",
      "task_id": "<task_id>"
    }
  ],
  "msg": "success",
  "timestamp": 1774664048
}
```

Note: the download field is a pre-signed COS URL, not inline JSON. Current implementation expects inline JSON records but the docs show a COS download URL that requires a second GET request to retrieve the actual data. This is another missing step in our flow.

### Correct Amazon scraper_name and scraper_id

From the docs example (14-scraper-api.md lines 27-30):
```bash
-d "scraper_name=amazon.com"
-d "scraper_id=amazon_product_keywords"
```

- `scraper_name`: `"amazon.com"` (domain, not just "amazon")
- `scraper_id`: `"amazon_product_keywords"` for keyword search, `"amazon_product_asin"` for ASIN lookup
- No `product` type code needed — scraper API uses scraper_name + scraper_id, not numeric product types

Our submit step (scrape.ts, submitScrapeTask) correctly sends `scraper_name` and `scraper_id`. The submit step is likely working. The failure is in the result retrieval.

### Summary of Amazon 0-char root cause

The most likely sequence:
1. Submit: works (correct endpoint + format)
2. Poll `task_download`: hits wrong URL or wrong method — returns empty/pending/error response
3. Code loops until 180s timeout or misidentifies the response as "no records"
4. Returns "No records returned" (0 chars) rather than the actual product data

The actual result data is behind a COS pre-signed URL that requires a second HTTP GET after the task_download step. Our code does not implement this two-step result retrieval.

---

## Fix Priority

| Priority | Issue | File | Fix |
|----------|-------|------|-----|
| P0 | Mobile balance wrong endpoint | plan_balance_all.ts:11 | `/v1/mobile_flow/mobile_flow_balance` |
| P0 | Mobile traffic wrong endpoint | traffic_daily.ts:11 | `/v1/mobile_flow/mobile_flow_use` |
| P0 | Mobile traffic missing `day_or_hour` field | traffic_daily.ts | Add `day_or_hour: "2"` to mobile body |
| P0 | Amazon download: wrong URL + method | scrape.ts, scraper_result.ts, config.ts | Switch to POST `api-m.novada.com/v1/scraper/task_download` with Bearer auth + `task_ids` field; then fetch the COS URL |
| P1 | start_time/end_time optional vs required | traffic_daily.ts | Confirm server default behavior; if server requires dates, default to last 7 days |
| P2 | static_flow endpoints undocumented | plan_balance_all.ts, traffic_daily.ts | Accept as gracefully-failing until docs surface |
