> **This folder IS the npm package published as `novada-mcp`** — a local stdio MCP server (`npx novada-mcp`). It lives inside the [novada-mcp monorepo](../README.md); the hosted mcp.novada.com wrapper is in [`../hosted-server/`](../hosted-server/README.md).

# Novada MCP

> **One MCP server. All web data.** Search, extract, crawl, scrape, proxy, and AI research — 22 curated tools behind a single `npx` command. Run it locally or call the hosted endpoint (15 tools).
>
> **Always use `npx -y novada-mcp@latest`.** A bare `npx novada-mcp` or a global `npm i -g novada-mcp` can silently run an old cached version. See [Staying on the latest version](#staying-on-the-latest-version).

[![npm version](https://img.shields.io/npm/v/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![npm downloads](https://img.shields.io/npm/dm/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![CI](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)

```bash
# Local (Claude Code)
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest
```

## The Problem

AI agents need web data but the tools are fragmented:

- **Tavily** does search but can't scrape or proxy
- **Firecrawl** does scrape but can't search or proxy
- **BrightData** does everything but ships 69 tools that bloat your context window
- **Building it yourself** means maintaining proxies, anti-bot bypass, retry logic, and 10 different APIs

## The Fix

```bash
npx -y novada-mcp@latest
```

One server. One API key. Tools that cover every web data need an AI agent has:

| Need | Tool | What it does |
|------|------|-------------|
| Find information | `novada_search` | Web search across Google, Bing, DuckDuckGo, Yandex |
| Read a page | `novada_extract` | Any URL → clean markdown, batch up to 10 in parallel |
| Deep research | `novada_research` | One call → parallel searches → dedup → cited source material to reason over |
| Crawl a site | `novada_crawl` | BFS/DFS up to 20 pages with glob path filtering |
| Discover URLs | `novada_map` | Sitemap + BFS discovery without reading content |
| Platform data | `novada_scrape` | Amazon, LinkedIn, TikTok, GitHub, Instagram — 13 built-in platform scrapers, plus the wider Novada Scraper API |
| Monitor changes | `novada_monitor` | Track price/content/availability changes between checks |
| Verify claims | `novada_verify` | Parallel fact-checking against live web sources |
| Raw HTML | `novada_extract` (`format: "html"`) | JS render or full browser CDP for bot-protected pages |
| Browser automation | `novada_browser` | Navigate, click, type, fill forms, screenshot in cloud browser |
| Browser flows | `novada_browser_flow` | Multi-step browser automation sequences |
| Proxy credentials | `novada_proxy` | Residential, mobile, ISP, datacenter, static, dedicated — 195 countries |
| AI brand monitoring | `novada_ai_monitor` | Search AI-company public domains (openai.com, perplexity.ai, anthropic.com…) for brand mentions — indexed pages, not live models |
| Account & health | `novada_account` | Balance, plans, usage, and product entitlements |
| Async scraping | `novada_scraper_submit` | Submit async scraping task → poll → retrieve results |

## Tools at a Glance

**22 curated tools, 6 categories** (the count `novada_discover` shows). The hosted endpoint exposes a 15-tool subset. Older tool names (e.g. `novada_health`, `novada_unblock`, `novada_verify`, the six typed `novada_proxy_*`, wallet/traffic lookups) still work as back-compat aliases that route into these. Load all, or scope with `NOVADA_GROUPS` / `NOVADA_TOOLS`.

| Category | Tools | What you get |
|----------|-------|--------------|
| Search & research | `novada_search` · `novada_research` · `novada_search_feedback` | 4-engine search, cited source-material research, ranking feedback |
| Extract & crawl | `novada_extract` · `novada_crawl` · `novada_map` · `novada_monitor` · `novada_site_copy` | URL → clean markdown, multi-page crawl, URL discovery, change detection |
| Platform scraping | `novada_scrape` · `novada_ai_monitor` | Structured data from 13 built-in platform scrapers (Amazon, LinkedIn, TikTok…), AI-domain brand monitoring |
| Proxy network | `novada_proxy` (type=residential/isp/datacenter/mobile/static/dedicated) | Connection credentials across 195 countries |
| Browser | `novada_browser` · `novada_browser_flow` | Cloud-browser automation (interactive + scripted sequences) |
| Account & ops | `novada_account` · `novada_setup` · `novada_discover` · `novada_session_stats` · `novada_proxy_account_create` · `novada_proxy_account_list` · `novada_ip_whitelist` · `novada_capture_apikey` · `novada_static_ip_mgmt` | Key validation, balances, usage, sub-account & IP management |

> Don't want all 22 in your context window? `NOVADA_GROUPS="search,extract"` loads only those groups. Full list any time via `novada_discover`.

## What Makes This Different

**`novada_research` is unique.** No other MCP server turns one question into ranked, cited source material in a single call. It searches across Google, Bing, and DuckDuckGo in parallel, deduplicates, extracts full content from the top sources, and returns the most relevant passages under numbered source sections for your agent to reason over (extractive, not a generated prose report — you compose the answer). One tool call replaces an entire search→extract workflow. Depth options: quick (3 queries), deep (6), comprehensive (8-9).

**Auto-escalation handles anti-bot automatically.** Static fetch → JS render → Browser CDP. Known hard targets (Amazon, LinkedIn, G2, Zillow, Glassdoor, Walmart, Instagram, TikTok, Shein) skip straight to the right method based on a 30+ domain registry. You never think about Cloudflare, DataDome, Kasada, or PerimeterX — the tool handles it.

**Agent-first design (8.5/10 benchmark score).** Every response includes `agent_instruction` with structured next-step guidance, `source` field (live/cache/wayback), structured errors with `failure_class`, cross-tool hints suggesting better alternatives, and a `## Agent Action` block with machine-parseable status codes.

## Quick Start

1. Get a key at [novada.com](https://www.novada.com)

2. Add to your MCP client:

**Claude Code:**
```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest
```

**Claude Desktop / Cursor / VS Code / Windsurf:**
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": { "NOVADA_API_KEY": "your_key" }
    }
  }
}
```

**Hosted (no install, beta):** point any Streamable-HTTP MCP client at
`https://mcp.novada.com/mcp?token=YOUR_KEY`. A 15-tool subset, zero local setup. `novada_browser`
runs on the hosted endpoint (via cloud CDP, one-shot per call); only `novada_browser_flow`
(persistent multi-call sessions) and the disk-writing `novada_site_copy` are local-only.

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
| `novada_search` | Web search via 4 engines (Google, Bing, DuckDuckGo, Yandex) | `query`, `engine`, `num`, `time_range`, `include_domains` | `novada_search({query: "best API gateways 2026", engine: "google", num: 10})` |
| `novada_research` | Multi-source parallel research | `question`, `depth`, `focus` | `novada_research({question: "Kong vs Traefik vs APISIX", depth: "comprehensive", focus: "performance benchmarks"})` |
| `novada_verify` | Fact-check claims against web | `claim` | `novada_verify({claim: "GPT-5 was released in 2026"})` |

### Extract & Crawl

| Tool | Purpose | Key Params | Example |
|------|---------|-----------|---------|
| `novada_extract` | Extract content from URL(s) | `url` (single or array), `format`, `render`, `fields` | `novada_extract({url: "https://example.com", fields: ["price", "rating"]})` |
| `novada_crawl` | Crawl multiple pages from a domain | `url`, `max_pages`, `strategy`, `select_paths` | `novada_crawl({url: "https://docs.example.com", max_pages: 10, select_paths: ["/api/**"]})` |
| `novada_map` | Discover URLs on a site | `url`, `search`, `limit` | `novada_map({url: "https://example.com", search: "pricing"})` |
| `novada_monitor` | Detect page changes over time | `url`, `fields` | `novada_monitor({url: "https://amazon.com/dp/B09...", fields: ["price"]})` |

### Structured Platform Data

`novada_scrape` ships 13 built-in platform scrapers with structured data extraction (and the wider Novada Scraper API is reachable via `novada_scraper_submit`). Returns clean tabular records, not raw HTML.

| Platform | Operation Examples | Data Returned |
|----------|-------------------|---------------|
| Amazon | `amazon_product_keywords`, `amazon_product_asin` | Title, price, rating, reviews, BSR, availability |
| LinkedIn | `linkedin_company_information_url` | Company info, employee count, profile data |
| TikTok | `tiktok_posts_url`, `tiktok_profiles_url` | Video stats, engagement, profile data |
| GitHub | `github_repository_repo-url` | Stars, forks, issues, description, languages |
| YouTube | `youtube_video_search_label` | Video titles, views, duration, channel |
| Instagram | `ins_profiles_profileurl` | Posts, followers, engagement |
| Google Shopping | `google_shopping_keywords` | Products, prices, merchants |

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
| `novada_browser` | Full browser interaction via CDP | `novada_browser({actions: [{action: "navigate", url: "..."}, {action: "click", selector: "#btn"}]})` |
| `novada_browser_flow` | Multi-step automation sequences (local-only) | Click, scroll, wait, type, screenshot — up to 20 actions per call |

For raw rendered HTML from protected pages, use `novada_extract({url, format: "html", render: "render"})` (or `render: "browser"`). Sessions reuse the same page via `session_id` (cookies, login, page context) on the local/long-lived server; on the hosted serverless endpoint treat each call as one-shot.

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
Get structured product data (price, rating, reviews, BSR) for competitive analysis across the built-in platform scrapers and the wider Novada Scraper API.

### Lead Generation
```
novada_scrape({platform: "linkedin.com", operation: "linkedin_company_information_url", params: {url: "https://linkedin.com/company/..."}, limit: 1})
```
Extract company info, employee count, and industry data from LinkedIn company pages.

### Content Extraction for LLM Training
```
novada_crawl({url: "https://docs.example.com", max_pages: 20, select_paths: ["/docs/**"]})
```
Crawl documentation sites and extract clean markdown for fine-tuning datasets or knowledge bases.

### AI Brand Monitoring
```
novada_ai_monitor({brand: "YourProduct", models: ["chatgpt", "perplexity", "claude"]})
```
Searches AI-company public web domains (openai.com, perplexity.ai, anthropic.com…) for public mentions of your brand: sentiment signals, claims, competitor co-mentions, source URLs. Note: this searches indexed public pages — it does NOT query the live AI models' responses; a brand with few indexed pages shows low/zero mentions.

### Geo-Targeted Data Collection
```
novada_proxy_residential({country: "DE", city: "berlin", format: "curl"})
```
Get proxy credentials for any of 195 countries. Use with your own HTTP client for geo-specific content access.

## Why Novada — Honest Comparison

|  | Novada | Firecrawl | Tavily | BrightData |
|---|---|---|---|---|
| Tools | **22** (curated; 15 hosted) | 14 | 2 | 69 |
| Search engines | **4** | 0 | 1 | 3 |
| Multi-source research | **Yes** | No | No | No |
| Proxy as MCP tool | **Yes** | No | No | No |
| Auto anti-bot escalation | **Yes** | No | N/A | No |
| Change monitoring | **Yes** | No | No | No |
| Platform scraping | 13 built-in scrapers (+ Scraper API) | No | No | 437 platforms |
| Browser automation | **Yes** (CDP) | No | No | Yes |
| MCP Prompts & Resources | **Yes** (5+4) | No | No | No |
| Hosted MCP (no install) | **Yes** (beta) | No | No | Yes |
| Cost / 1k extracts | **$1** | $4 | $5 | varies |
| Agent-first score | **8.5/10** | 6.0 | 6.0 | N/A |

> **Where competitors still lead:** Firecrawl and Tavily return higher raw-character counts and lower P50 latency on easy pages (see `benchmark/results/latest-summary.json`); BrightData ships more structured scrapers (437 vs Novada's 13 built-in, with more reachable through the Scraper API). Novada trades raw volume for clean main-content extraction and a 4–5× lower cost, and is closing the latency gap (success rate climbed 70%→91% across the last two benchmark runs). Some Scraper API platforms need separate activation on your key.

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
| `NOVADA_GROUPS` | No | Load tool groups: `"search,proxy,browser"` — groups: search, proxy, browser, scraper, health, account |

## Staying on the latest version

Always use `npx -y novada-mcp@latest` — never `npx novada-mcp` (bare) and never `npm install -g novada-mcp`.

**Why:** A globally-installed `novada-mcp` shadows `npx`, so every subsequent `npx novada-mcp` silently runs the global binary regardless of what npm has published. You could be running a build that is multiple versions behind without any warning.

**If you see an old version:**

```bash
# 1. Check what you are running vs what npm has
npx novada-mcp@latest --version
npm view novada-mcp version

# 2. Remove any stale global install
npm uninstall -g novada-mcp

# 3. Clear the npx cache
npm cache verify

# 4. Confirm the correct version now runs
npx -y novada-mcp@latest --version
```

## Links

- Docs + API key: [novada.com](https://www.novada.com)
- npm: [npmjs.com/package/novada-mcp](https://www.npmjs.com/package/novada-mcp)
- Hosted MCP endpoint (beta): `https://mcp.novada.com/mcp?token=YOUR_KEY`
- GitHub: [github.com/NovadaLabs/novada-mcp](https://github.com/NovadaLabs/novada-mcp)
- Issues: [github.com/NovadaLabs/novada-mcp/issues](https://github.com/NovadaLabs/novada-mcp/issues)
- Benchmarks: [`benchmark/results/latest-summary.json`](benchmark/results/latest-summary.json) — auditable per-scenario numbers vs Firecrawl & Tavily
- Tool details: call `novada_discover` or `novada_account` from any MCP client

## License

MIT
