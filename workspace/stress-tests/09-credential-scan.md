# 09 — Credential Leak Scan

**Date:** 2026-06-25
**Version:** novada-mcp v0.8.3
**Scope:** Trigger error paths across all tool categories and verify no error message contains API keys, passwords, or internal URLs.

## Test Credentials Used

| Secret | Type | Length |
|--------|------|--------|
| `1f35...adfa` | NOVADA_API_KEY | 32 |
| `Dz0v...Wkil` | Browser WSS password | 12 |
| `nova...8WuZ` | Browser WSS username | 20 |
| `_Asd...asd_` | Proxy password | 12 |
| `tong...DI7X` | Proxy username | 14 |

## Results Summary (post-fix)

| # | Test Case | Status | Notes |
|---|-----------|--------|-------|
| 1 | `novadaExtract` render=browser (forced) | PASS | Error sanitized, no secrets |
| 2 | `novadaSetup` output | PASS | API key masked as `1f35...adfa` (first 4 + last 4) |
| 3 | `novadaHealthAll` output | PASS | No secrets exposed |
| 4 | `novadaSearch` with wrong key | PASS | Generic "invalid API key" error |
| 5 | `novadaExtract` unreachable URL | PASS | No secrets in error |
| 6 | `novadaExtract` empty API key | PASS | No secrets in error |
| 7 | `novadaSearch` real key in output | PASS | Key not present in search results |
| 8 | `novadaProxy` residential (url format) | PASS* | Username exposed by design (see F-2) |
| 9 | `novadaHealth` all vars set | PASS | No secrets exposed |
| 10 | `novadaUnblock` bad URL | PASS | No secrets in error |
| 11 | `novadaBrowser` connection error (invalid host) | PASS | **FIXED** -- was CRITICAL, now sanitized |
| 12 | `novadaBrowser` working connection | PASS | No secrets in normal output |
| 13 | `novadaSetup` with proxy creds | PASS | Proxy password not shown |

**Overall: 13 PASS (1 by-design), 0 FAIL**

---

## Findings

### F-1: CRITICAL (FIXED) — Browser tool leaked WSS credentials on connection failure

**File:** `src/tools/browser.ts`
**Severity:** CRITICAL
**Status:** FIXED in this session
**Trigger:** `novadaBrowser` with an unreachable `NOVADA_BROWSER_WS` endpoint

**Before fix:** When `chromium.connectOverCDP(wsEndpoint)` failed (DNS error, connection refused, timeout), Playwright embedded the full WSS URL in its error message. The browser tool passed this error through to the output without sanitization:

```
browserType.connectOverCDP: WebSocket error: getaddrinfo ENOTFOUND invalidhost12345.com
Call log:
  - <ws connecting> wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@invalidhost12345.com/
  - <ws error> wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@invalidhost12345.com/ ...
```

Both the **username** and **password** were fully exposed.

**Root cause:** `tools/browser.ts` had a `try/finally` block (no `catch`) around `chromium.connectOverCDP()`. The Playwright error propagated up without going through `sanitizeBrowserError()`. The sanitizer existed in `utils/browser.ts` but was (a) not exported, and (b) not imported in the tools layer.

**Contrast:** `utils/browser.ts:fetchViaBrowser()` (used by `novadaExtract`) correctly sanitized at its own catch block.

**Fix applied (3 changes):**

1. **Export sanitizer:** `src/utils/browser.ts` -- changed `function sanitizeBrowserError` to `export function sanitizeBrowserError`

2. **Import + apply to all error paths:** `src/tools/browser.ts` --
   - Added import: `import { sanitizeBrowserError } from "../utils/browser.js"`
   - Wrapped all 3 `errMsg` assignments through `sanitizeBrowserError()`
   - Added `catch` block around `connectOverCDP` to intercept Playwright connection errors

3. **Redacted malformed-URL error:** Changed `wsEndpoint.slice(0, 30)` to `"[redacted]"` in the format validation check

**After fix:**
```
### Action 1: navigate [error]
Error: browserType.connectOverCDP: WebSocket error: getaddrinfo ENOTFOUND invalidhost12345.com
Call log:
  - <ws connecting> wss://***:***@invalidhost12345.com/
  - <ws error> wss://***:***@invalidhost12345.com/ ...
```

### F-2: LOW — Proxy tool exposes proxy username (by design)

**File:** `src/tools/proxy.ts` (line 74)
**Severity:** LOW (by design, not a bug)

The proxy tool's output includes the proxy username in the proxy URL: `http://tongwu_TRDI7X-zone-res:***@pr.novada.com:7777`. This is intentional -- the tool's purpose is to provide users with a usable proxy URL. The password is correctly masked with `***`.

**Risk:** The proxy username alone cannot authenticate. It does reveal the Novada account name. Acceptable for the tool's purpose.

### F-3: INFO — Setup tool exposes 8 chars of API key

**File:** `src/tools/setup.ts` (line 28-30)
**Severity:** INFO (acceptable masking)

The setup tool masks API keys as `1f35...adfa` (first 4 + last 4 = 8 chars visible out of 32). This is standard practice matching Stripe, GitHub, and other platforms. Not a security issue.

### F-4: INFO — sanitizeServerMsg does not cover raw credential values

**File:** `src/_core/errors.ts` (line 162-179)
**Severity:** INFO

The `sanitizeServerMsg()` function handles:
- URL query params: `api_key=...`, `apikey=...`
- HTTP headers: `Authorization: Bearer ...`
- Internal API URLs: `scraperapi.novada.com`
- JSON fields: `"api_key":"..."`, `"password":"..."`, `"token":"..."`

It does NOT strip raw credential values that appear as plain strings. This is acceptable because `classifyError()` replaces raw error messages with safe, pre-defined messages for auth failures.

### F-5: INFO (FIXED) — browser.ts partial credential exposure via slice

**File:** `src/tools/browser.ts`
**Severity:** INFO (edge case, only on malformed config)
**Status:** FIXED -- replaced `wsEndpoint.slice(0, 30)` with `"[redacted]"`

---

## Sanitization Architecture (post-fix)

```
utils/browser.ts
  sanitizeBrowserError(msg)     -- exported, strips wss://user:pass@ patterns
  fetchViaBrowser()             -- USES sanitizeBrowserError (line 170)  OK

_core/errors.ts
  sanitizeServerMsg(msg)        -- strips api_key=, Bearer, JSON fields, internal URLs
  classifyError(error)          -- USES sanitizeMessage for URL_UNREACHABLE + UNKNOWN  OK

tools/browser.ts
  novadaBrowser()               -- NOW USES sanitizeBrowserError on all error paths  OK (FIXED)
```

## Files Changed

| File | Change |
|------|--------|
| `src/utils/browser.ts` | Export `sanitizeBrowserError` function |
| `src/tools/browser.ts` | Import sanitizer, apply to 3 error paths, add catch block for connectOverCDP, redact slice(0,30) |
