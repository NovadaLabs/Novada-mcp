# Universal Scraper API Compliance Verification

Date: 2026-06-23
Source: `/tmp/novada-api-pages/14-scraper-api.md` (official spec)
Implementation: `src/tools/scrape.ts`, `src/tools/scraper_submit.ts`, `src/tools/scraper_status.ts`, `src/tools/scraper_result.ts`

---

## Check 1: Submit Endpoint URL ✅

**Spec:** `POST https://scraper.novada.com/request`
**Our code:** `config.ts:8` → `SCRAPER_API_BASE = "https://scraper.novada.com"` + `scrape.ts:7` → `SCRAPE_ENDPOINT = ${SCRAPER_API_BASE}/request`

**Result: MATCH.** URL is correct.

---

## Check 2: Request Body Format ❌ PARTIAL MISMATCH

**Spec:** `Content-Type: x-www-form-urlencoded`
**Our code (`scrape.ts:71-77`):**
```
Content-Type: "application/x-www-form-urlencoded"
```
Uses `URLSearchParams` (which serializes as x-www-form-urlencoded).

**BUT:** The spec example curl uses `-d` flags (form-urlencoded), and the task list/status/download endpoints say `Content-Type: form-data`. Our submit sends `application/x-www-form-urlencoded` which matches the create-task spec exactly.

**Result: MATCH for /request (submit). No issue here.**

---

## Check 3: Field Names ❌ CRITICAL MISMATCH

**Spec (from `14-scraper-api.md`, Request params table):**

| field | type | required |
|-------|------|----------|
| `scraper_name` | string | yes |
| `scraper_id` | **number** | yes |
| `scraper_params` | string | no |
| `scraper_errors` | boolean | yes |
| `file_name` | string | yes |

**Our code (`scrape.ts:37-39`):**
```typescript
form.append("scraper_name", scraper_name);   // ✅ correct
form.append("scraper_id", scraper_id);        // ❌ scraper_id should be NUMBER per spec, we send string
form.append("scraper_errors", "true");        // ✅ correct (boolean as string is fine in form-encoded)
form.append("is_auto_push", "false");         // ❌ NOT in spec — extra field, likely harmless but undocumented
// MISSING: file_name — listed as required in spec but we never send it
```

**Mismatches:**
1. `scraper_id` type: spec says `number`, we append it as a string. The spec example uses `scraper_id=amazon_product_keywords` (string) in the curl example — contradicting the table saying "number". The actual field value in the example IS a string (operation name). Likely the table type column is wrong; the example is correct. **Low risk.**
2. `file_name` is marked **required** in spec but we never send it. This may be why some tasks fail silently or return unexpected results. **Medium risk.**
3. `is_auto_push` is not in spec. **Undocumented field — likely harmless.**

---

## Check 4: Async Flow ❌ CRITICAL MISMATCH

**Spec defines this flow:**
1. `POST /request` → returns `task_id` (nested at `data.data.task_id`)
2. `POST https://api-m.novada.com/v1/scraper/task_status` with `task_ids` → returns `{status: "Ready"|"Failed"|...}`
3. `POST https://api-m.novada.com/v1/scraper/task_download` with `task_ids` + `file_type` → returns array of `{download: "<cos-url>", task_id: "..."}` (COS presigned download URLs)
4. Fetch the actual data by doing a GET on each `download` URL

**Our implementation:**
- Submit: ✅ correct
- Status check (`scraper_status.ts`): uses `GET https://api-m.novada.com/v1/scraper/{task_id}` (single task, GET, not in spec) **AND** falls back to `GET https://api.novada.com/g/api/proxy/scraper_download?task_id=...` — **neither endpoint is in the official spec**.
- Download (`scraper_result.ts`): uses `GET https://api.novada.com/g/api/proxy/scraper_download?task_id=...&file_type=json&apikey=...` — **this endpoint is NOT in the official spec at all**.

**Official download endpoint:** `POST https://api-m.novada.com/v1/scraper/task_download` with `task_ids` (plural, comma-separated) as form-data, returns COS download URLs. Then a second GET to the COS URL to fetch actual data.

**Our download endpoint:** `GET https://api.novada.com/g/api/proxy/scraper_download` — an undocumented proxy endpoint with different auth (apikey query param vs Bearer token). This appears to be an internal shortcut that may or may not work depending on account configuration.

**Result: MISMATCH — we use undocumented internal endpoints, not the official spec endpoints.**

---

## Check 5: task_id Handling ❌ MISMATCH

**Spec response (`14-scraper-api.md` lines 36-48):**
```json
{
  "code": 0,
  "data": {
    "code": 200,
    "data": {
      "task_id": "330ae83bcff7479b9c97e586dbf93801"
    },
    "msg": "success"
  }
}
```
task_id is at `data.data.task_id` (double-nested).

**Our code (`scrape.ts:106-113`):**
```typescript
const inner = body.data as Record<string, unknown> | null;
const taskId = (
  (inner?.task_id as string | undefined) ??
  ((inner?.data as Record<string, unknown> | undefined)?.task_id as string | undefined)
);
```
Tries `data.task_id` first, then falls back to `data.data.task_id`.

**Result: MATCH (handles both shapes). The fallback catches the documented double-nested shape.**

---

## Check 6: Sync vs Async Mode ❌ SPEC GAP

**Spec:** Only documents async mode (submit → poll → download). No sync/inline mode documented.

**Our implementation (`scrape.ts`):** `novadaScrape()` is internally async (poll loop up to 180s) but returns final results synchronously to the caller. This is a UX choice, not an API-level issue.

**Separate async tools (`scraper_submit`, `scraper_status`, `scraper_result`):** Expose the three-step async flow explicitly.

**Result: No mismatch — spec only has async, we support both user experiences.**

---

## Check 7: Download Endpoint Format ❌ CRITICAL MISMATCH

**Spec (`14-scraper-api.md`, lines 192-238):**
```
POST https://api-m.novada.com/v1/scraper/task_download
Content-Type: form-data
Authorization: Bearer YOUR_API_KEY
Body: task_ids=<comma-separated-ids>&file_type=json
```
Response: `{ code: 0, data: [{ download: "<cos-url>", task_id: "..." }] }`
Then: GET the `download` COS URL to fetch actual JSON data.

**Our code (`config.ts:13`, `scrape.ts:120`, `scraper_result.ts:38`):**
```
GET https://api.novada.com/g/api/proxy/scraper_download?task_id=...&file_type=json&apikey=...
Auth: apikey as query param (NOT Bearer token)
```

**Differences:**
1. Domain: `api.novada.com/g/api/proxy` vs `api-m.novada.com/v1/scraper`
2. Method: GET vs POST
3. Auth: query param `apikey=` vs `Authorization: Bearer`
4. Field name: `task_id` (singular) vs `task_ids` (plural, comma-separated)
5. Response: returns data directly vs returns COS download URLs requiring second fetch

**The endpoint we use (`api.novada.com/g/api/proxy/scraper_download`) is an undocumented internal proxy.** It appears to work in practice (code 27202 for pending, array for complete), but it is not the official API.

---

## Root Cause: Amazon Scrape Returns 0 Chars

Based on the above analysis, the most likely causes for 0 chars from Amazon:

### Cause 1: Missing `file_name` field (HIGH probability)
The spec marks `file_name` as **required** in the create-task endpoint. We never send it (`scrape.ts` has no `file_name` append). The backend may silently succeed at task creation but fail to write the output file, causing the download to return an empty or pending response indefinitely.

### Cause 2: Wrong status polling endpoint (MEDIUM probability)
Our status check uses `GET https://api-m.novada.com/v1/scraper/{task_id}` — a GET to a path with single task_id. The spec says `POST https://api-m.novada.com/v1/scraper/task_status` with `task_ids` body param. If `api-m` returns 404 on our path (which `scraper_status.ts:72` explicitly notes: "api-m.novada.com/v1/scraper returns 404"), we fall back to the proxy download endpoint which may return code 27202 (pending) even for completed tasks that used the wrong file_name.

### Cause 3: Amazon-specific scraper_params format (MEDIUM probability)
From `14-scraper-api.md` line 30-31, Amazon keywords example:
```
scraper_params=[{"keyword":"Coffer","max_pages":"1","min_price":"5","max_price":"50"}]
```
For `amazon_product_asin`, the required param is `asin`. Our code wraps it correctly in `scraper_params=[{...}]` (scrape.ts lines 67-68). But if no `asin` or `keyword` is passed, the task may succeed with 0 results.

### Cause 4: Download endpoint returns COS URLs, not data directly (HIGH probability)
The spec says `task_download` returns `{ download: "<cos-url>" }` — a redirect URL to cloud storage. Our proxy endpoint (`api.novada.com/g/api/proxy/scraper_download`) appears to follow the redirect and return the data inline. If the proxy is down, rate-limited, or the COS file wasn't written (due to missing `file_name`), we'd get 0 chars.

---

## Summary Table

| Check | Status | Severity | Notes |
|-------|--------|----------|-------|
| Submit URL | ✅ MATCH | — | `scraper.novada.com/request` correct |
| Request body format | ✅ MATCH | — | `x-www-form-urlencoded` correct |
| Field names | ❌ PARTIAL | Medium | `file_name` required but missing; `is_auto_push` undocumented |
| `scraper_id` type | ⚠️ AMBIGUOUS | Low | Spec says number, example uses string; string works |
| Async flow — status | ❌ MISMATCH | High | We use GET `/v1/scraper/{id}`; spec is POST `/task_status` with `task_ids` |
| Async flow — download | ❌ MISMATCH | Critical | We use undocumented proxy; spec is POST `/task_download` → COS URL |
| task_id extraction | ✅ MATCH | — | Handles double-nested `data.data.task_id` correctly |
| Sync/async modes | ✅ N/A | — | Both supported; spec only has async |
| Download endpoint format | ❌ MISMATCH | Critical | Wrong domain, method, auth, field name, response shape |
| Amazon 0 chars root cause | ❌ BUG | Critical | Missing `file_name` + relying on undocumented proxy endpoint |

---

## Recommended Fixes

1. **Add `file_name` to submit request** (`scrape.ts:39`): `form.append("file_name", scraper_id + "_" + Date.now())` — required field per spec.

2. **Fix status endpoint** (`scraper_status.ts`): Change from `GET api-m.novada.com/v1/scraper/{task_id}` to `POST api-m.novada.com/v1/scraper/task_status` with body `task_ids=<task_id>`.

3. **Fix download flow** (`scraper_result.ts`): Change from single-step proxy GET to two-step:
   - Step 1: `POST api-m.novada.com/v1/scraper/task_download` → get COS `download` URL
   - Step 2: GET the COS URL → get actual JSON data

4. **Keep the proxy as fallback**: `api.novada.com/g/api/proxy/scraper_download` appears to work in practice and is faster (one fewer hop). Keep as primary, add official two-step as fallback.
