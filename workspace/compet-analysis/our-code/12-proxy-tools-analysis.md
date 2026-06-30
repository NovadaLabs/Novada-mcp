# Proxy Tools Architecture Analysis

**Date:** 2026-06-23
**Scope:** novada-mcp proxy subsystem — 9 files

---

## File Map

| File | Role |
|------|------|
| `src/utils/credentials.ts` | Credential resolution + auto-provision cache |
| `src/tools/proxy.ts` | Legacy generic proxy tool (`novada_proxy`) |
| `src/tools/proxy_residential.ts` | `novada_proxy_residential` |
| `src/tools/proxy_isp.ts` | `novada_proxy_isp` |
| `src/tools/proxy_datacenter.ts` | `novada_proxy_datacenter` |
| `src/tools/proxy_mobile.ts` | `novada_proxy_mobile` |
| `src/tools/proxy_static.ts` | `novada_proxy_static` |
| `src/tools/proxy_dedicated.ts` | `novada_proxy_dedicated` |
| `src/tools/proxy_account_create.ts` | `novada_proxy_account_create` |
| `src/tools/proxy_account_list.ts` | `novada_proxy_account_list` |

---

## 1. Auto-Provision Flow (`fetchProxySubAccountCredentials`)

The flow has two layers:

**Layer 1 — `resolveProxyCredentials()` in `credentials.ts`:**
```
if NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT are all set → return directly (no API call)
elif NOVADA_PROXY_ENDPOINT is set but user/pass missing:
    if NOVADA_API_KEY is set → call POST /v1/proxy_account/list (product=1, limit=5, status=1)
        → pick first active residential sub-account
        → cache result 6h
        → return {user: account, pass: password, endpoint}
    else → return null
else (no endpoint) → return null (proxy disabled)
```

**Layer 2 — Server startup injection (`src/index.ts` lines 898–916):**

At `run()` time (before any tool call), if `NOVADA_PROXY_ENDPOINT` is set and user/pass are missing, the server calls `resolveProxyCredentials()` and **injects the result back into `process.env`**. This converts auto-provisioned credentials into effectively-static env vars for the process lifetime. All proxy tools then use the synchronous `getProxyCredentials()` which reads `process.env` directly.

**Key consequence:** Auto-provision happens once at startup, not per-tool-call. The 6h cache in `_credCache` is a belt-and-suspenders guard but is only ever hit again if the server somehow bypasses the startup injection.

---

## 2. Cache Implementation — Correctness and Thread Safety

```typescript
// credentials.ts lines 73–113
let _credCache: FetchedProxyCreds | null = null;  // module-level mutable singleton

if (_credCache && Date.now() - _credCache.fetchedAt < CACHE_TTL_MS) {
  return { account: _credCache.account, password: _credCache.password };
}
```

**Is it correct?** Yes for single-process MCP server. The 6h TTL matches typical proxy session expectations.

**Is it thread-safe?** No, but it doesn't matter in practice:

- Node.js is single-threaded; there is no true data race on `_credCache`.
- However, there is a **check-then-act race** on the async path: two concurrent `await fetchProxySubAccountCredentials()` calls (if triggered simultaneously before startup injection completes) would both see `_credCache === null`, make two API calls, and the second write wins. This is benign (same credentials), but results in a wasted API call.
- The cache is **never invalidated** (no TTL reset on startup injection, no explicit clear). If credentials rotate within 6h, the cached stale creds are returned. The startup injection path (writing to `process.env`) bypasses the cache entirely, so the cache only matters for subsequent calls within the same process — and the startup injection makes that practically impossible for normal operation.

**Verdict:** Functionally correct for single-instance MCP server. Not production-safe for multi-instance or long-running SDK usage with credential rotation.

---

## 3. Error Handling When Auto-Provision Fails

**At startup (index.ts lines 905–915):**
```typescript
try {
  const autoCreds = await resolveProxyCredentials();
  if (autoCreds) { /* inject into process.env */ }
} catch {
  // Non-fatal: proxy tools will show a configuration error when invoked
}
```
Failure is silently swallowed. No log entry for failed auto-provision (only success logs `[novada] Auto-provisioned proxy credentials (account: ...)`).

**At tool-call time (all 5 zone-based tools):**
All 5 zone tools (`residential`, `isp`, `datacenter`, `mobile`, plus legacy `proxy.ts`) check `getProxyCredentials()` and, if null, return a structured `NovadaError` with `PROXY_AUTH_FAILURE` code and an `agent_instruction` pointing to the dashboard. This is correct and user-friendly.

**Gap:** `proxy_static.ts` and `proxy_dedicated.ts` do NOT use `getProxyCredentials()` at all — they read from `NOVADA_STATIC_PROXY_LIST` / `NOVADA_DEDICATED_PROXY_LIST` respectively. Their error path returns a plain JSON `{status: "configuration_required"}` instead of a `NovadaError` — inconsistent with the other 5 tools.

---

## 4. Consistency Across 7 Proxy Tools

| Tool | Credential Source | Error Format | Country | City | Session | Carrier |
|------|------------------|--------------|---------|------|---------|---------|
| `novada_proxy` (legacy) | `getProxyCredentials()` | Plain markdown | Yes | Yes | Yes | No |
| `novada_proxy_residential` | `getProxyCredentials()` | `NovadaError` | Yes | Yes | Yes | No |
| `novada_proxy_isp` | `getProxyCredentials()` | `NovadaError` | Yes (ignored) | No | Yes | No |
| `novada_proxy_datacenter` | `getProxyCredentials()` | `NovadaError` | Yes | No | Yes | No |
| `novada_proxy_mobile` | `getProxyCredentials()` | `NovadaError` | Yes | No | Yes | Yes |
| `novada_proxy_static` | `NOVADA_STATIC_PROXY_LIST` | Plain JSON | Required | No | Required | No |
| `novada_proxy_dedicated` | `NOVADA_DEDICATED_PROXY_LIST` | Plain JSON | No | No | Required | No |

**Inconsistencies found:**

1. **Error format split**: `static` and `dedicated` return `JSON.stringify({status: "configuration_required", ...})` while the other 5 return `NovadaError.toAgentString()`. Agents parsing responses will see two different structures.

2. **ISP country param is accepted but silently ignored**: The schema accepts `country` for ISP but the `buildIspUsername()` function does not include it. The output message warns the user inline, but the Zod schema does not reject it. An agent could pass `country` to `novada_proxy_isp` expecting it to work.

3. **Legacy `novada_proxy` uses plain markdown error** (not `NovadaError`) for the unconfigured case. It is labeled "legacy" in `--help` output (`novada_proxy — Get residential proxy credentials (legacy)`) but is still registered and active in the tool list.

4. **Zone strings differ between `proxy.ts` and the specialized tools**:
   - `proxy.ts` uses `ZONE_MAP` which includes `zone-static` and `zone-dedicated`
   - `proxy_static.ts` and `proxy_dedicated.ts` use per-IP credentials (not zone-based at all)
   - If someone calls `novada_proxy` with `type: "static"`, they get zone-format output, not the per-IP format that `novada_proxy_static` would return. The behavior is inconsistent.

5. **`encodedPass` computed but never used** in `proxy_residential.ts`, `proxy_isp.ts`, `proxy_datacenter.ts`, `proxy_mobile.ts`: all four files have `const encodedPass = encodeURIComponent(pass)` at the top but only use `maskedUrl` (with `***`) in output. Dead variable in all four files.

---

## 5. What Each Proxy Tool Actually Returns

All tools return a **plain text string** (markdown-formatted configuration), not structured JSON.

**Zone-based tools (residential/isp/datacenter/mobile + legacy proxy)** return in 3 formats:

- `url` (default): markdown block with `proxy_url: http://user-zone-res-region-us:***@endpoint:port`, Node.js axios snippet, Python requests snippet, `agent_instruction`
- `env`: 4x `export HTTP_PROXY/HTTPS_PROXY/http_proxy/https_proxy` lines with `${NOVADA_PROXY_PASS}` shell variable substitution (password NOT embedded)
- `curl`: `curl --proxy "..."` with `***` placeholder for password

The **actual plaintext password is never included** in any zone-based tool output. The encoded username (with zone/region/session) is exposed in the proxy URL.

**Static/dedicated tools** return differently:
- When `NOVADA_STATIC_PROXY_LIST` / `NOVADA_DEDICATED_PROXY_LIST` is set, the `curl` and `env` formats embed the **plaintext password** directly: `curl -x IP:PORT -U "USER:PASS" ...` and `export HTTP_PROXY="http://USER:PASS@IP:PORT"`. The `url` format only shows `***` in the masked cmd.
- This is a **security divergence**: static/dedicated tools CAN expose plaintext credentials in their output; zone-based tools never do.

---

## 6. Security Concerns

### Credential Exposure in Responses

| Scenario | Exposure Level |
|----------|---------------|
| Zone-based tools, any format | Username only (zone-encoded, not sensitive). Password masked as `***` or `${NOVADA_PROXY_PASS}` |
| `proxy_static` / `proxy_dedicated`, `curl` format | **PLAINTEXT PASSWORD IN RESPONSE** (from `NOVADA_STATIC_PROXY_LIST` / `NOVADA_DEDICATED_PROXY_LIST`) |
| `proxy_static` / `proxy_dedicated`, `env` format | **PLAINTEXT PASSWORD IN RESPONSE** (embedded in `export HTTP_PROXY=...` line) |
| `proxy_static` / `proxy_dedicated`, `url` format | Password masked in `maskedCmd`, but response is JSON with `command` field using `***` |

The plaintext exposure in static/dedicated `curl` and `env` formats is a concrete issue: MCP tool responses are logged by many MCP clients and go through the LLM context. Any MCP conversation log becomes a credential leak vector.

### Auto-Provision Account Name Logged to stderr

```typescript
console.error(`[novada] Auto-provisioned proxy credentials (account: ${autoCreds.user})`);
```
The sub-account name is logged to stderr. In most deployments this is benign (stderr goes to MCP host process logs), but it is a data point that appears in MCP server output.

### Process.env Mutation

The startup auto-provision pattern mutates `process.env.NOVADA_PROXY_USER` and `process.env.NOVADA_PROXY_PASS` at runtime. In a multi-tenant SDK scenario (using `withCredentials()`), this global mutation bypasses the `AsyncLocalStorage` isolation intended for SDK use. The credentials module was explicitly designed to avoid process.env mutation for SDK clients, and the startup code undoes that design for proxy credentials.

### NOVADA_PROXY_ENDPOINT Validation

The endpoint is accepted as a plain string (`host:port`) with no URL validation. `proxy_residential.ts` line 76–78:
```typescript
const endpointParts = endpoint.split(":");
const proxyHost = endpointParts[0];
const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;
```
No validation that `proxyPort` is a valid port number (1–65535), no check that `proxyHost` is a valid hostname. `parseInt("abc")` returns `NaN`, which would produce `proxy: { port: NaN }` in the Node.js usage example. The output would be silently incorrect.

---

## 7. NOVADA_PROXY_ENDPOINT: Usage and Validation

**Used for:**
- Zone-based tools: `endpoint.split(":")` → host + port for output string construction
- Auto-provision gating: presence of `NOVADA_PROXY_ENDPOINT` triggers auto-provision at startup
- Proxy URL construction: `http://user:***@endpoint` in all formatted outputs

**Not validated for:**
- Valid hostname format
- Valid port range
- URL encoding of special characters in hostname
- Reachability (no health check)

The `novada_proxy` tool description says "Requires: NOVADA_PROXY_ENDPOINT env var" — this is the only hard requirement for proxy tools to function. The static and dedicated tools have no such requirement (they use separate list env vars).

---

## 8. Credentials in Error Messages

**Zone-based tools**: Error messages reference missing env var *names* only (`NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, `NOVADA_PROXY_ENDPOINT`) — no values are exposed in errors. Safe.

**Static/dedicated tools**: When `NOVADA_STATIC_PROXY_LIST` has invalid entries, the error message includes the expected format string `IP:PORT:USER:PASS (one per line). Example: 151.242.47.74:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR` — the example uses hardcoded-looking but fictional credentials. Not a real leak, but reinforces a pattern of including credential-format strings in error outputs.

---

## 9. Missing Features vs BrightData Enterprise

### Sub-account Quota Management
**Status: Absent.**
`proxy_account_create` supports `limit_flow` (GB cap) but there is no tool to:
- Check remaining quota per sub-account
- Alert when approaching quota
- Modify quota on an existing sub-account
- Reset or extend quota

BrightData provides per-zone, per-account bandwidth dashboards and programmatic quota APIs.

### Per-Session Sticky IP Management
**Status: Partial.**
`session_id` is passed through to the username string, which is how zone-based sticky IPs work. However:
- No tool to list active sessions
- No tool to rotate/invalidate a specific session_id
- No tool to check how long a session IP has been held
- Session persistence depends entirely on the upstream proxy backend behavior — not tracked in MCP

### IP Rotation Tracking
**Status: Absent.**
No tool returns the actual IP assigned to a session_id. An agent cannot verify which IP was assigned or detect if rotation occurred. BrightData's "Super Proxy" returns `x-luminati-ip` response headers; nothing equivalent is exposed here.

### Country/City Targeting Options
**Status: Partial.**
- Residential: country + city (both validated with regex)
- Datacenter: country only
- Mobile: country + carrier
- ISP: country param accepted but silently ignored (backend limitation)
- Static/dedicated: no targeting (per-IP credentials model)

Missing:
- State/region targeting (US-specific: California, Texas, etc.)
- ASN targeting
- City validation against a known list (currently any string passes regex)
- Time zone targeting

---

## 10. Improvements for Enterprise Use Cases

### Security

1. **Fix plaintext password in static/dedicated output**: The `curl` and `env` format blocks in `proxy_static.ts` and `proxy_dedicated.ts` embed `proxyPass` directly. Replace with `${NOVADA_STATIC_PROXY_PASS}` shell variable pattern matching what zone-based tools do. This is the highest priority security fix.

2. **Remove the process.env mutation in startup auto-provision**: Instead, store auto-provisioned credentials in a module-level variable and update `getProxyCredentials()` to check it. This preserves `AsyncLocalStorage` isolation for SDK use cases.

3. **Validate NOVADA_PROXY_ENDPOINT format**: Add a regex check `^[a-zA-Z0-9\.\-]+:\d{1,5}$` before splitting. Return a clear error if malformed rather than silently producing `NaN` port.

4. **Suppress account name from stderr log**: Or at minimum make it configurable. Account names are not secrets but appear in process logs.

### Consistency

5. **Unify error format**: `proxy_static.ts` and `proxy_dedicated.ts` should use `makeNovadaError(NovadaErrorCode.PROXY_AUTH_FAILURE, ...)` instead of `JSON.stringify({status: "configuration_required"})`.

6. **Remove or validate ISP country param**: Either make the schema reject `country` for ISP (since backend ignores it) or add a `NOTE: country param is not supported for ISP zone` to the schema `.describe()` without silently accepting it.

7. **Remove dead `encodedPass` variable** from `proxy_residential.ts`, `proxy_isp.ts`, `proxy_datacenter.ts`, `proxy_mobile.ts`. It is computed but never used.

8. **Deprecate `novada_proxy` (legacy)**: It is labeled legacy but is still in the active tool list and registered in `CATEGORY_MAP.proxy`. Its error format (plain markdown) diverges from the `NovadaError` system. Either port it to `NovadaError` or remove it from the default tool set.

### Features

9. **Quota check tool**: Add `novada_proxy_quota` that calls `/v1/proxy_account/list` and returns remaining bandwidth per sub-account, or expose remaining_mb in the `novada_plan_balance_all` tool which already calls the relevant endpoints.

10. **Session invalidation**: Add `session_id` invalidation endpoint if the Novada API supports it, or at minimum document that session rotation requires changing the `session_id` string.

11. **Actual IP verification tool**: Add `novada_proxy_verify` that routes a test request through the proxy and returns the observed IP (calling `ipinfo.novada.pro` or similar). The example already appears in static/dedicated tool comments.

12. **ISP country targeting**: If the backend ever supports it, expose it in `buildIspUsername()`. Currently the schema accepts it but silently drops it, which is deceptive.

13. **Multi-IP static/dedicated selection**: Currently `proxy_static` and `proxy_dedicated` always pick `entries[0]`. Add a `session_id`-based hash to select consistently from the list, and expose the count of available IPs in the response.

---

## Summary

The proxy subsystem is **functionally sound for zone-based proxies** (residential/isp/datacenter/mobile). The auto-provision flow works correctly for the common single-instance MCP server case. The zone-based tools consistently mask passwords and have good `agent_instruction` guidance.

The **two critical issues** are:
1. `proxy_static` and `proxy_dedicated` expose plaintext passwords in `curl` and `env` format output.
2. The startup `process.env` mutation undermines the `AsyncLocalStorage` credential isolation designed for SDK multi-tenant use.

The **structural issues** are:
- `proxy_static` / `proxy_dedicated` use a completely different architecture (per-IP list) with inconsistent error format.
- Legacy `novada_proxy` is still active and inconsistent with the newer tools.
- ISP country targeting silently no-ops rather than failing clearly.
- Dead `encodedPass` variable in 4 files.
