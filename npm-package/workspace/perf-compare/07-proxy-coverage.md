# 07 - Proxy Coverage Test

**Date:** 2026-06-25
**Test:** All 6 proxy types return valid credentials with just NOVADA_API_KEY
**Env:** NOVADA_API_KEY + NOVADA_PROXY_ENDPOINT set; no NOVADA_PROXY_USER/PASS (auto-fetch path)

## Results

| Tool | Status | Auto-Provision | Username Masked | Notes |
|------|--------|---------------|-----------------|-------|
| proxy_residential | PASS | Yes (API key) | Yes (`tong***`) | Only tool with `user.slice(0,4)+'***'` masking |
| proxy_isp | PASS | Yes (API key) | **NO** | Full username `tongwu_TRDI7X` in output |
| proxy_mobile | PASS | Yes (API key) | **NO** | Full username `tongwu_TRDI7X` in output |
| proxy_datacenter | PASS | Yes (API key) | **NO** | Full username `tongwu_TRDI7X` in output |
| proxy_static | NOT CONFIGURED | N/A (list-based) | N/A | Requires `NOVADA_STATIC_PROXY_LIST` env var |
| proxy_dedicated | NOT CONFIGURED | N/A (list-based) | N/A | Requires `NOVADA_DEDICATED_PROXY_LIST` env var |
| browser (auto) | PASS | Yes (product=10) | Yes (`***:***@`) | `resolveBrowserWs()` works |

**Configured:** 4/6 zone-based tools work with API key alone
**Browser WS:** Auto-provisioned via product=10 sub-account lookup

## Credential Flow

Zone-based tools (residential, isp, mobile, datacenter):
```
resolveProxyCredentials()
  -> getProxyCredentials() [checks NOVADA_PROXY_USER/PASS/ENDPOINT]
  -> if user/pass missing but endpoint+apikey present:
     fetchProxySubAccountCredentials(apiKey)
       -> POST /v1/proxy_account/list (product=1, status=1)
       -> returns { account, password } from first active sub-account
       -> cached 6h in memory
  -> returns { user: account, pass: password, endpoint }
```

List-based tools (static, dedicated):
```
reads NOVADA_STATIC_PROXY_LIST / NOVADA_DEDICATED_PROXY_LIST
  -> format: IP:PORT:USER:PASS per line
  -> no auto-provision — requires dashboard purchase
```

## Security Finding: Username Leakage (3 tools)

**Severity: MEDIUM** -- Username is not secret (password is masked), but exposes account identifier to LLM context.

`proxy_residential.js` masks the username:
```js
const maskedUser = user.slice(0, 4) + '***';
const maskedUsername = buildResidentialUsername(maskedUser, params);
// Output: tong***-zone-res:***@endpoint
```

`proxy_isp.js`, `proxy_mobile.js`, `proxy_datacenter.js` do NOT mask:
```js
const maskedUrl = `http://${encodedUser}:***@${endpoint}`;
// Output: tongwu_TRDI7X-zone-isp:***@endpoint  (full username exposed)
```

**Fix:** Apply the same `user.slice(0,4)+'***'` pattern from residential to all 3 zone-based tools.

## Architecture Notes

- Static and dedicated proxies are fundamentally different: per-IP credentials purchased via dashboard, not zone-routed through a shared endpoint. They cannot auto-provision from the management API.
- The `resolveProxyCredentials()` function always queries product=1 (residential) sub-accounts. All 4 zone-based tools share the same user/pass -- only the zone prefix in the username differs (zone-res, zone-isp, zone-mob, zone-dcp).
- Browser WS auto-provision queries product=10 via the same management API. Returns `wss://account:password@upg-scbr2.novada.com`.
- Credential cache is 6h in-memory (per-process). No persistence across restarts.
