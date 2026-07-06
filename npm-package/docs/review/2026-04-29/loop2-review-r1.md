# Loop 2 Code Review — R1

## FAIL

Three issues need fixing before publish: a limit/max mismatch bug, a "Visit" wording bug that renders a broken next-steps message, and a missing test for the ZodError branch in classifyError. The remaining issues are quality concerns or observations.

---

## Critical Issues (must fix before publish)

### 1. `limit` alias allows values up to 50 but crawl.ts clamps at 20 — schema lie

`CrawlParamsSchema.limit` is defined as `z.number().int().min(1).max(50).optional()`, but `max_pages` is `z.number().int().min(1).max(20).default(5)`. In `crawl.ts` line 57:

```ts
const maxPages = Math.min(params.max_pages ?? params.limit ?? 5, 20);
```

If an agent passes `limit: 40`, schema validation passes (max=50 allows it), but the runtime silently clamps to 20. The schema description says "Alias for max_pages — use max_pages for the canonical name" but never mentions the max difference. An agent that reads the schema will think 40 pages is valid and be confused when it gets 20. Either:
- Change `limit` max to 20 to match `max_pages`, or
- Add "max 20 enforced at runtime" to the `limit` description.

This is schema documentation lying to the agent. P0 for an agent-first product.

### 2. "Visit" fix in health.ts produces broken next-steps messages for most `not_activated` cases

The fix changed line 222 from `"Go to ${r.note} to activate"` to `"Visit ${r.note} to activate"`. This looks correct for the Scraper API 11006 case where `r.note` is `"visit dashboard.novada.com/overview/scraper/ — contact support to enable Bearer token access"`. But the rendered output is:

```
- Scraper API (129 platforms): Visit visit dashboard.novada.com/overview/scraper/ — contact support to enable Bearer token access to activate
```

The word "visit" appears twice (once hardcoded in the Next Steps formatter, once embedded in the `note` string itself). This was a pre-existing issue in the `note` values that still hasn't been fixed. The fix changed the framing verb but left the `note` strings starting with lowercase "visit". One of the following must be done:
- Strip the leading "visit " from all `not_activated` note strings in the probe functions, OR
- Remove the embedded "visit" text from note values and format the URL differently.

The Search API case has the same double-verb problem: `note: "visit dashboard.novada.com/overview/scraper/ — request SERP access"` → output: "Visit visit dashboard.novada.com/...".

This renders broken text for agents reading the Next Steps section.

### 3. No new tests for ZodError branch in `classifyError()` (W2D)

The `classifyError()` function now has a `ZodError` branch (lines 369–375 of types.ts). The `classifyError` test suite in `tests/tools/types.test.ts` covers 401, 429, timeout, 503, unknown, and non-Error objects, but has zero test for `classifyError(new ZodError(...))`. This branch is reachable (any tool that rethrows Zod errors would hit it) and the behavior change is untested. Must add a test case.

---

## Quality Issues (should fix)

### 4. ZodError double-classification — harmless but architecturally sloppy

W2C handles `ZodError` in `index.ts` (lines 305–320) with a dedicated early-return path. W2D separately added a `ZodError` branch in `classifyError()` in `types.ts`. In practice the `index.ts` early-return fires first, so the `classifyError` ZodError branch is **never reached** during normal MCP server operation — it only matters if someone calls `classifyError()` directly from outside the MCP handler.

This creates dead code in the main execution path and a latent correctness risk: if someone restructures `index.ts` and removes the early-return, they'll get `INVALID_PARAMS` without the enhanced enum `values` formatting that the early-return provides. The two handlers should be consolidated. Recommendation: keep the W2C early-return (it produces better output with values enumeration) and document or remove the classifyError ZodError branch.

### 5. `nextStep` missing for `API_DOWN` and `UNKNOWN` codes

W2C added `nextStep` guidance for RATE_LIMITED, URL_UNREACHABLE, INVALID_PARAMS, and INVALID_API_KEY. API_DOWN and UNKNOWN get no `nextStep` string, so the error output ends abruptly without agent guidance. At minimum API_DOWN should say "Retry in 30 seconds; check status.novada.com." UNKNOWN is less critical but a fallback like "If this persists, contact support at support@novada.com" would help.

### 6. No new tests for alias params (limit/mode) in crawl tests

`tests/tools/crawl.test.ts` has no test passing `{ url: "...", limit: 3 }` or `{ url: "...", mode: "dfs" }` to verify the alias resolution works end-to-end. The alias logic is a one-liner and easy to break silently. Add at minimum:
- One unit test: `validateCrawlParams({ url: "https://example.com", limit: 3 })` → parses without error and `limit` field is present
- One integration test: `novadaCrawl({ url, limit: 3, mode: "dfs" }, key)` respects the alias values (maxPages=3, strategy=dfs)

### 7. No new test for `nextStep` messages in index.ts error handler

The `nextStep` injection is pure string concatenation logic. A test that triggers each classified error code through the MCP handler and asserts the correct `nextStep` suffix exists would be straightforward with the existing mock setup and is missing entirely.

---

## Minor Observations

### 8. `invalid_value` / `values` usage in index.ts — confirmed correct for Zod v4

Tested against installed `zod@4.3.6`. A failed enum parse produces `{ code: "invalid_value", values: ["a", "b"], ... }`. The `"values" in i` guard and `i.values as string[]` cast are correct. No issue.

### 9. `NovadaErrorCode` export in `tools/index.ts` — confirmed present

Line 13 of `src/tools/index.ts` exports `NovadaErrorCode` from `types.js`. The W2C re-export is correct.

### 10. `AUTH_ERROR` code — does not exist, no bug

The review brief asks whether W2C mapped `AUTH_ERROR → INVALID_API_KEY`. Looking at the code: `NovadaErrorCode` has no `AUTH_ERROR` member. The `classifyError` function maps `401/api_key/unauthorized` error messages → `INVALID_API_KEY`, and `index.ts` maps `NovadaErrorCode.INVALID_API_KEY` → the nextStep hint. No `AUTH_ERROR` reference exists anywhere. No bug.

### 11. `limit` field naming in `CrawlParamsSchema` — no cross-tool shadowing concern

`limit` appears in both `MapParamsSchema` (max=100, default=50) and `CrawlParamsSchema` (max=50, optional alias). These are entirely separate schema objects applied to different MCP tools. No shadowing issue at runtime. The concern only applies within a single schema if two fields had the same name, which they don't.

### 12. proxy.ts port parsing — correct for common cases, fragile for edge cases

```ts
const endpointParts = proxyEndpoint.split(":");
const proxyHost = endpointParts[0];
const proxyPort = endpointParts[1] ? parseInt(endpointParts[1]) : 7777;
```

For `"proxy.novada.com:8080"` → host=`"proxy.novada.com"`, port=`8080`. Correct.
For `"proxy.novada.com"` → host=`"proxy.novada.com"`, port=`7777` (default). Correct.
For `"proxy.novada.com:8080/path"` → port=`parseInt("8080/path")` = `8080`. Correct (parseInt stops at non-numeric).
For an IPv6 endpoint like `"[::1]:8080"` → host=`"[`", port=`parseInt("1]:8080/path")` = NaN. IPv6 is not a supported use case here, so this is acceptable but should be noted as a known limitation.
`parseInt` without a radix is a minor lint nit — `parseInt(s, 10)` is the standard form.

### 13. scrape.ts error 11008 message — confirmed W2C change is in place

Line 56–57 of scrape.ts shows the operation ID guidance is already appended to the 11008 message. The change is present and coherent.

### 14. health.ts "129 platforms" — confirmed W2D change is in place

Lines 104, 112, 115, 177 of health.ts all show "Scraper API (129 platforms)". The "65+ platforms" text no longer appears. The W2D change is fully applied.

---

## File-by-file Notes

**`src/tools/types.ts`**
- CrawlParamsSchema alias fields are present and described. Schema max mismatch on `limit` (50 vs 20) is the critical bug.
- ZodError branch in `classifyError()` is logically unreachable from the MCP handler path.
- No `AUTH_ERROR` in `NovadaErrorCode` — not a bug.

**`src/tools/crawl.ts`**
- Alias resolution at line 57 is correct for `max_pages`/`limit` and `strategy`/`mode`.
- `Math.min(..., 20)` is the right safety guard but creates the schema-vs-runtime mismatch.
- No tests for alias params.

**`src/index.ts`**
- Zod v4 `invalid_value`/`values` handling is correct.
- `nextStep` guidance covers 4 of 6 error codes; `API_DOWN` and `UNKNOWN` are unguided.
- ZodError early-return at line 305 makes the `classifyError` ZodError branch dead in practice.

**`src/tools/health.ts`**
- "129 platforms" update is fully applied in all 4 occurrences.
- "Visit ${r.note}" fix creates a double-verb output bug because `note` strings already start with "visit".
- No test validates the Next Steps wording for any `not_activated` case with the new verb.

**`src/tools/proxy.ts`**
- Dynamic port parsing replaces hardcoded 7777. Logic is correct for standard `host:port` format.
- Missing radix in `parseInt` is a minor nit.
- Existing proxy tests all use `proxy.example.com:7777` — a test with a non-7777 port (e.g. `:8080`) should be added to prove the dynamic parsing works.

**`src/tools/scrape.ts`**
- Error 11008 operation ID guidance is appended. Wording is clear. No issues.
