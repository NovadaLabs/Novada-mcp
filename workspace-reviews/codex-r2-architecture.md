# Architecture Review — Codex R2

## VIOLATIONS (must fix)
- [src/tools/search.ts:5] Rule violated: tools/ files must NOT import other tools/ files. `novada_search` imports `novadaExtract` from `./extract.js`, creating a cross-tool dependency. | Fix: move the shared "extract top search results" behavior into a non-tool helper under utils/ or a dedicated service module outside tools/, then have both tools call that helper.
- [src/tools/research.ts:5] Rule violated: tools/ files must NOT import other tools/ files. `novada_research` imports `novadaExtract` from `./extract.js`. | Fix: extract the reusable page-extraction orchestration into utils/ or another non-tool module and import that instead.
- [src/index.ts:97] Rule violated: direct `process.env.NOVADA_API_KEY` read outside `_core/auth.ts`. | Fix: replace with `_core/auth.ts` helper, e.g. `getNovadaApiKey()` / `requireNovadaApiKey()`.
- [src/cli.ts:17] Rule violated: direct `process.env.NOVADA_API_KEY` read outside `_core/auth.ts`. | Fix: route CLI auth through `_core/auth.ts`.
- [src/tools/scrape.ts:63,73,114,117,120,122,124,127,189,191,202,215] Rule violated: raw `throw new Error()` in tool error paths instead of `_core/errors.ts` `makeNovadaError`. | Fix: map scraper submit/download/timeout/auth failures to `NovadaErrorCode` values and throw `makeNovadaError(...)`.
- [src/utils/http.ts:30,46,125,151,200,203,209] Rule violated: raw `throw new Error()` in shared runtime error paths instead of `_core/errors.ts`. | Fix: convert fetch retry, proxy fallback, and Web Unblocker failures to `makeNovadaError(...)` or return typed errors consumed by tools.
- [src/utils/browser.ts:102] Rule violated: raw `throw new Error()` in browser utility error path. | Fix: throw `makeNovadaError(...)` with a browser/auth/config-oriented code.
- [src/utils/pdf.ts:19] Rule violated: raw `throw new Error()` in PDF extraction error path. | Fix: use `makeNovadaError(NovadaErrorCode.INVALID_PARAMS, ...)` or a size/content-specific code.
- [src/utils/router.ts:16] Rule violated: raw `throw new Error()` in routing/content error path. | Fix: return/throw `makeNovadaError(...)` so tool responses remain structured.
- [src/resources/index.ts:571] Rule violated: raw `throw new Error()` in MCP resource error path. | Fix: use `_core/errors.ts` structured error handling or convert to an MCP-safe error response at the boundary.
- [src/prompts/index.ts:202] Rule violated: raw `throw new Error()` in MCP prompt error path. | Fix: use `_core/errors.ts` or a structured prompt error result.
- [src/sdk/index.ts:121,277] Rule violated: raw `throw new Error()` in SDK-facing error paths. | Fix: use shared NovadaError types/factory so SDK and MCP errors are consistent.
- [src/tools/types.ts:10] Rule violated: string params flowing into URLs must have `.regex()` Zod constraint. The shared `safeUrl` schema uses `.url()` and `.refine()` but no `.regex()`, and it backs URL params for extract/crawl/map/unblock/browser. | Fix: add an explicit `.regex(/^https?:\/\/[^\s\r\n]+$/i, ...)` or equivalent before refinements.
- [src/tools/types.ts:100] Rule violated: string params flowing into regex construction lack `.regex()` constraints. `select_paths` values are later passed to `new RegExp(...)` in `src/tools/crawl.ts:42`. | Fix: constrain allowed regex/path syntax with `.regex(...)` plus existing ReDoS guards.
- [src/tools/types.ts:102] Rule violated: string params flowing into regex construction lack `.regex()` constraints. `exclude_paths` values are later passed to `new RegExp(...)` in `src/tools/crawl.ts:42`. | Fix: constrain allowed regex/path syntax with `.regex(...)` plus existing ReDoS guards.
- [src/tools/scraper_submit.ts:9] Rule violated: URL string param lacks `.regex()` Zod constraint before flowing into `URLSearchParams` request body. | Fix: reuse the shared `safeUrl` schema once it has `.regex()`, or add the same URL `.regex()` locally.
- [src/tools/browser_flow.ts:31] Rule violated: URL string param lacks `.regex()` Zod constraint before flowing into the cloud browser endpoint. | Fix: reuse the shared `safeUrl` schema once it has `.regex()`, or add the same URL `.regex()` locally.

## INCONSISTENCIES
- [src/tools/types.ts:201] Issue: `NovadaErrorCode`, `NovadaError`, `classifyError`, and sanitizer logic are duplicated in `tools/types.ts` even though `_core/errors.ts` is the architectural source of truth. This risks divergent classifications and violates the intended module boundary by keeping core error semantics in tools/. Fix: import these from `_core/errors.ts` and remove the duplicate definitions/exports.
- [src/tools/discover.ts:66] Issue: `novada_scraper_submit`, `novada_scraper_status`, and `novada_scraper_result` are registered and implemented, but discover marks them as `todo`. Fix: mark these active.
- [src/tools/discover.ts:103] Issue: registered proxy tools are advertised with mismatched or `todo` names (`novada_proxy_isp_rotating`, `novada_proxy_static_isp`, etc.) while actual registered names are `novada_proxy_isp`, `novada_proxy_static`, and `novada_proxy_dedicated`. Fix: align discover catalog names/statuses with `TOOLS`.
- [src/tools/discover.ts:152] Issue: `novada_browser_flow` is registered and implemented, but discover marks it as `todo` and describes a GET session-state endpoint rather than the implemented multi-step browser automation behavior. Fix: mark active and update the description.
- [src/tools/proxy_residential.ts:8] Issue: optional `url` schema is unconstrained and currently unused. Same issue exists in `proxy_isp.ts:8`, `proxy_datacenter.ts:8`, `proxy_mobile.ts:8`, `proxy_static.ts:8`, and `proxy_dedicated.ts:8`. Fix: remove the param or validate it with the shared safe URL schema if it will affect output.

## MISSING REGISTRATIONS (tool in TOOLS but not in switch, or vice versa)
- None. `src/index.ts` has 23 `TOOLS` entries and 23 matching switch cases: no tool is registered without dispatch and no switch case is unregistered.

## PASS
- Rules confirmed clean: `_core/` does not import from `tools/` or `utils/`; `_core/` imports are limited to zod and internal `_core` modules.
- Rules confirmed clean: `utils/` does not import from `tools/`.
- Rules confirmed clean: `src/tools/index.ts` exports all 23 implemented tools.
- Rules confirmed clean: all 23 registered tools are present in both the `TOOLS` array and switch dispatch in `src/index.ts`.
