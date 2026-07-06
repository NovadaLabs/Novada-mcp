# Scraper API Flow — Compliance Verification

Date: 2026-06-23
Spec source: /tmp/novada-api-pages/14-scraper-api.md
Implementation: src/tools/scraper_submit.ts, scraper_status.ts, scraper_result.ts, scraper_task_mgmt.ts, scrape.ts, config.ts

---

## 1. Submit Endpoint URL

**Spec:** `POST https://scraper.novada.com/request`

**Implementation:**
- `config.ts` line 8: `SCRAPER_API_BASE = "https://scraper.novada.com"`
- `scrape.ts` line 7: `SCRAPE_ENDPOINT = \`${SCRAPER_API_BASE}/request\``
- `submitScrapeTask()` at `scrape.ts` line 71 posts to `SCRAPE_ENDPOINT`

**Result: MATCH ✅** — URL is correct.

---

## 2. Submit Body — Required Fields

**Spec required fields:**
- `scraper_name` (yes)
- `scraper_id` (yes)
- `scraper_errors` (yes)
- `file_name` (yes — spec marks as required)
- `scraper_params` (no — required for non-search scenarios)
- `scraper_universal` (no — youtube video params)

**Implementation (`scrape.ts` lines 36–69, `submitScrapeTask`):**
- `scraper_name` — appended at line 37 ✅
- `scraper_id` — appended at line 38 ✅
- `scraper_errors` — hardcoded `"true"` at line 39 ✅
- `file_name` — NOT sent ❌ (spec marks it required)
- `scraper_params` — sent as `JSON.stringify([opParams])` for non-search platforms (line 68) ✅
- `is_auto_push` — sent as `"false"` (line 40); not mentioned in spec — extra field, no harm
- `scraper_universal` — not used; only relevant for YouTube, acceptable

**Result: MISMATCH ❌** — `file_name` is spec-required but never appended. In practice the API likely assigns a default, but this is a compliance gap.

**Auth on submit:**
- Spec: `Bearer YOUR_API_KEY`
- Implementation `scrape.ts` line 73: `"Authorization": \`Bearer ${apiKey}\`` ✅

**Content-Type:**
- Spec: `x-www-form-urlencoded`
- Implementation `scrape.ts` line 74: `"Content-Type": "application/x-www-form-urlencoded"` ✅

---

## 3. Status Polling — Endpoint and Response Codes

### 3a. Spec status endpoint

**Spec:** `POST https://api-m.novada.com/v1/scraper/task_status` with form field `task_ids`

Response shape:
```json
{ "code": 0, "data": { "list": [{ "status": "Ready"|"Failed", "task_id": "..." }] } }
```

**Implementation (scraper_status.ts):**

The implementation does NOT primarily use the spec's `task_status` endpoint. Instead it uses two non-spec endpoints:

1. **Primary** (lines 75–124): `GET ${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=...&file_type=json&apikey=...`
   - `SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy"` (config.ts line 13)
   - This is the download endpoint repurposed as a status probe — not in spec.

2. **Fallback** (lines 128–169): `GET https://api-m.novada.com/v1/scraper/{task_id}` (Bearer auth)
   - Spec's status endpoint is `POST /v1/scraper/task_status` (plural, form-data) — our fallback uses `GET /v1/scraper/{task_id}` (path param, Bearer).
   - URL shape and method differ from spec.

**Result: MISMATCH ❌** — Neither the primary nor fallback in `scraper_status.ts` matches the spec's `POST /v1/scraper/task_status` with `task_ids` form field.

The spec-compliant endpoint IS correctly implemented separately in `scraper_task_mgmt.ts` line 127–129 (`action='status'`), which posts to `/v1/scraper/task_status` with `task_ids`. But this is an internal management tool, not the user-facing `novada_scraper_status` polling path.

### 3b. Pending code 27202

**Spec:** No mention of code 27202 — this code is inferred from actual API behavior.

**Implementation:**
- `scraper_status.ts` line 94: `if (dlObj.code === 27202)` → returns `status: "pending"` ✅
- `scraper_status.ts` line 146: `if (body.code === 27202)` → `normalStatus = "pending"` ✅
- `scrape.ts` line 134: `(body as ...).code === 27202` → sleep and continue ✅

**Result: MATCH ✅** — Code 27202 is correctly treated as pending/in-progress across all three files.

### 3c. Complete indicator

**Spec status response:** `status: "Ready"` in the list array.

**Implementation normalization (`scraper_status.ts` line 56):**
```
if (s === "complete" || s === "completed" || s === "success" || s === "done") return "complete";
```
- `"Ready"` is NOT in this list — spec uses `"Ready"`, implementation normalizes only lowercase variants of complete/success/done.

**Result: MISMATCH ❌** — The string `"Ready"` from the spec `task_status` endpoint is not handled by `normalizeStatus()`. However, since the primary path avoids that endpoint entirely (using the download endpoint instead), this gap only matters if the api-m fallback path is hit and the server returns `"Ready"`.

Note: `scraper_task_mgmt.ts` `handleStatus()` returns the raw API response as-is (line 132, `data` field), leaving status string normalization to the caller. This is fine for the management tool's purpose but exposes the agent to the raw `"Ready"` string.

---

## 4. Download Endpoint

**Spec:** `POST https://api-m.novada.com/v1/scraper/task_download`
- Body: `task_ids` (comma-separated), `file_type` (json/csv/xlsx)
- Auth: `Bearer YOUR_API_KEY`

**Implementation (scraper_result.ts lines 38, 119–122):**
```
RESULT_DOWNLOAD_ENDPOINT = "https://api.novada.com/g/api/proxy/scraper_download"
GET ...?task_id=...&file_type=json&apikey=...
```

**Differences from spec:**
- Spec uses `POST api-m.novada.com/v1/scraper/task_download`; implementation uses `GET api.novada.com/g/api/proxy/scraper_download` ❌
- Spec auth is Bearer token in header; implementation uses `apikey` query param ❌
- Spec uses `task_ids` (plural) as form field; implementation uses `task_id` (singular) as query param ❌

The spec-compliant download endpoint IS implemented in `scraper_task_mgmt.ts` lines 163–166:
```typescript
devApiPost("/v1/scraper/task_download", { task_ids: params.task_id, file_type: ... }, { apiKey })
```
This correctly posts to `api-m.novada.com/v1/scraper/task_download` with Bearer auth.

**Result: MISMATCH ❌** for `novada_scraper_result` primary path vs spec.
**Result: MATCH ✅** for `scraper_task_mgmt.ts` `action='download'` vs spec.

The non-spec endpoint (`api.novada.com/g/api/proxy/scraper_download` with apikey query param) appears to be a working undocumented proxy. The comment at `scraper_result.ts` line 37 acknowledges this: "Auth: apikey query param (NOT Bearer)". This is empirically functional but deviates from published spec.

---

## 5. Auth — Download Endpoint

**Spec:** Bearer token (`Authorization: Bearer YOUR_API_KEY`)

**Implementation `scraper_result.ts` lines 119–122:**
```typescript
axios.get(RESULT_DOWNLOAD_ENDPOINT, {
  params: { task_id, file_type: "json", apikey: apiKey },
  ...
})
```
Uses `apikey` as a query parameter — NOT a Bearer header.

**Result: MISMATCH ❌ vs spec** — The implementation intentionally uses the undocumented proxy endpoint that requires apikey as query param rather than Bearer. This is a conscious divergence documented in code comments.

**For submit auth:** `scrape.ts` line 73 uses `Bearer ${apiKey}` ✅ matching spec.

---

## 6. Error Codes

### 11006 — "task not found" / invalid operation

**Spec:** Not explicitly listed in the doc page.

**Implementation:**
- `scrape.ts` lines 83–89: caught and thrown as `NovadaErrorCode.PRODUCT_UNAVAILABLE` ✅
- `scraper_submit.ts` lines 47–58: re-enriches the error with alias context ✅
- `scraper_result.ts` — NOT handled (only checks 27202, 10002, 10003)

**Result: MATCH ✅** — 11006 is handled in submit path. Gap: not explicitly handled in result path (irrelevant since result path uses a different endpoint).

### 11008 — unknown platform

**Implementation (`scrape.ts` lines 90–95):** Caught and thrown as `NovadaErrorCode.INVALID_PARAMS` ✅

**Result: MATCH ✅**

### Other codes handled

| Code | Location | Meaning |
|------|----------|---------|
| 10001 | `scrape.ts` line 154 | Invalid file type |
| 10002, 10003 | `scrape.ts` lines 157–159, `scraper_result.ts` lines 153–164 | Task failed |
| 27202 | Multiple | Pending |
| 27203 | `scrape.ts` line 161 | Transient task execution error |
| 10002/10003 | `scraper_status.ts` lines 148–150 | Failed |

---

## 7. Sync Mode

**Spec:** No explicit sync/async mode documented. The spec's `POST /request` always returns a `task_id` (async by default).

**Implementation:**
- `novadaScrape()` in `scrape.ts` (line 244) implements a **synchronous** wrapper — it submits the task, then immediately polls `pollForResult()` until completion (up to 180s at 2s intervals).
- `novadaScraperSubmit()` in `scraper_submit.ts` exposes the **async** path — returns `task_id` immediately without polling.

**Result: MATCH ✅** — The submit-and-poll sync wrapper (`novadaScrape`) aligns with the expected use pattern even though the spec doesn't define a sync mode flag. There's no `sync=true` param in our implementation either — sync behavior is determined by which tool the agent calls (`novada_scrape` vs `novada_scraper_submit`).

---

## Summary

| Check | Result | Note |
|-------|--------|------|
| Submit URL `scraper.novada.com/request` | ✅ MATCH | config.ts:8, scrape.ts:7 |
| Submit auth (Bearer) | ✅ MATCH | scrape.ts:73 |
| Submit Content-Type | ✅ MATCH | scrape.ts:74 |
| Submit `scraper_name` field | ✅ MATCH | scrape.ts:37 |
| Submit `scraper_id` field | ✅ MATCH | scrape.ts:38 |
| Submit `scraper_errors` field | ✅ MATCH | scrape.ts:39 |
| Submit `file_name` field (spec: required) | ❌ MISMATCH | Never sent — scrape.ts has no file_name |
| Submit `scraper_params` field | ✅ MATCH | scrape.ts:68 (non-search) |
| Status endpoint (spec: POST /task_status) | ❌ MISMATCH | scraper_status.ts uses GET download proxy as primary; GET /scraper/{id} as fallback |
| Status code 27202 = pending | ✅ MATCH | scraper_status.ts:94, :146; scrape.ts:134 |
| Status "Ready" string handling | ❌ MISMATCH | normalizeStatus() doesn't map "Ready" → complete |
| Download endpoint (spec: POST /task_download) | ❌ MISMATCH | scraper_result.ts uses GET undocumented proxy endpoint |
| Download auth (spec: Bearer) | ❌ MISMATCH | scraper_result.ts uses apikey query param |
| Download `task_ids` param (spec: plural) | ❌ MISMATCH | scraper_result.ts uses `task_id` (singular) on different endpoint |
| task_mgmt download (spec: POST /task_download) | ✅ MATCH | scraper_task_mgmt.ts:163–166 |
| Error 11006 handling | ✅ MATCH | scrape.ts:83–89, scraper_submit.ts:47–58 |
| Error 11008 handling | ✅ MATCH | scrape.ts:90–95 |
| Sync polling wrapper | ✅ MATCH | scrape.ts novadaScrape() |

---

## Key Findings

1. **`file_name` not sent on submit** — Spec marks it required. Currently omitted. If the backend enforces this in future, all submits will fail. Recommend adding `file_name` with a generated value (e.g. `${scraper_id}_${Date.now()}`).

2. **`novada_scraper_status` diverges from spec endpoint** — The primary user-facing polling tool bypasses the spec-documented `POST /v1/scraper/task_status` in favor of a proxy endpoint. The spec-compliant endpoint is only used in the internal `scraper_task_mgmt` tool. This is likely intentional (the proxy endpoint returns actual data, not just status strings) but creates doc-to-code divergence.

3. **`"Ready"` status string not normalized** — If the api-m fallback path in `scraper_status.ts` is ever exercised, `"Ready"` won't be mapped to `"complete"`. Add `"ready"` to the `normalizeStatus()` match list at scraper_status.ts:56.

4. **Download URL is an undocumented proxy** — `api.novada.com/g/api/proxy/scraper_download` with `apikey` query param works in practice but is not in the published spec. Risk: proxy URL could be deprecated without notice.
