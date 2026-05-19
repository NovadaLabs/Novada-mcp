# Consolidated Review — novada@0.0.1
> 4 reviewers: Codex R1 (security), Codex R2 (architecture), CC R1 (security), CC R2 (agent experience)
> All 4 reports in: workspace-reviews/

---

## CRITICAL — 0 issues
No critical issues found by any reviewer.

---

## HIGH — fix before publish

### Security
**S1. API key sent as query param** (Codex R1, CC R1 — confirmed by 2)
- `scraper_status.ts:82–89` and `scraper_result.ts:200–204`
- `params: { apikey: apiKey }` + Bearer header on same request → key lands in server access logs
- Fix: remove `params: { apikey: apiKey }` from both files — Bearer is sufficient

**S2. Proxy credentials exposed in MCP response** (Codex R1)
- `proxy_residential.ts:94,112` and `proxy_static.ts:84,103`
- `format="env"` → `export HTTP_PROXY="...user:pass@..."` returned to MCP caller
- Fix: mask credentials by default; use env-var placeholder `NOVADA_PROXY_PASS` in output

**S3. Raw Axios error logging** (Codex R1)
- `index.ts:492` and `index.ts:720` — `console.error("[novada]", error)` can include `config.headers.Authorization`
- Fix: strip to `{ name, code, statusCode }` before logging

**S4. SSRF on new tools** (Codex R1)
- `scraper_submit.ts` and `browser_flow.ts` URL params: `.url()` scheme-only, no private-IP/localhost block
- (Note: `safeUrl` in `types.ts` IS thorough — apply it to these two new tools)
- Fix: reuse `safeUrl` from `tools/types.ts` in scraper_submit and browser_flow

**S5. process.env.NOVADA_API_KEY bypass** (Codex R1, Codex R2, CC R1)
- `index.ts:97` and `cli.ts:17` read env var directly, bypassing `_core/auth.ts`
- Fix: replace with `getApiKey()` / `requireNovadaApiKey()` from `_core/auth.ts`

### Agent Experience
**A1. discover.ts TOOL_CATALOG wrong names + all marked todo** (Codex R2, CC R2 — confirmed by 2)
- 6 proxy tools: wrong names (`novada_proxy_isp_rotating` etc.) and `status: "todo"` — all are active
- 3 scraper tools: `status: "todo"` — all are active and deployed
- `novada_browser_flow`: `status: "todo"` and wrong description — active and deployed
- Fix: update all names to match actual tool names; set status "active" for all deployed tools

**A2. scraper_submit misclassifies 11006/11008 as API_DOWN** (CC R2)
- `scraper_submit.ts:94` — code 11006 (product not activated) = retryable: true, "wait 30–60s and retry"
- Agents will retry indefinitely against a permanently unavailable product
- Fix: map 11006 → `PRODUCT_UNAVAILABLE`, 11008 → `INVALID_PARAMS`

**A3. unblock.ts returns errors as success strings** (CC R2)
- `unblock.ts:27–38` — catch block does `return fallbackHint` instead of `throw`
- Error surfaces with `isError: false` — agent can't tell error from HTML content
- Fix: remove try/catch; let errors propagate to index.ts handler

**A4. --help shows 11 tools, 23 deployed** (CC R2)
- `index.ts:702` — stale count and list from before Phase 3–4 expansion
- Fix: update to 23 tools and add the 12 missing tool entries

**A5. Internal endpoint URLs in scraper_result response** (CC R1)
- `scraper_result.ts:261` — `endpoints_tried` array leaks internal API routing topology
- Fix: replace with generic description string

---

## MEDIUM

| ID | File | Issue |
|----|------|-------|
| M1 | `_core/errors.ts:150` | sanitizeMessage() misses proxy URLs (`user:pass@host`), JSON fields, env var strings |
| M2 | `tools/types.ts:393` | Zombie `classifyError` + `NovadaErrorCode` duplicates — wrong shape (no toAgentString) |
| M3 | `tools/types.ts:10,100,102` | `safeUrl` + `select_paths`/`exclude_paths` lack `.regex()` before RegExp construction |
| M4 | `browser_flow.ts:14` | `selector` field: no `.regex()` or `.max()` constraint |
| M5 | `proxy_*.ts (all 6):8` | Unused `url` param — unconstrained, not validated, will bite if wired |
| M6 | `proxy.ts:44–61` | Legacy proxy: missing structured `agent_instruction` (returns markdown block, not NovadaError) |
| M7 | `scraper_status.ts:48` | `STATUS_BASE` URL hardcoded, not in config.ts |
| M8 | `scraper_submit.ts:19` | `"contact fudong"` in external-facing tool description — replace with support@novada.com |

---

## Architecture Violations (need separate pass)

These exist in the pre-existing src/ (search.ts, research.ts, scrape.ts, utils/, sdk/, resources/):
- `search.ts` + `research.ts` import from `extract.ts` — cross-tool dependency
- 20+ raw `throw new Error()` in scrape.ts, utils/http.ts, utils/browser.ts, utils/pdf.ts, etc.
- `scraper_result.ts`, `scraper_status.ts`: confirm both import from `_core/errors.ts` ✓

---

## PASS — confirmed clean

- 23 TOOLS array entries ↔ 23 switch cases — zero silent failures (all 4 reviewers confirmed)
- `_core/` imports: only Node builtins + zod — no tools/ or utils/ imports
- `utils/` does not import from `tools/`
- `tools/index.ts` exports all 23 tools
- Tool naming: all 23 follow `novada_{product}_{action}` pattern
- Tool descriptions: multi-sentence, with Best for / Not for, actionable
- `_core/errors.ts` agent_instruction completeness: all 10 error codes have actionable instructions
- `safeUrl` in `tools/types.ts`: thorough — blocks RFC-1918, loopback, link-local, IPv6
- `evaluate` script security: ASCII-only + network API blocklist + bracket-access blocklist
- `task_id` regex constraint in scraper_status + scraper_result + encodeURIComponent applied
- No hardcoded credentials anywhere in source
- No remaining `novada-search` string literals in `src/`

---

## Fix Priority Order (before publish)

1. S1 — remove ?apikey= query param (scraper_status + scraper_result) — 2-line fix
2. A1 — fix discover.ts catalog (names + statuses) — 15-line fix, highest agent impact
3. A3 — fix unblock.ts error propagation — remove try/catch
4. A2 — fix scraper_submit 11006 error classification
5. S2 — mask proxy credentials in format=env/curl responses
6. A4 — update --help tool count + list
7. S3 — redact raw errors in console.error
8. S4 — apply safeUrl to scraper_submit + browser_flow URLs
9. A5 — remove endpoints_tried from scraper_result unavailable response
10. M8 — replace "fudong" with support contact
