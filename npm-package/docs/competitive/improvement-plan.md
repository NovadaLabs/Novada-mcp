# novada-mcp Competitive Improvement Plan
**Date:** 2026-04-30
**Session:** novada-competitive-20260430-cf69f8fa
**Input:** phase1-final-synthesis.md (8 competitors, 11 gaps, live API tests)
**Scope:** Planning document only. No code changes in this document. No version bumps. No npm publish. No git push without explicit approval.

---

## 1. Executive Summary

novada-mcp v0.8.3 ships 11 tools, 444 tests, and an agent-first design with `agent_instruction` fields in every structured error — a baseline that no competitor reviewed matches. However, competitive analysis against 8 MCP servers (Firecrawl, BrightData, Decodo, Tavily, Exa, Apify, Spider, Scrapfly) reveals four compounding gaps: agent UX issues causing unnecessary retries and incorrect tool selection, an inconsistent error model across tools, missing response-size controls that cause context overflow on large pages, and zero distribution reach on cloud-hosted agent platforms due to the absence of a remote MCP endpoint. The current npm download rate (1,604/month) is ahead of Decodo (571) but 15x behind BrightData (24,913) and 86x behind Firecrawl (137,585), and the download gap is directly traceable to the missing hosted endpoint — every cloud-hosted orchestrator defaults to remote MCP connections. This plan defines 5 P0 items (agent correctness + distribution enablement), 2 P1 items (feature parity with Firecrawl/Tavily/Exa), and 3 P2 items (polish and strategic positioning), ordered by ROI per engineering hour. Version numbers will not be changed, npm will not be published, and no git push will occur without explicit approval.

---

## 2. P0 Items — Must Fix (High ROI, Low Effort)

### P0-1: quality:0 False Negative on Successful Small-Page Extractions

**Problem:**
`novada_extract` returns `quality: 0` for successful extractions of small pages (e.g., example.com, simple static pages). Quality score 0 is identical to the score returned for a failed extraction with zero content. Agents interpreting quality:0 as failure will retry unnecessarily, burning credits and adding latency. This is a silent agent loop trigger.

**Evidence:**
Live test #3 (phase-1-live-api-tests.md): example.com extraction succeeded with 166 chars of accurate content and a correct title/description, but returned `quality: 0`. Test issue #10 confirmed the pattern. No competitor reviewed has this bug — BrightData, Firecrawl, Tavily, and Exa either omit quality scores entirely or use distinct error states that cannot be confused with low-quality successful content.

**Fix:**
File: `src/tools/extract.ts` (quality scoring logic)
- Locate the scoring function that computes the `quality` field in the extraction response.
- Add a floor: if `content.length > 0` (i.e., any content was returned), the minimum returned quality score must be `1`.
- Reserve `quality: 0` strictly for failed extractions where `content_length === 0`.
- The floor should be applied as the last step before the response is assembled — after all other scoring factors are computed — so that the floor does not distort relative quality comparisons between pages that actually returned content.

**Tests to Add:**
File: `tests/tools/extract.test.ts`
- Test name: `"returns quality >= 1 for non-empty content"`
- Arrange: mock API response returning a small but non-empty content body (e.g., 50–200 chars).
- Assert: `response.quality >= 1`.
- Add a complementary test: `"returns quality 0 for empty content"` to lock the reserved-zero behavior.

**Effort:** 30 minutes (one-line floor in scoring function + 2 test cases)

---

### P0-2: novada_scrape Throws Uncaught Exception vs Structured Error

**Problem:**
`novada_scrape` throws an uncaught exception when the Scraper API is not activated on the account (error code 11006). By contrast, `novada_search` returns a graceful structured error string: `{status: "SERP_UNAVAILABLE", reason: ..., alternatives: [...]}`. This inconsistency is dangerous: agent frameworks that catch exceptions behave differently from those that parse string responses. Some frameworks abort on exception; others retry. The unpredictable branching is an agent reliability issue.

**Evidence:**
Live test (phase-1-live-api-tests.md): `novada_scrape` returned `Scraper error (code 11006): Scraper API not yet activated on this account.` as a thrown exception. `novada_search` returned a structured string with `SERP_UNAVAILABLE` status, alternatives, and next steps. Both tools failed due to plan tier, but the agent experience diverges entirely.

**Fix:**
File: `src/tools/scrape.ts` — wrap the tool handler body in a try/catch block at the outermost level of the exported handler function.

The catch block must return a structured error string in the same format as `novada_search`'s graceful degradation pattern:

```
{
  status: "unavailable",
  code: 11006,
  reason: "Scraper API not yet activated on this account.",
  agent_instruction: "Activate Scraper API at dashboard.novada.com/overview/scraper/ before retrying. Do not retry this call automatically — this is a plan-tier gate, not a transient error.",
  alternatives: [
    "Use novada_extract for general web page content extraction.",
    "Use novada_unblock for bot-protected pages that require anti-bot bypass.",
    "Use novada_crawl for multi-page site traversal."
  ],
  next_steps: ["Activate at: https://dashboard.novada.com/overview/scraper/"]
}
```

The return value must be the same type that the MCP framework expects — a content string or tool result, not a thrown Error object.

Also audit `src/tools/research.ts` and `src/tools/verify.ts`: both tools depend on SERP and are blocked on the test account, but their graceful fallback behavior should be verified to match this same pattern.

**Tests to Add:**
File: `tests/tools/scrape.test.ts`
- Test name: `"returns structured error string on API-not-activated exception"`
- Arrange: mock the scrape API call to throw an error with code 11006.
- Assert: the tool handler does not throw; it returns a string containing `status` and `agent_instruction`.
- Assert: the returned string is parseable as JSON or contains the expected fields as a structured string (match the pattern used in search tests).

**Effort:** 1 hour (try/catch wrapper + response assembly + 2-3 test cases)

---

### P0-3: novada_extract fields Returns `*(pattern)*` Annotation in Values

**Problem:**
When `novada_extract` is called with `fields: ["title", "description"]`, the returned field values contain a ` *(pattern)*` suffix indicating fuzzy/pattern-matched extraction. Example from live test #5:
- `title: "🔥 Firecrawl *(pattern)*"` (actual title: "GitHub - firecrawl/firecrawl")
- `description: "Search the web and get full content from results. *(pattern)*"`

Agents piping these values downstream — into databases, comparison logic, display templates, or structured data stores — will propagate the ` *(pattern)*` suffix as literal text. This is a data corruption vector for any downstream system. Agents that pipe these values into databases, comparison logic, or structured prompts will silently pass corrupt data downstream — producing incorrect reasoning in any tool that relies on the extracted field value.

**Evidence:**
Live test #5 (phase-1-live-api-tests.md): fields extraction on github.com/mendableai/firecrawl. Both extracted values contained the ` *(pattern)*` annotation as a literal string suffix. No competitor reviewed embeds extraction metadata as inline string suffixes in field values.

**Fix:**
File: `src/tools/extract.ts` — locate the section where extracted field values are assembled into the response object.

Apply a string strip operation before returning each field value:
- Strip the pattern ` *(pattern)*` (with leading space) from the end of each string value.
- Apply to all fields in the `fields` response block.

If fuzzy-match metadata is needed for debugging or agent decision-making, move it to a separate per-field metadata key (e.g., `extraction_method: "pattern_match"` alongside the clean `value: "Firecrawl"`) — do not embed it in the value string itself.

The fix is a single `.replace(/ \*\(pattern\)\*/g, '')` or `.trimEnd()` after the match annotation, applied in the field assembly loop.

**Tests to Add:**
File: `tests/tools/extract.test.ts`
- Test name: `"field values have no *(pattern)* annotation"`
- Arrange: mock an extraction response where the API returns values with ` *(pattern)*` suffix.
- Assert: the returned field values do not contain ` *(pattern)*`.
- Assert: the clean value is returned (e.g., `"Firecrawl"` not `"Firecrawl *(pattern)*"`).

**Effort:** 20 minutes (one-line strip in field assembly loop + 2 test cases)

---

### P0-4: Missing "Common Mistakes" + "When to Use" in Key Tool Descriptions

**Problem:**
No novada tool description includes a "Common mistakes" block or explicit "When to use / Not to use" guidance. Live testing proved agents make predictable, expensive mistakes without this guidance. The most damaging example: test S4 used `render="render"` on Tavily.com, taking 44 seconds — the same task in `render="auto"` (static mode) took 388ms. That is a 113x latency penalty from a single param choice that a "Common mistakes" note would prevent.

This is a market-level design expectation: Firecrawl has dedicated "Common mistakes:" sections in every tool description, Tavily embeds upgrade hints inline in param descriptions, and Scrapfly uses disambiguation notes to route agents to the correct tool. novada has none of these. The result is incorrect tool choice: agents select the wrong render mode, call the wrong tool for the job, or exhaust time budgets before fallback logic can engage.

**Evidence:**
Live test S4 (phase-1-live-api-tests.md): agent selected `render="render"` on a static page, resulting in 44s latency vs 388ms for `render="auto"`. Phase 1 synthesis identified this as the highest-impact low-effort change: documentation with proven agent behavioral impact.

**Fix:**
Files:
- `src/tools/types.ts` — where Zod schema `.describe()` strings are set for each param
- `src/index.ts` — where tool-level description strings are assembled (check if descriptions live in the `tools` array passed to `server.setRequestHandler(ListToolsRequestSchema, ...)`)

Add the following "Common mistakes:" blocks to the tool description strings:

**novada_extract — add to tool description:**
```
Common mistakes:
- Do NOT set render='render' for all pages. auto mode is 15x–113x faster for static sites.
  Only use render='render' for JavaScript-heavy SPAs (LinkedIn, Glassdoor, React SPAs, Next.js apps).
- Do NOT call novada_extract on a URL just to check if it exists — use novada_map for URL discovery.
- If fields extraction returns annotated values, prefer structured pages (product pages, GitHub repos) over generic homepages.

When to use:
- You need clean markdown, text, or HTML from a single URL or batch of URLs.
- You need specific structured fields (price, author, date) extracted from a page.
- You need render-mode bypass for bot-protected or JS-rendered pages.

Not for:
- Discovering what URLs exist on a site — use novada_map.
- Multi-page site traversal — use novada_crawl.
- Raw DOM access for CSS selector parsing — use novada_unblock.
```

**novada_crawl — add to tool description:**
```
Common mistakes:
- Do NOT set max_pages > 10 for large sites — crawl time scales linearly (~1.4s/page). At max_pages=20, expect 28s minimum.
- Do NOT use novada_crawl to fetch one page — use novada_extract which is faster and simpler.
- Use select_paths to restrict to relevant URL patterns before setting max_pages high.

When to use:
- You need content from multiple pages on one domain (e.g., all /docs/* pages).
- You need BFS discovery of related content under a path prefix.

Not for:
- Single-URL extraction — use novada_extract.
- Finding all URLs on a site without downloading content — use novada_map.
```

**novada_unblock — add to tool description:**
```
Common mistakes:
- This tool returns RAW HTML, not parsed/cleaned text. Passing the output directly to an LLM expecting markdown will produce garbled, token-heavy responses.
- For extracted content from bot-protected pages, use novada_extract (it calls the unblocker internally with render='render').
- Do not use novada_unblock for simple static pages — it adds 9–16 seconds of latency vs 112ms for novada_extract.

When to use:
- You need the original DOM structure for CSS selector parsing in a processing pipeline.
- You are feeding the HTML into a downstream parser, not directly to an LLM.
- You need raw access to a page's complete HTML before novada_extract's content selection.

Not for:
- Getting readable content from protected pages — use novada_extract with render='render'.
```

**novada_search — add to engine param description:**
```
Performance hint: If engine='google' is slow or rate-limited, try engine='duckduckgo' — DDG responses average 329ms vs 1,092ms for Google in benchmarks. DDG is suitable for most factual and recent-news queries.
```

**Tests to Add:**
No direct unit tests for description strings. However, add a test to `tests/integration/mcp.test.ts` (or create it if it does not exist):
- Test name: `"novada_extract tool description contains 'Common mistakes'"`
- Assert: the tool description string for novada_extract, novada_crawl, and novada_unblock each contain the substring `"Common mistakes"`.
- This test prevents future description regressions.

**Effort:** 2–3 hours (description writing + validation + description regression test)

---

### P0-5: No tokenLimit / max_chars on novada_extract — Context Overflow

**Problem:**
`novada_extract` has no per-call response size control. There is a hard 50K character truncation in `novada_unblock`, but it is not exposed as a param. For agents on production context budgets (e.g., 16K context Claude deployments), large pages cause context overflow with no recourse. Live test evidence: Bloomberg unblock returned 8.3MB HTML, hard-truncated to 50,000 chars — 96% discarded. The agent received no way to request less or get the most relevant portion first.

Decodo has a `tokenLimit` param that surfaces a truncation warning to the agent. Exa has `maxCharacters` per page. BrightData strips markdown server-side before returning. Agents that exhaust their context window mid-task cannot process further instructions and either abandon the task or produce truncated reasoning — a silent failure mode that is hard to debug.

**Evidence:**
Live test #9 (phase-1-live-api-tests.md): novada_unblock on nytimes.com returned 1,295,261 chars truncated to 50,000. Test notes: "Agents receive <4% of the page with no way to request less." Bloomberg test: 8.3MB raw HTML, 96% discarded.

**Fix:**
File: `src/tools/extract.ts` — add `max_chars` to `ExtractParamsSchema` and enforce it in the response assembly.

Schema change in `src/tools/types.ts`, `ExtractParamsSchema`:
```typescript
max_chars: z.number().int().min(1000).max(100000).optional()
  .describe(
    "Maximum characters to return (default: 25000, max: 100000). " +
    "When content exceeds this limit, it is truncated and a notice is appended: " +
    "'Content truncated at {max_chars} characters. Pass max_chars={higher} to get more.' " +
    "Common mistake: do not set max_chars=100000 by default — use 25000 for most pages " +
    "and increase only when you need full article body or long documentation."
  ),
```

Implementation in `src/tools/extract.ts`:
- After content is extracted and before the response is returned, check if `content.length > max_chars` (using the param value, defaulting to 25000 if not provided).
- If truncation occurs, slice the content at `max_chars` and append a notice string:
  `\n\n[Content truncated at {max_chars} characters. Full content is {total_chars} characters. Pass max_chars={suggested_higher} to get more.]`
  where `suggested_higher = Math.min(max_chars * 2, 100000)`.
- Add `content_truncated: true` and `total_chars: number` to the response metadata when truncation occurs.

**Tests to Add:**
File: `tests/tools/extract.test.ts`
- Test name: `"truncates content at max_chars when content exceeds limit"`
  - Arrange: mock extraction returning content longer than the specified max_chars.
  - Assert: returned content length <= max_chars.
  - Assert: response contains the truncation notice string.
  - Assert: `content_truncated: true` in response metadata.
- Test name: `"does not truncate content when content is within max_chars limit"`
  - Arrange: content shorter than max_chars.
  - Assert: content returned unmodified, `content_truncated` is false or absent.
- Test name: `"defaults to 25000 chars when max_chars not provided"`
  - Arrange: mock extraction returning 30000 chars with no max_chars param.
  - Assert: returned content is 25000 chars with truncation notice.

**Effort:** 1–2 hours (schema + truncation logic + 3 test cases)

---

## 3. P1 Items — Feature Parity

### P1-6: No Multi-URL Batch Extraction (urls Array Alias)

**Problem:**
`novada_extract` uses a singular `url` param. Research workflows needing to extract structured data from 5–10 pages require 5–10 separate tool calls against novada. Firecrawl, Tavily, and Exa all accept a `urls[]` array — one call extracts from multiple pages in parallel.

Note: The current `ExtractParamsSchema` in `src/tools/types.ts` (lines 47–51) already defines `url` as a `z.union([safeUrl, z.array(safeUrl)])`, meaning array input is technically accepted by the schema. However, it is not documented as `urls` (the market-standard param name), and the downstream handler may not process arrays correctly. This item is about: (1) verifying the handler processes arrays, (2) adding `urls` as an explicit alias, and (3) documenting batch mode prominently.

**Evidence:**
Phase 1 synthesis Gap 6: Firecrawl (`firecrawl_extract` takes `urls[]`), Tavily (`tavily_extract` takes `urls[]`), Exa (`web_fetch_exa` takes `urls[]`). The `urls` param name is the market-standard convention. novada's `url` singular param name with undocumented array support is a discoverability gap.

**Fix:**
File: `src/tools/types.ts`, `ExtractParamsSchema`:
- Add `urls` as an explicit alias alongside `url`:
  ```typescript
  urls: z.array(safeUrl).min(1).max(10).optional()
    .describe("Array of URLs to extract in parallel (max 10). Alias for url when passing multiple URLs. Use this for batch research workflows extracting from several pages in one call."),
  ```
- Update the `url` field description to cross-reference: `"Single URL. For multiple URLs, use the urls array param instead."`
- In the handler, normalize: if `urls` is provided, treat it as the URL list; if `url` is a single string, wrap as array; if `url` is an array (existing behavior), use directly.

File: `src/tools/extract.ts` — handler:
- Ensure the handler iterates over the URL array and runs extractions in parallel (`Promise.all`).
- Return an array of result objects when batch mode is used (more than one URL). Each result object should contain `url`, `content`, `quality`, `title`, `content_truncated` (if applicable).
- When a single URL is passed (legacy behavior), return a single object (not an array) to preserve backward compatibility.

File: `src/tools/types.ts` — update tool description:
- Add to the novada_extract description: `"Batch mode: pass urls (array) to extract from multiple pages in one call. Returns an array of results. Max 10 URLs per call."`

**Tests to Add:**
File: `tests/tools/extract.test.ts`
- Test name: `"accepts urls array and returns array of results"`
  - Arrange: pass `urls: ["https://example.com", "https://httpbin.org/json"]` (mocked).
  - Assert: result is an array with 2 elements.
  - Assert: each element has `url`, `content`, `quality` fields.
- Test name: `"single url still returns single object (backward compat)"`
  - Assert: passing `url: "https://example.com"` returns a single object, not an array.
- Test name: `"urls array respects max_chars per URL"`
  - Assert: when max_chars is set, each URL result is independently truncated.

**Effort:** 2–3 hours (alias + handler normalization + batch iteration + 3 test cases)

---

### P1-7: No Inline extract_options in novada_search (Round-Trip Efficiency)

**Problem:**
The most common agent research pattern is: search for URLs → extract content from top results. novada requires 2 separate tool calls for this. Firecrawl handles it in 1 call via `scrapeOptions` embedded in `firecrawl_search`. This doubles tool call count, latency, and context consumption for research-style agents.

**Evidence:**
Phase 1 synthesis Gap 7: Firecrawl `firecrawl_search` accepts `scrapeOptions: {formats: ["markdown"], onlyMainContent: true}`. The same pattern applies to `firecrawl_crawl`. novada requires a search call followed by N extract calls.

**Fix:**
File: `src/tools/types.ts`, `SearchParamsSchema`:
- Add optional `extract_options` object:
  ```typescript
  extract_options: z.object({
    format: z.enum(["text", "markdown", "html"]).optional().default("markdown"),
    fields: z.array(z.string()).optional(),
    max_chars: z.number().int().min(1000).max(100000).optional(),
    top_n: z.number().int().min(1).max(10).optional().default(3)
      .describe("Number of top search results to auto-extract. Default: 3. Max: 10."),
  }).optional()
    .describe(
      "When provided, automatically extracts content from the top top_n search result URLs " +
      "and appends it to each result. Eliminates the need for a separate novada_extract call. " +
      "Note: adds latency proportional to top_n * extract_latency. Use top_n=1-3 for most queries."
    ),
  ```

File: `src/tools/search.ts` — handler:
- After fetching search results, check if `extract_options` is present.
- If present, run `Promise.all` over the top `top_n` result URLs, calling the extract logic (reuse the extract handler or a shared helper) with the specified format and fields.
- Append extracted content to each corresponding search result under a `content` key.
- If extraction fails for a URL, set `content: null` and `extract_error: "..."` — do not fail the entire search call.

This change depends on the batch extraction handler from P1-6 being correct and testable in isolation.

**Tests to Add:**
File: `tests/tools/search.test.ts`
- Test name: `"appends extracted content to search results when extract_options provided"`
  - Arrange: mock search returning 5 results, mock extract for top 3 URLs.
  - Assert: top 3 results have `content` field; results 4-5 do not.
- Test name: `"search still works without extract_options (backward compat)"`
  - Assert: search results have no `content` field when extract_options is absent.
- Test name: `"individual extract failure does not fail the search call"`
  - Arrange: mock one extract call throwing an error.
  - Assert: search returns; the failed URL result has `content: null` and `extract_error` field.

**Effort:** 3–4 hours (schema + handler + shared extract helper refactor + 3 test cases)
Dependency: P1-6 (batch extract handler) should be implemented first.

---

## 4. P2 Items — Polish and Long-Term

### P2-8: Hosted / Remote MCP Endpoint (Infrastructure Decision)

**Problem:**
novada-mcp is stdio/npx only. Every cloud-hosted agent orchestrator — LangChain Cloud, Cursor, Copilot Studio, Dify, n8n Cloud — defaults to remote MCP connections. stdio/npx is incompatible with cloud deployments. The LobeHub listing explicitly shows `haveCloudEndpoint: false`, which flags as a gap in marketplace search ranking. Seven of eight competitors reviewed have hosted endpoints.

**Evidence:**
Phase 1 synthesis Gap 1: Tavily (`mcp.tavily.com/mcp/`), Exa (`mcp.exa.ai/mcp`), BrightData (`mcp.brightdata.com/mcp`), Decodo (`mcp.decodo.com/mcp`), Apify (`mcp.apify.com/`), Scrapfly (`mcp.scrapfly.io/mcp`). novada LobeHub listing: `haveCloudEndpoint: false`. npm downloads (1,604/month) vs Firecrawl (137,585/month) gap is partly attributable to this.

**Fix (Infrastructure Decision Required — Out of Scope for This Sprint):**
This item requires a backend infrastructure decision before implementation. Flag for KR-3.

Implementation path when approved:
- Expose `https://mcp.novada.com/mcp?token=<key>` via StreamableHTTP transport.
- Follow Decodo pattern: `Authorization: Basic <token>` in HTTP header, token = user's Novada API key.
- Update `server.json` (Claude Plugin manifest) with `"remote_url": "https://mcp.novada.com/mcp"`.
- Update README with remote URL and one-click Claude Desktop JSON snippet.
- Update LobeHub listing with `haveCloudEndpoint: true` after endpoint is live.

For now (this sprint): add a comment block to `src/index.ts` above the `StdioServerTransport` initialization noting that a StreamableHTTP transport should be added when the hosted endpoint is provisioned.

**Effort:** Medium (backend streaming endpoint + auth layer + CDN/load balancer config) — infrastructure scope, not a local code change.

---

### P2-9: novada_unblock Description Reframe

**Problem:**
`novada_unblock` is described in a way that invites agents to use it as a general extraction tool for protected pages. But the tool returns raw HTML — 1.3MB for NYT, 8.3MB for Bloomberg — with a hard 50K char truncation. Agents expecting readable content receive <4% of the page in many cases. The correct tool for content extraction from bot-protected pages is `novada_extract` with `render='render'`, which calls the unblocker internally but returns cleaned, structured content.

**Evidence:**
Live test #9: novada_unblock on nytimes.com returned 1,295,261 chars truncated to 50,000. Test recommendation: "Agents should be redirected to novada_extract for parsed content." The P0-4 section above adds a "Common mistakes" block — this item ensures the top-level tool description also sets expectations correctly so agents see the guidance before reading any param descriptions.

**Fix:**
File: `src/index.ts` — locate the tool description string for `novada_unblock` in the `ListToolsRequestSchema` handler.

Update the opening sentence to:
```
Returns raw HTML for preprocessing pipelines and DOM-level access. 
For extracted/readable content from bot-protected pages, use novada_extract with render='render' instead — it calls the unblocker internally and returns clean markdown.
Use novada_unblock only when you need: (1) the original DOM structure for CSS selector parsing in a custom processing pipeline, (2) raw HTML before your own content extraction layer.
```

**Tests to Add:**
File: `tests/integration/mcp.test.ts` (or create if absent)
- Test name: `"novada_unblock tool description contains redirect to novada_extract"`
- Assert: the description string for `novada_unblock` contains the substring `"novada_extract"`.

**Effort:** 15 minutes (description update + 1 test assertion)

---

### P2-10: novada_browser No Country Param (Geo Locale Bug)

**Problem:**
`novada_browser` has no `country` param. Live browser test B3 (phase-1-live-api-tests.md) showed DuckDuckGo returning a Chinese-locale page ("保护。隐私。安心。"), confirming the browser proxy exits in a non-US region. Agents doing US-targeted or locale-specific research receive incorrectly geo-localized content with no way to override.

BrightData has `country` on all `scraping_browser_*` tools. Scrapfly has `country` on `cloud_browser_open`. Spider has `country_code` on `spider_browser_open`.

**Evidence:**
Live test B3: DuckDuckGo in novada_browser returned Chinese locale. No country override available. Signal A from phase-1-final-synthesis.md: "Add `country` (ISO 2-letter) param to novada_browser. Pass to CDP proxy selection. This is a quick win."

**Fix:**
File: `src/tools/types.ts`, `BrowserParamsSchema`:
- Add:
  ```typescript
  country: z.string().length(2).optional()
    .describe(
      "ISO 3166-1 alpha-2 country code for the proxy exit node (e.g. 'US', 'GB', 'DE'). " +
      "When not set, the proxy selects an exit node automatically, which may not be US. " +
      "Set country='US' for US-targeted research to avoid geo-localized pages."
    ),
  ```

File: `src/tools/browser.ts` — handler:
- If `country` is provided in params, pass it to the CDP proxy configuration or WebSocket connection params (check how the Browser API WS endpoint accepts geo selection — consult Novada API docs before implementing).
- If the Novada Browser API does not support country selection at the WebSocket level, document the limitation in the param description: "Note: country selection may not be supported by the current Browser API version. Check Novada docs before use."

**Tests to Add:**
File: `tests/tools/browser.test.ts`
- Test name: `"accepts country param in BrowserParamsSchema"`
  - Assert: schema accepts `{country: "US", ...}` without validation error.
- Test name: `"rejects invalid country codes in BrowserParamsSchema"`
  - Assert: schema rejects `{country: "USA", ...}` (3 letters) and `{country: "12", ...}` (non-alpha).

**Effort:** 30 minutes for schema + handler wire-through; additional time if API docs research is needed to confirm Browser API country param support.

---

## 4.5 Deferred Items (Evaluated — Not Implemented This Sprint)

### Deferred: Gap 8 — AI/LLM Query Tools for GEO Monitoring
**Decision:** Strategic defer to Phase 3+.
**Reason:** Requires external API dependencies (OpenAI, Perplexity, Gemini) and is a separate product capability, not a parity fix. Phase 1 synthesis confirms this is a high-effort new tool category.
**Future concept:** `novada_ai_perception(query, platforms=["chatgpt","perplexity","gemini"])`
**Revisit trigger:** After KR-3 distribution goals are met and SERP/Scraper tiers are activated.

### Deferred: Gap 10 — Structured Platform Datasets (Top 5 Platforms)
**Decision:** Defer — high effort, requires per-platform schema definition and parsing for Amazon, LinkedIn, Reddit, TikTok, Google Shopping.
**Reason:** novada_scrape is currently blocked by plan tier (code 11006) and cannot be verified live. Schema work cannot be validated without plan activation.
**Effort:** High (schema definition + platform-specific parsing per platform).
**Revisit trigger:** After novada_scrape plan tier is activated and live platform outputs can be inspected.

---

## 5. Distribution Checklist (Non-Engineering — KR-3)

These are marketing and distribution tasks. They are NOT in the engineering backlog and do NOT require code changes. Assign to KR-3 execution.

- [ ] **Claim LobeHub listing** — `isClaimed: false` on `novadalabs-novada-search-mcp`. Log in to LobeHub dashboard, claim listing, add logo, update description with competitive positioning (novada_verify, novada_proxy, 129-platform catalog as differentiators). Estimated: 15 minutes.
- [ ] **Fix LobeHub identifier mismatch** — Listing references `NovadaLabs/novada-search-mcp` but primary package is `novada-search`. Resolve URL inconsistency to improve discoverability.
- [ ] **Add GitHub stars CTA to README** — Add "Star this repo" badge and community ask to README. Current: 2 stars vs Tavily 1,865, Exa 4,358. Low effort, compounding returns.
- [ ] **Submit to Claude Plugin marketplace** — KR-3 item. Firecrawl has MCP registry metadata (`mcpName`, `server.json`). Replicate this pattern for Claude Plugin submission. Prerequisite: `server.json` is up to date with correct tool list.
- [ ] **Add to LangChain/CrewAI community lists** — KR-3 item. Submit PRs to `awesome-mcp` lists, LangChain tools directory, CrewAI tools catalog.
- [ ] **Show HN post** — KR-3 item. Timing: after hosted endpoint is live (P2-8 resolved) so HN audience can try without npx. Draft: "novada-mcp — web search + anti-bot bypass + claim verification for AI agents, with agent_instruction in every error."
- [ ] **Add VS Code one-click install button to README** — Firecrawl has VS Code install badge links. Low effort, high discoverability for developer agents.
- [ ] **Add natural language example prompts to README tool table** — Decodo has an "Example prompt" column in their tool table. Add one natural language example per tool to the novada README tool table.

---

## 6. MCP Annotations — Quick Infrastructure Win

> **Priority: P0-equivalent. Estimated effort: 30 minutes. No dependencies. Can be parallelized with all other items.**

Add MCP 2025 standard annotations to all 11 tools in `src/index.ts`. These annotations are read by MCP-aware agent frameworks (Cursor, Claude Desktop, VS Code Copilot) to optimize tool selection and prevent unnecessary retries.

**Current state:** Phase 1 synthesis confirmed novada has zero `title` annotations. The `readOnlyHint`, `idempotentHint`, and `destructiveHint` fields may be partially present — audit required.

**Evidence:** Firecrawl (all tools + `title`), Exa (all tools), Scrapfly (all tools + `title`), BrightData (browser mutating tools have `destructiveHint: true`). novada has zero `title` fields confirmed by synthesis.

**Target annotations per tool:**

| Tool | readOnlyHint | idempotentHint | destructiveHint | title |
|------|-------------|----------------|-----------------|-------|
| `novada_search` | true | true | false | "Web Search" |
| `novada_extract` | true | true | false | "Extract Web Content" |
| `novada_crawl` | true | false | false | "Crawl Website" |
| `novada_map` | true | true | false | "Discover Site URLs" |
| `novada_research` | true | false | false | "Deep Web Research" |
| `novada_verify` | true | true | false | "Verify Claims" |
| `novada_unblock` | true | true | false | "Unblock Protected Pages" |
| `novada_scrape` | true | true | false | "Structured Platform Scrape" |
| `novada_proxy` | true | true | false | "Get Proxy Credentials" |
| `novada_browser` | false | false | false | "Browser Automation" |
| `novada_health` | true | true | false | "Check Service Health" |

Note on `novada_crawl`: `idempotentHint: false` because multiple calls to the same URL may return different pages as the crawl traverses different link paths based on server state or rate limiting.
Note on `novada_browser`: `readOnlyHint: false` and `idempotentHint: false` because browser automation can interact with pages (click, type, navigate) and is stateful (session).

**Implementation:**
File: `src/index.ts` — in the `ListToolsRequestSchema` handler, each tool object in the `tools` array should include:
```typescript
annotations: {
  title: "Web Search",
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
}
```

**Tests to Add:**
File: `tests/integration/mcp.test.ts` (create if absent):
- Test name: `"all tools have MCP annotations"`
  - Call the `list_tools` MCP endpoint.
  - Assert: every tool has `annotations.title`, `annotations.readOnlyHint`, `annotations.destructiveHint` defined.
- Test name: `"novada_browser readOnlyHint is false"`
  - Assert: `annotations.readOnlyHint === false` for novada_browser.
- Test name: `"no tool has destructiveHint: true"`
  - Assert: no tool in the list has `annotations.destructiveHint === true`.

**Effort:** ~30 minutes (11 annotation blocks + 3 test assertions)

---

## 7. Implementation Order

Execute in this order. Items with no dependencies can be parallelized by separate workers if multiple agents are available.

| # | Item | Priority | Estimated Effort | Dependencies |
|---|------|----------|------------------|--------------|
| 1 | P0-1: quality:0 floor fix | P0 | 30 min | None |
| 2 | P0-3: Strip `*(pattern)*` from field values | P0 | 20 min | None |
| 3 | MCP annotations on all 11 tools | Quick Win | 30 min | None |
| 4 | P0-4: "Common mistakes" + "When to use" in tool descriptions | P0 | 2–3 h | None |
| 5 | P0-2: novada_scrape error handling (try/catch + structured error) | P0 | 1 h | None |
| 6 | P0-5: max_chars param on novada_extract | P0 | 1–2 h | None |
| 7 | P2-9: novada_unblock description reframe | P2 | 15 min | None (complements step 4) |
| 8 | P2-10: novada_browser country param | P2 | 30 min | None (API docs check required first) |
| 9 | P1-6: urls array on novada_extract (batch mode) | P1 | 2–3 h | None (schema already partially supports arrays) |
| 10 | P1-7: extract_options on novada_search | P1 | 3–4 h | P1-6 (batch extract handler) |
| 11 | P2-8: Hosted endpoint | P2 | Medium+ | Infrastructure decision required — flag for KR-3 |

**Parallelization notes:**
- Items 1, 2, 3, 4, 5, 6, 7, 8 have no dependencies on each other and can run in parallel across workers.
- Item 10 (extract_options on search) must follow item 9 (batch extract handler) because it reuses the batch extraction logic.
- Item 11 (hosted endpoint) is blocked on an infrastructure decision and should not be started without explicit approval from Ethan (boss — approvals per CLAUDE.md).

**DO NOT bump version, DO NOT run npm publish, DO NOT git push without explicit approval.**

---

## 8. Tests to Add

Full test inventory. Phase 3 workers implementing each item must write the tests listed here before submitting the implementation.

### P0-1: quality:0 floor fix
**File:** `tests/tools/extract.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"returns quality >= 1 for non-empty content"` | Unit | Mock non-empty content, assert quality >= 1 |
| `"returns quality 0 for empty content"` | Unit | Mock empty content body, assert quality === 0 |

### P0-2: novada_scrape structured error
**File:** `tests/tools/scrape.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"returns structured error string on API-not-activated exception"` | Unit | Mock 11006 throw, assert handler returns string not exception |
| `"structured error contains agent_instruction field"` | Unit | Assert returned string/object contains `agent_instruction` |
| `"structured error contains alternatives array"` | Unit | Assert `alternatives` present with at least one fallback tool |

### P0-3: Strip `*(pattern)*` annotation
**File:** `tests/tools/extract.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"field values have no *(pattern)* annotation"` | Unit | Mock API returning `"Title *(pattern)*"`, assert clean output |
| `"field values strip annotation from all fields"` | Unit | Multi-field mock, assert no field contains ` *(pattern)*` |

### P0-4: Tool description "Common mistakes"
**File:** `tests/integration/mcp.test.ts` (create if absent)
| Test Name | Type | Description |
|-----------|------|-------------|
| `"novada_extract description contains 'Common mistakes'"` | Integration | list_tools, assert string present |
| `"novada_crawl description contains 'Common mistakes'"` | Integration | list_tools, assert string present |
| `"novada_unblock description contains 'Common mistakes'"` | Integration | list_tools, assert string present |

### P0-5: max_chars on novada_extract
**File:** `tests/tools/extract.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"truncates content at max_chars when content exceeds limit"` | Unit | Mock long content, assert len <= max_chars |
| `"appends truncation notice when content is truncated"` | Unit | Assert notice string in truncated response |
| `"content_truncated: true when truncated"` | Unit | Assert metadata field |
| `"does not truncate content within max_chars limit"` | Unit | Mock short content, assert no truncation |
| `"defaults to 25000 chars when max_chars not provided"` | Unit | 30000 char mock, assert 25000 char output |

### MCP Annotations
**File:** `tests/integration/mcp.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"all tools have MCP annotations with title"` | Integration | list_tools, assert annotations.title defined for all |
| `"novada_browser readOnlyHint is false"` | Integration | Assert browser tool annotation |
| `"no tool has destructiveHint: true"` | Integration | Assert none are destructive |

### P1-6: urls array batch extraction
**File:** `tests/tools/extract.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"accepts urls array and returns array of results"` | Unit | 2-URL mock, assert array response |
| `"single url returns single object (backward compat)"` | Unit | Single URL, assert non-array response |
| `"urls array respects max_chars per URL"` | Unit | Batch + max_chars, assert per-URL truncation |
| `"urls rejects more than 10 URLs"` | Unit | 11-URL input, assert schema validation error |

### P1-7: extract_options on novada_search
**File:** `tests/tools/search.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"appends extracted content to top N results when extract_options provided"` | Unit | Mock search + extract, assert content on top N |
| `"search without extract_options returns no content field"` | Unit | No extract_options, assert no content key |
| `"extract failure for one URL does not fail the search"` | Unit | One mock extract error, assert search still returns |

### P2-10: novada_browser country param
**File:** `tests/tools/browser.test.ts`
| Test Name | Type | Description |
|-----------|------|-------------|
| `"accepts country param in BrowserParamsSchema"` | Unit | `{country: "US"}` passes schema validation |
| `"rejects invalid country code (3 letters)"` | Unit | `{country: "USA"}` fails validation |

**Total new tests:** 25 tests minimum. Current count: 444. Expected post-implementation count: ~469.

---

## 9. Success Metrics

After all P0 items are implemented and tests pass:

### Correctness Bar
- [ ] `quality: 0` is never returned for non-empty content in any extract test — verified by the 2 new extract quality tests.
- [ ] novada_scrape never throws an uncaught exception — verified by the 3 new scrape error tests.
- [ ] No field value in extract response contains ` *(pattern)*` — verified by the 2 new annotation-strip tests.
- [ ] All 4 primary tools (extract, crawl, unblock, search) have "Common mistakes" in their descriptions — verified by 3 integration tests.
- [ ] All content over 25000 chars is truncated with a truncation notice — verified by 5 new extract tests.

### Test Count
- Current baseline: 444 tests passing (`npx vitest run`).
- Expected after all P0 items: 444 + ~14 new tests = ~458 tests.
- Expected after P0 + P1 + Annotations: 444 + ~25 new tests = ~469 tests.
- All tests pass: `npx vitest run` exits with 0 failures.

### Agent UX Bar ("Can an LLM use this correctly on first try?")
Test each of these 4 scenarios against the updated tool descriptions without additional context:
1. Extract from example.com (static page) — agent should NOT add `render='render'`.
2. Get content from LinkedIn profile (JS page) — agent SHOULD use `render='render'`.
3. Extract from NYT article (bot-protected) — agent should use `novada_extract`, NOT `novada_unblock`.
4. Search for a topic and read top 3 results — agent SHOULD use `extract_options` on novada_search (after P1-7 is implemented).

### Error Consistency Bar
- All 11 tools return structured error strings (not thrown exceptions) on activation/plan-tier failures.
- All structured errors contain `agent_instruction`.
- Verify by checking the `catch` blocks in all 11 tool handler files: `search.ts`, `extract.ts`, `crawl.ts`, `map.ts`, `research.ts`, `verify.ts`, `unblock.ts`, `scrape.ts`, `proxy.ts`, `browser.ts`, `health.ts`.

### Distribution Readiness Bar (after P2-8 and KR-3 checklist)
- LobeHub listing shows `isClaimed: true` and `haveCloudEndpoint: true`.
- README contains GitHub stars CTA, one-click Claude Desktop JSON, and VS Code install badge.
- `server.json` includes `mcpName` and remote URL for Claude Plugin submission.

---

## Appendix A: File Reference Map

| Change | Primary File | Secondary Files |
|--------|-------------|-----------------|
| P0-1 quality floor | `src/tools/extract.ts` | — |
| P0-2 scrape error handling | `src/tools/scrape.ts` | `src/tools/research.ts`, `src/tools/verify.ts` (audit) |
| P0-3 strip annotation | `src/tools/extract.ts` | — |
| P0-4 tool descriptions | `src/tools/types.ts` (param descriptions) | `src/index.ts` (tool-level descriptions) |
| P0-5 max_chars | `src/tools/types.ts` (schema) | `src/tools/extract.ts` (truncation logic) |
| MCP annotations | `src/index.ts` | — |
| P1-6 urls array | `src/tools/types.ts` (schema) | `src/tools/extract.ts` (handler) |
| P1-7 extract_options | `src/tools/types.ts` (schema) | `src/tools/search.ts` (handler) |
| P2-9 unblock description | `src/index.ts` | — |
| P2-10 browser country | `src/tools/types.ts` (schema) | `src/tools/browser.ts` (handler) |

---

## Appendix B: Competitive Reference Links

For Phase 3 implementors who need to verify competitor patterns:
- Firecrawl tool descriptions (scrapeOptions, Common mistakes): https://github.com/firecrawl/firecrawl-mcp-server (v3.13.0)
- Exa maxCharacters + readOnlyHint pattern: https://github.com/exa-labs/exa-mcp-server (v3.2.1)
- Decodo tokenLimit param: https://github.com/Decodo/mcp-server (v1.2.0)
- Tavily urls[] array: https://github.com/tavily-ai/tavily-mcp (v0.2.19)
- Decodo hosted MCP (StreamableHTTP auth pattern): https://mcp.decodo.com/mcp
