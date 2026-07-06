# Fix B: Auto-Provision Proxy Credentials at MCP Startup

## Changes Made

### 1. `src/utils/credentials.ts`

**Removed:** `fetchProxyCredentials(apiKey, username)` — the old OAuth2 two-step flow that required `NOVADA_USERNAME` + a `/oauth2/token` exchange before calling `/proxy_account/list`.

**Added:** `fetchProxySubAccountCredentials(apiKey)` — calls `POST /v1/proxy_account/list` directly with `Authorization: Bearer <apiKey>`. No OAuth2 needed. Returns `{ account, password } | null`. Cached 6h in module-level variable `_credCache`.

**Updated:** `resolveProxyCredentials()` — signature changed from `Promise<{user,pass,endpoint}>` (throws) to `Promise<{user,pass,endpoint} | null>` (returns null on failure). No longer requires `NOVADA_USERNAME`.

New `resolveProxyCredentials()` priority:
1. All three `NOVADA_PROXY_USER` + `NOVADA_PROXY_PASS` + `NOVADA_PROXY_ENDPOINT` set → return directly, no API call
2. Only `NOVADA_PROXY_ENDPOINT` set (user/pass missing) + `NOVADA_API_KEY` available → auto-fetch first active sub-account from `/v1/proxy_account/list`
3. `NOVADA_PROXY_ENDPOINT` not set → return null (proxy tools disabled, not an error)

### 2. `src/index.ts`

Added import of `resolveProxyCredentials` from `./utils/credentials.js`.

Added startup auto-provision block inside `NovadaMCPServer.run()`, before `checkProxyConfiguration()`:

```ts
if (
  process.env.NOVADA_PROXY_ENDPOINT &&
  (!process.env.NOVADA_PROXY_USER || !process.env.NOVADA_PROXY_PASS)
) {
  try {
    const autoCreds = await resolveProxyCredentials();
    if (autoCreds) {
      process.env.NOVADA_PROXY_USER = autoCreds.user;
      process.env.NOVADA_PROXY_PASS = autoCreds.pass;
      // logs: "[novada] Auto-provisioned proxy credentials (account: tongwu_TRDI7X)"
    }
  } catch {
    // Non-fatal: proxy tools will show config error when invoked
  }
}
```

This populates `process.env.NOVADA_PROXY_USER/PASS` at startup so the synchronous `getProxyCredentials()` — called by all proxy tools — picks them up without any code changes to those tools.

## Before / After

**Before:** `getProxyCredentials()` returned null unless all three `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, `NOVADA_PROXY_ENDPOINT` were set. `resolveProxyCredentials()` threw if `NOVADA_USERNAME` was missing.

**After:**
- User sets only `NOVADA_API_KEY` + `NOVADA_PROXY_ENDPOINT`
- At startup, MCP fetches the first active residential sub-account via Bearer token
- Injects `NOVADA_PROXY_USER/PASS` into process.env
- All proxy tools work normally (zero callers changed)

## tsc Result

```
(no output — clean)
```

Exit code 0, no type errors.

## What User Now Needs

**Minimum config for proxy tools to work:**
```
NOVADA_API_KEY=<your_key>
NOVADA_PROXY_ENDPOINT=<host:port>
```

`NOVADA_PROXY_USER` and `NOVADA_PROXY_PASS` are **no longer required** — they are auto-provisioned from the first active residential sub-account.

**Backward compatible:** If `NOVADA_PROXY_USER/PASS/ENDPOINT` are all explicitly set, they are used as-is (no API call made).

## Files Changed

- `/Users/tongwu/Projects/novada-mcp/src/utils/credentials.ts`
- `/Users/tongwu/Projects/novada-mcp/src/index.ts`
