# Stress Test 05: API Key Edge Cases

**Date:** 2026-06-26
**Scope:** Invalid, empty, undefined, null, numeric, space-padded API keys across `novadaExtract`, `novadaSearch`, `novadaSetup`

## Results Matrix

| # | Test Case | Tool | Verdict | Behavior | Error Code |
|---|-----------|------|---------|----------|------------|
| 1 | Empty string `''` | extract | WARN | Returns static content (quality:1/100) | n/a |
| 2 | Wrong key `'invalid_key_12345'` | extract | WARN | Returns cached content from test 1 | n/a |
| 3 | Key with spaces `' key '` | extract | WARN | Returns cached content | n/a |
| 4 | `undefined` | extract | WARN | Returns cached content | n/a |
| 5 | `null` | extract | WARN | Returns cached content | n/a |
| 6 | Numeric `12345` | extract | WARN | Returns cached content | n/a |
| 7 | Empty string `''` | search | **BUG** | Throws plain Error, not NovadaError | none |
| 8 | Wrong key `'invalid_key_12345'` | search | PASS | Throws NovadaError with agent_instruction | INVALID_API_KEY |
| 9 | No key (env empty) | setup | PASS | Shows diagnostic with `(not set)` markers | n/a |
| 10 | Valid key (env set) | setup | PASS | Shows masked key, correct status | n/a |

**Score: 3/10 passed, 1 bug, 6 architectural warnings**

## Bug Found

### BUG-1: Search code 10001 not classified as INVALID_API_KEY

**File:** `build/tools/search.js` (source: `src/tools/search.ts`)
**Line:** 146

When `NOVADA_API_KEY` is empty, the Scraper API returns HTTP 200 with `body.code = 10001` and `msg = "invalid authorization header"`. This falls through the explicit auth checks (which only handle codes 50001/50002/50003) and throws a plain `Error`:

```typescript
throw new Error(`Scraper search submit error (code ${body.code}): ${sanitizeServerMsg(body.msg ?? "unknown")}`);
```

The outer catch block (line 362) tries to match `/unauthorized|forbidden/i` but the actual message contains `"authorization"` not `"unauthorized"`, so it also misses.

The error propagates as a raw Error without:
- `code` property
- `agent_instruction`
- `toAgentString()` method

**Fix:** Add `10001` to the explicit auth check block at line 139:

```typescript
if (body.code === 50001 || body.code === 50002 || body.code === 50003 || body.code === 10001) {
    throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, `Scraper API auth error (code: ${body.code})`);
}
```

**Secondary fix in `classifyError` (`_core/errors.ts`):** Add `"authorization"` to the auth failure pattern at line 210:

```typescript
if (msg.includes("401") || msg.includes("api_key") || msg.includes("unauthorized") || msg.includes("invalid_api_key") || msg.includes("authorization")) {
```

## Architectural Observations

### Extract silently degrades without API key (by design, but risky)

`novadaExtract` does not validate the API key upfront. Its architecture:

1. `render="auto"` -> tries static fetch first (no API key needed)
2. `render="render"` -> calls `getWebUnblockerKey()` -> returns `undefined` when key is empty -> falls back to static fetch silently
3. Static fetch uses `fetchWithRetry()` which does a direct HTTP GET with no proxy/auth

For `https://example.com`, static fetch succeeds regardless of API key. The tool returns `quality:1/100 (low)` content but never errors.

**Impact:** An agent with no API key configured will get degraded results from extract without any indication that their key is missing. On simple sites (example.com, static blogs), it works. On JS-heavy or bot-protected sites, it silently returns empty/low-quality content with no auth error.

**Recommendation:** Consider a warning in the output header when `NOVADA_API_KEY` is not set, e.g.:
```
warning: NOVADA_API_KEY not set — render/proxy escalation disabled. Run novada_setup for instructions.
```

### Session cache masks key-change testing

Tests 2-6 for extract returned cached results from test 1 (0ms response, `source: cache`). The session cache (`getCached()`) keys on `url + renderMode + format + fields`, not on the API key. This means:

- Switching API keys mid-session has no effect on cached URLs
- An agent that corrects its key after a failed attempt still gets the old cached result

This is probably acceptable (cache TTL is short and extract is idempotent), but worth noting.

### Setup handles no-key case correctly

`novadaSetup` is the only tool that's explicitly designed to work without an API key. It reads `process.env.NOVADA_API_KEY` directly, shows clear `(not set)` markers, and provides setup instructions. No bugs here.

## Severity Assessment

| Issue | Severity | Impact |
|-------|----------|--------|
| BUG-1: code 10001 not classified | HIGH | Agent gets unhelpful raw error with no recovery guidance on empty API key |
| Extract no-key silent degradation | MEDIUM | Agent gets bad results without knowing why; no actionable error |
| classifyError misses "authorization" | LOW | Defense-in-depth gap; BUG-1 fix makes this less critical |
| Cache ignores API key changes | LOW | Edge case; cache TTL is short |
