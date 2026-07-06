# Browser API Auto-Provision Verification

**Date:** 2026-06-25
**Verdict: YES — NOVADA_API_KEY can auto-provision Browser WSS credentials**

---

## API Probe Results

| Endpoint | Result |
|---|---|
| POST /v1/residential_flow/balance | 200 OK — API key valid, confirmed working |
| POST /v1/browser/credentials | 404 not found — endpoint does not exist |
| POST /v1/browser_flow/balance | 404 not found — endpoint does not exist |
| POST /v1/proxy_account/list (product=10) | **200 OK — returns Browser API sub-account** |

---

## Key Finding: product=10 Works

`/v1/proxy_account/list` with `product=10` returned a Browser API account:

```json
{
  "code": 0,
  "data": {
    "list": [{
      "account": "novada529MUW_2Q8WuZ",
      "password": "Dz0vkMW4Wkil",
      "flow_type": "browser",
      "product": "10",
      "status": 1,
      "consumed_browser_flow": 156560947
    }]
  }
}
```

- Same `/v1/proxy_account/list` endpoint used for proxy auto-provisioning (product=1) works for Browser API with product=10
- Returns `account` + `password` — same field names as proxy accounts
- `flow_type: "browser"` confirms this is a Browser API credential, not a proxy credential

---

## WSS URL Construction

From codebase (`.env.example`, `config.ts`, `browser.ts`):

```
wss://username:password@upg-scbr.novada.com
```

So auto-provisioned WSS = `wss://${account}:${password}@upg-scbr.novada.com`

Note: `upg-scbr.novada.com` and `upg-scbr2.novada.com` are both referenced in the codebase. The dashboard-issued URL uses `upg-scbr.novada.com` (no suffix `2`). The example in `browser.ts` error messages uses `upg-scbr2.novada.com`. The `.env.example` uses `upg-scbr.novada.com` (without `2`) — use that as canonical until confirmed otherwise.

---

## Current State of credentials.ts

`getBrowserWs()` currently only reads:
1. SDK-scoped `store.getStore()?.browserWs`
2. `process.env.NOVADA_BROWSER_WS`

**No auto-provisioning exists for Browser API.** The function returns `undefined` if `NOVADA_BROWSER_WS` is not set, which disables `novada_browser` and `novada_browser_flow` entirely.

By contrast, proxy credentials already implement auto-provisioning via `fetchProxySubAccountCredentials()` + `resolveProxyCredentials()`.

---

## Implementation Plan

Add `fetchBrowserSubAccountCredentials(apiKey)` and `resolveBrowserWs()` to `credentials.ts`, mirroring the existing proxy pattern:

```typescript
// product=10 for Browser API (same endpoint as proxy, different product code)
async function fetchBrowserSubAccountCredentials(apiKey: string): Promise<{ account: string; password: string } | null>

// Priority:
// 1. SDK-scoped browserWs
// 2. NOVADA_BROWSER_WS env var
// 3. Auto-fetch via product=10 + construct wss://account:password@upg-scbr.novada.com
async function resolveBrowserWs(): Promise<string | undefined>
```

`getBrowserWs()` becomes `resolveBrowserWs()` (async) — callers in `browser.ts` and `health.ts` need to await it.

**Gate before implementation:** Confirm which hostname is correct — `upg-scbr.novada.com` vs `upg-scbr2.novada.com`. Ask dashboard or try connecting with a fetched credential.

---

## Risk Notes

- Browser API uses `consumed_browser_flow: 156560947` (~149 MB consumed) — account is active and billing real usage. Auto-provisioning means the first `novada_browser` call with only `NOVADA_API_KEY` set will incur Browser API charges. Must add clear documentation that Browser API is billed separately.
- Cache TTL for browser credentials can reuse the existing 6h `CACHE_TTL_MS` pattern.
- `getBrowserWs()` is currently synchronous — making it async is a breaking change for all callers. Alternatively, add a separate `resolveBrowserWs()` (async) and keep `getBrowserWs()` as the sync env-var-only read for hot paths.
