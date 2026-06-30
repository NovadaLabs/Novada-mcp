# Worker Report: Scraper Download Flow Fix

**Date:** 2026-06-23
**Status:** COMPLETE
**tsc:** EXIT 0

## Changes Made

### Fix 1: scrape.ts — file_name added to submit
- File: `src/tools/scrape.ts`
- Added `file_name` generation before form build: `novada_${Date.now()}_${Math.random().toString(36).slice(2,8)}`
- Appended as `form.append("file_name", file_name)` after `is_auto_push`

### Fix 2: scraper_status.ts — correct status endpoint
- File: `src/tools/scraper_status.ts`
- Imported `devApiPost` from `../_core/developer_api.js`
- Replaced the primary try/catch block (which was hitting `SCRAPER_DOWNLOAD_BASE/scraper_download`) with a POST to `/v1/scraper/task_status` using `devApiPost`
- Response shape: `{ task_id, status, msg }` — status values: "Pending" | "Running" | "Ready" | "Failed"
- Updated `normalizeStatus` to map `"ready"` -> `"complete"` and explicitly map `"pending"` | `"waiting"` -> `"pending"`
- Old fallback (api-m GET path) is preserved as-is for the case where devApiPost throws

### Fix 3: scraper_result.ts — 2-step COS download
- File: `src/tools/scraper_result.ts`
- Imported `devApiPost` from `../_core/developer_api.js`
- Primary path now:
  1. POST `/v1/scraper/task_download` via `devApiPost` → get `cos_url` from response
  2. GET the pre-signed COS URL via plain `axios.get` (no auth) → actual scraped JSON
- If no `cos_url` returned: returns `not_ready` JSON
- On any failure from steps 1-2: falls through to the legacy `GET /scraper_download?apikey=...` endpoint (original logic preserved verbatim as fallback)
- Existing error handling for codes 27202, 10002, 10003 retained in fallback

## Type Correctness Notes
- `devApiPost` signature is `(path, body, opts: { apiKey?, timeoutMs? })` — used as `{ apiKey }` throughout (not positional string)
- Typed `TaskDownloadData`, `TaskDownloadResponse`, and `TaskStatusData` inline interfaces to avoid `unknown` property access errors
- No unused imports left
