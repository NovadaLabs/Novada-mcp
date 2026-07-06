# MCP Spec Review — Agent B (novada-search v0.8.3)

### Executive Summary

novada-search v0.8.3 presents **strong agent UX fundamentals** with excellent tool descriptions, comprehensive schemas, and thoughtful error classification. However, critical gaps exist in manifest documentation, parameter inconsistencies, and error messaging that would prevent a naive LLM from succeeding on first try. The gap between implementation (11 tools, 5 prompts, 4 resources) and what the manifest declares (6 tools, 3 prompts, 3 resources) creates confusion for MCP clients and agents relying on server.json.

---

## Agent UX Issues (P0 — Agent Will Fail on First Try)

### 1. Manifest Severely Outdated — Declares Only 6/11 Tools
**Current:** 
- `server.json` lists only 6 tools: `novada_search`, `novada_extract`, `novada_crawl`, `novada_map`, `novada_research`, `novada_proxy`
- Actual implementation provides 11 tools in `src/index.ts`: adds `novada_scrape`, `novada_verify`, `novada_unblock`, `novada_browser`, `novada_health`
- Version mismatch: `package.json` is v0.8.3, `server.json` is v0.6.9

**Impact:** 
- MCP clients parsing `server.json` (Smithery, LobeHub, Claude Code settings) see only 45% of available tools
- Agents discover 5 additional tools only after introspection via `ListTools` request
- Agents may not attempt to call `novada_scrape` or `novada_browser` based on manifest
- Breaks "LobeHub Score Criteria" — manifest doesn't match implementation

**Fix:**
- Update `server.json` tools array to include all 11 tools with full descriptions
- Sync versions: `server.json` version → "0.8.3"
- Add scraper platforms to prompts: `scrape_platform_data`, `browser_stateful_workflow` are defined in code but missing from manifest
- Add `novada://scraper-platforms` resource to manifest

**Priority:** P0 — Blocks discoverability for 45% of tool surface area

---

### 2. Missing Required Parameter Descriptions in Schemas
**Current:** Several critical Zod schemas lack `.describe()` on key enum fields, forcing agents to guess intent:

- **SearchParamsSchema** — `engine` enum has no description. Agent doesn't know which engine to choose when.
- **CrawlParamsSchema** — `strategy` enum (`"bfs"` vs `"dfs"`) lacks description of traversal difference
- **ExtractParamsSchema** — `render` enum has description but it's placed on schema, not visible in generated JSON Schema

**Technical issue:** When `.describe()` is missing from enum definitions, the generated MCP JSON Schema lacks constraint documentation.

**Example:** Current schema for `engine`:
```typescript
engine: z.enum(["google", "bing", "duckduckgo", "yahoo", "yandex"]).default("google"),
```

Should be:
```typescript
engine: z.enum(["google", "bing", "duckduckgo", "yahoo", "yandex"]).default("google")
  .describe("Search engine. 'google' (default): best relevance. 'bing': market-based locale. 'duckduckgo': privacy-focused. 'yandex': Russian content."),
```

**Impact:** Agents pick first enum value or default without understanding trade-offs. For multi-engine research, LLM won't know which to choose.

**Fix:** Add `.describe()` to all enum parameters, especially:
- `SearchParamsSchema.engine`
- `CrawlParamsSchema.strategy`
- `ExtractParamsSchema.render`
- `UnblockParamsSchema.method`
- `ProxyParamsSchema.type`

---

### 3. Parameter Name Ambiguity: `method` vs `render` for Unblocking
**Current:** 
- `ExtractParamsSchema` uses `render: z.enum(["auto", "static", "render", "browser"])`
- `UnblockParamsSchema` uses `method: z.enum(["render", "browser"])`

Same functionality, different parameter names.

**Impact:** Agent trained on `novada_extract render="render"` will try `novada_unblock render="render"` and fail validation. Creates decision paralysis: "Should I use extract with render, or unblock with method?"

**Fix:** 
Option A (preferred): Rename `UnblockParamsSchema.method` → `render` for consistency
Option B: Add note in `novada_unblock` description: "Unlike extract, this tool uses `method=render|browser` not `render`"

**Priority:** P1 — Causes first-try failures when agents swap parameters

---

### 4. Error Messages Lack Agent Guidance on Retryable Errors
**Current in index.ts (lines 315–324):**
```typescript
const classified = classifyError(error);
return {
  content: [{
    type: "text" as const,
    text: `Error [${classified.code}]: ${classified.message}${classified.retryable ? "\n(This error is retryable)" : ""}${classified.docsUrl ? `\nDocs: ${classified.docsUrl}` : ""}`,
  }],
  isError: true,
};
```

**Problem:** Error messages don't tell agents WHAT TO DO NEXT:
- On `RATE_LIMITED`: Should agent exponential backoff? How long to wait?
- On `URL_UNREACHABLE`: Should agent try with `render="render"`? Or skip?
- On `INVALID_PARAMS`: Message shows path names but not valid values (e.g., "field 'render' is invalid" — doesn't say valid values are ["auto", "static", "render", "browser"])

Example Zod error handling (line 309):
```typescript
const issues = error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
```

This produces: `render: Invalid enum value`, not the enum options.

**Fix:**
1. **Retryable errors:** Add retry guidance: "Wait 30 seconds before retrying" or "Try with different parameters"
2. **Parameter errors:** Append valid values from schema to Zod error message
3. **URL errors:** Suggest escalation: "Try with render='render' for JS-heavy sites" or "Use novada_map to find correct URL"

**Priority:** P1 — Agents waste retries on non-retryable errors or give up too early

---

### 5. Browser Tool Missing Critical Guidance on Wait-Until Modes
**Current:** `novada_browser` description mentions avoiding `networkidle` for SPAs — but this is in tool description, not in parameter `.describe()` for the `wait_until` field.

**Impact:** First-time agent passes `wait_until="networkidle"` on Twitter/TikTok → 30s timeout → classified as retryable → agent retries 3x (90s wasted).

**Fix:** Update BrowserActionSchema navigate action:
```typescript
wait_until: z.enum(["load", "domcontentloaded", "networkidle"])
  .default("domcontentloaded")
  .describe("Page load event. Default 'domcontentloaded' for all sites including SPAs (Twitter, TikTok). NEVER use 'networkidle' for SPAs — they continuously poll, timeout after 30s."),
```

---

## Agent UX Issues (P1 — Agent Will Struggle or Make Wrong Choices)

### 6. Scraper API Platform List Is Huge — Agents Can't Memorize Operation IDs
**Current:** `novada://scraper-platforms` resource contains 129 platforms with 300+ operation IDs. 

**Problem:** Agents hallucinate operation IDs after first call. Error response doesn't tell agent to re-read resource.

**Fix:**
1. Add to `novada_scrape` description: "**Always check `novada://scraper-platforms` resource before calling** — operation IDs are exact and cannot be guessed."
2. Add to error message: "Unknown operation. Read `novada://scraper-platforms` for the correct operation ID."

---

### 7. Time Range vs Date Range Confusion in Search
**Current:** `SearchParamsSchema` has `time_range` (enum) + `start_date` + `end_date` (strings). No description of mutual exclusivity.

**Fix:** Add to `time_range`:
```typescript
.describe("Relative time window. Mutually exclusive with start_date/end_date. 'day'=last 24h, 'week'=last 7 days, 'month'=last 30 days, 'year'=last 12 months.")
```
Add to `start_date`/`end_date`: "Absolute date filtering. Overrides time_range if both provided."

---

### 8. Browser Session Management Lacks Clarity on Expiry
**Problem:** Agent doesn't know if 10-min timeout is since creation or since last activity. No error message guides "session expired, create new one without session_id".

**Fix:**
1. Tool description: "Sessions persist across calls with same `session_id`. 10-min inactivity timeout since last action."
2. Add expected error message: "Session [session_id] expired. Use new call without session_id to start fresh."

---

### 9. Extract `query` Parameter Lacks Usage Examples
**Current description:** "Optional query for relevance context. Helps the calling agent focus on relevant sections."

**Problem:** Agent doesn't know if this affects extraction or just post-processing.

**Fix:**
```typescript
query: z.string().optional()
  .describe("Optional search term to focus extraction on relevant sections. E.g., 'pricing' extracts pricing-related content preferentially. Does not filter extraction — full page is always returned."),
```

---

### 10. Crawl `select_paths` Regex Syntax Not Documented
**Problem:** Agent may try Glob syntax (`/docs/**`) or URL patterns that don't work. No mention of anchoring.

**Fix:**
```typescript
.describe("Array of regex patterns matching URL paths (not full URLs). Use '.*' for wildcards, not '**'. E.g., ['^/docs/', '^/api/'] to crawl only /docs and /api paths."),
```

---

### 11. Missing Render Mode Selection Guide Resource
**Gap:** No resource explaining when to use `render="auto"` vs `"static"` vs `"render"` vs `"browser"`.

**Fix:** New resource `novada://render-modes` covering all four modes with decision tree:
- static → fastest, fails on JS-heavy
- auto → tries static first, escalates
- render → full JS via Web Unblocker (needs NOVADA_WEB_UNBLOCKER_KEY)
- browser → full Chromium CDP (needs NOVADA_BROWSER_WS)

**Priority:** P1 — Agents make wrong escalation choices

---

### 12. Proxy Tool Status Not Reported by novada_health
**Problem:** Agent calls `novada_proxy` → error "env var missing" → can't tell if product inactive or misconfigured.

**Fix:** Update `novada_health` to include Proxy API status. Add to proxy error: "Check novada_health for Proxy product status."

---

## Consistency Issues

### 13. Output Format Inconsistency Across Tools
- `novada_search`: Returns markdown with "## Search Results" + "## Agent Hints" footer
- `novada_extract`: Returns raw markdown/text content
- `novada_scrape`: Returns markdown table or JSON array

**Fix:** Define standard output wrapper:
```
## Tool Result: [tool_name]
[content]
## Next Steps
[suggestions for agent]
```

**Priority:** P2

---

## LobeHub Gaps

### 14. Server Manifest Incomplete for LobeHub Marketplace
**Current state:**
- Declares 6/11 tools (missing: scrape, verify, unblock, browser, health)
- Declares 3/5 prompts (missing: scrape_platform_data, browser_stateful_workflow)
- Declares 3/4 resources (missing: novada://scraper-platforms)
- Version mismatch: manifest=0.6.9 vs package.json=0.8.3

**Fix:** Full `server.json` sync — all 11 tools, 5 prompts, 4 resources, version 0.8.3.

---

### 15. Skill SKILL.md References Only 5 Tools, Outdated
**Current:** `/skills/novada-agent/SKILL.md` says "You have access to 5 Novada MCP tools."

**Fix:** Update to document all 11 tools with same detail as the 5 legacy tools.

---

## Resources/Prompts Quality

**Strengths (no changes needed):**
- `novada://guide` resource: exemplary agent documentation with decision trees, common mistakes, failure recovery
- All 5 prompts: well-written, teach proper tool composition patterns

---

## Summary

### Critical Issues (P0 — Must Fix Before Release)
1. **Server manifest 2 versions behind** — 6/11 tools declared → breaks discoverability
2. **Missing enum descriptions** — agents can't choose between search engines or render modes
3. **Parameter name inconsistency** (`method` vs `render`) — validation failures on tool swap

### High-Priority Issues (P1)
4. Error messages lack "next steps" guidance
5. Browser session expiry semantics unclear
6. Scraper operation ID error doesn't reference the resource
7. Time range vs date range conflict undocumented
8. Render modes selection guide resource missing
9. Extract query parameter poorly documented
10. Crawl select_paths regex syntax unclear
11. Proxy status not reported by health tool

### Medium-Priority Issues (P2)
12. Output format inconsistency across tools
13. No tool for "find + read" workflows

---

### Estimated Effort

**P0 fixes (5 hours):**
- server.json full sync: all 11 tools, 5 prompts, 4 resources, version 0.8.3 (1h)
- Add enum .describe() to all schemas (2h)
- Document or rename `method` → `render` in UnblockParamsSchema (0.5h)
- Update SKILL.md for all 11 tools (1h)
- Update error messages with agent guidance (0.5h)

**P1 fixes (8 hours):**
- Add novada://render-modes resource (2h)
- Clarify time_range vs date_range (0.5h)
- Document browser session expiry semantics + error (1h)
- Add scraper operation ID error guidance (0.5h)
- Fix extract query description + crawl select_paths (0.5h)
- Add proxy status to novada_health (2h)
- Add render mode selection guidance to tool descriptions (1.5h)

---

*Report generated: 2026-04-29 | Reviewer: Agent B (MCP Spec) | Codebase: novada-search v0.8.3*
