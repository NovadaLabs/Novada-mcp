# Agent Experience Review — CC R2

## CRITICAL (blocks agent usability)

None found.

---

## HIGH (degrades agent experience)

### 1. discover.ts TOOL_CATALOG — 5 deployed proxy tools have wrong names and wrong status

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/discover.ts:107–141`

**Issue:** The TOOL_CATALOG lists proxy tool names that do not match the actual deployed tools:

| Catalog name | Actual deployed name | Status in catalog | Actual status |
|---|---|---|---|
| `novada_proxy_residential` | `novada_proxy_residential` | `todo` | **active** |
| `novada_proxy_isp_rotating` | `novada_proxy_isp` | `todo` | active |
| `novada_proxy_datacenter_rotating` | `novada_proxy_datacenter` | `todo` | active |
| `novada_proxy_mobile` | `novada_proxy_mobile` | `todo` | active |
| `novada_proxy_static_isp` | `novada_proxy_static` | `todo` | active |
| `novada_proxy_dedicated_datacenter` | `novada_proxy_dedicated` | `todo` | active |

**Impact:** An agent calling `novada_discover` is told all 6 specialized proxy tools are `todo` (planned but not available), when in fact they are all active. An agent will attempt workarounds with the legacy `novada_proxy` or give up, never using the better-targeted tools. The catalog names also don't match what the agent would type in a tool call (e.g. `novada_proxy_isp` exists, `novada_proxy_isp_rotating` does not).

**Fix:** Update TOOL_CATALOG proxy entries to use the actual deployed tool names (`novada_proxy_isp`, `novada_proxy_datacenter`, `novada_proxy_static`, `novada_proxy_dedicated`) and set status to `"active"`. Also add `novada_browser_flow` as active (it is currently listed as `todo` at line 156).

---

### 2. discover.ts TOOL_CATALOG — `novada_browser_flow` listed as `todo` but is active

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/discover.ts:153–157`

```
{
  name: "novada_browser_flow",
  description: "Track and manage browser session flow state...",
  category: "Browser & Rendering",
  status: "todo",  // WRONG — tool is deployed and active
},
```

**Impact:** Agents calling `novada_discover` and filtering on `Browser & Rendering` will see `novada_browser_flow` as `todo` and skip it entirely. They'll never consider it as an alternative to `novada_browser` for API-side automation flows.

**Fix:** Set `status: "active"`. Update description to match the actual tool behavior (it is NOT a session-tracker; it POSTs to `browser_flow_use` and executes actions).

---

### 3. discover.ts TOOL_CATALOG — `novada_scraper_submit/status/result` listed as `todo` despite being deployed

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/discover.ts:66–83`

**Issue:** All three scraper async tools are shown as `status: "todo"` in the catalog, but they are fully registered in TOOLS, have Zod schemas, and dispatch in the switch statement.

**Impact:** An agent exploring the catalog will not learn about the async scraper pipeline (submit → poll → result). It will default to `novada_scrape` for all scraping, even cases where the async scraper would be more appropriate (e.g. universal scraper_type).

**Fix:** Set `status: "active"` for `novada_scraper_submit`, `novada_scraper_status`, `novada_scraper_result`.

---

### 4. `--help` output: tool count says 11 but 23 are registered

**File:** `/Users/tongwu/Projects/novada-mcp/src/index.ts:702`

```
Tools (11):                 // ← stale count from pre-expansion
  novada_search    ...
  novada_extract   ...
  ...
  novada_health    ...
```

The `--help` block lists only 11 tools and does not mention `novada_proxy_residential`, `novada_proxy_isp`, `novada_proxy_datacenter`, `novada_proxy_mobile`, `novada_proxy_static`, `novada_proxy_dedicated`, `novada_browser_flow`, `novada_scraper_submit`, `novada_scraper_status`, `novada_scraper_result`, `novada_health_all`, or `novada_discover`.

**Impact:** Any human or agent reading `--help` output will think the server has 11 tools and miss 12 deployed tools entirely.

**Fix:** Update `Tools (11):` to `Tools (23):` and add the missing tool lines.

---

### 5. `scraper_submit.ts` misclassifies activation-gate errors as `API_DOWN`

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/scraper_submit.ts:94`

```typescript
throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper submit error (code ${body.code}): ${msg}`);
```

This fires for error codes including `11006` (product not activated) and `11008` (unknown scraper_type). Both are not transient API downtime — they are configuration errors that will never succeed on retry. Yet they are classified as `API_DOWN` (retryable: true, instruction: "wait 30–60 seconds and retry").

**Impact:** An agent receiving `11006` will retry indefinitely (exponential backoff pattern) against a permanently unavailable endpoint, wasting tokens and time. The correct code is `PRODUCT_UNAVAILABLE` (retryable: false), which instructs the agent to activate the product at the dashboard.

**Fix:** Map code `11006` to `NovadaErrorCode.PRODUCT_UNAVAILABLE` and `11008` to `NovadaErrorCode.INVALID_PARAMS` before the generic fallback throw.

---

## MEDIUM

### 6. Legacy `classifyError` in `types.ts` is a zombie — shadowed by `_core/errors.ts`

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/types.ts:393–440`

`types.ts` exports its own `classifyError` function and `NovadaErrorCode` enum (as a plain object, not a class). It is also exported from `tools/index.ts` on line 37. However, `_core/errors.ts` defines the canonical `NovadaError` class, `classifyError` function, and `NovadaErrorCode` enum that all tools actually use.

**Impact:** The `types.ts` version uses a different `NovadaError` shape (plain object with `{ code, message, retryable, docsUrl }` — not a class, no `toAgentString()`, no `agent_instruction`). Any import of `classifyError` from `tools/index.ts` gets the weaker version without `agent_instruction`. Cross-contamination risk if a new tool imports the wrong symbol.

**Fix:** Remove `classifyError`, `NovadaErrorCode`, and the `NovadaError` interface from `types.ts`. Only keep them in `_core/errors.ts`. Update `tools/index.ts` line 37 to remove the re-export of `classifyError` and `NovadaErrorCode` from `types.ts` (they're already exported from `_core/errors.ts` through the existing re-export).

---

### 7. `proxy.ts` (legacy) missing `agent_instruction` on the not-configured error path

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/proxy.ts:44–61`

The not-configured branch returns a markdown block with "Agent Hints" but no structured `agent_instruction:` field. All specialized proxy tools (`proxy_residential.ts`, `proxy_isp.ts`, etc.) return `makeNovadaError(...).toAgentString()` on the same error, which outputs `agent_instruction:` in the canonical format.

**Impact:** Minor inconsistency — an agent hitting the legacy `novada_proxy` with missing credentials gets a different error format from the specialized proxy tools.

**Fix:** Replace the `return [...]` block with `return makeNovadaError(NovadaErrorCode.PROXY_AUTH_FAILURE, ...).toAgentString()` to match the pattern in all 6 specialized proxy tools.

---

### 8. `unblock.ts` returns errors as success strings instead of throwing

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/unblock.ts:27–38`

```typescript
} catch (err: unknown) {
  const classified = classifyError(err);
  const fallbackHint = [
    classified.toAgentString(),
    ...
  ].join("\n");
  return fallbackHint;   // returns as success, not error
}
```

**Impact:** Errors from `novada_unblock` are returned with `isError: false` in the MCP envelope. An agent cannot distinguish a real failure from successful content — it will try to parse the `agent_instruction` text as HTML. The correct pattern used by all other tools is to `throw` the error and let `index.ts` handle it with `isError: true`.

**Fix:** Remove the try/catch in `unblock.ts` and let errors propagate. `index.ts` already wraps all tool calls with the correct `isError: true` handling.

---

### 9. `scraper_submit.ts` and `scraper_status.ts`: hardcoded internal URL not from config

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/scraper_status.ts:48`
**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/scraper_result.ts:57`

```typescript
const STATUS_BASE = "https://api-m.novada.com/v1/scraper";
```

This URL is hardcoded in two separate files rather than centralized in `config.ts`. `SCRAPER_API_BASE`, `SCRAPER_DOWNLOAD_BASE`, `SCRAPERAPI_BASE`, and `WEB_UNBLOCKER_BASE` are all in `config.ts`. The `api-m.novada.com` domain is only referenced in these two scattered files.

**Fix:** Add `export const SCRAPER_STATUS_BASE = "https://api-m.novada.com/v1/scraper";` to `config.ts` and import it in both files.

---

### 10. `scraper_submit.ts` description mentions `contact fudong` — internal name in external tool

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/scraper_submit.ts:19–20`
**File:** `/Users/tongwu/Projects/novada-mcp/src/index.ts:378` (TOOLS definition)

```typescript
.describe("Scraper type to use. Default: 'universal'. Contact fudong for available scraper types on your account.")
```

And in `index.ts`:
```
**Note:** If the endpoint returns a placeholder task_id, contact fudong to confirm scraper_type availability.
```

**Impact:** "fudong" is an internal person's name that will be surfaced to external agents and users. This looks unprofessional and is non-actionable for external agents who don't know who "fudong" is.

**Fix:** Replace with "contact Novada support at support@novada.com" or "check your account dashboard".

---

## MISSING REGISTRATIONS

All 23 tools are confirmed present in both TOOLS array and switch dispatch. No missing registrations.

### discover.ts TOOL_CATALOG — Catalog vs deployed mismatch summary

Tools in TOOLS array but NOT in discover catalog under their correct name:
- `novada_proxy_isp` — catalog has `novada_proxy_isp_rotating`
- `novada_proxy_datacenter` — catalog has `novada_proxy_datacenter_rotating`
- `novada_proxy_static` — catalog has `novada_proxy_static_isp`
- `novada_proxy_dedicated` — catalog has `novada_proxy_dedicated_datacenter`

Tools in discover catalog that do NOT exist as deployed tools:
- `novada_proxy_isp_rotating` (does not exist)
- `novada_proxy_datacenter_rotating` (does not exist)
- `novada_proxy_static_isp` (does not exist)
- `novada_proxy_dedicated_datacenter` (does not exist)
- `novada_scraper_task_list` (does not exist, properly marked todo)
- `novada_unblock_direct` (does not exist, properly marked todo)
- `novada_proxy_discover` (does not exist, properly marked todo)
- `novada_browser_area_select` (does not exist, properly marked todo)
- `novada_auth_token` (does not exist, properly marked todo)

---

## PASS (confirmed good)

- **TOOLS count matches switch count**: 23 tools in TOOLS array, 23 cases in switch — perfect alignment, no silent failures.
- **`_core/errors.ts` agent_instruction completeness**: All 10 `NovadaErrorCode` values have full, actionable `agent_instruction` templates with specific next steps (not generic "try again"). Special codes like `TASK_NOT_FOUND`, `TASK_PENDING`, `SESSION_EXPIRED`, `PROXY_AUTH_FAILURE`, `PRODUCT_UNAVAILABLE` are covered with product-specific actions.
- **Tool naming convention**: All 23 tools follow `novada_{product}_{action}` or `novada_{product}` pattern consistently.
- **Tool descriptions**: All 23 tool descriptions in `index.ts` are multi-sentence, include Best for / Not for sections, and provide concrete next-step guidance. `novada_extract`, `novada_crawl`, `novada_unblock` include detailed "Common mistakes" callouts.
- **Zod `.describe()` quality**: Input param descriptions are specific and informative across all tools. Notable examples: `BrowserActionSchema` per-action descriptions, `ScrapeParamsSchema` operation examples, `ProxyStaticParamsSchema` explicit REQUIRED markers.
- **No `novada-search` string literals in `src/`**: Confirmed zero matches. All tool references use `novada` as the package/server name. (`novada-search` appears only in docs, config files, and package.json — not in src).
- **`health_all.ts` product coverage**: Tests 6 products (Search, Extract/Web Unblocker, Scraper, Proxy, Browser, Unblock) in parallel. Degrades gracefully — `Promise.allSettled` means one probe failure never kills the others. Activation links present for all `not_activated` states.
- **Security — `safeUrl` validator**: Blocks `localhost`, all private RFC-1918 ranges (10.x, 172.16-31.x, 192.168.x), IPv6 loopback, link-local, and newlines in URLs. Present in `types.ts` and used on all URL inputs in extract, crawl, map, browser.
- **`evaluate` script security**: Three-layer protection — ASCII-only, network API blocklist, global bracket-access blocklist. Prevents eval/fetch/XMLHttpRequest/WebSocket/sendBeacon/EventSource injection via prompt injection.
- **`scraper_submit.ts` 404 path**: Returns structured JSON with `alternatives` array pointing to `novada_scrape`, `novada_extract`, `novada_unblock` — actionable fallback chain for agents.
- **`scraper_status.ts` per-state agent_instruction**: Each of the 4 states (complete, failed, running, pending) returns a distinct, specific instruction (not one generic message).
- **Proxy tools credential error**: All 6 specialized proxy tools enumerate which specific env vars are missing (`NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, `NOVADA_PROXY_ENDPOINT`) rather than a generic "credentials missing".
- **GROUP_MAP filtering**: All 23 tool short names are in `GROUP_MAP`. The `novada_health` always-include rule ensures agents can always diagnose issues even with restrictive NOVADA_GROUPS.
- **`scraper_submit.ts` + `scraper_status.ts` task_id regex validation**: Both validate `task_id` via `.regex(/^[a-zA-Z0-9_\-\.]{1,128}$/)` preventing path injection in URL construction (`encodeURIComponent(task_id)` also applied).

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 5     | warn   |
| MEDIUM   | 5     | info   |

**Verdict: WARNING — 5 HIGH issues should be resolved before the next publish.**

The most impactful fix is the `discover.ts` TOOL_CATALOG misalignment (issues 1–3): agents calling `novada_discover` are shown a catalog where 9 of 23 active tools appear as either unavailable or under wrong names. This is the first tool an agent is supposed to call to understand capabilities, making it the highest-leverage fix.
