# Test Agent C — Unified Billing Investigation
**Date:** 2026-06-23
**Claim tested:** "Novada already made a unified API key" — does NOVADA_API_KEY give zero-config proxy access?

---

## Evidence Summary

### What NOVADA_API_KEY gives you (confirmed by live API calls)

| Product | Status | How |
|---------|--------|-----|
| Web Unblocker / Extract | Active | `getWebUnblockerKey()` falls back to `NOVADA_API_KEY` — already unified |
| Wallet (EUR) | €174.10 | `api-m.novada.com/v1/wallet/balance` with Bearer key |
| Residential proxy quota | 9,999,984,016 bytes (~9.3 GB), expires 2026-07-08 | `api-m.novada.com/v1/residential_flow/balance` with Bearer key |
| Proxy sub-account list | `tongwu_TRDI7X` / `_Asd1644asd_` visible | `api-m.novada.com/v1/proxy_account/list` with Bearer key |
| Search API | Not activated (code=50001) | — |
| Scraper API (129 platforms) | Not activated (code=50001) | — |
| Browser API | Not configured (needs NOVADA_BROWSER_WS) | — |

### What "unified" already covers in the MCP code
`src/utils/credentials.ts` shows:
- `getWebUnblockerKey()` → `NOVADA_WEB_UNBLOCKER_KEY ?? NOVADA_API_KEY` — already unified, no extra config needed
- `fetchProxyCredentials()` — auto-fetches sub-account `account` + `password` from `/v1/proxy_account/list` using `NOVADA_API_KEY` (already implemented, 6h cache)
- `resolveProxyCredentials()` — tries `NOVADA_PROXY_*` env vars first, then auto-fetch path

---

## The Gap: NOVADA_PROXY_ENDPOINT Cannot Be Auto-Derived

**This is the only blocker for true zero-config proxy.**

The proxy gateway hostname (`1b9b0a2b9011e022.vtv.na.novada.pro:7777`) is:
- Account-specific (unique per customer)
- Not exposed via any API endpoint (tested `/v1/proxy/endpoint_list`, `/v1/residential_flow/endpoint` — both 404)
- Currently only available from the dashboard UI at: `dashboard.novada.com/overview/res/ → Endpoint Generator`

Even with `NOVADA_API_KEY` + auto-fetched sub-account credentials, the MCP still demands `NOVADA_PROXY_ENDPOINT`.

Confirmed by `resolveProxyCredentials()` final block:
```
if (!endpoint) {
  throw new Error(`Auto-fetched proxy credentials (account: ${fetched.account}) but NOVADA_PROXY_ENDPOINT is not set.`)
}
```

---

## Current Setup Requirements vs True Unified Key

| Scenario | Env vars needed today | Env vars with true unified key |
|----------|----------------------|-------------------------------|
| Extract/Unblock | `NOVADA_API_KEY` only | same — already works |
| Proxy (residential, ISP, datacenter) | `NOVADA_API_KEY` + `NOVADA_PROXY_USER` + `NOVADA_PROXY_PASS` + `NOVADA_PROXY_ENDPOINT` | `NOVADA_API_KEY` only |
| Browser | `NOVADA_API_KEY` + `NOVADA_BROWSER_WS` | would need platform work |

---

## Option C Assessment: Already Works / Needs Platform Work?

**Partial — the credential auto-fetch exists in code but the endpoint is still manual.**

The MCP already has the auto-fetch plumbing (`fetchProxyCredentials`, `resolveProxyCredentials`). What's missing:

1. **Platform API endpoint** to return the proxy gateway host+port for an account (needs Novada backend work)
2. OR: **Hardcode a shared gateway** if Novada uses a fixed endpoint for all accounts (`gw.novada.pro:7777` style) — would eliminate `NOVADA_PROXY_ENDPOINT` entirely

If Novada exposes a `/v1/residential_flow/gateway` endpoint returning `host:port`, the MCP can auto-derive everything from `NOVADA_API_KEY` alone with no code changes beyond removing the endpoint check.

---

## Recommendation

**Option C is 80% there in the MCP, but needs a product/platform decision:**

- If the proxy gateway URL is the same for all accounts → hardcode it in `credentials.ts`, drop `NOVADA_PROXY_ENDPOINT` requirement entirely. Agents can use proxy with zero config.
- If gateway is account-specific → Novada backend needs to expose a `/v1/account/proxy_endpoint` API. Then MCP auto-fetches it alongside sub-account credentials.
- Either path makes `NOVADA_API_KEY` truly sufficient for proxy.

Until one of these is resolved, users still need to manually set `NOVADA_PROXY_ENDPOINT`.

**For the roundtable: the user's claim is directionally correct — the key IS unified for billing/auth, but the proxy gateway URL lookup is the last mile that needs platform support.**
