# Introduction

Novada is a web data API built for AI agents. One MCP server gives your agent the ability to search the web, extract content from any page, scrape structured data from 129 platforms, run multi-source research, crawl entire sites, automate browsers, and route requests through proxies in 195 countries. One API key. One `npx` command. No fragmented tooling.

## What can Novada do?

| Capability | Tool | What it does |
|------------|------|--------------|
| **Search** | `novada_search` | Web search across Google, Bing, DuckDuckGo, Yahoo, and Yandex |
| **Extract** | `novada_extract` | Any URL to clean markdown or JSON. Batch up to 10 pages in parallel |
| **Research** | `novada_research` | One call triggers parallel multi-engine searches, deduplicates results, extracts top sources, and returns a cited report |
| **Scrape** | `novada_scrape` | Structured data from Amazon, LinkedIn, TikTok, GitHub, Zillow, and 124 more platforms |
| **Crawl** | `novada_crawl` | BFS/DFS crawling up to 20 pages with regex path filtering |
| **Monitor** | `novada_monitor` | Track price, content, and availability changes over time with field-level diffs |
| **Browser** | `novada_browser` | Navigate, click, type, fill forms, and take screenshots in a cloud browser |
| **Proxy** | `novada_proxy_*` | Residential, mobile, ISP, datacenter, static, and dedicated IPs across 195 countries |
| **Verify** | `novada_verify` | Fact-check any claim against live web sources |
| **AI Monitor** | `novada_ai_monitor` | See how ChatGPT, Perplexity, Grok, Claude, and Gemini mention your brand |

## One API key covers everything

Most web data stacks require stitching together separate services for search, scraping, proxies, and browser automation -- each with its own API key, billing dashboard, and rate limits.

Novada consolidates all of this behind a single `NOVADA_API_KEY`. Search, extract, crawl, scrape, research, verify, and monitor all work out of the box. Proxy and browser tools are available with optional add-on credentials for advanced use cases.

```bash
# That's it. One key, all tools.
npx novada-mcp
```

## How Novada compares

|  | Novada | Firecrawl | Tavily | Bright Data |
|---|---|---|---|---|
| MCP tools | 25 | 14 | 2 | 69 |
| Search engines | 5 | 1 | 1 | 3 |
| Multi-source research | Yes | No | No | No |
| Proxy as MCP tool | Yes | No | No | No |
| Auto anti-bot bypass | Yes | No | N/A | No |
| Change monitoring | Yes | No | No | No |
| Platform scrapers | 129 | 0 | 0 | 437 |
| Browser automation | Yes | Yes | No | Yes |

**Where Novada leads:** `novada_research` is unique -- no other MCP server turns one question into a cited, multi-source report with parallel searches across three engines. Auto-escalation (static fetch, JS render, full browser CDP) handles Cloudflare, DataDome, Kasada, and PerimeterX without any configuration. Agent-first responses include `agent_instruction` fields with structured next-step guidance.

**Where others lead:** Bright Data has more platform scrapers (437 vs 129) and offers a hosted HTTP endpoint. Firecrawl has a browser interaction model and a free tier without an API key. Novada currently requires a terminal install.

## What you can build with it

**AI agent research and RAG pipelines.** Call `novada_research` with a question and get back a cited report sourced from multiple search engines. Feed it directly into vector stores or use it as agent context.

**E-commerce and price monitoring.** Use `novada_monitor` to track product pages over time. First call sets a baseline; subsequent calls return field-level diffs with percentage changes.

**Competitive intelligence.** Use `novada_scrape` to pull structured data (price, rating, reviews, market position) from Amazon, LinkedIn, Glassdoor, G2, and dozens of other platforms.

**Content extraction for LLM training.** Use `novada_crawl` to walk documentation sites and extract clean markdown for fine-tuning datasets or knowledge bases.

## Get started

Install Novada in one command:

```bash
# Claude Code
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp
```

```json
// Claude Desktop, Cursor, VS Code, Windsurf
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

Get your API key at [novada.com](https://www.novada.com), then head to [Quick Start](/quickstart) to run your first query.
