# novada

> One MCP server. All web data. Search, scrape, crawl, proxy, and AI research — in a single `npx` command.

[![npm version](https://img.shields.io/npm/v/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![npm downloads](https://img.shields.io/npm/dm/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## The Problem

AI agents need web data but the tools are fragmented:

- **Tavily** does search but can't scrape or proxy
- **Firecrawl** does scrape but can't search or proxy
- **BrightData** does everything but ships 69 tools that bloat your context window
- **Building it yourself** means maintaining proxies, anti-bot bypass, retry logic, and 10 different APIs

## The Fix

```bash
npx novada-mcp
```

One server. One API key. Tools that cover every web data need an AI agent has:

| Need | Tool | What it does |
|------|------|-------------|
| Find information | `novada_search` | Web search across Google, Bing, DuckDuckGo, Yandex, Yahoo |
| Read a page | `novada_extract` | Any URL → clean markdown, batch up to 10 in parallel |
| Deep research | `novada_research` | One call → parallel searches → dedup → cited multi-source report |
| Crawl a site | `novada_crawl` | BFS/DFS up to 20 pages with regex path filtering |
| Discover URLs | `novada_map` | Sitemap + BFS discovery without reading content |
| Platform data | `novada_scrape` | Amazon, LinkedIn, TikTok, GitHub, Zillow — 129 platforms |
| Monitor changes | `novada_monitor` | Track price/content/availability changes between checks |
| Verify claims | `novada_verify` | Parallel fact-checking against live web sources |
| Raw HTML | `novada_unblock` | JS render or full browser CDP for bot-protected pages |
| Browser automation | `novada_browser` | Navigate, click, type, fill forms, screenshot in cloud browser |
| Browser flows | `novada_browser_flow` | Multi-step browser automation sequences |
| Proxy credentials | `novada_proxy` | Residential, mobile, ISP, datacenter, static, dedicated — 195 countries |
| AI brand monitoring | `novada_ai_monitor` | Check how ChatGPT, Perplexity, Grok, Claude, Gemini mention your brand |
| Health check | `novada_health` | Check which API products are active on your key |
| Async scraping | `novada_scraper_submit` | Submit async scraping task → poll → retrieve results |

## What Makes This Different

**`novada_research` is unique.** No other MCP server turns one question into a cited multi-source report. It searches across Google, Bing, and DuckDuckGo in parallel, deduplicates, extracts full content from the top 5 sources, and synthesizes with citations. One tool call replaces an entire research workflow. Depth options: quick (3 queries), deep (5-6), comprehensive (8-10).

**Auto-escalation handles anti-bot automatically.** Static fetch → JS render → Browser CDP. Known hard targets (Amazon, LinkedIn, G2, Zillow, Glassdoor, Walmart, Instagram, TikTok, Shein) skip straight to the right method based on a 30+ domain registry. You never think about Cloudflare, DataDome, Kasada, or PerimeterX — the tool handles it.

**Agent-first design (8.5/10 benchmark score).** Every response includes `agent_instruction` with structured next-step guidance, `source` field (live/cache/wayback), structured errors with `failure_class`, cross-tool hints suggesting better alternatives, and a `## Agent Action` block with machine-parseable status codes.

## Quick Start

1. Get a key at [novada.com](https://www.novada.com)

2. Add to your MCP client:

**Claude Code:**
```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp
```

**Claude Desktop / Cursor / VS Code / Windsurf:**
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": { "NOVADA_API_KEY": "your_key" }
    }
  }
}
```

3. Try it:
```
novada_search({query: "Claude MCP tutorials", num: 5})
novada_research({question: "How do MCP servers work?", depth: "deep"})
novada_extract({url: "https://news.ycombinator.com", format: "markdown"})
novada_monitor({url: "https://amazon.com/dp/B09...", fields: ["price", "availability"]})
```

## Tool Reference

### Search & Research

| Tool | Purpose | Key Params | Example |
|------|---------|-----------|---------|
| `novada_search` | Web search via 5 engines | `query`, `engine`, `num`, `time_range`, `include_domains` | `novada_search({query: "best API gateways 2026", engine: "google", num: 10})` |
| `novada_research` | Multi-source parallel research | `question`, `depth`, `focus` | `novada_research({question: "Kong vs Traefik vs APISIX", depth: "comprehensive", focus: "performance benchmarks"})` |
| `novada_verify` | Fact-check claims against web | `claim` | `novada_verify({claim: "GPT-5 was released in 2026"})` |

### Extract & Crawl

| Tool | Purpose | Key Params | Example |
|------|---------|-----------|---------|
| `novada_extract` | Extract content from URL(s) | `url` (single or array), `format`, `render`, `fields` | `novada_extract({url: "https://example.com", fields: ["price", "rating"]})` |
| `novada_crawl` | Crawl multiple pages from a domain | `url`, `max_pages`, `strategy`, `select_paths` | `novada_crawl({url: "https://docs.example.com", max_pages: 10, select_paths: "/api/.*"})` |
| `novada_map` | Discover URLs on a site | `url`, `search`, `limit` | `novada_map({url: "https://example.com", search: "pricing"})` |
| `novada_monitor` | Detect page changes over time | `url`, `fields` | `novada_monitor({url: "https://amazon.com/dp/B09...", fields: ["price"]})` |

### Structured Platform Data

`novada_scrape` supports 129 platforms with structured data extraction. Returns clean tabular records, not raw HTML.

| Platform | Operation Examples | Data Returned |
|----------|-------------------|---------------|
| Amazon | `amazon_product_keywords`, `amazon_product_asin` | Title, price, rating, reviews, BSR, availability |
| LinkedIn | `linkedin_company_information_url`, `linkedin_profile_url` | Company info, employee count, profile data |
| TikTok | `tiktok_posts_url`, `tiktok_profile_url` | Video stats, engagement, profile data |
| GitHub | `github_repository_repo-url` | Stars, forks, issues, description, languages |
| Reddit | `reddit_subreddit_posts` | Posts, scores, comments, timestamps |
| Zillow | `zillow_property_url` | Price, beds, baths, sqft, Zestimate |
| Glassdoor | `glassdoor_company_reviews_url` | Reviews, ratings, salary data |
| YouTube | `youtube_video_search_label` | Video titles, views, duration, channel |
| Instagram | `instagram_profile_url` | Posts, followers, engagement |
| Google Shopping | `google_shopping_search` | Products, prices, merchants |

Full platform list: call `novada_discover` or read the `novada://scraper-platforms` MCP resource.

### Proxy Network

Route your own HTTP requests through Novada's proxy infrastructure. 100M+ IPs across 195 countries.

| Tool | Proxy Type | Best For |
|------|-----------|---------|
| `novada_proxy_residential` | Real home ISP IPs | Anti-bot bypass, geo-restricted content |
| `novada_proxy_isp` | ISP-assigned IPs | Social media, ecommerce platforms |
| `novada_proxy_datacenter` | Datacenter IPs | High-volume, non-protected targets |
| `novada_proxy_mobile` | 4G/5G mobile IPs | Mobile-targeted content, app APIs |
| `novada_proxy_static` | Dedicated static ISP IP | Account management, login flows |
| `novada_proxy_dedicated` | Exclusive datacenter IP | High-trust platforms, clean reputation |

Each proxy tool returns connection credentials in `url`, `env`, or `curl` format. Params: `country` (ISO 2-letter), `city` (optional), `session_id` (for sticky sessions).

### Browser Automation

| Tool | Purpose | Example |
|------|---------|---------|
| `novada_browser` | Full browser interaction via CDP | `novada_browser({actions: [{type: "navigate", url: "..."}, {type: "click", selector: "#btn"}]})` |
| `novada_browser_flow` | Multi-step automation sequences | Click, scroll, wait, type, screenshot — up to 20 actions per call |
| `novada_unblock` | Raw rendered HTML from protected pages | `novada_unblock({url: "...", method: "browser"})` |

Sessions persist across calls via `session_id`. Cookies, login state, and page context are maintained.

## Use Cases

### AI Agent Research & RAG Pipelines
```
novada_research({question: "What are the latest developments in quantum computing?", depth: "comprehensive"})
```
Returns a cited multi-source report. Feed directly into RAG vector stores or use as context for agent reasoning.

### E-Commerce Price Monitoring
```
novada_monitor({url: "https://amazon.com/dp/B0XXXXXX", fields: ["price", "availability"]})
```
First call records baseline. Call again later — returns field-level diffs with percentage change (e.g., price: $999 → $899, ↓10%).

### Competitive Intelligence
```
novada_scrape({platform: "amazon.com", operation: "amazon_product_keywords", params: {keyword: "wireless earbuds"}, limit: 20})
```
Get structured product data (price, rating, reviews, BSR) for competitive analysis across 129 platforms.

### Lead Generation
```
novada_scrape({platform: "linkedin.com", operation: "linkedin_company_information_url", params: {url: "https://linkedin.com/company/..."}, limit: 1})
```
Extract company info, employee count, and industry data from LinkedIn company pages.

### Content Extraction for LLM Training
```
novada_crawl({url: "https://docs.example.com", max_pages: 20, select_paths: "/docs/.*"})
```
Crawl documentation sites and extract clean markdown for fine-tuning datasets or knowledge bases.

### AI Brand Monitoring
```
novada_ai_monitor({brand: "YourProduct", models: ["chatgpt", "perplexity", "claude"]})
```
Check how AI models reference your brand: sentiment, claims, competitor mentions, source URLs.

### Geo-Targeted Data Collection
```
novada_proxy_residential({country: "DE", city: "berlin", format: "curl"})
```
Get proxy credentials for any of 195 countries. Use with your own HTTP client for geo-specific content access.

## Honest Comparison

|  | Novada | Firecrawl | Tavily | BrightData |
|---|---|---|---|---|
| Tools | 25 | 14 | 2 | 69 |
| Search engines | 5 | 0 | 1 | 3 |
| Multi-source research | **Yes** | No | No | No |
| Proxy as MCP tool | **Yes** | No | No | No |
| Auto anti-bot escalation | **Yes** | No | N/A | No |
| Change monitoring | **Yes** | No | No | No |
| Platform scraping | 129 platforms | No | No | 437 platforms |
| Browser automation | **Yes** (CDP) | No | No | Yes |
| MCP Prompts & Resources | **Yes** (5+4) | No | No | No |
| Hosted MCP (no install) | **No** | No | No | Yes |
| Agent-first score | 8.5/10 | 6.0 | 6.0 | N/A |

> **What we don't have yet:** hosted HTTP endpoint (requires terminal install for now), and some Scraper API platforms need separate activation. BrightData has more structured scrapers (437 vs 129).

## Anti-Bot Support

Novada automatically handles these anti-bot systems via its escalation chain:

| Anti-Bot System | Detection | Escalation Method |
|----------------|-----------|-------------------|
| Cloudflare | `cf_chl_`, `__cf_bm`, challenge pages | Auto-render via Web Unblocker |
| DataDome | `datadome` cookie/script | Auto-render |
| Kasada | Script path detection | Browser CDP |
| PerimeterX | `_px` cookie variants | Auto-render |
| Akamai | `_abck`, `ak_bmsc` cookies | Auto-render |
| Imperva/Incapsula | `incap_ses_`, `visid_incap_` | Auto-render |

30+ domains are pre-tagged in the hard target registry — these skip static fetch entirely and go straight to the right method.

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOVADA_API_KEY` | **Yes** | API key — covers search, extract, crawl, scrape, research, verify, monitor |
| `NOVADA_BROWSER_WS` | No | Browser API WebSocket URL for `novada_browser` and `novada_browser_flow` |
| `NOVADA_PROXY_USER` | No | Proxy username for `novada_proxy_*` tools |
| `NOVADA_PROXY_PASS` | No | Proxy password |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port endpoint |
| `NOVADA_WEB_UNBLOCKER_KEY` | No | Separate key for Web Unblocker (if different from main API key) |
| `NOVADA_TOOLS` | No | Load specific tools only: `"extract,search,research,monitor"` |
| `NOVADA_GROUPS` | No | Load tool groups: `"search,proxy,browser"` — groups: search, proxy, browser, scraper, health |

## Links

- Docs + API key: [novada.com](https://www.novada.com)
- npm: [npmjs.com/package/novada-mcp](https://www.npmjs.com/package/novada-mcp)
- GitHub: [github.com/NovadaLabs/novada-mcp](https://github.com/NovadaLabs/novada-mcp)
- Issues: [github.com/NovadaLabs/novada-mcp/issues](https://github.com/NovadaLabs/novada-mcp/issues)
- Tool details: call `novada_discover` or `novada_health` from any MCP client

## License

MIT
