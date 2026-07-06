# Firecrawl MCP — Competitive Research
Date: 2026-04-30

## Sources
- GitHub repo: https://github.com/firecrawl/firecrawl-mcp-server (6,169 stars)
- Main Firecrawl repo: https://github.com/firecrawl/firecrawl (113,184 stars)
- npm package: `firecrawl-mcp` v3.13.0 — ~137,585 downloads/month
- SDK: `@mendable/firecrawl-js` v4.17.0 — ~3,080,388 downloads/month

---

## Tools Inventory

| Tool | Description (agent-facing summary) | Key Params | Notes |
|------|-------------------------------------|------------|-------|
| `firecrawl_scrape` | Extract content from a single URL. "Most powerful, fastest and most reliable scraper tool — always default to this." | `url`, `formats` (markdown/html/rawHtml/screenshot/links/summary/branding/json/query), `jsonOptions.schema`, `actions`, `mobile`, `proxy` (basic/stealth/enhanced/auto), `location`, `storeInCache`, `maxAge`, `lockdown`, `profile` | Has **branding** format (extracts colors/fonts/typography for design replication), **lockdown mode** (cache-only, no outbound), **profile** (named browser state), **proxy tier selection** |
| `firecrawl_map` | Discover all indexed URLs on a site. | `url`, `search`, `sitemap` (include/skip/only), `includeSubdomains`, `limit`, `ignoreQueryParameters` | `search` param filters map output by keyword — very useful for "find the webhook docs page" |
| `firecrawl_search` | Web search with optional content extraction inline. Supports search operators. | `query`, `limit`, `sources` (web/images/news), `scrapeOptions`, `tbs`, `filter`, `location`, `enterprise` | **Multi-source types**: web + images + news in one call. Inline scraping via `scrapeOptions`. Documented search operators (site:, inurl:, intitle:, related:, imagesize:, etc.) |
| `firecrawl_crawl` | Crawl entire site, extract all pages. Async. | `url`, `maxDiscoveryDepth`, `limit`, `sitemap`, `allowExternalLinks`, `allowSubdomains`, `crawlEntireDomain`, `delay`, `maxConcurrency`, `deduplicateSimilarURLs`, `scrapeOptions`, `webhook`, `webhookHeaders` | Returns `id` for status polling. Webhook support with custom headers. |
| `firecrawl_check_crawl_status` | Poll async crawl job. | `id` | — |
| `firecrawl_extract` | LLM-powered structured extraction from array of URLs. | `urls[]`, `prompt`, `schema`, `allowExternalLinks`, `enableWebSearch`, `includeSubdomains` | Multi-URL batch LLM extraction with web search augmentation. Not same as `scrape` — fires across multiple pages simultaneously with one LLM pass |
| `firecrawl_agent` | Autonomous research agent. Browses, searches, gathers. Async. | `prompt` (max 10,000 chars), `urls[]` (optional focus), `schema` | Returns job ID. Expected wait 1-5 min. Docs tell agent to poll every 15-30s for "at least 2-3 minutes" |
| `firecrawl_agent_status` | Poll async agent job. | `id` | Statuses: processing / completed / failed |
| `firecrawl_browser_create` | *(deprecated)* Create CDP browser session. | `ttl`, `activityTtl`, `streamWebView`, `profile` | Deprecated in favor of scrape+interact |
| `firecrawl_browser_execute` | *(deprecated)* Run bash/python/node code in browser session. | `sessionId`, `code`, `language` | Has `agent-browser` CLI pre-installed in sandbox — accessibility tree, click by ref, type, scroll, screenshot |
| `firecrawl_browser_list` | *(deprecated)* List browser sessions. | `status` | — |
| `firecrawl_browser_delete` | *(deprecated)* Delete browser session. | `sessionId` | — |
| `firecrawl_interact` | Interact with a previously scraped page (scrapeId-bound session). | `scrapeId`, `prompt` OR `code`, `language`, `timeout` | **Key innovation**: scrape first, get `scrapeId`, then interact using that same session. No separate session management. Returns live view URLs. |
| `firecrawl_interact_stop` | Stop interact session. | `scrapeId` | — |
| `firecrawl_parse` | Parse a LOCAL FILE via self-hosted instance. | `filePath`, `contentType`, `formats`, `jsonOptions`, `parsers` (pdf), `pdfOptions.maxPages` | Only available when `CLOUD_SERVICE != true`. Supports PDF, DOCX, XLSX, HTML, RTF, ODT |

**Total active tools: 14** (+ batch_scrape, check_batch_status mentioned in README but not found in current index.ts — may be in legacy/ folder)

---

## Agent-First Design Patterns

### 1. Exhaustive "Best for / Not for / Common mistakes" in every tool description
Every tool has a structured block:
```
**Best for:** [specific use cases]
**Not recommended for:** [anti-patterns]
**Common mistakes:** [what agents get wrong]
**Prompt Example:** [natural language trigger phrase]
**Usage Example:** [complete JSON call]
**Returns:** [exact return format]
```
This is more explicit than novada-search's "Best for / Not for / Tip" pattern. Firecrawl adds "Common mistakes" as a dedicated section.

### 2. Multi-format format selection guidance embedded in scrape
The `firecrawl_scrape` description contains a 400-word guide on when to use JSON vs markdown vs query format, with concrete examples like "if user says 'get the header parameters', use JSON." This prevents agents from defaulting to markdown and hitting token limits.

### 3. Polling patience instructions
For async tools (`firecrawl_agent`, `firecrawl_agent_status`), description says:
> "Keep polling for at least 2-3 minutes... Poll every 15-30 seconds... Do NOT give up after just a few polling attempts"
> "Expected wait times: Simple queries: 30s-1min, Complex: 2-5min, Deep: 5+ min"
novada-search does not have async polling patterns for its tools.

### 4. scrapeId-based interact pattern (firecrawl_interact)
Firecrawl deprecates standalone browser sessions. Instead: scrape a page → get `scrapeId` → interact using that same scrapeId. The browser session is bound to a specific scrape, eliminating session management overhead for agents.

### 5. Tool selection decision table
README has a lookup table:
| Scenario | Recommended Tool |
|----------|-----------------|
| Single known URL | Scrape |
| Multiple known URLs | Batch Scrape |
| Discover site URLs | Map |
| Web search | Search |
| Full site extraction | Crawl |
| Structured data extraction | Extract or Scrape (JSON) |
| Complex research | Agent |
| Browser interaction | Scrape + Interact |

### 6. MCP annotations (readOnlyHint, openWorldHint, destructiveHint)
Every tool has MCP 2025 annotations:
```ts
annotations: {
  title: 'Scrape a URL',
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
}
```
novada-search also uses these, but Firecrawl has `title` (human-readable label) in addition.

### 7. Safe mode for cloud vs self-hosted
`SAFE_MODE=true` (cloud service) disables interactive actions (click, write, executeJavascript), webhooks. Agents on ChatGPT get a restricted tool surface. Documentation says this explicitly: "**Safe Mode:** Read-only content extraction. Interactive actions disabled for security."

### 8. `agent-browser` CLI in browser sessions
When using `firecrawl_browser_execute`, a pre-installed `agent-browser` CLI provides accessibility-tree-based interaction:
- `agent-browser snapshot` → returns clickable ref IDs (e.g. `@e5`)
- `agent-browser click @e5` → click by accessibility ref
This is designed so agents don't need to guess CSS selectors.

### 9. Self-healing scrape workflow documented step-by-step
For JS-rendered pages, the description walks agents through a 4-step fallback:
1. Add `waitFor: 5000`
2. Try a different URL (check hash fragments)
3. Use `firecrawl_map` with `search` to find correct URL
4. Use `firecrawl_agent` as last resort

### 10. In-description JSON usage examples
Every tool includes complete, copy-pasteable JSON examples of what the MCP call looks like — not just parameter descriptions.

---

## Strengths vs novada-search

### 1. `firecrawl_interact` — scrapeId-bound page interaction
**Gap:** novada-search has `novada_browser` with session IDs, but it requires managing sessions manually. Firecrawl's `firecrawl_interact` binds interaction to a specific scrape result. Agents don't need to think about session lifecycle.
- Firecrawl returns `scrapeId` in scrape metadata → pass it directly to `interact`
- Returns live view URLs for debugging
- Has `prompt` mode (natural language) AND `code` mode (bash/python/node)

### 2. `firecrawl_extract` — multi-URL LLM batch extraction
**Gap:** Firecrawl's `firecrawl_extract` takes an array of URLs and runs a single LLM pass across all of them with one prompt+schema. novada-search has no equivalent — `novada_extract` extracts content but does not do LLM-powered structured extraction across multiple URLs in one call.

### 3. `firecrawl_scrape` formats: branding, changeTracking, summary, query
**Gap:** novada-search's `novada_extract` returns markdown/html only.
- `branding` format: extracts colors, fonts, typography, spacing, logo, UI components for design replication
- `changeTracking`: not documented in README but in schema
- `summary`: condensed page summary
- `query` format: ask a natural language question about the page without full content extraction (saves tokens)

### 4. Inline `scrapeOptions` inside search and crawl
**Gap:** `firecrawl_search` and `firecrawl_crawl` both accept `scrapeOptions` — agents can search + scrape in one round trip. novada-search requires two separate calls (search → extract).

### 5. `firecrawl_search` multi-source types (web + images + news)
**Gap:** novada-search `novada_search` supports multiple engines (Google/Bing/DDG/Yahoo/Yandex) but all return web results. Firecrawl's `sources` param allows mixing web + images + news in a single call.

### 6. `firecrawl_agent` — true async autonomous research agent
**Gap:** novada-search has `novada_research` which runs synchronously. Firecrawl's `firecrawl_agent` is a true async agent that independently browses the web autonomously. Returns job ID immediately, runs in background. Better for long-running deep research.

### 7. Proxy tier selection in scrape
**Gap:** novada-search has `novada_proxy` (separate tool), but `novada_extract` doesn't expose proxy tier selection. Firecrawl's `firecrawl_scrape` has `proxy: basic | stealth | enhanced | auto` — agents can select escalating proxy tiers inline without a separate tool call.

### 8. Named browser profiles (persistent state across sessions)
**Gap:** novada-search sessions expire after 10 min. Firecrawl's `profile: { name: "my-profile", saveChanges: true }` persists cookies/localStorage across sessions by name. Agent can do a login once, save profile, reuse it later without re-authenticating.

### 9. Lockdown mode (cache-only, air-gapped compliance)
**Gap:** novada-search has no cache mode. Firecrawl's `lockdown: true` serves from cache only, no outbound network. For compliance-constrained environments.

### 10. `firecrawl_parse` — local file parsing (PDF, DOCX, XLSX)
**Gap:** novada-search has no local file parsing. Firecrawl can parse local PDFs, Word docs, Excel files when self-hosted.

### 11. Webhook support in crawl
**Gap:** novada-search crawl has no webhook. Firecrawl's `firecrawl_crawl` accepts `webhook` + `webhookHeaders` to push results to an endpoint when done.

### 12. Search operators documented for agents
**Gap:** novada-search doesn't document search operators. Firecrawl includes a full operator table in the `firecrawl_search` description: `site:`, `inurl:`, `allinurl:`, `intitle:`, `allintitle:`, `related:`, `imagesize:`, `larger:`, negation (`-`), exact match (`"`).

### 13. `maxAge` caching + `storeInCache`
**Gap:** novada-search has no caching controls. Firecrawl: "Add maxAge parameter for 500% faster scrapes using cached data." Agents can trade freshness for speed.

### 14. npm install distribution + VS Code one-click install buttons
**Gap:** The README has VS Code install badge links that work with one click. Firecrawl has a `server.json` with full MCP registry metadata (`mcpName: "io.github.firecrawl/firecrawl-mcp-server"`), Smithery config, and Docker support.

---

## Weaknesses vs novada-search

### 1. No `novada_verify` equivalent
Firecrawl has no fact-checking/claim verification tool. novada-search's `novada_verify` (3-angle parallel search → verdict) is unique.

### 2. No multi-engine SERP selection
novada-search lets agents pick Google, Bing, DuckDuckGo, Yahoo, Yandex separately. Firecrawl search is one engine (Google-powered).

### 3. No structured platform scraping (`novada_scrape`)
Firecrawl has no equivalent to novada-search's 129-platform structured scraper (Amazon, TikTok, LinkedIn, etc.). Firecrawl's `firecrawl_extract` is LLM-powered extraction from arbitrary URLs, not a structured data catalog.

### 4. No `novada_proxy` credential export
Firecrawl doesn't expose residential proxy credentials for agents to use in their own HTTP requests. novada-search's `novada_proxy` returns `url/env/curl` format credentials.

### 5. No `novada_unblock` raw HTML return
Firecrawl's scrape returns cleaned content. novada-search's `novada_unblock` returns raw HTML for custom DOM parsing — useful when agents need the original HTML structure.

### 6. Async adds cognitive overhead
Firecrawl's crawl and agent are async (poll pattern). novada-search's crawl returns synchronously. For agents, synchronous tools are simpler to orchestrate.

### 7. No error `agent_instruction` field
Firecrawl errors are plain `throw new Error(...)`. novada-search has classified errors with `Next step:` guidance in every error message. Firecrawl doesn't have structured `agent_instruction` in error responses.

### 8. Self-hosted requirement for some features
`firecrawl_parse` only works with self-hosted instances. novada-search is fully cloud.

---

## Key Numbers

| Metric | Firecrawl | novada-search |
|--------|-----------|---------------|
| GitHub stars (MCP repo) | 6,169 | — |
| GitHub stars (main repo) | 113,184 | — |
| npm downloads/month (MCP) | ~137,585 | — |
| npm downloads/month (SDK) | ~3,080,388 | — |
| MCP version | 3.13.0 | 0.8.3 |
| Active tools | 14 (+ batch) | 11 |
| Async tools | 3 (crawl, agent, batch_scrape) | 0 |
| Format options in scrape | 10 | 2 (markdown, html) |

---

## Raw Data / Links

- MCP repo: https://github.com/firecrawl/firecrawl-mcp-server
- Main source: https://github.com/firecrawl/firecrawl-mcp-server/blob/main/src/index.ts
- npm: https://www.npmjs.com/package/firecrawl-mcp
- SDK npm: https://www.npmjs.com/package/@mendable/firecrawl-js
- server.json (MCP registry): https://github.com/firecrawl/firecrawl-mcp-server/blob/main/server.json
- Smithery config: https://github.com/firecrawl/firecrawl-mcp-server/blob/main/smithery.yaml
- Download stats source: https://api.npmjs.org/downloads/range/last-month/firecrawl-mcp
