# Security Review — CC R1

Reviewed files:
- src/_core/errors.ts
- src/_core/auth.ts
- src/_core/types.ts
- src/config.ts
- src/tools/proxy_residential.ts
- src/tools/proxy_static.ts
- src/tools/proxy_mobile.ts (additional)
- src/tools/proxy_isp.ts (additional)
- src/tools/proxy_datacenter.ts (additional)
- src/tools/proxy_dedicated.ts (additional)
- src/tools/scraper_submit.ts
- src/tools/scraper_status.ts
- src/tools/scraper_result.ts (additional)
- src/tools/browser_flow.ts
- src/tools/browser.ts (additional)
- src/tools/scrape.ts (additional)
- src/tools/extract.ts (additional)
- src/tools/unblock.ts (additional)
- src/tools/types.ts (primary schemas, SSRF guard)
- src/tools/discover.ts
- src/tools/health_all.ts
- src/tools/index.ts
- src/utils/credentials.ts
- src/utils/http.ts
- src/utils/url.ts

---

## CRITICAL (must fix before publish)

None found.

---

## HIGH

### [HIGH-1] src/tools/scraper_status.ts:82-89 — API key sent in both Authorization header AND query param simultaneously

The `apiKey` is sent twice to the same endpoint: once as `Authorization: Bearer ${apiKey}` in the request headers and once as `params: { apikey: apiKey }` in the query string.

```typescript
// Lines 82-89 in scraper_status.ts
const resp = await axios.get(STATUS_ENDPOINT, {
  headers: {
    Authorization: `Bearer ${apiKey}`,     // ← key in header
  },
  params: {
    apikey: apiKey,                          // ← same key in query string
  },
  timeout: 30000,
});
```

Risk: The query-string copy of the API key will appear in server access logs, CDN logs, and any HTTP proxy or load balancer access logs between the MCP server and `api-m.novada.com`. Bearer token in header is the correct and sufficient auth mechanism. The query-string duplicate is pure leakage with no functional benefit.

Fix: Remove the `params: { apikey: apiKey }` block entirely. The `Authorization: Bearer` header is already present and is the canonical auth mechanism for this endpoint.

Same pattern also appears in `src/tools/scraper_result.ts:200-204` (the fallback GET to `api-m.novada.com`) — fix both.

---

### [HIGH-2] src/tools/scraper_status.ts:261 and src/tools/scraper_result.ts:261 — task_id leaked into error response in `endpoints_tried` array

In `scraper_result.ts:261`, the unavailable-result response includes:
```typescript
endpoints_tried: [RESULT_DOWNLOAD_ENDPOINT, `${STATUS_BASE}/${task_id}`],
```

While `task_id` is constrained to `[a-zA-Z0-9_\-\.]{1,128}` by Zod (so no injection risk), this constructs and surfaces the full internal URL shape of `api-m.novada.com/v1/scraper/{task_id}` to the agent caller. This leaks internal API routing topology. Low severity on its own, but combined with HIGH-1 it forms a pattern of unnecessary information disclosure.

Fix: Replace with a generic hint string — do not expose constructed internal endpoint URLs in user-facing error responses.

---

## MEDIUM

### [MEDIUM-1] src/config.ts:23-28 and multiple tool files — process.env reads outside _core/auth.ts violate architecture rule

Architecture rule: "All process.env reads must be in _core/auth.ts only."

Violations found:
- `src/config.ts:23-28`: `BROWSER_WS_ENDPOINT`, `PROXY_USER`, `PROXY_PASS`, `PROXY_ENDPOINT` read directly from `process.env` and exported as module-level constants.
- `src/index.ts:97`: `const API_KEY = process.env.NOVADA_API_KEY` read directly at module level.
- `src/index.ts:448,538,542,669`: `process.env.NOVADA_GROUPS` read directly in tool filtering logic.
- `src/utils/credentials.ts:30-43`: `process.env.NOVADA_WEB_UNBLOCKER_KEY`, `NOVADA_BROWSER_WS`, `NOVADA_PROXY_*` read as fallbacks. This is the AsyncLocalStorage layer and has documented intent, making it an acceptable architectural exception, but the `_core/auth.ts` functions already provide the same fallback behavior — the two are parallel implementations.
- `src/tools/proxy_residential.ts:59-61`, `proxy_static.ts:53-55`, `proxy_mobile.ts:60-62`, `proxy_isp.ts:54-56`, `proxy_datacenter.ts:54-56`, `proxy_dedicated.ts:49-51`: All six proxy tools read `NOVADA_PROXY_*` directly to build a "missing vars" error string, despite `getProxyCredentials()` from `utils/credentials.ts` already being called on line 55 of each file.

Risk: Not a direct security vulnerability, but violates the intended single-responsibility of `_core/auth.ts` as the sole credential-access point. Future refactors that add key rotation, secret masking, or audit logging to `_core/auth.ts` will miss these bypass paths.

Fix: The proxy tool files should derive the "missing" variable names from the `null` return of `getProxyCredentials()` without re-reading `process.env`. A helper like `getMissingProxyVarNames()` in `_core/auth.ts` would centralize this. `config.ts` constants `BROWSER_WS_ENDPOINT`, `PROXY_USER/PASS/ENDPOINT` are module-load-time snapshots — either remove them (they are not used by tool layer code after credentials.ts was added) or deprecate them.

---

### [MEDIUM-2] src/tools/browser_flow.ts:14 — `selector` parameter has no regex constraint

The `BrowserFlowActionSchema` `selector` field (line 14) is `z.string().optional()` with no constraint:

```typescript
selector: z
  .string()
  .optional()
  .describe("CSS selector for click/type actions...")
```

This `selector` flows into the API payload at lines 113-116:
```typescript
...(a.selector !== undefined && { selector: a.selector }),
```

Risk: In contrast, `src/tools/types.ts` `BrowserActionSchema` for `novada_browser` applies `z.string().min(1)` to selectors. `browser_flow.ts` does not. A prompt-injected agent could pass a selector containing arbitrary characters (e.g., `; injected_key=value`) into the JSON POST body to `api-m.novada.com`. The impact depends on how the backend processes the selector — if it naively includes it in a log key or error message, injection could occur. At minimum it violates the project's stated rule: "Any z.string() param that flows into... API payloads MUST have either a .regex() constraint."

Fix: Add `.regex(/^[a-zA-Z0-9#\.\[\]:\-_>+~\s*=^$|"'(),]{1,500}$/)` or at least `.max(500).regex(/^[^\x00-\x1F\x7F]+$/)` to block control characters.

---

### [MEDIUM-3] src/_core/errors.ts:150-156 — sanitizeMessage() does not strip the apikey query param pattern used in actual requests

`sanitizeMessage()` strips `apikey=VALUE` (line 153), but the actual download URL constructed in `scrape.ts:81` and `scraper_result.ts:132` uses `&apikey=` as part of a full URL like:
```
https://api.novada.com/g/api/proxy/scraper_download?task_id=XYZ&file_type=json&apikey=ACTUAL_KEY
```

The sanitizer regex `apikey=[^&\s"')]+` would successfully strip this specific pattern. However the URL pattern regex on line 155 only strips URLs matching `https?:\/\/scraperapi\.novada\.com` — it does NOT strip `api.novada.com` or `api-m.novada.com` URLs that could also carry the `apikey=` param.

Risk: If an error is thrown after the URL is constructed (e.g., network timeout in `pollForResult`), the full URL — including the API key — could appear in `err.message`, which then reaches `sanitizeMessage()` in the `UNKNOWN` fallback handler. The `apikey=` pattern IS caught by line 153, so key extraction is prevented. But the host URL remains unsanitized. This is borderline medium — the key itself is masked but the surrounding URL could still expose internal API structure.

Fix: Extend the sanitizer regex to also blank `https?:\/\/(api|api-m)\.novada\.com[^\s"')]*` in addition to the existing `scraperapi.novada.com` pattern.

---

### [MEDIUM-4] src/tools/scrape.ts:63 and 191 — raw `throw new Error()` in tool layer

Eight `throw new Error()` calls in `scrape.ts` (lines 63, 73, 114, 117, 120, 122, 124, 127, 189, 191, 202, 215) bypass `makeNovadaError`. These errors propagate to `index.ts` catch block which calls `classifyError()`, so they do eventually get sanitized — but only if the error message does not already contain sensitive data.

Specific risk: Line 191: `throw new Error(\`Scraper API error (HTTP ${status}): ${JSON.stringify(body)}\`)` — the `body` here is `error.response?.data`, which is raw API response body. If the Novada API ever includes auth-related fields (e.g., a user ID, account details) in error response bodies, they would be passed unsanitized to the generic `classifyError()` UNKNOWN handler, which does call `sanitizeMessage()`, but only strips the known patterns.

Fix: Convert tool-layer throws to `makeNovadaError(NovadaErrorCode.API_DOWN, sanitizedMsg)`. At minimum, do not `JSON.stringify(body)` directly into error text — extract `body?.msg` only.

---

## LOW

### [LOW-1] src/index.ts:97 — API_KEY read at module load, not at request time

```typescript
const API_KEY = process.env.NOVADA_API_KEY; // line 97
```

This is a module-level constant, evaluated once when the process starts. The value is used in every tool dispatch. If the environment variable is rotated (e.g., by a secret manager restarting the process or injecting a new value), the in-memory `API_KEY` is stale. The MCP server would need a restart to pick up the new key.

This is the same pattern used by many MCP servers and is acceptable for the stdio transport model where the process is typically short-lived. Flagging as low because the architecture comment in `_core/auth.ts:12-13` explicitly acknowledges this as correct for MCP single-tenant use.

No code change required — document the restart requirement in README.

---

### [LOW-2] src/_core/errors.ts:150-156 — sanitizeMessage() does not sanitize `Bearer TOKEN` patterns in multi-line error strings

`sanitizeMessage` strips `Authorization: Bearer TOKEN` (line 154), but only as a single inline string. If a stack trace or multi-line error message contains `Authorization:\nBearer TOKEN` (line-broken by a proxy or HTTP library formatter), the pattern would not match.

Fix: Change the regex to allow optional whitespace and newline: `/Authorization:\s*\r?\n?\s*Bearer\s+\S+/gi`.

---

### [LOW-3] src/tools/discover.ts:282 — category filter value echoed unsanitized into output

```typescript
return `No tools found for category: ${category}`;
```

`category` comes from a Zod `.enum()` which strictly validates it to one of 6 known values — so there is no practical injection risk. The Zod validation would throw before any arbitrary string reaches this line. Noting for completeness: the pattern is safe as long as Zod runs before this code is reached, which it does.

No fix required.

---

## PASS (confirmed safe)

- **SSRF guard**: `src/tools/types.ts:6-31` — `safeUrl` Zod refine blocks `localhost`, all RFC-1918 ranges (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`), `0.0.0.0`, IPv6 loopback (`::1`), and IPv6 link-local (`fe80:`). Applied to all user-supplied URL fields in `ExtractParamsSchema`, `CrawlParamsSchema`, `MapParamsSchema`, `UnblockParamsSchema`, and browser `navigate` action. `scraper_submit.ts` and `browser_flow.ts` use their own `.url()` + `https?://` refine but do NOT apply the private-IP block — however these URLs are passed to Novada's backend API, not fetched server-side by the MCP process, so SSRF risk is against Novada's infrastructure, not the host running the MCP server. Still, adding `safeUrl` to these schemas would be consistent defense-in-depth.

- **API key not in error messages**: `_core/errors.ts` `classifyError()` constructs all error messages with hardcoded strings (not the raw key). The `INVALID_API_KEY` error message on line 190 says "Invalid or missing API key" — does not echo the key value. PASS.

- **auth.ts credential isolation**: `getApiKey()`, `getProxyCredentials()`, `getBrowserWsUrl()`, `getWebUnblockerKey()`, `getAuthCredentials()` all read from `process.env` without logging or exposing the values. `buildProxyUrl()` uses `encodeURIComponent()` on both user and pass. PASS.

- **task_id regex constraint**: `scraper_status.ts:10-17` and `scraper_result.ts:12-18` both apply `.regex(/^[a-zA-Z0-9_\-\.]{1,128}$/)`. The constrained value is then passed to `encodeURIComponent()` before being placed in URLs. PASS.

- **session_id regex constraint**: `browser_flow.ts:51`, `proxy_residential.ts:19-22`, `proxy_static.ts:13-17`, `types.ts BrowserParamsSchema:381`, `types.ts ProxyParamsSchema:236` all apply `.regex(/^[a-zA-Z0-9_\-]+$/)`. PASS.

- **country regex constraint**: All proxy tools, scraper_submit, and browser_flow apply `.regex(/^[a-zA-Z]{2}$/)` or `{0,2}` variant on the `country` field. PASS.

- **scraper_type regex**: `scraper_submit.ts:16` applies `.regex(/^[a-zA-Z0-9_\-\.]{1,64}$/)`. PASS.

- **Reserved key injection in scrape.ts**: `scrape.ts:38-43` blocks `scraper_name`, `scraper_id`, `apikey`, `api_key`, `authorization` from being shadowed by user-supplied `opParams`. PASS.

- **evaluate script sandboxing in browser.ts**: `types.ts:329-343` — ASCII-only enforcement, blocks `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `eval`, `new Function`, and bracket-property access on global objects. Well-thought-out defense against prompt injection via evaluate. PASS.

- **No hardcoded credentials**: No API keys, passwords, or tokens found in source code. PASS.

- **sanitizeMessage applied to UNKNOWN fallback**: `_core/errors.ts:284-289` applies `sanitizeMessage(rawMsg)` before surfacing unknown errors. PASS.

- **ProxyCredentials not in error text**: Proxy tools return `makeNovadaError(...).toAgentString()` with only variable names ("Missing: NOVADA_PROXY_USER") — not the values. PASS.

- **encodeURIComponent on proxy credentials**: `proxy_residential.ts:73-75` and `proxy_static.ts:68-70` both call `encodeURIComponent(username)` and `encodeURIComponent(pass)` before constructing the proxy URL string. PASS.

- **No SQL or command injection surfaces**: No database queries, no shell exec calls, no `path.join()` with user input found. PASS.

- **No raw console.log of credentials**: `console.error` calls in `index.ts` log only error objects and version/group info — never credential values. PASS.
