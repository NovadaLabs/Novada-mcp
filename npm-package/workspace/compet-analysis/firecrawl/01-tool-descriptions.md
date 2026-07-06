# Firecrawl MCP Server — Competitive Analysis
## Tool Descriptions, Error Handling, and Agent UX Patterns

**Source analyzed:** `mendableai/firecrawl-mcp-server` (main branch, 2025-06)
**Files:** `src/index.ts` (2470 lines), `src/research.ts` (475 lines), `src/monitor.ts` (574 lines)
**Compared against:** `novada-mcp` `src/index.ts` + `src/tools/`

---

## 1. Tool Description Architecture

### Firecrawl's pattern

Every tool description follows a strict template:

```
[One-liner superlative]

**Best for:** ...
**Not recommended for:** ...
**Common mistakes:** ...
[Optional: **CRITICAL — ...** for high-stakes decisions]
**Prompt Example:** ...
**Usage Example:**
```json { ... } ```
**Returns:** ...
```

The structure is **prescriptive, not descriptive**. Instead of explaining what the tool does, it tells the agent exactly when to pick it versus alternatives. This is a deliberate choice — Firecrawl's descriptions act as a routing table across the tool suite.

### Novada's pattern

Novada's current format:

```
[Short use-case sentence]. [Capability claim].

**Use for:** ...
**Not for:** ...
**Key rule:** ...
```

Novada is shorter and more imperative ("Use when", "Not for"), but lacks:
- `**Common mistakes:**` sections (prevents agent footguns)
- JSON Usage Examples embedded in the description
- `**Prompt Example:**` (natural language example for the agent's context)
- `**Returns:**` terminal line summarizing the output shape

---

## 2. The `firecrawl_scrape` Description — Word for Word

This is the single most important tool in both MCPs. Full text:

```
Scrape content from a single URL with advanced options.
This is the most powerful, fastest and most reliable scraper tool, if available you should always default to using this tool for any web scraping needs.

**Best for:** Single page content extraction, when you know exactly which page contains the information.
**Not recommended for:** Multiple pages (call scrape multiple times or use crawl), unknown page location (use search).
**Common mistakes:** Using markdown format when extracting specific data points (use JSON instead).
**Other Features:** Use 'branding' format to extract brand identity (colors, fonts, typography, spacing, UI components) for design analysis or style replication.

**CRITICAL - Format Selection (you MUST follow this):**
When the user asks for SPECIFIC data points, you MUST use JSON format with a schema. Only use markdown when the user needs the ENTIRE page content.

**Use JSON format when user asks for:**
- Parameters, fields, or specifications (e.g., "get the header parameters", "what are the required fields")
- Prices, numbers, or structured data (e.g., "extract the pricing", "get the product details")
- API details, endpoints, or technical specs (e.g., "find the authentication endpoint")
- Lists of items or properties (e.g., "list the features", "get all the options")
- Any specific piece of information from a page

**Use markdown format ONLY when:**
- User wants to read/summarize an entire article or blog post
- User needs to see all content on a page without specific extraction
- User explicitly asks for the full page content
```

Key observations:
- **"you MUST follow this"** — directive language treating the agent as an executor with constraints
- The CRITICAL section is a complete decision tree, not guidance
- Firecrawl embeds full JSON examples with proper `{ "name": "firecrawl_scrape", "arguments": {...} }` wrappers inside the description text — the agent can copy-paste these

### Novada equivalent (`novada_extract`)

```
Extract clean content from any URL. Handles Cloudflare, DataDome, Kasada automatically via auto-escalation (static → JS render → Browser CDP). Batch mode: pass url as array for up to 10 pages in parallel.

**Use for:** Reading pages, batch-extracting search results, pulling structured fields (price, author, date). Works on anti-bot pages automatically.
**Not for:** URL discovery (novada_map), multi-page crawl (novada_crawl), platform data like Amazon/LinkedIn (novada_scrape is richer).
**Key rule:** Leave render="auto" (default). Only set render="render" for known JS-heavy SPAs. Auto mode is 15-100x faster on static sites.
```

**Gap:** Novada's description focuses on what it does (auto-escalation, anti-bot) but gives no format selection decision tree. An agent calling `novada_extract` with a request to "get the product price" has no guidance to use `fields=["price"]` vs just reading markdown. Firecrawl explicitly prevents this mistake.

---

## 3. JS-Rendering / Anti-Bot Strategy

### Firecrawl's approach

Firecrawl uses a **step-by-step escalation ladder** embedded in the description:

```
**Handling JavaScript-rendered pages (SPAs):**
If JSON extraction returns empty, minimal, or just navigation content, the page is likely JavaScript-rendered...
Try these steps IN ORDER:
1. **Add waitFor parameter:** Set `waitFor: 5000` to `waitFor: 10000`
2. **Try a different URL:** If the URL has a hash fragment (#section)...
3. **Use firecrawl_map to find the correct page:** Large documentation sites...
4. **Use firecrawl_agent:** As a last resort for heavily dynamic pages...
```

The agent gets a named decision tree for the most common failure mode (SPA rendering). Steps 3 and 4 route to sibling tools — this is cross-tool orchestration guidance inside a single tool description.

### Novada's approach

Novada handles this at the **implementation level** (auto-escalation: static → render → browser) but exposes it only as a brief flag explanation:

```
**Key rule:** Leave render="auto" (default). Only set render="render" for known JS-heavy SPAs.
```

No step-by-step ladder. The agent may not know that getting empty content means it should try `render="render"` vs `render="browser"` vs switching to `novada_unblock`. The actual escalation logic lives in `extract.ts` at runtime; agents can't see that.

**Advantage Firecrawl has:** Makes the escalation strategy visible to the agent at decision time, not buried in implementation.

**Novada's advantage:** Auto-escalation means agents don't need to think about this in the first place — but this is only true when the auto-detection works correctly. When it silently falls back to lower quality, the agent has no signal.

---

## 4. Error Handling Patterns

### Firecrawl's error approach

Firecrawl's errors are simple TypeScript `throw new Error(message)` strings. For feedback/search errors, it returns structured JSON objects:

```typescript
return asText({
  success: false,
  status: response.status,
  feedbackErrorCode: parsed?.feedbackErrorCode,
  error: parsed?.error ?? `HTTP ${response.status}`,
  retryable: response.status >= 500,
});
```

Key pattern: `retryable: response.status >= 500` — a single boolean that tells the agent whether to retry. The decision logic is exposed in the response, not just the message string.

In the tool description for `firecrawl_search_feedback`:
```
**Time window:** Feedback must be submitted within ~2 minutes of the search. Beyond that, the call returns HTTP 409 with `feedbackErrorCode: "FEEDBACK_WINDOW_EXPIRED"` — do not retry, just move on. Same goes for any 4xx response: do not retry-loop.
```

Firecrawl pre-trains agents on specific error codes (`FEEDBACK_WINDOW_EXPIRED`) and their handling in the description itself, before the agent ever encounters them.

### Novada's error approach

Novada has a significantly more sophisticated error system:

```typescript
export class NovadaError extends Error {
  readonly code: NovadaErrorCode;       // e.g. INVALID_API_KEY
  readonly agent_instruction: string;   // full recovery steps
  readonly retryable: boolean;
  readonly detail?: string;

  toAgentString(): string {
    return [
      `Error [${this.code}]: ${safeMsg}`,
      `failure_class: ${failureClass}`,  // transient | permanent | auth | quota
      `retry_recommended: ${this.retryable}`,
      `retry_after_ms: ${retryAfter}`,   // concrete wait time
      `agent_instruction: "${this.agent_instruction}"`,
    ].join("\n");
  }
}
```

Novada classifies errors into `transient | permanent | auth | quota` and provides `retry_after_ms` with concrete wait times. The `agent_instruction` field contains full recovery steps.

Additionally, `novada_extract` returns inline `suggested_fix` per URL in batch mode:

```typescript
const fix = getSuggestedFix(url, message);
return { i, url, content: `Error: ${message}\n${fix}`, ok: false };

// Per-domain routing:
if (host === "amazon.com") return `suggested_fix: try novada_scrape(platform="amazon.com", ...)`;
if (host === "x.com") return `suggested_fix: try novada_scrape(platform="x.com", ...)`;
```

**Verdict:** Novada's error system is more structured than Firecrawl's. Firecrawl's advantage is that error handling guidance is embedded in tool descriptions upfront — agents see it before failures happen. Novada's advantage is runtime error quality.

---

## 5. Parameter Naming Conventions

### Firecrawl

- `camelCase` throughout: `waitFor`, `onlyMainContent`, `maxDiscoveryDepth`, `allowExternalLinks`
- Schema: Zod `z.object({})` with `.optional()` — minimal constraints
- Domain validation with explicit regex: `searchDomainSchema = z.string().regex(/^(?:[a-z0-9]...)/)`
- Parameter descriptions go in the tool description text, not `.describe()` on the schema fields
- Output schema has `z.record(z.string(), z.any())` for flexible JSON extraction

### Novada

- Also `camelCase`: `render`, `max_pages`, `select_paths`, `enrich_top`
- Mix of conventions: some tools use `snake_case` params (`max_pages`, `select_paths`) in schemas
- `.describe()` on Zod fields for params: `z.string().describe("Optional query for relevance context")`
- Schema validation is stricter: `z.string().url()`, `z.enum(["auto","static","render","js","browser"])`

**Inconsistency to fix:** Novada has `snake_case` params in some tools (`max_pages`, `select_paths`, `render`) and `camelCase` in others. Firecrawl is uniformly camelCase. This matters because LLM agents pattern-match across tools — inconsistency increases errors.

---

## 6. Output Format Strategy

### Firecrawl

Formats as an enum with rich options:
```typescript
z.enum(["markdown", "html", "rawHtml", "screenshot", "links", "summary",
        "changeTracking", "branding", "json", "query", "audio"])
```

Notably: `branding` format — extracts brand identity (colors, fonts, UI components). This is a differentiated feature with no equivalent in novada-mcp.

JSON output is explicitly promoted over markdown for data extraction — the tool description has a full section forcing this decision.

### Novada

```typescript
z.enum(["text", "markdown", "html", "json"])
```

Fewer formats but cleaner defaults. No equivalent to Firecrawl's `branding` or `audio` formats.

---

## 7. Feedback Loop Tools — A Major Differentiator

Firecrawl has two tools with no equivalent in novada-mcp:
- `firecrawl_search_feedback` — rate a search result and get 1 credit refund
- `firecrawl_feedback` — rate any scrape/parse/map job

This is a **flywheel mechanism built into the MCP itself**. Every search tool call is immediately followed (per description) by a feedback call. The description literally says:

```
**After the search:** Once you have processed the results (or decided they were not useful),
call `firecrawl_search_feedback` with the `id` from this response. The first feedback per
search refunds 1 credit and helps Firecrawl improve search quality.
```

The credit refund creates an incentive for agents to always call it. This generates training data on what LLM agents actually find useful from searches — at scale, across all users.

**Strategic implication for Novada:** No equivalent exists. Adding `novada_search_feedback` with even a token incentive (0.1 credit refund, nothing) would generate valuable agent-usage data and provide a quality signal for search ranking improvements.

---

## 8. Async Job Pattern

### Firecrawl's agent tool pattern

`firecrawl_agent` (async research agent) has explicit polling guidance:

```
**IMPORTANT - Async workflow with patient polling:**
1. Call `firecrawl_agent` with your prompt/schema → returns job ID immediately
2. Poll `firecrawl_agent_status` with the job ID to check progress
3. **Keep polling for at least 2-3 minutes** - agent research typically takes 1-5 minutes
4. Poll every 15-30 seconds until status is "completed" or "failed"
5. Do NOT give up after just a few polling attempts - the agent needs time to research

**Expected wait times:**
- Simple queries with provided URLs: 30 seconds - 1 minute
- Complex research across multiple sites: 2-5 minutes
- Deep research tasks: 5+ minutes
```

Critically: the companion `firecrawl_agent_status` description reinforces this:
```
- processing: Agent is still researching - keep polling, do not give up
- completed: Research finished - response includes the extracted data
- failed: An error occurred (only stop polling on this status)
```

The possible statuses are documented with explicit "do not give up" / "keep polling" instructions per status value. This prevents premature polling abandonment.

### Novada's async scraper pattern

`novada_scraper_submit` + `novada_scraper_status` + `novada_scraper_result` follow the same 3-tool pattern. Description:

```
**Next step:** After calling this tool, use novada_scraper_status with the returned task_id to check progress.
```

`novada_scraper_status` description:
```
**Complete:** Call novada_scraper_result with the same task_id to retrieve formatted data.
**agent_instruction:** Each response includes the next action to take — always follow it.
```

Novada embeds `next_action` in the response payload itself, whereas Firecrawl documents the status values. Both approaches work; Novada's is more structured because the LLM sees it at runtime, not just at description-read time.

---

## 9. Tool Annotations (MCP Metadata)

Firecrawl uses MCP `annotations` on every tool:

```typescript
annotations: {
  title: 'Scrape a URL',
  readOnlyHint: SAFE_MODE,    // true in cloud safe mode
  openWorldHint: true,        // operates on public web URLs
  destructiveHint: false,     // does not modify external sites
}
```

Every Firecrawl tool has `readOnlyHint`, `openWorldHint`, `destructiveHint` set. These map to MCP's optional tool annotations spec and help clients display tools appropriately.

Novada also uses annotations:
```typescript
annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true }
```

Novada adds `idempotentHint` which Firecrawl doesn't use. Both are correct; Novada's annotation set is slightly richer.

---

## 10. Cross-Tool Navigation — Routing Tables

The strongest pattern in Firecrawl's descriptions is explicit **cross-tool routing**. Every "Not recommended for" has a named alternative:

- `firecrawl_scrape` → "Multiple pages (use crawl)"
- `firecrawl_map` → "use scrape after mapping"
- `firecrawl_search` → "already know which website to scrape (use scrape)"
- `firecrawl_crawl` → "single page (use scrape instead)"

This creates a complete routing graph in the description text. An agent reading any one tool's description can infer which other tool to use without needing to read all descriptions.

Novada does this too, but less consistently:
- `novada_extract` → "URL discovery (novada_map), multi-page crawl (novada_crawl)"
- `novada_crawl` → "Single-URL extraction — use novada_extract"
- `novada_scrape` → "General web pages (use novada_extract)"

The proxy tools are missing cross-routing. `novada_proxy` says "Specialized tools: use novada_proxy_residential..." but doesn't explain *when* to escalate from datacenter → ISP → residential.

---

## 11. Notable Differences Summary

| Dimension | Firecrawl | Novada | Gap |
|---|---|---|---|
| Description length | Very long (100-200 lines for scrape) | Shorter (10-30 lines) | FC embeds full examples; Novada is more concise |
| Format decision trees | Yes — CRITICAL sections with MUST rules | No | Novada agents may use wrong format |
| JS rendering guidance | 4-step escalation ladder in description | 1 key rule + runtime auto-detection | FC teaches agents; Novada handles silently |
| Error feedback tools | `firecrawl_search_feedback` + `firecrawl_feedback` | None | No feedback flywheel in Novada |
| Error structure | Simple throw + `retryable` in response | Full NovadaError class + `agent_instruction` | Novada is more structured |
| Async polling | Explicit wait times + "do not give up" | `next_action` in response payload | Different approaches, both effective |
| Branding format | Yes (`branding`) | No | Differentiated feature |
| Parameter consistency | Uniform camelCase | Mixed camelCase/snake_case | Novada has inconsistency |
| Cross-tool routing | Complete routing graph | Partial — proxy tools under-documented | Novada has gaps |
| Usage examples in descriptions | Yes — full JSON blocks | No — descriptions are prose only | FC gives copy-paste examples |

---

## 12. Recommendations for Novada-MCP

Prioritized by impact:

### P0 — Format Selection Decision Trees
Add CRITICAL sections to `novada_extract` (and `novada_scrape`) that teach agents when to use `fields=[...]` vs markdown vs JSON format. The absence of this guidance causes the most common agent error: getting full markdown when a single field was needed.

```
**CRITICAL - Output Format Selection:**
When extracting SPECIFIC data points (price, author, date, availability):
  → Pass fields=["price", "availability"] — returns structured ## Requested Fields block
When reading an entire article or page:
  → Use format="markdown" (default) — returns full cleaned content
When building a pipeline that needs typed values:
  → Use format="json" — returns structured JSON object
```

### P1 — JS Rendering Escalation Ladder
In `novada_extract` description, add a step-by-step guide matching Firecrawl's pattern. Auto-escalation is good, but agents don't know it's happening or when to force a specific mode.

### P2 — Fix Parameter Case Inconsistency
`max_pages`, `select_paths`, `enrich_top` (snake_case) vs `waitFor`, `onlyMainContent` (camelCase). Pick one convention. camelCase is more consistent with the rest of the MCP ecosystem.

### P3 — Add `suggested_fix` to More Error Paths
`novada_extract` already does per-URL suggested_fix. Extend this pattern to `novada_scrape` failures and `novada_crawl` failures. The per-domain routing hints (`amazon.com → novada_scrape`) are particularly valuable.

### P4 — Consider Feedback Tools
`novada_search_feedback` — even a minimal version with no credit incentive — would generate signal on search quality from real agent sessions. Firecrawl uses this to measure and improve ranking.

### P5 — Proxy Escalation Routing
The 6 proxy tools (`residential`, `isp`, `datacenter`, `mobile`, `static`, `dedicated`) lack a clear "when to escalate" path. Add to each description:
```
**Escalation:** blocked on datacenter → try isp → try residential (strongest anti-bot)
```

---

## Appendix: Firecrawl Tool Inventory (as of 2025-06)

**Core scraping** (src/index.ts):
- `firecrawl_scrape` — single URL extraction
- `firecrawl_map` — URL discovery
- `firecrawl_search` — web search
- `firecrawl_crawl` — multi-page crawl
- `firecrawl_check_crawl_status` — async crawl polling
- `firecrawl_extract` — LLM structured extraction
- `firecrawl_agent` — autonomous research agent
- `firecrawl_agent_status` — agent polling
- `firecrawl_interact` — browser interaction on scraped page
- `firecrawl_interact_stop` — release browser session
- `firecrawl_parse` — local file parsing (PDF, DOCX, etc.)
- `firecrawl_search_feedback` — search quality feedback
- `firecrawl_feedback` — job feedback

**Research** (src/research.ts):
- `firecrawl_research_search_papers` — arXiv semantic search
- `firecrawl_research_inspect_paper` — paper metadata
- `firecrawl_research_related_papers` — citation graph expansion
- `firecrawl_research_read_paper` — full-text passages
- `firecrawl_research_search_github` — GitHub issue/PR/README search

**Monitoring** (src/monitor.ts):
- `firecrawl_monitor_create` — create recurring scrape monitor
- `firecrawl_monitor_list` — list monitors
- `firecrawl_monitor_get` — get monitor
- `firecrawl_monitor_update` — update/pause monitor
- `firecrawl_monitor_delete` — delete monitor
- `firecrawl_monitor_run` — trigger immediate check
- `firecrawl_monitor_checks` — check history
- `firecrawl_monitor_check` — single check with diffs

**Total: 26 tools** vs Novada's ~40 tools.

Firecrawl's advantage is depth on core scraping. Novada's advantage is breadth (proxy management, AI monitoring, browser flow, health checks, scraper platform data).
