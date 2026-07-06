# novada-mcp vs Firecrawl vs Tavily vs BrightData — MCP Competitive Benchmark

> Date: 2026-05-21  
> Version: novada-mcp@0.7.6, firecrawl-mcp (latest), tavily-mcp (latest), @brightdata/mcp (latest)  
> Source: GitHub READMEs + tool source code analysis

---

## 1. Tool Count / Breadth

| Capability | novada-mcp | Firecrawl | Tavily | BrightData |
|------------|-----------|-----------|--------|------------|
| Search | novada_search (Google/Bing/DDG/Yandex) | firecrawl_search | tavily-search | search_engine |
| Extract / Scrape URL | novada_extract (batch up to 10) | firecrawl_scrape, firecrawl_batch_scrape | tavily-extract | scrape_as_markdown |
| Crawl | novada_crawl | firecrawl_crawl | tavily-crawl | — |
| Site Map | novada_map | firecrawl_map | tavily-map | discover |
| Research (multi-source) | novada_research | firecrawl_agent | — | — |
| Fact Verify | novada_verify | — | — | — |
| Browser CDP | novada_browser | firecrawl_interact | — | scraping_browser_* (Pro) |
| Browser Flow | novada_browser_flow | — | — | — |
| Proxy config | novada_proxy, novada_proxy_residential/datacenter/mobile/isp/static/dedicated (6 types) | — | — | Proxy built-in; no direct tool |
| Platform scrapers | novada_scrape (129 platforms) | — | — | web_data_* tools (groups: ecommerce/social/finance/business/travel/app_stores) |
| Async scraper queue | novada_scraper_submit/status/result | — | — | — |
| Unblock raw HTML | novada_unblock | — | — | — |
| Health check | novada_health, novada_health_all | — | — | — |
| Discover (smart URL find) | novada_discover | — | — | discover |
| **Total distinct tools** | **~24** | **~8** | **4** | **~15–60+ (mode-gated)** |

**Winner — breadth:** novada-mcp (24 tools, always-on) > BrightData (more tools but most gated behind PRO_MODE) > Firecrawl (~8) > Tavily (4).

---

## 2. Output Formats

| Format | novada-mcp | Firecrawl | Tavily | BrightData |
|--------|-----------|-----------|--------|------------|
| Markdown | Yes (default) | Yes (default) | Yes | Yes (default) |
| JSON | Yes (structured, typed) | Yes (with schema) | Yes | Yes |
| Plain text | Yes | — | — | — |
| Raw HTML | Yes (novada_unblock / extract format=html) | Yes | — | scrape_as_html |
| toon (token-optimized pipe format) | Yes (40–65% smaller) | — | — | — |
| Screenshot | Via browser snapshot | Yes | — | scraping_browser_screenshot (Pro) |
| PDF extraction | Yes (auto-detect) | Yes (media parsing) | — | — |
| Branding extract | — | Yes | — | — |

**Winner — formats:** Firecrawl (screenshot + branding) and novada-mcp (toon format unique, PDF auto-detect, raw HTML tool). Tie for agent-use formats (markdown/json).  
**novada-mcp advantage:** `toon` format is unique — 40–65% token savings vs JSON/markdown. No other MCP offers this.

---

## 3. Agent-First Features

| Feature | novada-mcp | Firecrawl | Tavily | BrightData |
|---------|-----------|-----------|--------|------------|
| Quality scores (0–100 + label) | Yes — every extract returns `quality:score/100 (label)` | — | — | — |
| Auto-escalation (static→render→browser) | Yes — built into novada_extract auto mode | — | — | — |
| Agent hints block | Yes — every tool response ends with `## Agent Hints` | — | — | — |
| agent_instruction in errors | Yes — structured error responses include next-step instructions | — | — | — |
| extract_options on search | Yes — inline content extraction from top-N results in one call | — | — | — |
| Batch extract (up to 10 URLs parallel) | Yes | Yes (batch_scrape, async) | — | Yes (scrape_batch) |
| Session persistence (browser) | Yes — 5x faster warm reuse, 10min TTL | Yes (interact uses scrape_id) | — | Yes (scraping_browser_navigate) |
| Fact verification tool | Yes (novada_verify — 3-angle search + scoring) | — | — | — |
| Async queue with polling | Yes (scraper_submit/status/result) | Yes (async crawl) | — | — |
| reranked results | Yes — search results reranked by keyword relevance | — | — | — |
| Reddit auto-rewrite | Yes (new→old.reddit.com) | — | — | — |
| Domain registry (skip JS probe) | Yes | — | — | — |
| fetched_at timestamp | Yes | — | — | — |

**Winner — agent-first:** novada-mcp by a significant margin. Quality scores, auto-escalation, agent hints on every response, and structured error instructions are not present in any competitor.

---

## 4. Pricing Model

| Aspect | novada-mcp | Firecrawl | Tavily | BrightData |
|--------|-----------|-----------|--------|------------|
| Model | Pay-per-use (usage-based) | Credit-based (credit bundles) | Subscription tiers + usage | Free tier (5K req/mo) + pay-as-you-go Pro |
| Free tier | No (API key required at signup) | Yes (limited) | Yes (1,000 searches/mo) | Yes — 5,000 requests/month |
| Self-host option | No | Yes (open source) | No | No |
| Proxy pricing | Separate per-GB (res/mobile/ISP/DC) | Not offered | Not offered | Built into plan |
| Scraper pricing | Per-record (platform scrapers) | Not offered | Not offered | Via web_data tools (Pro) |

**Winner — free tier:** BrightData (5,000 free requests/month).  
**Winner — transparency:** novada-mcp and Firecrawl (clear per-use billing).  
**Honest note:** Firecrawl is open source — self-hosted deployments have no per-call cost. novada-mcp and BrightData are closed-API only.

---

## 5. Rendering Support

| Mode | novada-mcp | Firecrawl | Tavily | BrightData |
|------|-----------|-----------|--------|------------|
| Static fetch | Yes | Yes | Yes | Yes |
| JS render (Web Unblocker / headless) | Yes (`render=js`) | Yes (default for most sites) | Yes | Yes (Web Unlocker) |
| Full browser CDP | Yes (`render=browser`, NOVADA_BROWSER_WS) | Yes (firecrawl_interact / browser) | No | Yes (scraping_browser group, Pro) |
| Auto-escalation (static→render→browser) | Yes — automatic with quality scoring | No (manual format selection) | No | No |
| Wait-for-selector | Yes (novada_unblock: wait_for param) | Yes (actions: wait) | No | Yes |
| Multi-step browser actions | Yes (novada_browser: navigate/click/type/scroll/hover/press_key/select) | Yes (firecrawl_interact: AI prompt or code) | No | Yes (browser group) |
| Country-targeted rendering | Yes (country param on browser/unblock/proxy) | No documented | No | Yes (geo-targeting) |
| PDF auto-extract | Yes (auto-detect content-type) | Yes (media parsing) | No | No documented |

**Winner — rendering depth:** Tie between novada-mcp and Firecrawl for full-stack rendering. novada-mcp unique advantage: automatic escalation with quality scoring means agents don't need to manually pick render mode.  
**BrightData advantage:** Enterprise-grade unblocking infrastructure (world's #1 proxy network).

---

## 6. Platform Scrapers

| Aspect | novada-mcp | Firecrawl | Tavily | BrightData |
|--------|-----------|-----------|--------|------------|
| Dedicated platform scrapers | 129 platforms via novada_scrape | — | — | Yes (grouped: ecommerce/social/finance/business/travel/app_stores/code/geo) |
| Amazon | Yes (product_keywords, product_asin) | — | — | web_data_amazon_product |
| LinkedIn | Yes (company_information_url) | — | — | web_data_linkedin_posts |
| TikTok | Yes (posts_url) | — | — | web_data_tiktok_posts |
| Twitter/X | Yes (profile_username) | — | — | — |
| YouTube | Yes (video_search_label) | — | — | web_data_youtube_videos |
| Reddit | Yes (auto-rewrite + static extract) | — | — | — |
| GitHub | Yes (repository_repo-url) | — | — | web_data_github_repository_file |
| Google Shopping | — | — | — | web_data_google_shopping |
| npm / PyPI | — | — | — | web_data_npm_package, web_data_pypi_package (code group) |
| LLM query (ChatGPT/Grok/Perplexity) | — | — | — | web_data_chatgpt/grok/perplexity_ai_insights (geo group) |
| Async scraper queue for platform ops | Yes (novada_scraper_submit/status/result) | — | — | — |
| Format options | markdown, json, toon | — | — | markdown (default) |

**Winner — platform scrapers:** novada-mcp (129 platforms, structured queue, 3 output formats) and BrightData (curated groups, unique LLM/GEO tools). BrightData has unique data types (LLM brand visibility, npm/PyPI). novada-mcp has broader raw count (129) and async queue.

---

## Overall Scorecard

| Dimension | Winner | novada | Firecrawl | Tavily | BrightData |
|-----------|--------|--------|-----------|--------|------------|
| Tool breadth | novada-mcp | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★★★★☆ |
| Output formats | Tie (novada/FC) | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★★☆☆ |
| Agent-first design | novada-mcp | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ |
| Pricing accessibility | BrightData | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Rendering stack | Tie (novada/FC) | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| Platform scrapers | Tie (novada/BD) | ★★★★★ | ★☆☆☆☆ | ★☆☆☆☆ | ★★★★☆ |

### Where competitors are genuinely stronger

- **Firecrawl:** Open source (self-hostable = zero marginal cost). Branding extraction. AI-prompt-driven browser interaction (natural language, not code).
- **Tavily:** Simplest integration (4 tools, remote MCP URL, OAuth). Lowest friction onboarding.
- **BrightData:** World's largest proxy network = highest unblocking reliability. Free tier (5K/mo). LLM brand visibility tools (ChatGPT/Grok/Perplexity) are unique. npm/PyPI package intelligence for coding agents.

### novada-mcp differentiation that competitors lack

1. Quality scoring on every extract (0–100 + label) — agents know when to retry
2. Auto-escalation (static→render→browser) with no agent effort
3. `## Agent Hints` block on every response — actionable next-step guidance
4. `toon` format — 40–65% token reduction for high-volume pipelines
5. `extract_options` on search — one tool call returns search + content (no second round-trip)
6. `novada_verify` — 3-angle fact checking with confidence scoring
7. 6 distinct proxy types (residential/mobile/ISP/datacenter/static/dedicated) as MCP tools
8. `novada_health` / `novada_health_all` — agent can self-diagnose service availability
