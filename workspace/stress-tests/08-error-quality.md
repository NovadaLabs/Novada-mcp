# 08 — Error Quality Audit: `agent_instruction` Coverage

**Date:** 2026-06-26
**Scope:** Trigger every reachable error path in novada-mcp tools and verify each error response contains `agent_instruction` (or equivalent agent guidance like `Agent Hints`, `suggested_fix`, `suggested_alternatives`).

---

## Architecture Summary

Error handling follows a 3-layer design:

| Layer | Mechanism | `agent_instruction` source |
|-------|-----------|---------------------------|
| **L1: NovadaError** | `makeNovadaError()` / `new NovadaError()` — typed errors with code, message, agent_instruction | Built-in per `NovadaErrorCode` in `src/_core/errors.ts` |
| **L2: classifyError()** | Catches raw `Error` / `AxiosError` / `ZodError` at the MCP handler boundary (`src/index.ts:891-918`) and maps to `NovadaError` | Pattern-matched from error message keywords |
| **L3: Soft errors** | Tools return error info as a successful string response (no throw) — e.g. `## Extract Failed`, `SERP_UNAVAILABLE` | Must be embedded in the response string by each tool |

The MCP handler (`src/index.ts:771-919`) wraps all tool calls: thrown errors hit L2 (`classifyError()`), ZodErrors get a dedicated handler, and NovadaErrors pass through. All three paths produce `agent_instruction`.

---

## Test Results

### Wave 1 — Core Tools (extract, search, scrape)

| # | Test Case | Error Type | Layer | Has agent_instruction | Verdict |
|---|-----------|-----------|-------|----------------------|---------|
| 1 | `extract: nonexistent domain` | Soft error (string) | L3 | Yes (`agent_instruction`, `suggested_fix`, `Agent Hints`) | PASS |
| 2 | `extract: render mode on example.com` | Success (low quality) | L3 | Yes (`agent_instruction` in Agent Action block) | PASS |
| 3 | `scrape: invalid operation (fake_op)` | `NovadaError(PRODUCT_UNAVAILABLE)` | L1 | Yes | PASS |
| 4 | `search: bad API key` | `NovadaError(INVALID_API_KEY)` | L1 | Yes | PASS |
| 5 | `extract: bad API key` | Success (static fetch bypasses proxy) | L3 | Yes (`agent_instruction` in Agent Action) | PASS |
| 6 | `extract: >10 URLs` | `NovadaError(INVALID_PARAMS)` | L1 | Yes | PASS |
| 7 | `scrape: unknown platform (fakeplat.xyz)` | `NovadaError(INVALID_PARAMS)` | L1 | Yes | PASS |
| 8 | `search: yahoo engine` | Soft error (`YAHOO_UNAVAILABLE`) | L3 | Yes (`suggested_alternatives`) | PASS |
| 9 | `search: unknown engine (altavista)` | Soft error (`SERP_UNAVAILABLE`) | L3 | **No** | **FAIL** |
| 10 | `extract: empty string URL` | Soft error (string) | L3 | Yes (`agent_instruction`, `suggested_fix`) | PASS |
| 11 | `extract: batch with 1 broken URL` | Soft error (string) | L3 | Yes (`Agent Hints`, `suggested_fix`) | PASS |

### Wave 2 — Extended Tools (map, crawl, browser, scraper_status/result)

| # | Test Case | Error Type | Layer | Has agent_instruction | Verdict |
|---|-----------|-----------|-------|----------------------|---------|
| 12 | `map: invalid URL` | `NovadaError(INVALID_PARAMS)` | L1 | Yes | PASS |
| 13 | `crawl: invalid URL` | `NovadaError(INVALID_PARAMS)` | L1 | Yes | PASS |
| 14 | `scraper_status: fake task_id` | Success (with `agent_instruction`) | L3 | Yes | PASS |
| 15 | `scraper_result: fake task_id` | Success (with `agent_instruction`) | L3 | Yes | PASS |
| 16 | `browser: no NOVADA_BROWSER_WS` | Soft error (string) | L3 | **No** | **FAIL** |
| 17 | `browser_flow: API unavailable` | Soft error (string) | L3 | Yes (`agent_instruction`) | PASS |
| 18 | `crawl: nonexistent domain` | `NovadaError(URL_UNREACHABLE)` | L2 | Yes | PASS |

### Wave 3 — Validation Errors (ZodError)

| # | Test Case | Error Type | Layer | Has agent_instruction | Verdict |
|---|-----------|-----------|-------|----------------------|---------|
| 19 | `extract: missing url` | ZodError | L2 | Yes (via `classifyError()`) | PASS |
| 20 | `extract: bad format` | ZodError | L2 | Yes (via MCP handler) | PASS |
| 21 | `search: missing query` | ZodError | L2 | Yes (via MCP handler) | PASS |
| 22 | `scrape: missing platform` | ZodError | L2 | Yes (via MCP handler) | PASS |
| 23 | `crawl: bad render value` | ZodError | L2 | Yes (via MCP handler) | PASS |
| 24 | `map: missing url` | ZodError | L2 | Yes (via MCP handler) | PASS |

### Source Code Audit — Additional Error Paths (not runtime-tested)

| Error Path | File:Line | Has agent_instruction | Notes |
|------------|-----------|----------------------|-------|
| `browser: close_session without session_id` | `browser.ts:34` | **No** — bare string `"Error: close_session requires a session_id parameter."` | **FAIL** |
| `browser: playwright-core missing` | `browser.ts:86-91` | **No** — bare string | **FAIL** |
| `browser: invalid wsEndpoint format` | `browser.ts:144` | Yes (NovadaError) | PASS |
| `browser: wsEndpoint missing credentials` | `browser.ts:150` | Yes (NovadaError) | PASS |
| `unblock: render-failed mode` | `unblock.ts:39-40` | Yes (`agent_instruction` in hints) | PASS |
| `search: SERP_UNAVAILABLE (non-scraper engine)` | `search.ts:323-333` | **No** | **FAIL** |
| `search: AxiosError catch` | `search.ts:444-445` | **No** — returns `SERP_UNAVAILABLE` which lacks `agent_instruction` | **FAIL** |
| `scrape: HTTP 401/403` | `scrape.ts:277-278` | No (bare Error) — but L2 `classifyError()` catches "401" keyword | PASS (via L2) |
| `scrape: all results failed (INC-190)` | `scrape.ts:331-340` | No (bare Error) — but L2 catches it | PASS (via L2) |
| `research: search unavailable` | `research.ts:219` | Yes (`agent_instruction`) | PASS |
| `map: SPA no URLs found` | `map.ts:34-52` | Yes (`Agent Hints`) | PASS |
| `crawl: 0 pages crawled` | `crawl.ts:196-205` | Yes (NovadaError) | PASS |

---

## Summary

```
Total error paths audited:  30+
Runtime-tested:             24
Source-code-audited only:   ~12

Passed:  24 / 30  (80%)
Failed:   6 / 30  (20%)
```

---

## Failures Detail

### FAIL 1 — `search: SERP_UNAVAILABLE` (unknown engine + AxiosError catch)

**File:** `src/tools/search.ts:323-333, 392-394, 444-445`

**What happens:** When an unsupported engine is used (e.g., `altavista`) or when `SCRAPER_SEARCH_ENGINES.has(engine)` is false, the function returns the `SERP_UNAVAILABLE` constant. This constant contains `## Search Unavailable` and alternatives, but NO `agent_instruction` field.

Same constant is returned when the scraper-API catch block hits an AxiosError (line 444-445).

**Response returned:**
```
## Search Unavailable

The Novada SERP endpoint is not yet available for this API key.
...
**Alternatives right now:**
- `novada_extract` — fetch and read any specific URL directly
...
```

**Fix:** Add an `agent_instruction` line to `SERP_UNAVAILABLE`:
```
agent_instruction: Search endpoint unavailable. Use novada_extract to read specific URLs, novada_research for multi-source investigation, or novada_map + novada_extract for site-specific content.
```

### FAIL 2 — `browser: not configured` (no NOVADA_BROWSER_WS)

**File:** `src/tools/browser.ts:64-78`

**What happens:** When `NOVADA_BROWSER_WS` is not set, the tool returns a setup guide but no `agent_instruction`.

**Fix:** Add `agent_instruction` to the response:
```
agent_instruction: NOVADA_BROWSER_WS not set. Use novada_extract (handles most pages automatically), novada_unblock (anti-bot bypass), or novada_browser_flow (cloud browser) as alternatives that don't require NOVADA_BROWSER_WS.
```

### FAIL 3 — `browser: playwright-core missing`

**File:** `src/tools/browser.ts:86-91`

**What happens:** Returns a bare string asking to install playwright-core, no `agent_instruction`.

**Fix:** Add `agent_instruction`:
```
agent_instruction: playwright-core not installed. Use novada_browser_flow (cloud browser, no local dependencies) or novada_extract/novada_unblock as alternatives.
```

### FAIL 4 — `browser: close_session without session_id`

**File:** `src/tools/browser.ts:34`

**What happens:** Returns bare string `"Error: close_session requires a session_id parameter."` — no `agent_instruction`.

**Fix:** Return structured response:
```
agent_instruction: close_session requires session_id. Call list_sessions first to see active session IDs, then pass one to close_session.
```

---

## Error Path Coverage by Tool

| Tool | Thrown Errors | Soft Errors | All Have agent_instruction |
|------|-------------|-------------|---------------------------|
| novada_extract | 3 (NovadaError) | 3 (string) | Yes |
| novada_search | 2 (NovadaError) | 3 (string) | **No** (SERP_UNAVAILABLE) |
| novada_scrape | 4 (NovadaError) + 6 (Error→L2) | 1 (string) | Yes (via L1+L2) |
| novada_crawl | 3 (NovadaError) | 0 | Yes |
| novada_map | 2 (NovadaError) | 1 (string) | Yes |
| novada_browser | 2 (NovadaError) | 3 (string) | **No** (3 soft errors missing) |
| novada_browser_flow | 4 (NovadaError) | 1 (string) | Yes |
| novada_unblock | 0 (throws→L2) | 1 (string) | Yes |
| novada_verify | 0 | 0 | Yes |
| novada_research | 0 | 1 (string) | Yes |
| novada_scraper_* | 3+ (NovadaError) | 5+ (string) | Yes |
| ZodError (all tools) | via L2 classifyError | n/a | Yes |

---

## Recommendations

1. **P0 — Fix `SERP_UNAVAILABLE` constant** (`search.ts:323`): Add `agent_instruction` line. This is the most common error path for search failures and currently gives agents no structured next-step guidance.

2. **P1 — Fix `browser.ts` soft errors** (lines 34, 64-78, 86-91): Add `agent_instruction` to all three "not configured" / "missing dependency" / "missing param" responses. These are configuration errors that agents encounter on first use.

3. **P2 — Consider wrapping `SERP_UNAVAILABLE` returns with `isError: true`**: Currently these return as successful MCP responses (no `isError` flag), so agents may not realize the search failed. The `YAHOO_UNAVAILABLE` constant has the same issue but at least includes `suggested_alternatives`.

4. **Defensive pattern**: All L3 (soft error) responses should include at minimum:
   - A `## Agent Hints` section with alternatives
   - An `agent_instruction:` line with structured next-step guidance
   - This matches the pattern already used by extract, crawl, map, research, and scraper_* tools

---

## Architecture Strength

The 3-layer error system is well-designed:
- **L1 (NovadaError)**: 12 error codes, each with a multi-line `agent_instruction` template. All `makeNovadaError()` calls automatically get the right instruction.
- **L2 (classifyError)**: Catches bare `Error` throws at the MCP boundary via keyword matching. This is the safety net — even tools that throw plain `Error` get `agent_instruction`.
- **L3 (soft errors)**: Tools that return error info as strings must embed their own guidance. This is where the 6 failures occur — the pattern is inconsistent across tools.

The `sanitizeServerMsg()` function properly strips API keys, injection patterns, and markdown headings from server error messages before surfacing them — good security practice.
