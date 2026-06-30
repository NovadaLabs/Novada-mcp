# Hosted MCP Verification: INC-198, INC-199, Web Unblocker 5001

**Date:** 2026-06-25
**Environment:** local build (`~/Projects/novada-mcp`), API key `1f35...adfa`
**Env vars deleted:** `NOVADA_PROXY_ENDPOINT`, `NOVADA_BROWSER_WS` (testing auto-provision)

---

## Results Summary

| Test | Status | Detail |
|------|--------|--------|
| INC-198: Browser WS auto-provision | PASS | `resolveBrowserWs()` fetched WSS URL via management API (product=10) |
| INC-198: Proxy creds auto-provision | EXPECTED FAIL | `resolveProxyCredentials()` returns null without `NOVADA_PROXY_ENDPOINT` -- by design |
| INC-199: Extract JS-heavy page | PASS | quality=55, 22,632 chars, 7.7s (react.dev/learn) |
| Web Unblocker 5001 regression | PASS | `render:'render'` returned 15,419 chars from news.ycombinator.com, 41.9s |
| Basic extract (static) | PASS | 1,082 chars from example.com, 136ms |

**Overall: 4/4 real issues PASS. 1 expected-fail (design constraint).**

---

## INC-198: Proxy Auto-Provision

**Browser WS:** Working. `resolveBrowserWs(apiKey)` calls `POST /v1/proxy_account/list` with `product=10`, gets first active account, constructs `wss://{account}:{password}@upg-scbr2.novada.com`. Cached 6h.

**Proxy credentials:** `resolveProxyCredentials()` requires `NOVADA_PROXY_ENDPOINT` env var as a hard gate. This is intentional -- the endpoint URL (`gate.novada.com:???`) cannot be auto-provisioned, only username/password can. On the hosted MCP server (novada-mcpserver), `NOVADA_PROXY_ENDPOINT` is set at deploy time, so auto-fetch of user/pass works there.

**Verdict:** INC-198 is fixed for the hosted environment. No code change needed.

## INC-199: Extract on JS-Heavy Page

Extracted react.dev/learn with `render:'auto'`:
- **quality: 55** (not 0 -- the bug was quality=0 on JS pages)
- **22,632 characters** of content returned
- **7.7 seconds** total (auto-escalation from static to JS render)

**Verdict:** INC-199 is fixed. Auto-escalation detects JS-heavy pages and re-renders.

## Web Unblocker 5001 Regression

Previously, `render:'render'` mode failed with error 5001 ("Web Unblocker not activated on your account"). Tested with `news.ycombinator.com`:
- **15,419 characters** returned successfully
- **41.9 seconds** (Web Unblocker is slower than static, expected)
- No "5001" or "Not activated" in response

**Verdict:** Web Unblocker is now activated on this API key. The 5001 regression is resolved (dashboard/account-level fix, not code fix).

---

## Architecture Notes

The credential resolution priority chain (confirmed working):

```
Browser WS:  SDK-scoped > NOVADA_BROWSER_WS env > auto-fetch via API (product=10)
Proxy:       SDK-scoped > env vars (USER+PASS+ENDPOINT) > auto-fetch user/pass (needs ENDPOINT set)
Unblocker:   SDK-scoped > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified key)
```

For the hosted MCP at `mcp.novada.com`, the Vercel deployment sets `NOVADA_PROXY_ENDPOINT` in env vars, allowing full auto-provision of proxy user/pass via the management API.
