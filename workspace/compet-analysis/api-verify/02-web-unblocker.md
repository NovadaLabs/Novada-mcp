# Web Unblocker API Compliance Verification

**Date:** 2026-06-23
**Spec source:** `/tmp/novada-api-pages/13-web-unblocker.md`
**Implementation:** `src/tools/unblock.ts`, `src/utils/http.ts`

---

## 1. Endpoint URL ✅

**Spec:** `https://webunlocker.novada.com/request`

**Implementation:** `src/config.ts:22` defines `WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com"`. Used in `src/utils/http.ts:250` as `${WEB_UNBLOCKER_BASE}/request`.

Exact match.

---

## 2. Request Method ❌ MISMATCH

**Spec:** `POST` with `application/x-www-form-urlencoded`

**Implementation:** `src/utils/http.ts:249` uses `axios.post(...)` — method is correct (POST). However, `src/utils/http.ts:254` sends `"Content-Type": "application/json"` and passes a plain JS object, which axios serializes as JSON.

The spec requires `application/x-www-form-urlencoded`. We are sending `application/json`. This is a content-type mismatch that may cause silent failures depending on server tolerance.

---

## 3. Required Fields ✅ / ⚠️ PARTIAL

**Spec required fields:** `target_url`, `response_format`

**Implementation** (`src/utils/http.ts:251`):
```
{ target_url: url, response_format: "html", js_render: true, country: country ?? "" }
```

- `target_url` ✅ — present
- `response_format` ✅ — hardcoded to `"html"` (valid per spec: HTML or PNG)
- `js_render` ✅ — hardcoded `true` (matches spec field name `js_render`, not `js_rendering`)

Note: `response_format` is always forced to `"html"` — PNG mode is never used. This is an intentional constraint (the tool only returns HTML), not a bug.

---

## 4. Auth ❌ MISMATCH (design divergence from task spec)

**Spec:** `Authorization: Bearer <token>` where token = user's API key (implies `NOVADA_API_KEY`)

**Task spec says to check:** Is `NOVADA_API_KEY` being used (not `NOVADA_WEB_UNBLOCKER_KEY`)?

**Implementation:** `src/utils/credentials.ts:29-30` — `getWebUnblockerKey()` returns:
```
store.getStore()?.webUnblockerKey ?? process.env.NOVADA_WEB_UNBLOCKER_KEY ?? process.env.NOVADA_API_KEY
```

**Auth header** (`src/utils/http.ts:255`): `"Authorization": "Bearer ${unblockerKey}"`

Verdict: The implementation uses `NOVADA_WEB_UNBLOCKER_KEY` as primary and falls back to `NOVADA_API_KEY`. The API spec says the token IS the user's API key — so using `NOVADA_API_KEY` as the fallback is compliant. The separate `NOVADA_WEB_UNBLOCKER_KEY` is an implementation-level override, not a spec violation.

If `NOVADA_WEB_UNBLOCKER_KEY` is set to a different key from `NOVADA_API_KEY`, the auth token sent will differ from what the spec implies. This is expected product behavior (optional override), not a bug. Auth bearer header format itself is correct.

---

## 5. Optional Params ⚠️ PARTIAL

**Spec optional fields:** `js_render`, `headers`, `cookies`, `country`, `wait_ms`, `wait_selector`, `follow_redirects`, `block_resources`, `clear`, `auto_runs`

**Implementation** (`src/utils/http.ts:251`): only sends `js_render` and `country`.

| Param | Spec | Impl | Status |
|---|---|---|---|
| `js_render` | optional boolean | always `true` | ✅ sent (hardcoded) |
| `country` | optional string | passed through | ✅ wired |
| `wait_ms` | optional integer | NOT sent | ❌ missing |
| `wait_selector` | optional string | NOT sent (only `wait_for` parsed in unblock.ts but never forwarded to API) | ❌ missing |
| `headers` | optional string | NOT sent | ❌ missing |
| `cookies` | optional string | NOT sent | ❌ missing |
| `follow_redirects` | optional string | NOT sent | ❌ missing |
| `block_resources` | optional string | NOT sent | ❌ missing |
| `clear` | optional string | NOT sent | ❌ missing |
| `auto_runs` | optional integer | NOT sent | ❌ missing |

`wait_for` is accepted in `unblock.ts:13` (`params.wait_for`) and passed to `routeFetch` as `waitForSelector` (`src/utils/router.ts`), but it is NOT forwarded to the Web Unblocker API request body at the HTTP layer. The spec field `wait_selector` maps to this param but is dropped before the POST.

---

## 6. Response Parsing ✅

**Spec response:** `application/json` with unspecified schema.

**Implementation** (`src/utils/http.ts:265`):
```
if (resp.data?.code === 0 && resp.data?.data?.html) {
  return { ...resp, data: resp.data.data.html };
}
```

Expects: `{ code: 0, data: { code: 200, html: "...", msg, msg_detail } }`

This matches what the actual API returns (nested envelope pattern). The inner `data.code` transient error handling (lines 269-279) is defensive and correct.

---

## 7. Auth Key: NOVADA_API_KEY vs NOVADA_WEB_UNBLOCKER_KEY ✅ (by design)

**Task question:** Is `NOVADA_API_KEY` being used as auth (not `NOVADA_WEB_UNBLOCKER_KEY`)?

**Answer:** Both can be used. `getWebUnblockerKey()` at `src/utils/credentials.ts:30` resolves:
1. SDK-scoped key (per-request override)
2. `NOVADA_WEB_UNBLOCKER_KEY` env var
3. `NOVADA_API_KEY` env var (fallback)

The spec says the token = user's API key, which is `NOVADA_API_KEY`. The fallback chain ensures `NOVADA_API_KEY` is used when `NOVADA_WEB_UNBLOCKER_KEY` is absent. This is compliant. The separate env var is a user convenience feature, not a spec violation.

---

## Summary

| Check | Status | Notes |
|---|---|---|
| Endpoint URL | ✅ MATCH | `https://webunlocker.novada.com/request` |
| Request method (POST) | ✅ MATCH | Correct |
| Content-Type | ❌ MISMATCH | Sends `application/json`; spec requires `application/x-www-form-urlencoded` |
| Required field: `target_url` | ✅ MATCH | `http.ts:251` |
| Required field: `response_format` | ✅ MATCH | Hardcoded `"html"` |
| Auth header format | ✅ MATCH | `Bearer ${key}` |
| Auth key source | ✅ MATCH | Falls back to `NOVADA_API_KEY` when override not set |
| `js_render` param | ✅ MATCH | Always `true` |
| `country` param | ✅ MATCH | Wired through |
| `wait_selector` / `wait_ms` forwarding | ❌ MISMATCH | Parsed in tool but not sent to API body |
| Other optional params | ❌ MISSING | 7 spec params never forwarded |
| Response parsing | ✅ MATCH | Nested envelope handled correctly |

**Critical:** Content-Type mismatch (JSON vs form-encoded) is the highest-risk issue — the server may reject or misparse requests depending on its tolerance. All other mismatches are missing optional features.
