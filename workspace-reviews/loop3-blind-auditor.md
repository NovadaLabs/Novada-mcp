---
role: blind-auditor
loop: 3
verdict: ISSUES_FOUND
---

## What I See

A TypeScript MCP server (`novada@0.0.1`) that registers tools via `@modelcontextprotocol/sdk`, validates inputs with Zod v4, converts schemas to JSON Schema via `.toJSONSchema()`, and dispatches tool calls through a single `switch` in `setupHandlers()`. The server reads `NOVADA_API_KEY` from `process.env` at startup (module level), exposes a `NOVADA_GROUPS` filter mechanism, and includes structured error classification with `agent_instruction` strings. Build passes `tsc --noEmit` with zero errors. A `build/` directory is present (already compiled). Prompts and MCP Resources (`novada://engines`, `novada://guide`, etc.) are also registered.

## Against the Goal

**Tool count: 23 — confirmed.**

Counting from `TOOLS` array in `index.ts`:
1. novada_search
2. novada_extract
3. novada_crawl
4. novada_research
5. novada_map
6. novada_scrape
7. novada_proxy
8. novada_proxy_residential
9. novada_proxy_isp
10. novada_proxy_datacenter
11. novada_proxy_mobile
12. novada_proxy_static
13. novada_proxy_dedicated
14. novada_verify
15. novada_unblock
16. novada_browser
17. novada_health
18. novada_health_all
19. novada_discover
20. novada_scraper_submit
21. novada_scraper_status
22. novada_scraper_result
23. novada_browser_flow

That is exactly 23. The `--help` output also lists exactly 23. Count matches stated goal.

**Product coverage:** Search ✓, Scraping ✓, Proxy ✓ (7 proxy variants), Browser ✓ (2 browser tools + browser_flow), health/discover ✓.

**Package name:** `"name": "novada"` at version `"0.0.1"` — matches stated goal.

**Build:** TypeScript compiles clean (lint passes, `build/` exists).

**Credential safety:** API key checked at call time (not just at startup). No hardcoded credentials found. Sensitive values are masked in proxy output (`***`). `sanitizeServerMsg()` strips `api_key=` query params from error messages. `.env` presence blocks `npm publish` via `prepublishOnly`.

**No silent failures:** Every tool path either returns a structured JSON/markdown response or throws a `NovadaError` with `agent_instruction`. Zod validation errors produce readable messages. 404/401/5xx all produce actionable responses.

The deliverable substantially achieves the stated goal.

## What Seems Wrong or Missing

### 1. Dual `NovadaErrorCode` / `classifyError` definitions — one is a dead export

`src/_core/errors.ts` defines `NovadaErrorCode` (11 codes) and `classifyError()` (returns `NovadaError` class). `src/tools/types.ts` defines a second `NovadaErrorCode` enum (6 codes, missing `PRODUCT_UNAVAILABLE`, `TASK_NOT_FOUND`, `TASK_PENDING`, `SESSION_EXPIRED`, `PROXY_AUTH_FAILURE`) and a second `classifyError()` (returns a plain `NovadaError` interface, not the class). The `tools/index.ts` re-exports `classifyError` and `NovadaErrorCode` from `tools/types.ts`. This means any consumer who imports from `tools/index.ts` gets the weaker, 6-code version. The richer `_core/errors.ts` version is only used internally. This is a functional inconsistency: the `tools/types.ts::classifyError` does not handle `PRODUCT_UNAVAILABLE` (maps 402 to nothing), does not handle session or task errors, and returns a plain object instead of a class — so `.toAgentString()` would be missing. If any downstream consumer uses the exported `classifyError`, they get a degraded error handler.

### 2. `novada_unblock` accepts `apiKey` as optional but always receives it

`novadaUnblock(params: UnblockParams, apiKey?: string)` — the second parameter is optional. In `index.ts` the call is `novadaUnblock(validateUnblockParams(...), API_KEY)` which passes it correctly. But the optional signature creates a surface where the apiKey can be omitted silently by any caller outside the MCP server (SDK use, tests). `routeFetch` downstream presumably needs it. This is a type-safety gap.

### 3. `scraper_status.ts` hardcodes a base URL that differs from `config.ts`

`scraper_status.ts` line 48: `const STATUS_BASE = "https://api-m.novada.com/v1/scraper"` — hardcoded, not imported from `config.ts`. Every other tool imports its base URLs from `config.ts`. This is the one exception. The same URL is also hardcoded in `scraper_result.ts` line 57. If the endpoint changes, these files won't be updated by changing `config.ts`.

### 4. `novada_unblock` description says `wait_ms`, `block_resources`, `auto_runs` "have no effect"

The tool description explicitly documents: "wait_ms, block_resources, auto_runs are accepted but not yet implemented — they have no effect in the current version." These three params are present in the Zod schema, validated, accepted without error, and silently discarded (`void wait_ms; void block_resources; void auto_runs`). An agent reading the schema will see these params and may use them expecting effect. The description does mention this, but accepting params that do nothing is a silent behavior gap.

### 5. `novada://guide` and `novada://llms-txt` resources list only 11 tools; the server exposes 23

`novada://guide` table lists 11 tools. `novada://llms-txt` documents 11 tools. The server has 23. The 12 newer tools — all proxy variants (`novada_proxy_residential`, `novada_proxy_isp`, etc.), `novada_health_all`, `novada_discover`, `novada_scraper_*`, and `novada_browser_flow` — are completely absent from both resources. An agent that reads `novada://guide` first will not know these tools exist unless it also calls `novada_discover`.

### 6. `proxy_residential.ts` imports `getProxyCredentials` from `../utils/credentials.ts` but `_core/auth.ts` has its own `getProxyCredentials`

Two `getProxyCredentials` implementations exist: `_core/auth.ts` (reads directly from `process.env`) and `utils/credentials.ts` (reads from AsyncLocalStorage first, falls back to `process.env`). `proxy_residential.ts` (and presumably the other proxy tools) imports from `utils/credentials.ts` — the correct one with SDK-scoped credential support. But `_core/auth.ts` exports the same function name unused by proxy tools. This creates confusion about which is authoritative for new contributors.

### 7. `novada_scraper_result.ts` has a TODO comment indicating endpoint uncertainty

Line 52–55: `// TODO: Confirm the exact result-fetch endpoint with fudong.` — an unresolved TODO in production code with a named individual. This signals the endpoint behavior is not fully confirmed. The code has a two-attempt fallback that handles this gracefully, but the TODO is a production code smell.

## Assumptions This Deliverable Makes

1. **`NOVADA_API_KEY` is set and valid.** Checked at call time, not at startup — but the startup log message would succeed even with no key, giving no warning until first tool call.

2. **Zod v4's `.toJSONSchema()` produces MCP-compatible JSON Schema.** The `zodToMcpSchema()` function strips `$schema` and `$defs` and trusts the rest. If Zod v4's output contains properties MCP clients don't support (e.g., `$ref` without `$defs`, `prefixItems`, etc.), the schema will be silently wrong and agents will receive incorrect input schemas.

3. **`scraper_status.ts` STATUS_BASE (`https://api-m.novada.com/v1/scraper`) is a valid endpoint.** This is hardcoded and not from config. There is no evidence this URL has been validated as live (the TODO in `scraper_result.ts` suggests endpoint shape is still uncertain).

4. **`novada_browser_flow` endpoint `https://api-m.novada.com/v1/browser_flow/browser_flow_use` is stable.** Also hardcoded outside `config.ts`. The 404 handling returns a structured response, so it degrades gracefully, but the assumption is this will eventually be live.

5. **The SSRF blocklist in `safeUrl` is complete.** The blocklist covers common private ranges but does not cover: IPv6 link-local for all possible formats, DNS rebinding attacks (where a public hostname resolves to a private IP at request time), or URL-encoded/punycode bypass. This is a runtime assumption about what constitutes a safe URL.

6. **`playwright-core` is available in the runtime environment.** It is listed as a production dependency, but it downloads large browser binaries. If the runtime environment blocks binary downloads (e.g., serverless, container with no write access), the browser tool will fail at connection time rather than schema validation time.

7. **`pdf-parse` and `exceljs` can run in all target environments.** Both are production dependencies. `pdf-parse` uses native bindings in some configurations. No fallback if they are unavailable.

8. **`NOVADA_GROUPS` env var is properly comma-separated.** No validation that the value is well-formed. A value like `"search, extract"` (space after comma) is handled by `.trim()` on each segment, but a value like `"search extract"` (space as separator) would produce no match and fall through to the warning path.

## What I Would Ask If I Had More Context

1. **Where is `novadaProxy` implemented and does it use `_core/auth.ts` or `utils/credentials.ts`?** The `tools/proxy.ts` file exists but was not read. The `_core/auth.ts::getProxyCredentials` vs `utils/credentials.ts::getProxyCredentials` split is confusing — which one does `proxy.ts` use?

2. **What does `routeFetch` in `utils/router.ts` do with the optional `apiKey`?** `novadaUnblock` passes `apiKey` as an optional arg to `routeFetch`. If `apiKey` is undefined, does the router fail silently or throw?

3. **Are `SCRAPER_API_BASE`, `SCRAPERAPI_BASE`, and `WEB_UNBLOCKER_BASE` from `config.ts` live and confirmed?** The comment says "correct domain per official Novada docs" for `SCRAPERAPI_BASE`. The distinction between `scraper.novada.com` (scraper submit), `scraperapi.novada.com` (SERP), `api.novada.com` (download), `api-m.novada.com` (status/browser) is non-obvious. A new developer would not know which base URL maps to which product.

4. **Is `novada_health`'s probing logic aware of all 23 tools?** The description says it checks 5 products; `novada_health_all` says 6. Neither appears to probe the async scraper (`api-m.novada.com`) or `browser_flow` endpoints. Health tools may report "all good" even when the scraper and browser_flow endpoints are unreachable.

5. **What is the relationship between `novada_scrape` (synchronous, platform-specific) and `novada_scraper_submit/status/result` (asynchronous, universal)?** The descriptions suggest they use different backends entirely. The `novada://scraper-platforms` resource documents `novada_scrape` operations. Are the two systems really separate, or does `novada_scrape` internally use the async task lifecycle?

6. **Why does `novada_browser` not use `API_KEY` but `novada_browser_flow` does?** In `index.ts`, `novadaBrowser(validateBrowserParams(...))` — no `API_KEY`. But `novadaBrowserFlow(..., API_KEY)` — passes it. The browser tool presumably uses the `NOVADA_BROWSER_WS` WebSocket directly (so no API key needed), while browser_flow POSTs to a REST endpoint. This is correct but undocumented — a developer would be confused.

7. **Is `config.ts::VERSION = "0.8.6"` intentionally different from `package.json::version = "0.0.1"`?** The server announces `v0.8.6` at startup. `package.json` is `0.0.1`. These are different. An agent or user running `npx novada` would see "Novada MCP server v0.8.6" but npm registry would show `0.0.1`. This discrepancy could cause version-tracking confusion.
