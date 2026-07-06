# Browser API Compliance Verification

**Source:** `/tmp/novada-api-pages/15-browser-api.md` (official spec)
**Implementation files:**
- `src/tools/browser.ts` — CDP WebSocket automation (novada_browser)
- `src/tools/browser_flow.ts` — HTTP action-sequence API (novada_browser_flow)
- `src/utils/browser.ts` — session management + fetchViaBrowser utility
- `src/_core/developer_api.ts` — shared HTTP client for api-m.novada.com
- `src/tools/proxy_account_create.ts` — account management

---

## 1. Browser API HTTP Endpoints — URL and Auth

The official spec (15-browser-api.md) contains **one documented endpoint**:

```
POST /v1/proxy_account/create   (product: 10 = Browser API)
```

The JSON schema in the spec explicitly states `"product:10=Browser API"`.

### Check 1a — /v1/proxy_account/create endpoint ✅

Our implementation calls:
- `src/tools/proxy_account_create.ts` line 130: `devApiPost("/v1/proxy_account/create", body, { apiKey })`
- `src/_core/developer_api.ts` line 27: `DEVELOPER_API_BASE = "https://api-m.novada.com"`

Resolved URL: `https://api-m.novada.com/v1/proxy_account/create` — matches spec.

Auth: `Authorization: Bearer ${apiKey}` (`developer_api.ts` line 114) — matches spec (`"security":[{"bearer":[]}]`).

Content-Type: `multipart/form-data` (`developer_api.ts` lines 75–89, using `FormData`) — matches spec.

### Check 1b — Browser API product code ❌ MISMATCH

**Spec says:** `"product:10=Browser API"` (in 15-browser-api.md OpenAPI JSON)

**Our implementation:** `src/tools/proxy_account_create.ts` line 19:
```typescript
const PRODUCT_CODES = ["1", "2", "3", "4", "7", "9"] as const;
```
Product code `"10"` (Browser API) is **absent** from the allowed enum. The local docs
(`docs/novada-api/proxy-user-management.md` lines 14–19) also omit code 10 — the
developer-api reference was copied before the Browser API product was added to the table.

**Impact:** `novada_proxy_account_create` cannot create Browser API sub-accounts. Passing
`product: "10"` would be rejected at Zod validation before even hitting the API.

---

## 2. WebDriver/WSS Connection — NOVADA_BROWSER_WS Format

### Check 2 — WSS format ✅

Spec implies CDP WebSocket credentials are `username:password@host`. Our implementation:

- `src/tools/browser.ts` lines 143–154:
  - Validates `wss://` prefix (throws if missing)
  - Validates `@` present in URL (throws if absent)
  - Example shown: `wss://user:pass@upg-scbr2.novada.com`
- `src/utils/browser.ts` line 103: error message shows `wss://user:pass@upg-scbr.novada.com`
- Connection made via `chromium.connectOverCDP(wsEndpoint)` — Playwright CDP, correct mechanism

Format is `wss://username:password@host` which is the standard CDP WebSocket auth embedding.
No mismatch with spec intent; spec doesn't define the WSS URL format explicitly but the
dashboard credential format matches what our validation enforces.

---

## 3. Traffic Management Endpoints

The spec page (15-browser-api.md) **does not document** any traffic management endpoints.
The developer-api reference (`docs/novada-api/developer-api-reference.md` line 207) notes:
> "Browser API — Traffic monitoring endpoints available" (no further detail)

Our implementation does not implement Browser API-specific traffic endpoints. The general
`/v1/residential_flow/consume_log` etc. endpoints in `src/tools/traffic_daily.ts` do NOT
include a browser-specific flow path (`/v1/browser_flow/consume_log` or similar).

### Check 3 — Traffic management endpoints ⚠️ UNKNOWN

Cannot verify — the spec page only shows the account-create endpoint. No traffic endpoint
paths are documented. No browser-specific traffic endpoint is implemented. If such
endpoints exist server-side, they are not yet wired.

---

## 4. The 3 HTTP Management Endpoints

The official Browser API spec page (`15-browser-api.md`) documents **only 1 endpoint**:

| Endpoint | Documented | Implemented |
|----------|-----------|-------------|
| `POST /v1/proxy_account/create` (product=10) | ✅ | ✅ (but product code 10 missing from enum — see Check 1b) |

There are **no 3 HTTP management endpoints** documented on the Browser API spec page. The
page contains a single OpenAPI fragment for `/v1/proxy_account/create`.

If "3 management endpoints" refers to the Proxy User Management group as a whole, those are:
1. `POST /v1/proxy_account/create` — implemented (`proxy_account_create.ts`)
2. `POST /v1/proxy_account/list` — implemented (`proxy_account_list.ts`)
3. `POST /v1/proxy_account/update` — **NOT implemented** (no tool exists for this)

### Check 4 — /v1/proxy_account/update ❌ MISSING

`docs/novada-api/proxy-user-management.md` lines 73–91 documents `POST /v1/proxy_account/update`.
No corresponding tool or function exists in `src/tools/`.

---

## 5. Auth — API Key for HTTP vs username:password for WebDriver/WSS

### Check 5a — HTTP endpoints use API Key ✅

All HTTP calls to `api-m.novada.com` go through `devApiPost()` in `_core/developer_api.ts`
which injects `Authorization: Bearer ${apiKey}` (line 114). The spec uses
`"security":[{"bearer":[]}]`. Correct.

The `browser_flow.ts` HTTP endpoint also uses `Authorization: Bearer ${apiKey}` (line 137).
Correct.

### Check 5b — WebDriver/WSS uses username:password ✅

The CDP WebSocket connection in `src/tools/browser.ts` line 155:
```typescript
browser = await chromium.connectOverCDP(wsEndpoint);
```
where `wsEndpoint` is the full `wss://username:password@host` URL from `NOVADA_BROWSER_WS`.
Playwright CDP embeds auth in the URL — credentials travel as HTTP Basic Auth during the
WebSocket upgrade handshake. This is the correct pattern for Novada's Browser API CDP endpoint.

---

## Summary

| Check | Result | Detail |
|-------|--------|--------|
| 1a. /v1/proxy_account/create URL + auth | ✅ MATCH | Correct URL, Bearer token, multipart body |
| 1b. Browser API product code (10) | ❌ MISMATCH | Code "10" missing from ProxyAccountCreateParams enum; `proxy_account_create.ts` line 19 |
| 2. NOVADA_BROWSER_WS format | ✅ MATCH | `wss://user:pass@host` enforced at `browser.ts` lines 143–154 |
| 3. Traffic management endpoints | ⚠️ UNKNOWN | Not in spec; no browser-specific flow endpoint implemented |
| 4a. /v1/proxy_account/list | ✅ MATCH | Implemented in `proxy_account_list.ts` |
| 4b. /v1/proxy_account/update | ❌ MISSING | Documented in proxy-user-management.md but no tool exists |
| 5a. HTTP endpoints use API Key Bearer | ✅ MATCH | `developer_api.ts` line 114; `browser_flow.ts` line 137 |
| 5b. WSS uses username:password | ✅ MATCH | Embedded in NOVADA_BROWSER_WS URL, passed to connectOverCDP |

### Critical Findings

1. **Product code "10" (Browser API) missing** from `ProxyAccountCreateParams` Zod enum
   (`proxy_account_create.ts` line 19). Agents cannot create Browser API sub-accounts via
   `novada_proxy_account_create`. Fix: add `"10"` to `PRODUCT_CODES` and `"Browser API"` to
   `PRODUCT_LABELS`.

2. **`/v1/proxy_account/update` not implemented**. If users need to modify existing Browser
   API sub-accounts (change password, status, traffic cap), there is no tool for it.
