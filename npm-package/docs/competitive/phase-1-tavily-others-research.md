# Tavily + Other MCPs — Competitive Research
Date: 2026-04-30

Sources: GitHub API reads on live repos (no cached data).

---

## Tavily MCP

**Repo:** https://github.com/tavily-ai/tavily-mcp  
**Stars:** 1,865  
**Package:** `tavily-mcp` (npm)  
**Version:** 0.2.19  
**License:** LICENCE (file exists)

### Tools Inventory (5 tools)

| Tool | Description (verbatim from source) | Key Params |
|------|--------------------------------------|------------|
| `tavily_search` | "Search the web for current information on any topic. Use for news, facts, or data beyond your knowledge cutoff. Returns snippets and source URLs." | `query` (req), `search_depth` (basic/advanced/fast/ultra-fast), `topic`, `time_range` (day/week/month/year), `start_date`/`end_date` (YYYY-MM-DD), `max_results` (5–20), `include_domains`/`exclude_domains`, `country` (full name not ISO), `include_images`, `include_raw_content`, `exact_match` |
| `tavily_extract` | "Extract content from URLs. Returns raw page content in markdown or text format." | `urls` (array), `extract_depth` (basic/advanced — "Use 'advanced' for LinkedIn, protected sites, or tables"), `query` (optional relevance reranking), `format` (markdown/text) |
| `tavily_crawl` | "Crawl a website starting from a URL. Extracts content from pages with configurable depth and breadth." | `url`, `max_depth`, `max_breadth`, `limit`, `instructions` (natural language), `select_paths`/`select_domains` (regex), `allow_external`, `extract_depth` |
| `tavily_map` | "Map a website's structure. Returns a list of URLs found starting from the base URL." | `url`, `max_depth` |
| `tavily_research` | "Perform comprehensive research on a given topic or question. Use this tool when you need to gather information from multiple sources to answer a question or complete a task. Returns a detailed response based on the research findings. Rate limit: 20 requests per minute." | `input` ("comprehensive description of the research task"), `model` (mini/pro/auto) |

### Key Parameter Analysis

**tavily_search params:**
- `query` (required)
- `search_depth`: enum `["basic","advanced","fast","ultra-fast"]` — depth names are meaningful to an agent
- `topic`: enum `["general"]` — currently only one option
- `time_range`: enum `["day","week","month","year"]` — human-readable, not ISO codes
- `start_date` / `end_date`: `YYYY-MM-DD` format — explicit format in description
- `max_results`: 5–20 range (minimum 5, not 1)
- `include_images`, `include_image_descriptions`, `include_raw_content`: boolean flags
- `include_domains` / `exclude_domains`: array of strings — descriptions say "if the user asks to search on specific sites set this to the domain of the site"
- `country`: full country names only ("United States", not "us") — explicitly documented as NOT ISO codes
- `include_favicon`, `exact_match`: optional booleans

**tavily_extract params:**
- `urls`: array (not single URL) — batch by default
- `extract_depth`: `["basic","advanced"]` — "Use 'advanced' for LinkedIn, protected sites, or tables/embedded content" — this is *exceptional* guidance
- `query`: optional — "Query to rerank content chunks by relevance" — unique relevance reranking feature
- `format`: `["markdown","text"]`

**tavily_crawl params:**
- `url` (single, not array)
- `max_depth`, `max_breadth`, `limit` — three separate crawl controls
- `instructions`: natural language for crawler
- `select_paths`, `select_domains`: regex arrays
- `allow_external`: boolean
- `extract_depth`: `["basic","advanced"]`

**tavily_research params:**
- `input`: "A comprehensive description of the research task"
- `model`: `["mini","pro","auto"]` — model selection exposed to agent

### Agent-First Patterns in Tavily

1. **Use-case hints in descriptions**: tavily_extract says "Use 'advanced' for LinkedIn, protected sites, or tables/embedded content" — agents know exactly when to upgrade
2. **Default parameter override via env**: `DEFAULT_PARAMETERS` env var lets operators set defaults without changing code
3. **Meaningful enum values**: `["basic","advanced","fast","ultra-fast"]` for depth — agent-readable intent
4. **Explicit format in param descriptions**: "Required to be written in the format YYYY-MM-DD" in date params
5. **Country name inconsistency noted**: Full names only (not ISO), explicitly documented

### Strengths vs novada_search

- `tavily_research` exposes model selection (`mini`/`pro`/`auto`) — agent can tune cost vs quality
- `tavily_extract` has relevance reranking via `query` param — novada_extract lacks this
- Per-tool `extract_depth` on both extract AND crawl — novada only has render flag on extract
- `exact_match` boolean for phrase-exact searches — novada lacks this
- Remote MCP endpoint available (`https://mcp.tavily.com/mcp/`) — novada is stdio-only

### Weaknesses vs novada_search

- Only 5 tools vs novada's 11
- No platform-specific scraping (Amazon, Reddit, TikTok, etc.)
- No proxy/geo-routing beyond basic country param
- No browser automation tool
- No claim verification/fact-check tool
- No health check tool
- `max_results` minimum is 5 (wasteful for spot checks)
- Country param requires full names ("United States") not ISO codes — inconsistent with industry standard

---

## Exa MCP Server

**Repo:** https://github.com/exa-labs/exa-mcp-server  
**Stars:** 4,358  
**Package:** `exa-mcp-server` (npm)  
**Version:** 3.2.1  
**Hosted endpoint:** `https://mcp.exa.ai/mcp`

### Tools Inventory

**Active (enabled by default):**

| Tool | Description (verbatim) | Key Params |
|------|------------------------|------------|
| `web_search_exa` | "Search the web for any topic and get clean, ready-to-use content. Best for: Finding current information, news, facts, people, companies, or answering questions about any topic. Returns: Clean text content from top search results. Query tips: describe the ideal page, not keywords..." | `query` (natural language, "describe the ideal page"), `numResults` (1–100) |
| `web_fetch_exa` | "Read a webpage's full content as clean markdown. Use after web_search_exa when highlights are insufficient or to read any URL. Best for: Extracting full content from known URLs. Batch multiple URLs in one call. Returns: Clean text content and metadata from the page(s)." | `urls` (array), `maxCharacters` (per-page char limit, default 3,000) |

**Off by default (opt-in via URL param):**

| Tool | Description | Key Params |
|------|-------------|------------|
| `web_search_advanced_exa` | "Advanced web search with full control over filters, domains, dates, and content options. Best for: When you need specific filters like date ranges, domain restrictions, or category filters. Not recommended for: Simple searches - use web_search_exa instead." | `type` (auto/fast/instant), `category` (company/research paper/news/pdf/github/personal site/people/financial report), `includeDomains`/`excludeDomains`, `startPublishedDate`/`endPublishedDate` (ISO 8601), `startCrawlDate`/`endCrawlDate`, `userLocation` (2-letter ISO), `maxAgeHours`, `enableSummary`+`summaryQuery`, `enableHighlights`, `subpages` (1–10), `additionalQueries`, `includeText`/`excludeText` |

**Deprecated (still available):**
- `company_research_exa` → use `web_search_advanced_exa`
- `people_search_exa` → use `web_search_advanced_exa`
- `linkedin_search_exa` → use `people_search_exa`
- `deep_researcher_start` / `deep_researcher_check` → async research pair, now deprecated
- `get_code_context_exa`, `crawling_exa`, `deep_search_exa`

### Key Parameter Analysis

**web_search_exa** (minimal surface):
- `query`: "Natural language search query. Should be a semantically rich description of the ideal page, not just keywords. Optionally include category:<type> (company, people) to focus results"
- `numResults`: 1–100

**web_search_advanced_exa** (full power):
- `type`: `["auto","fast","instant"]`
- `category`: `["company","research paper","news","pdf","github","personal site","people","financial report"]`
- `includeDomains` / `excludeDomains`: arrays
- `startPublishedDate` / `endPublishedDate` / `startCrawlDate` / `endCrawlDate`: ISO 8601
- `includeText` / `excludeText`: arrays of required/excluded strings
- `userLocation`: ISO country code (2-letter, e.g. "US") — **correct ISO standard**
- `enableSummary` + `summaryQuery`, `enableHighlights` + highlight config
- `subpages`: 1–10 subpages per result
- `maxAgeHours`: freshness control — "0 = always fetch fresh content, omit = use cached with fallback"
- `additionalQueries`: parallel query variations for broader coverage

**web_fetch_exa:**
- `urls`: array (batch multiple in one call)
- `maxCharacters`: per-page character limit

### Agent-First Patterns in Exa

1. **Best-for / Not-for structure in descriptions**: Every tool description has explicit "Best for:" and "Returns:" sections — agents parse intent immediately
2. **Tiered tool exposure**: Simple (`web_search_exa`) vs advanced (`web_search_advanced_exa`) — prevents option paralysis
3. **Query guidance built into param description**: "describe the ideal page, not keywords" + category filter syntax in the query param itself
4. **`maxAgeHours` freshness control**: Agent can trade speed for freshness explicitly
5. **MCP annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` — standard MCP tool annotations present
6. **Tool restriction skills**: Exa publishes agent-specific skills (e.g., "Company Research skill", "Coding skill") that restrict tools to just what's needed for the task
7. **Structured output schema on research tools**: `outputSchema` param on deep researcher for typed output
8. **`additionalQueries`**: Let agent specify parallel search variations — unique multi-angle search

### Strengths vs novada_search

- Highest stars (4,358) — most adopted web search MCP
- `category` enum for content type filtering (news, pdf, github, research paper, financial report) — novada lacks this
- `maxAgeHours` freshness control — novada lacks explicit freshness param
- `subpages` per result — get subpages in one call
- Hosted SSE endpoint — no local install required
- MCP annotations (`readOnlyHint`, `destructiveHint`) on all tools
- Agent-specific skills published to guide tool selection

### Weaknesses vs novada_search

- Only 3 active tools vs novada's 11
- No platform scraping (Amazon, Reddit, etc.)
- No browser automation
- No proxy/anti-bot capabilities
- No fact verification
- No site crawling or mapping
- No health check
- `web_fetch_exa` default 3,000 chars per page may be too short for some use cases

---

## Apify MCP Server

**Repo:** https://github.com/apify/apify-mcp-server  
**Stars:** 1,167  
**Package:** `@apify/actors-mcp-server` (npm)  
**Version:** 0.9.21  
**Hosted endpoint:** `https://mcp.apify.com/` (Streamable HTTP)

### Tools Inventory (core default tools)

| Tool Name (enum value) | Purpose | Key Params |
|------------------------|---------|------------|
| `search-actors` | "Search the Apify Store to FIND and DISCOVER what scraping tools/Actors exist for specific platforms or use cases. This tool provides INFORMATION about available Actors — it does NOT retrieve actual data or run any scraping tasks." | `keywords` ("Use 1-3 simple keyword terms. ✅ 'Instagram posts' ❌ 'data extraction scraping tools'"), `limit` (1–100, default 5), `offset` |
| `fetch-actor-details` | Get input schema, README, pricing, stats, output schema for a specific Actor | `actorName`, boolean flags: `description`, `stats`, `pricing`, `rating`, `inputSchema`, `readme`, `outputSchema`, `mcpTools` |
| `call-actor` | Execute an Actor (scraper/crawler) by name with input params; supports sync and async | `actorName`, `input` (arbitrary object), `async` (boolean), `previewOutput` (boolean) |
| `get-actor-run` | Poll status of an async Actor run | `runId` |
| `get-actor-output` | Retrieve dataset/output from completed run | `runId`, `limit`, `offset` |
| `search-apify-docs` | Search Apify platform documentation | `query` |
| `fetch-apify-docs` | Fetch specific doc page content | `url` |
| `add-actor` | Add an Actor to account for rented access | `actorName` |
| Additional: `get-actor-log`, `get-dataset`, `get-dataset-items`, `get-dataset-schema`, `get-key-value-store-*` | Data retrieval tools | Various `runId`/`datasetId` params |

### Key Parameter Analysis

**search-actors:**
- `keywords`: "Space-separated keywords. Use 1-3 simple keyword terms maximum. Actors are named using platform or service name + data type. ✅ Good: 'Instagram posts', 'Amazon products' ❌ Bad: 'data extraction scraping tools'"
- `limit`: 1–100 (default 5)
- `offset`: for pagination

**call-actor:**
- `actorName`: string
- `input`: arbitrary object (matches Actor's input schema)
- `async`: boolean — start and poll separately
- `previewOutput`: boolean — include output preview

**fetch-actor-details output options (granular):**
- `description`, `stats`, `pricing`, `rating`, `metadata`, `inputSchema`, `readme`, `outputSchema`, `mcpTools` — each boolean flag

### Agent-First Patterns in Apify

1. **Discovery-then-execute workflow enforced in tool descriptions**: `search-actors` description explicitly says "Do NOT use this tool when user wants immediate data retrieval" — directs agent to the right tool for each step
2. **Mandatory double search instruction**: "IMPORTANT: You MUST always do a second search with broader, more generic keywords" — embedded in tool response text to ensure agents don't settle on first result
3. **Structured response alongside text**: Returns both `structuredContent` (JSON) and formatted text in the same response — agents can parse either
4. **Granular output options on details**: Agent can request only `pricing` or only `inputSchema` — reduces token usage
5. **Async execution support**: `async: true` on call-actor + separate `get-actor-run` polling — handles long-running tasks
6. **CLAUDE.md + AGENTS.md in repo**: Detailed agent-specific instructions for developers building on top
7. **Dedicated agent design instructions file**: `DESIGN_SYSTEM_AGENT_INSTRUCTIONS.md` for widget design
8. **Error responses with next steps**: Response text includes instructions like "use fetch-actor-details to get the input schema before calling"

### Strengths vs novada_search

- Marketplace model — 1,000s of scrapers accessible via 5 tool calls
- Discovery flow (search → details → call) is highly agent-friendly
- Async execution model for long-running tasks
- Structured output schema on responses
- Docs search tools bundled
- Streamable HTTP hosted endpoint

### Weaknesses vs novada_search

- Indirect: agent must discover then call, not direct data retrieval
- Requires Apify account + Actor costs per run
- No built-in proxy control
- No native search engine integration
- Steeper learning curve for one-shot tasks

---

## Cross-Competitor Design Patterns

Patterns that appear in ALL or most competitors that novada-search should adopt:

### 1. "Best for / Not for" structure in tool descriptions
- **Who does it**: Exa (explicit "Best for: / Returns: / Not recommended for:"), Tavily (implicit in description), Apify (explicit "Do NOT use this tool when...")
- **novada status**: Partial. novada_scrape has "Best for:", novada_unblock has "Best for:". But novada_search, novada_extract, novada_crawl descriptions lack this explicit structure.
- **Action**: Add "Best for:" and "Returns:" headers to all tool descriptions.

### 2. Explicit "when to upgrade" hints in param descriptions
- **Who does it**:
  - Tavily (`extract_depth`: "Use 'advanced' for LinkedIn, protected sites, or tables/embedded content")
  - Firecrawl: every tool description includes a dedicated **"Common mistakes"** block that names specific anti-patterns agents commit. Examples from the source:
    - `firecrawl_scrape` Common mistakes: "Using markdown format for all content (use JSON for structured data)", "Not using `waitFor` on JS-heavy pages", "Not passing `actions` to handle modals/consent banners before scraping"
    - `firecrawl_crawl` Common mistakes: "Setting `maxDepth` too high for large sites (results in runaway crawl)", "Not using `allowSubdomains: false` when you only need one domain section"
    - `firecrawl_extract` Common mistakes: "Passing URLs from different domains in one call (extract works best within a single domain)", "Not including `enableWebSearch: true` when data may not be on the listed URLs"
    - `firecrawl_agent` Common mistakes: "Giving up after a few polling attempts — agent jobs need 2-5 min; poll for at least 2-3 minutes"
- **novada status**: Missing. novada_extract's `render` param says "auto-detected; override to 'render' for JS-heavy pages" but doesn't name specific sites or common agent mistakes.
- **Action**: Add concrete examples of when to use `render="render"` (e.g., "Use for LinkedIn, Glassdoor, JS-heavy SPAs") AND add a "Common mistakes" block to high-traffic tools (novada_extract, novada_search, novada_crawl).

### 3. MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint)
- **Who does it**: Exa (all tools annotated), Apify (`readOnlyHint: false, destructiveHint: true` on call-actor)
- **novada status**: Not present in server.json tool definitions
- **Action**: Add MCP annotations — novada_search/extract/crawl/map/research/verify = `readOnlyHint: true`, novada_browser = `destructiveHint: true`, novada_health = `readOnlyHint: true`

### 4. camelCase param names
- **Who does it**: Exa (`numResults`, `includeDomains`, `startPublishedDate`, `maxAgeHours`), Tavily (`searchDepth`, `maxResults`, `includeDomains`)
- **novada status**: novada uses snake_case (`max_results`, `include_domains`, `select_paths`) — different convention
- **Note**: Not necessarily wrong, but worth flagging for consistency. MCP spec doesn't mandate either.

### 5. Structured/machine-readable response format alongside human text
- **Who does it**: Apify (returns both `structuredContent` JSON + formatted text), Exa (returns JSON string + `_meta` field)
- **novada status**: Returns structured JSON in most tools but format varies
- **Action**: Ensure all tools return consistent JSON structure, not mixed formats

### 6. "Returns:" section in description
- **Who does it**: All competitors (Exa most explicitly)
- **novada status**: Some tools say what they return, others don't
- **Action**: Every tool description should end with "Returns: [what the agent gets]"

### 7. Batch-by-default for URL inputs
- **Who does it**: Exa (`web_fetch_exa` takes `urls` array), Tavily (`tavily_extract` takes `urls` array)
- **novada status**: novada_extract supports `url=[url1,url2]` but the parameter is named `url` (singular) — confusing
- **Action**: Rename `url` to `urls` on novada_extract to match industry convention

### 8. Remote/hosted MCP endpoint
- **Who does it**: Tavily (remote HTTP MCP), Exa (hosted SSE), Apify (Streamable HTTP)
- **novada status**: stdio only
- **Impact**: All top competitors offer zero-install hosted options. This is a distribution gap.

---

## LobeHub Score Update

**Current state (as of 2026-04-30):**

The LobeHub marketplace CLI (`market-cli`) does not expose a numerical 0–100 score in its API response. The fields returned are: `ratingAverage` (0.0, no user ratings yet), `ratingCount` (0), `isValidated: true`, `isFeatured: false`, `isOfficial: false`, `isClaimed: false`.

The "61/100" referenced in the goal brief was a pre-P0+P1 estimate (internal assessment). The marketplace does not surface this number.

**What the listing shows post-P0+P1:**
- `capabilities`: `{prompts: true, resources: true, tools: true}` — all three present
- `toolsCount`: 11
- `promptsCount`: 5
- `resourcesCount`: 4
- `tags`: 27 tags including competitor alternatives (tavily-alternative, firecrawl-alternative, etc.)
- `category`: web-search
- `isValidated`: true
- `installationMethods`: npm
- `github.license`: MIT License
- `github.language`: TypeScript
- `github.stars`: 2 (very low — KR-3 gap)

**What is still missing/low vs top competitors:**

| Criterion | Status | Gap |
|-----------|--------|-----|
| User ratings | 0 ratings | Need real installs/ratings |
| GitHub stars | 2 | Tavily: 1,865 / Exa: 4,358 / Apify: 1,167 |
| `isClaimed` | false | Need to claim the listing to unlock features |
| `isFeatured` | false | Requires editorial review |
| `isOfficial` | false | Requires Novada org verification |
| Remote/cloud endpoint | false (`haveCloudEndpoint: false`) | All top competitors have hosted endpoint |
| Install count | 0 | No traction yet |
| Comment count | 0 | No community activity |

**Note on identifier mismatch:** The listing identifier is `novadalabs-novada-search-mcp` (referencing `NovadaLabs/novada-search-mcp` GitHub repo). The primary npm package is `novada-search`. This URL inconsistency may affect discoverability.

---

## Spider (spider.cloud) MCP

**Repo (v2):** https://github.com/spider-rs/spider-cloud-mcp-v2  
**Repo (v1, legacy):** https://github.com/spider-rs/spider-cloud-mcp-server  
**Stars (v2):** 1 (very early — repo created 2026-04-09)  
**Package:** `spider-cloud-mcp` (npm)  
**Version:** 2.1.0  
**Language:** TypeScript  
**License:** MIT

Spider is the high-throughput crawler behind spider.cloud — claims 100K+ pages/sec. The v2 MCP server exposes 22 tools across three tiers: Core (8), AI (5), and Browser Automation (9).

### Tools Inventory

**Core Tools (8) — pay-per-use credits, no subscription:**

| Tool | Description | Key Params | Notes |
|------|-------------|------------|-------|
| `spider_crawl` | Crawl a website, follow links up to depth/limit, extract content | `url` (comma-separate for multi), `return_format` (markdown/commonmark/raw/text/xml), `request` (http/chrome/smart), `limit`, `depth` (default 25), `delay`, `proxy` (residential/mobile/isp/datacenter), `proxy_enabled`, `country_code` (ISO), `budget` (page budget per path), `cron` (daily/weekly/monthly), `webhooks`, `run_in_background`, `automation` (Click/Fill/Wait/Scroll actions) | streaming responses; `budget` param caps pages per URL path |
| `spider_scrape` | Scrape a single URL, no link following | Same base params as crawl (minus `limit`/`depth`/`delay`); adds `screenshot`, `full_page`, `binary`, `cdp_params` | Cheaper than crawl for single URLs |
| `spider_search` | Web search, optionally fetch full content from results | `search`, `num`, `fetch_page_content`, `country` (2-letter), `language` (2-letter), `tbs` (qdr:h/d/w/m/y), `quick_search`, `auto_pagination`, `page` | `tbs` uses Google-style time range codes |
| `spider_links` | Extract all links from a page without fetching content | `url`, `limit`, `return_format`, `request` | Fast link discovery only |
| `spider_screenshot` | Capture screenshot as base64 PNG | `url`, `full_page`, `binary`, `omit_background`, `viewport`, `cdp_params` | Returns image content type |
| `spider_unblocker` | Access bot-protected sites with anti-bot bypass | Same as `spider_scrape`; costs 10-40 extra credits per unblock on top of base | Credits cost disclosed in description |
| `spider_transform` | Convert HTML to markdown/text without network requests | `data` (array of `{html, url?}`), `return_format`, `readability`, `clean_full`, `clean` | Offline transform — no API call to target |
| `spider_get_credits` | Check API credit balance | None | No params — clean health-check pattern |

**AI Tools (5) — require active AI subscription:**

| Tool | Description | Key Params | Notes |
|------|-------------|------------|-------|
| `spider_ai_crawl` | AI-guided crawl with natural language instructions | `url`, `prompt`, `limit`, `return_format`, `request`, `proxy_enabled`, `cookies` | Prompt drives crawl strategy |
| `spider_ai_scrape` | Extract structured JSON via plain English prompt, no selectors | `url`, `prompt`, `return_format`, `request`, `proxy_enabled`, `cookies` | No CSS selectors needed |
| `spider_ai_search` | AI-enhanced search with intent understanding and relevance ranking | `search`, `prompt` (optional AI guidance), `num`, `fetch_page_content`, `country`, `language`, `tbs` | `prompt` supplements query for ranking |
| `spider_ai_browser` | Automate browser via natural language instructions | `url`, `prompt`, `return_format`, `proxy_enabled`, `cookies` | NL → browser actions |
| `spider_ai_links` | Find and categorize links by description | `url`, `prompt`, `limit`, `return_format`, `request` | AI-filtered link extraction |

**Browser Automation Tools (9) — session-based CDP via browser.spider.cloud:**

| Tool | Description | Key Params | Notes |
|------|-------------|------------|-------|
| `spider_browser_open` | Open remote browser session, returns `session_id` | `browser` (chrome/chrome-new/firefox/auto), `stealth` (0–3: 0=auto, 1=standard, 2=residential, 3=premium) | Auto-closes after 5 min inactivity |
| `spider_browser_navigate` | Navigate to URL, wait for load | `session_id`, `url` | Returns URL + title |
| `spider_browser_click` | Click by CSS selector, waits for element | `session_id`, `selector`, `timeout` (default 10s) | — |
| `spider_browser_fill` | Fill form field, clears first | `session_id`, `selector`, `value`, `timeout` | — |
| `spider_browser_screenshot` | Screenshot current page, returns base64 PNG | `session_id` | — |
| `spider_browser_content` | Get page HTML or visible text | `session_id`, `format` (html/text) | — |
| `spider_browser_evaluate` | Execute JS in page context | `session_id`, `expression` | Function wrapper for multi-line code |
| `spider_browser_wait_for` | Wait for selector, navigation, or network idle | `session_id`, `selector`, `navigation`, `timeout` (default 30s) | Flexible wait condition |
| `spider_browser_close` | Close session, release resources | `session_id` | Always call to stop billing |

### Agent-First Patterns

1. **Three-tier tool hierarchy**: Core (cheap, no subscription) → AI (smart, subscription) → Browser (interactive, session-based). Reduces cognitive load — agent picks tier first, then tool.
2. **Credit cost disclosed in description**: `spider_unblocker` states "Costs 10-40 extra credits per successful unblock" — agents can make cost-aware decisions.
3. **`request` enum on every scrape-class tool**: `["http", "chrome", "smart"]` — "smart" is auto-detect, documented as default. Agents don't need to guess.
4. **`budget` param for crawl cost control**: `{'*': 100, '/blog': 20}` pattern — agents can cap pages per path section.
5. **`spider_transform` for offline conversion**: HTML-to-markdown without network. Agents that already have HTML don't need to re-fetch.
6. **Stealth escalation levels (0–3) on `spider_browser_open`**: Explicit numeric stealth level — agent can escalate on block without switching tools.
7. **`cron` scheduling on crawl**: Agents can set up recurring crawls without external scheduler.

### Strengths vs novada-search

- 22 tools vs novada-search's 11 — broadest coverage of any MCP reviewed
- `spider_transform`: offline HTML-to-markdown conversion — no equivalent in novada-search
- `spider_ai_*` tier: NL-driven scraping/crawling without CSS selectors — novada-search has no AI-guided extraction
- `spider_unblocker` with explicit credit cost in description — agent-friendly cost transparency
- Full CDP browser automation (9 tools) with stealth levels — novada_browser is less granular
- `budget` per-path page cap — novada_crawl has no equivalent cost control
- `cron` scheduling on crawl — novada-search has no scheduling
- Streaming responses on all REST tools

### Weaknesses vs novada-search

- No multi-engine SERP support (Google/Bing/DDG/Yahoo/Yandex) — `spider_search` is single engine
- No structured platform scraping catalog (Amazon, TikTok, LinkedIn, etc.)
- No fact verification / claim-checking tool
- No residential proxy credential export (like novada-proxy)
- No health check endpoint (has `spider_get_credits` as a functional proxy)
- AI tools require separate subscription — two-tier billing complexity
- 1 GitHub star (v2) — extremely low adoption signal, no community vetting
- Tool descriptions lack "Best for / Not for / Common mistakes" pattern

---

## Scrapfly MCP

**Repo:** https://github.com/scrapfly/scrapfly-mcp  
**Stars:** 8  
**Language:** Go  
**License:** None specified  
**Hosted endpoint:** `https://mcp.scrapfly.io/mcp` (HTTP)  
**Version:** Active (updated 2026-04-29 — very recent)

Scrapfly is an enterprise anti-bot scraping platform. Their MCP is written in Go and uses the official MCP Go SDK. Notable for a unique "Proof-of-Work" (PoW) anti-misuse gate on scraping tools, dynamic tool mounting for browser sessions, and a `check_if_blocked` antibot detector.

### Tools Inventory

**Static tools (always-on):**

| Tool | Description | Key Params | Notes |
|------|-------------|------------|-------|
| `web_scrape` | One-shot URL fetch with full control. Stateless. "This is the right tool whenever the task is 'get the content/bytes at this URL'." | `url`, `method` (GET/POST/etc.), `body`, `headers`, `country` (ISO 3166-1 alpha-2), `proxy_pool` (public_datacenter_pool/public_residential_pool), `render_js`, `rendering_wait` (ms), `asp` (Anti Scraping Protection, "prefer true"), `cache`, `cache_ttl`, `cache_clear`, `js` (inline JS to execute), `js_scenario` (multi-step scenario), `screenshots` (array of {name, target: fullpage/selector}), `format` (clean_html/markdown/text/raw), `format_options` (no_links/no_images/only_content), `extraction_prompt`, `extraction_model`, `wait_for_selector`, `cookies`, `lang`, `retry`, `timeout`, `pow` | `pow` is a gate requiring agent to call `scraping_instruction_enhanced` first; format `i_know_what_i_am_doing:<token>` |
| `web_get_page` | Quick-fetch URL with sane defaults. "Right choice for simple 'get me the page' asks." Falls back to `web_scrape` when tuning needed. | `url`, `country`, `format`, `format_options`, `proxy_pool`, `rendering_wait`, `capture_page`, `capture_flags`, `extraction_model`, `pow` | Simplified surface of `web_scrape` |
| `screenshot` | Stateless one-shot PNG screenshot | `url`, `capture` (fullpage OR CSS selector) | Note: no `selector` param — use `capture` for element-level shots |
| `check_if_blocked` | Detect if a scrape result is actually a block page. Runs Scrapfly classification API (Cloudflare/DataDome/PerimeterX/Akamai/Kasada/Imperva/AWS WAF/F5 detected). Costs 1 credit. | `url`, `content` (HTML/text from scrape), `status_code`, `response_headers` | Returns `is_blocked`, `antibot` (vendor name), `confidence`, `recommendation` |
| `scraping_instruction_enhanced` | "Call this before your first `web_scrape` / `web_get_page` on an unfamiliar target." Returns cheat-sheet of options. | None (no params) | Provides the `pow` token for scraping tools |
| `info_account` | Return account state: plan, credits, concurrency limits | None | — |
| `info_api_key` | Return current API key | None | — |
| `cloud_browser_open` | Open stateful real-browser session. Use for interaction (clicking, form filling, multi-step navigation). "Do NOT use for plain 'download URL' tasks." | `url`, `country`, `proxy_pool`, `timeout` (default 900s, max 1800s), `block_images`, `block_styles`, `block_fonts`, `block_media`, `blacklist`, `cache`, `optimize_bandwidth` (shortcut enables all blocking+cache), `debug` | Mounts interaction tools dynamically after open |
| `browser_unblock` | Same as `cloud_browser_open` but runs anti-bot bypass first | Same as `cloud_browser_open` | Use when plain open lands on challenge/captcha |
| `cloud_browser_close` | Close session. "Call ONLY when user explicitly asks to end." | `session_id` (optional, defaults to most recent) | — |
| `cloud_browser_sessions` | List active browser sessions | None | — |

**Interaction tools (dynamically mounted after `cloud_browser_open`):**

| Tool | Description | Key Params |
|------|-------------|------------|
| `take_snapshot` | Accessibility tree + uid refs for clicking | `session_id` (optional) |
| `take_screenshot` | PNG of current state | `session_id`, `selector` |
| `click` / `fill` / `type_text` / `hover` / `press_key` / `scroll` / `drag` / `select_option` | Browser interaction actions | `session_id` (optional), target (uid from snapshot) |
| `cloud_browser_navigate` | Navigate session to new URL, preserves cookies/storage | `session_id`, `url` |
| `cloud_browser_screenshot` / `cloud_browser_eval` / `cloud_browser_performance` / `cloud_browser_downloads` | Session read tools | `session_id` |
| `list_webmcp_tools` / `call_webmcp_tool` | Call page-registered WebMCP tools (page author's declared API) | `tool_name`, `input` |

### Agent-First Patterns

1. **"Proof-of-Work" gate on scraping tools (`pow` param)**: Agents must call `scraping_instruction_enhanced` first to get a `pow` token. Prevents blind tool use and ensures agents have the cheat-sheet before their first scrape on unfamiliar targets. Format: `i_know_what_i_am_doing:<token>`. Unique pattern — no other competitor does this.
2. **`check_if_blocked` antibot detector**: Agent calls this after any suspicious scrape result before feeding content to user. Returns structured detection: `is_blocked` bool + `antibot` vendor + `confidence`. novada-search has no equivalent.
3. **`optimize_bandwidth` shortcut**: Single boolean enables all bandwidth optimizations (block images/styles/fonts/media + cache) — agents don't need to set 6 separate flags.
4. **WebMCP meta-tools (`list_webmcp_tools`, `call_webmcp_tool`)**: Agents can call page-registered APIs declared by the page author. Survives DOM refactors. Most agent-friendly interaction pattern reviewed.
5. **Dynamic tool mounting**: Browser interaction tools only appear in `tools/list` AFTER `cloud_browser_open` succeeds. Keeps the base tool surface minimal. Also available statically to handle ADK clients that don't re-fetch on `notifications/tools/list_changed`.
6. **Two-prompt resources**: `system_prompt` and `composite_prompt` resources provided — agent builders get recommended prompts out of the box.
7. **`cloud_browser_performance`**: PageSpeed Insights-style lab run with Core Web Vitals, waterfall, and Lighthouse score baked in. No other MCP reviewed has performance profiling.
8. **Disambiguation in descriptions**: `screenshot` tool explicitly states "There is NO `selector` parameter — use `capture`" — prevents a specific wrong-param mistake.

### Strengths vs novada-search

- `check_if_blocked` antibot detector — unique tool not found in any competitor reviewed; returns structured detection with vendor name
- `scraping_instruction_enhanced` PoW gate — forces agents to read the cheat-sheet before scraping, dramatically reducing misconfigured calls
- WebMCP meta-tools — page-author API invocation, most agent-friendly interaction pattern reviewed
- `optimize_bandwidth` single-flag bandwidth control — novada-search has no equivalent
- `cloud_browser_performance` with Core Web Vitals — no competitor equivalent
- `cloud_browser_downloads` — capture file downloads during browser session
- Full MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool
- `title` field on every tool (human-readable label in addition to `name`)
- Hosted HTTP endpoint (`https://mcp.scrapfly.io/mcp`) + VS Code/Cursor one-click install badges
- 100+ country proxy network (datacenter + residential) — enterprise-grade

### Weaknesses vs novada-search

- No multi-engine SERP (Google/Bing/DDG/Yahoo/Yandex)
- No structured platform scraping catalog (Amazon, TikTok, LinkedIn 129-platform equivalent)
- No fact verification / claim-checking tool
- No research tool (novada_research equivalent)
- `pow` gate adds friction — agents must make an extra tool call before first scrape
- No caching-layer controls visible to agent (unlike Firecrawl's `maxAge`/`storeInCache`)
- 8 GitHub stars — low adoption signal for a claimed "enterprise" offering
- No npm package listed (Go binary only for self-hosted; cloud endpoint requires registration)
