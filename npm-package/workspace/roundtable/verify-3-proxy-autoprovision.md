# Verify-3: Proxy Auto-Provisioning Pipeline

**Date:** 2026-06-23
**Tester:** Claude Agent (Sonnet 4.6)
**Scope:** Can an AI agent use Novada proxy with ONLY `NOVADA_API_KEY` + `NOVADA_PROXY_ENDPOINT`?

---

## Result: YES — Full pipeline works from API key alone

Both stages passed without any manual credential setup.

---

## Stage 1: Auto-provision proxy credentials

**Env:** `NOVADA_API_KEY` + `NOVADA_PROXY_ENDPOINT` only (no USER/PASS)

**Result:**
```
AUTO-PROVISIONED: tongwu_TRDI7X / pass: _Asd*** / endpoint: 1b9b0a2b9011e022.vtv.na.novada.pro:7777
```

**How it works (`resolveProxyCredentials` in `src/utils/credentials.ts`):**

Priority chain:
1. If `NOVADA_PROXY_USER` + `NOVADA_PROXY_PASS` + `NOVADA_PROXY_ENDPOINT` are all set → use directly, no API call.
2. Else if `NOVADA_PROXY_ENDPOINT` is set but USER/PASS are missing → call `fetchProxySubAccountCredentials(apiKey)`.
3. `fetchProxySubAccountCredentials` calls `POST https://api-m.novada.com/v1/proxy_account/list` with Bearer token auth, requests product=1 (residential), status=1 (active), limit=5. Returns the first account's `account` + `password`. Result is cached 6h in-process.
4. If PROXY_ENDPOINT is not set → returns null (proxy tools disabled).

---

## Stage 2: Use provisioned credentials to scrape

**Target:** `https://www.walmart.com/` via `novadaExtract` with `render:auto`

**Result:**
```
Credentials resolved: tongwu_TRDI7X / 1b9b0a2b9011e022.vtv.na.novada.pro:7777
EXTRACT RESULT:
## Extracted Content
url: https://www.walmart.com/
mode: render | source: live | quality:70/100 (good) | content_ok:true
fetched_at: 2026-06-23T12:57:29.534Z
title: Walmart | Save Money. Live better.
description: Shop Walmart.
```

Live content extracted successfully. quality:70/100, content_ok:true.

---

## Answer

**Yes.** `NOVADA_API_KEY` + `NOVADA_PROXY_ENDPOINT` is sufficient. The pipeline:

1. `resolveProxyCredentials()` detects missing USER/PASS and calls the management API with the Bearer token.
2. Fetches the first active residential sub-account (`product=1`).
3. Injects those credentials into `process.env` for downstream proxy tool calls.
4. `novadaExtract` successfully routes through the proxy and returns live page content.

**No website visit required.** The entire flow is purely API/MCP — management API call + extract API call.

---

## Edge Cases / Caveats

| Case | Behavior |
|------|----------|
| No sub-accounts exist for product=1 | `fetchProxySubAccountCredentials` returns null; proxy tools disabled |
| API key invalid / expired | `fetch` returns non-OK response; returns null |
| `NOVADA_PROXY_ENDPOINT` not set | `resolveProxyCredentials` returns null immediately; proxy disabled |
| Cache | 6h in-process memory cache — dies with process restart |
| Product type | Only fetches residential (product=1) sub-accounts; no fallback to other types |
