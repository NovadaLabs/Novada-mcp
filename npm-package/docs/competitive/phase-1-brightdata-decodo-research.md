# BrightData + Decodo MCP — Competitive Research
Date: 2026-04-30

## Sources
- BrightData MCP: https://github.com/brightdata/brightdata-mcp (npm: `@brightdata/mcp` v2.9.5)
- Decodo MCP: https://github.com/Decodo/mcp-server (npm: `@decodo/mcp-server` v1.2.0)

---

## BrightData MCP

### Overview
- Repo: https://github.com/brightdata/brightdata-mcp
- Stars: 2,332 | Forks: 298 | npm downloads (last 30d): ~24,913
- npm package: `@brightdata/mcp`
- Version: 2.9.5 (active, updated 2026-04-30)
- Free tier: 5,000 requests/month
- Architecture: Single `server.js` file using FastMCP library, plain JS (not TypeScript)
- Auth: `API_TOKEN` env var → Bearer token to `api.brightdata.com`
- Hosted option: `https://mcp.brightdata.com/mcp?token=YOUR_TOKEN`
- Auto-creates required BrightData zones on startup (`mcp_unlocker`, `mcp_browser`)

### Tools Inventory

#### Core Tools (always available in default/free tier)
| Tool | Description | Key Params |
|------|-------------|------------|
| `search_engine` | Scrape SERP from Google, Bing, or Yandex | `query`, `engine` (enum: google/bing/yandex), `cursor` (pagination), `geo_location` (2-letter ISO) |
| `scrape_as_markdown` | Scrape URL with anti-bot bypass → Markdown | `url` |
| `discover` | AI-ranked web discovery with intent scoring | `query`, `intent`, `country`, `city`, `language`, `num_results`, `filter_keywords`, `remove_duplicates`, `start_date`, `end_date` |

#### Advanced Scraping Tools (GROUPS="advanced_scraping")
| Tool | Description | Key Params |
|------|-------------|------------|
| `search_engine_batch` | Run up to 5 searches simultaneously | `queries[]` (each with query, engine, cursor, geo) |
| `scrape_batch` | Scrape up to 5 URLs simultaneously → Markdown array | `urls[]` (max 5) |
| `scrape_as_html` | Scrape URL → raw HTML | `url` |
| `extract` | Scrape → AI extraction → structured JSON (uses MCP sampling) | `url`, `extraction_prompt` |
| `session_stats` | Report tool usage in session | none |

#### Browser Automation Tools (GROUPS="browser", Pro/paid)
| Tool | Description | Key Params |
|------|-------------|------------|
| `scraping_browser_navigate` | Navigate to URL via real browser | `url`, `country` (2-letter ISO) |
| `scraping_browser_snapshot` | ARIA snapshot of current page (refs for interaction) | `filtered` (bool) |
| `scraping_browser_click_ref` | Click element by ARIA ref | `ref`, `element` (description) |
| `scraping_browser_type_ref` | Type into element by ARIA ref | `ref`, `element`, `text`, `submit` |
| `scraping_browser_screenshot` | Screenshot current page as image | `full_page` (bool) |
| `scraping_browser_get_html` | Get current page HTML | `full_page` |
| `scraping_browser_get_text` | Get current page text | none |
| `scraping_browser_scroll` | Scroll to page bottom | none |
| `scraping_browser_scroll_to_ref` | Scroll to element by ARIA ref | `ref`, `element` |
| `scraping_browser_network_requests` | List all network requests on current page | none |
| `scraping_browser_wait_for_ref` | Wait for element by ARIA ref | `ref`, `element` |
| `scraping_browser_fill_form` | Fill form fields | (not read) |
| `scraping_browser_go_back` | Browser back | none |
| `scraping_browser_go_forward` | Browser forward | none |

#### Web Data / Dataset Tools (40+ tools, Pro mode, grouped by domain)

BrightData's biggest differentiator: structured cached datasets for specific platforms. All prefixed `web_data_`:

**E-commerce (GROUPS="ecommerce"):**
`web_data_amazon_product`, `web_data_amazon_product_reviews`, `web_data_amazon_product_search`, `web_data_walmart_product`, `web_data_walmart_seller`, `web_data_ebay_product`, `web_data_homedepot_products`, `web_data_zara_products`, `web_data_etsy_products`, `web_data_bestbuy_products`, `web_data_google_shopping`

**Social Media (GROUPS="social"):**
`web_data_linkedin_person_profile`, `web_data_linkedin_company_profile`, `web_data_linkedin_job_listings`, `web_data_linkedin_posts`, `web_data_linkedin_people_search`, `web_data_instagram_profiles`, `web_data_instagram_posts`, `web_data_instagram_reels`, `web_data_instagram_comments`, `web_data_facebook_posts`, `web_data_facebook_marketplace_listings`, `web_data_facebook_company_reviews`, `web_data_facebook_events`, `web_data_tiktok_profiles`, `web_data_tiktok_posts`, `web_data_tiktok_shop`, `web_data_tiktok_comments`, `web_data_x_posts`, `web_data_x_profile_posts`, `web_data_youtube_profiles`, `web_data_youtube_comments`, `web_data_youtube_videos`, `web_data_reddit_posts`

**Business/Finance (GROUPS="business"/"finance"):**
`web_data_crunchbase_company`, `web_data_zoominfo_company_profile`, `web_data_google_maps_reviews`, `web_data_zillow_properties_listing`, `web_data_booking_hotel_listings`, `web_data_yahoo_finance_business`

**GEO/AI Brand Visibility (GROUPS="geo"):**
`web_data_chatgpt_ai_insights`, `web_data_grok_ai_insights`, `web_data_perplexity_ai_insights`

**Code/Dev (GROUPS="code"):**
`web_data_npm_package`, `web_data_pypi_package`

**Research/App Stores:**
`web_data_github_repository_file`, `web_data_reuter_news`, `web_data_google_play_store`, `web_data_apple_app_store`

#### MCP Prompts (embedded guidance)
| Prompt | Purpose |
|--------|---------|
| `web_scraping_strategy` | Decision tree: dataset tool → scrape_as_markdown → browser API |
| `diagnose_scraping_approach` | Two-step diagnostic to discover best approach for a new site |

### Agent-First Design Patterns

1. **Embedded decision tree prompt** (`web_scraping_strategy`): Agents invoke this at session start to learn the correct tool selection order. This is explicit agent guidance baked into the MCP itself.

2. **ARIA ref-based browser automation**: Instead of CSS selectors (which break), browser tools use ARIA snapshots with stable `ref` attributes. Agent workflow: snapshot → get ref → click/type/scroll by ref. Highly agent-friendly.

3. **MCP annotations used correctly**: Every tool has `readOnlyHint: true` and `openWorldHint: true` where appropriate. Browser mutating tools have `destructiveHint: true`.

4. **Tool group filtering**: Agent (or user) can set `GROUPS` env var to scope which tools are available — reduces tool noise for the agent.

5. **Soft error handling**: Uses `UserError` (from FastMCP) which surfaces errors gracefully to the agent rather than crashing.

6. **Rate limiting with env config**: `RATE_LIMIT=100/1h` format — easy to configure.

7. **Progress reporting during async polls**: `ctx.reportProgress()` called during long-running dataset/discover operations so agents see status.

8. **Batch tools**: `search_engine_batch` and `scrape_batch` let agents do parallel work in one call — reduces round trips.

### Strengths vs novada-search
1. **Scale of structured datasets**: 40+ platform-specific cached datasets (LinkedIn, Amazon, Instagram, Facebook, etc.). We have none — we always live-scrape.
2. **Browser automation suite**: 14 browser tools for complex JS sites — novada has 1 (`browser`). BrightData's is ref-based ARIA which is more reliable.
3. **GEO/LLM brand visibility tools**: ChatGPT/Grok/Perplexity query tools — unique capability novada lacks.
4. **Batch operations**: `search_engine_batch` (5 queries) and `scrape_batch` (5 URLs) in one call — novada has no batch tools.
5. **npm/PyPI package lookup**: `web_data_npm_package`, `web_data_pypi_package` — targeted at coding agents. Novada lacks this.
6. **Decision tree prompt embedded**: `web_scraping_strategy` guides agents before first tool call — we have no prompts.
7. **5,000 free requests/month**: Clear free tier; novada pricing is less visible in the MCP.
8. **Star count**: 2,332 stars vs novada's less visible GitHub presence.
9. **Download velocity**: 24,913 npm downloads/month vs novada's 1,604.

### Weaknesses vs novada-search
1. **No dedicated proxy tool**: Agents can't select proxy type/country/rotation — it's implicit.
2. **No `verify` tool**: No URL/content verification tooling.
3. **No `map` tool**: No site-map crawling/link discovery.
4. **No `research` tool**: No multi-step deep research workflow.
5. **No `crawl` tool**: Can't crawl an entire site systematically.
6. **Platform lock-in**: Everything routes through BrightData's zones/API. No bring-your-own-proxy.
7. **Tool discovery complexity**: 60+ tools (Pro mode) — agent confusion without the decision tree prompt.
8. **JavaScript-only**: No TypeScript, no types, harder to reason about for contributors.
9. **`discover` uses polling (up to 600s timeout)**: Can time out agents waiting for results.

---

## Decodo MCP

### Overview
- Repo: https://github.com/Decodo/mcp-server
- Stars: 25 | Forks: 10 | npm downloads (last 30d): ~571
- npm package: `@decodo/mcp-server`
- Version: 1.2.0
- Parent company: Smartproxy (rebranded as Decodo for MCP)
- Architecture: TypeScript, modular OOP (class per tool), HTTP server with Express + StreamableHTTP transport
- Auth: `Basic` auth token passed as HTTP header (`Authorization: Basic <token>`)
- Hosted option: `https://mcp.decodo.com/mcp` with `Authorization: Basic <token>` header
- Toolset filtering: via `?toolsets=web,ai` query param on hosted, or `TOOLSETS` env var for local

### Tools Inventory

| Toolset | Tool Name | Description | Key Params |
|---------|-----------|-------------|------------|
| `web` | `scrape_as_markdown` | Scrape URL → Markdown (with JS render option) | `url`, `geo`, `locale`, `jsRender`, `tokenLimit` |
| `web` | `screenshot` | Capture page as PNG image | `url`, `geo` |
| `search` | `google_search` | Google SERP scrape, auto-parsed | `query`, `geo`, `locale`, `jsRender` |
| `search` | `google_ads` | Google Ads results | `query`, `geo`, `locale`, `jsRender` |
| `search` | `google_lens` | Google Lens image search | `imageUrl`, `geo` |
| `search` | `google_ai_mode` | Google AI Mode results | `query`, `geo`, `locale` |
| `search` | `google_travel_hotels` | Google Travel hotel results | `query`, `geo`, `locale` |
| `search` | `bing_search` | Bing SERP | `query`, `geo`, `locale`, `jsRender` |
| `ecommerce` | `amazon_search` | Amazon product search | `query`, `domain`, `geo`, `locale` |
| `ecommerce` | `amazon_product` | Amazon product page | `url`, `geo`, `locale` |
| `ecommerce` | `amazon_pricing` | Amazon pricing info | `url`, `geo` |
| `ecommerce` | `amazon_sellers` | Amazon seller info | `url`, `geo` |
| `ecommerce` | `amazon_bestsellers` | Amazon bestseller lists | `url`, `geo` |
| `ecommerce` | `walmart_search` | Walmart search | `query`, `geo`, `deliveryZip`, `storeId` |
| `ecommerce` | `walmart_product` | Walmart product page | `url`, `geo` |
| `ecommerce` | `target_search` | Target search | `query`, `geo`, `deliveryZip`, `storeId` |
| `ecommerce` | `target_product` | Target product page | `url`, `geo` |
| `ecommerce` | `tiktok_shop_search` | TikTok Shop search | `query`, `country` |
| `ecommerce` | `tiktok_shop_product` | TikTok Shop product | `url`, `country` |
| `ecommerce` | `tiktok_shop_url` | TikTok Shop URL scrape | `url`, `country` |
| `social_media` | `tiktok_post` | TikTok post data | `url`, `xhr` |
| `social_media` | `reddit_post` | Reddit post scrape | `url`, `geo` |
| `social_media` | `reddit_subreddit` | Reddit subreddit posts | `url`, `geo` |
| `social_media` | `reddit_user` | Reddit user profile | `url`, `geo` |
| `social_media` | `youtube_metadata` | YouTube video metadata | `url`, `geo` |
| `social_media` | `youtube_channel` | YouTube channel videos | `url`, `limit`, `geo` |
| `social_media` | `youtube_subtitles` | YouTube video subtitles | `url`, `language_code` |
| `social_media` | `youtube_search` | YouTube video search | `query`, `geo` |
| `ai` | `chatgpt` | Query ChatGPT | `prompt`, `search` (bool), `geo` |
| `ai` | `perplexity` | Query Perplexity | `prompt`, `geo` |
| `ai` | `google_ai_mode` | Google AI mode results | `query`, `geo`, `locale` |

**Total: 30 tools across 5 toolsets** (web, search, ecommerce, social_media, ai)

### Agent-First Design Patterns

1. **Token limit parameter**: `tokenLimit` on scrape tools — agent can explicitly cap response size to avoid context overflow. Truncation warning is surfaced to the agent: *"The website content is over 100,000 symbols, therefore, the content has been truncated. If you wish to obtain the full response, just say 'full response'."* Teaches the agent to iterate.

2. **Toolset scoping**: Agents/deployments can scope to `?toolsets=web,ai` — reduces tool count the agent sees, reduces confusion.

3. **HTTP transport + stateless per-request auth**: Auth is per-request in HTTP header — no env var setup required when using hosted. Easier for agent deployments.

4. **Standardized shared params via zod types**: `geo`, `locale`, `jsRender`, `tokenLimit`, `deviceType` are defined once in `zod-types.ts` and reused across all tools — consistent parameter names agents can learn once.

5. **README-embedded example prompts**: Every tool has an "Example prompt" column showing agents exactly how to invoke it via natural language.

6. **Class-based OOP per tool**: Each tool is a class with `register()` and `transformResponse()` — clean separation, easy to add tools.

7. **Retry with exponential backoff**: Client-side retry on 429/502/503/504 with `Retry-After` header support — agents don't need to handle transient failures.

8. **XHR capture**: `xhr: true` param on some tools includes XHR/fetch responses — useful for SPA scraping.

### Strengths vs novada-search
1. **`tokenLimit` param**: Explicit per-call token budget — novada doesn't expose this.
2. **Screenshot returns actual image** (MCP image content type, not URL) — directly usable by multimodal agents.
3. **AI tool toolset**: ChatGPT, Perplexity, Google AI Mode querying — novada has none of these.
4. **Target.com support**: Neither BrightData nor novada specifically target this.
5. **YouTube subtitles**: Clean subtitle extraction with language code — novada lacks this.
6. **HTTP-native hosted deployment**: Token in header, no npx needed — easier to integrate in agent orchestration frameworks.
7. **`deviceType` param**: Desktop/mobile/tablet emulation — novada lacks this.
8. **`locale` param**: Explicit locale vs just country — finer-grained control.
9. **`domain` param for Amazon**: `amazon.com` vs `amazon.co.uk` etc — useful for international ecommerce agents.

### Weaknesses vs novada-search
1. **No proxy tool**: No direct proxy IP access or rotation control.
2. **No verify tool**: No URL reachability/status verification.
3. **No map tool**: No site crawl/link discovery.
4. **No research tool**: No multi-step deep research orchestration.
5. **No crawl tool**: No recursive site crawling.
6. **No browser automation**: Just scrape/screenshot, no interaction tools.
7. **No unblock tool**: No explicit unblock API for bypassing bot detection beyond `jsRender`.
8. **Small community**: 25 stars, 571 downloads/month — early stage.
9. **Hosted-only deployment complexity**: Per-request HTTP auth is cleaner for cloud but adds friction for local dev.
10. **Platform-specific tools only**: Everything is a specific platform — no "generic URL" research workflow.

---

## Cross-Competitor Patterns

What BOTH BrightData and Decodo do that novada-search currently lacks:

### 1. Platform-Specific Structured Tools
Both have dedicated tools for LinkedIn, Amazon, TikTok, YouTube, Reddit, etc. These return pre-parsed structured JSON — not raw markdown. Novada's `scrape` has 129 platform definitions but returns markdown/HTML, not structured JSON datasets.

**Implication:** Agents need structured data for downstream tasks. Both competitors invest heavily in structured extraction.

### 2. AI/LLM Query Tools
Both offer tools to query ChatGPT, Perplexity, and Google AI Mode directly. This is a GEO (Generative Engine Optimization) use case — agents checking how LLMs answer about a topic/brand. Novada has none of this.

**Implication:** This is a fast-growing use case. Low effort to add `research_ai_perception` capability.

### 3. Toolset/Group Filtering
Both allow scoping which tools the agent sees (`GROUPS=ecommerce` or `?toolsets=search`). This reduces cognitive load for the agent and allows deployment-specific configurations.

**Implication:** Novada should consider grouping tools by use case.

### 4. Geo/Country Parameter on Every Tool
Both make `geo`/`geo_location` available on essentially every tool. In novada, geo-targeting is inside `proxy` — not surfaced at the scrape/search level.

**Implication:** Agent-friendlier to expose `country` as a first-class param on each tool, not just proxy.

### 5. Example Prompts in README
Both (especially Decodo) provide natural language example prompts per tool. Decodo has an "Example prompt" column in their README tool table. This is agent documentation, not just human docs.

**Implication:** novada-mcp README lacks natural language example prompts for each tool.

### 6. Token/Response Size Management
Decodo has `tokenLimit` param. BrightData strips markdown (remark + strip-markdown) to reduce token count. Both actively manage response size for agent context windows.

**Implication:** novada tools return raw content — no token budget control exposed to agents.

### 7. Batch Operations
BrightData has `search_engine_batch` and `scrape_batch`. Neither novada nor Decodo match this (Decodo has none). Agents that need to research multiple URLs/queries benefit enormously from batch tools.

### 8. Hosted/Remote MCP Option
Both offer a hosted URL option (`https://mcp.brightdata.com/mcp`, `https://mcp.decodo.com/mcp`). Agents using cloud-hosted orchestrators can connect without running npx locally. Novada currently only has local via npx.

**Implication:** novada should expose a hosted MCP endpoint.

---

## Novada Unique Capabilities (not in either competitor)

1. `verify` — URL/content verification
2. `map` — site-map crawling / link discovery
3. `research` — multi-step deep research orchestration
4. `crawl` — recursive site crawling
5. `proxy` — explicit proxy selection and rotation
6. `unblock` — dedicated anti-bot bypass
7. `health` — server health check tool
8. 129-platform `scrape` catalog — though Decodo/BrightData have structured datasets, novada's breadth of platform definitions for scraping is large

---

## Raw Data / Links

- BrightData GitHub: https://github.com/brightdata/brightdata-mcp
- BrightData npm: https://www.npmjs.com/package/@brightdata/mcp (v2.9.5)
- BrightData hosted MCP: https://mcp.brightdata.com/mcp
- BrightData pricing page: https://brightdata.com/ai/mcp-server
- Decodo GitHub: https://github.com/Decodo/mcp-server
- Decodo npm: https://www.npmjs.com/package/@decodo/mcp-server (v1.2.0)
- Decodo hosted MCP: https://mcp.decodo.com/mcp
- Decodo dashboard: https://dashboard.decodo.com/integrations
- npm downloads last 30d: BrightData ~24,913 | Decodo ~571 | novada-mcp ~1,604
