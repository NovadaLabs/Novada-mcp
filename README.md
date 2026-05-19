# novada

One MCP for all Novada products — search, scraping, proxy, browser, and more.

## Quick Install

```bash
npx -y novada
```

Set your API key before starting:

```bash
export NOVADA_API_KEY=your_api_key_here
```

Get your API key at [novada.com](https://www.novada.com).

## Auto-Setup (懒人启动)

Let an AI agent configure everything for you — it opens your Chrome, reads
your Novada dashboard, extracts credentials, and writes the config.

**Requirements:** Claude Code + Chrome DevTools MCP + Chrome logged into
[dashboard.novada.com](https://dashboard.novada.com)

See [`prompts/lazy-start/setup-agent.md`](prompts/lazy-start/setup-agent.md)
for the full agent prompt (English + 中文).

## Claude Desktop Config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada"],
      "env": {
        "NOVADA_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add novada -e NOVADA_API_KEY=your_api_key_here -- npx -y novada
```

## Refreshing MCP Configuration (when env changes are not picked up)

If you update `.mcp.json` or MCP env vars and Novada tools still report `not configured`, your current MCP subprocesses are likely stale.

### Option 1: Start a fresh Claude session (safest)

```bash
cd /path/to/your/project
claude
```

### Option 2: Kill only stale Novada MCP processes (no full app restart)

```bash
pkill -f "novada-search"
pkill -f "novada-proxy-mcp"
```

The next Novada tool call will respawn these MCP servers with the latest config.

### Verify refresh worked

Run a quick tool call and confirm you get real configuration output instead of `not configured`:

```text
Use novada_proxy_residential with format="env"
```

## Tools

### Content

| Tool | Description |
|------|-------------|
| `novada_search` | Search the web via Google, Bing, DuckDuckGo, Yahoo, and Yandex — returns ranked results with titles, URLs, and snippets |
| `novada_extract` | Extract clean text from any URL; supports batch (up to 10 URLs), auto-escalates from static fetch to JS render |
| `novada_crawl` | Crawl a website BFS/DFS up to 20 pages and extract content from each |
| `novada_research` | Multi-source research — generates parallel queries, deduplicates, and returns a cited report |
| `novada_map` | Discover all URLs on a site (sitemap.xml first, BFS fallback) — returns URL list only |
| `novada_verify` | Verify a factual claim against web sources — returns supported / unsupported / contested verdict |

### Scraping

| Tool | Description |
|------|-------------|
| `novada_scrape` | Structured data from 129 platforms — Amazon, Reddit, TikTok, LinkedIn, Glassdoor, GitHub, Zillow, and more |
| `novada_scraper_submit` | Submit an async scraping task for any URL — returns a task_id |
| `novada_scraper_status` | Poll the status of an async scraping task (pending / running / complete / failed) |
| `novada_scraper_result` | Retrieve completed async scraping result by task_id |
| `novada_unblock` | Force JS rendering on blocked or SPA pages — returns raw HTML for custom parsing |

### Proxy

| Tool | Description |
|------|-------------|
| `novada_proxy` | Get proxy credentials for routing your own HTTP requests (residential, ISP, datacenter, mobile) |
| `novada_proxy_residential` | Residential IPs from 100M+ pool — strongest anti-bot bypass, geo-targeting by country/city |
| `novada_proxy_isp` | ISP-assigned IPs that appear as real home users — best for social media and ecommerce |
| `novada_proxy_datacenter` | Datacenter IPs — fastest, most cost-effective for high-volume non-protected targets |
| `novada_proxy_mobile` | 4G/5G mobile IPs — ideal for mobile-targeted content and app APIs |
| `novada_proxy_static` | Dedicated static ISP IP that never changes — for account management and login-dependent flows |
| `novada_proxy_dedicated` | Exclusive datacenter IP shared with no other user — clean reputation, zero contamination |

### Browser

| Tool | Description |
|------|-------------|
| `novada_browser` | Full cloud browser automation — navigate, click, type, screenshot, evaluate JS; maintains session state |
| `novada_browser_flow` | Multi-step browser automation with Novada's cloud browser — click, scroll, wait, type, screenshot |

### Async

| Tool | Description |
|------|-------------|
| `novada_scraper_submit` | Submit an async scraping task and receive a task_id for polling |
| `novada_scraper_status` | Check task status; retry with exponential backoff until complete |
| `novada_scraper_result` | Retrieve result once status is complete; supports markdown, json, and raw formats |

### Health

| Tool | Description |
|------|-------------|
| `novada_health` | Check which Novada products are active on your API key — quick 5-product overview |
| `novada_health_all` | Extended health check testing all product endpoints in parallel with per-product latency |
| `novada_discover` | List all available Novada tools grouped by category with status (active / planned) |

## Optional Environment Variables

| Variable | Purpose |
|----------|---------|
| `NOVADA_API_KEY` | Required — your Novada API key |
| `NOVADA_BROWSER_WS` | Browser API WebSocket URL — enables `novada_browser` and `novada_browser_flow` |
| `NOVADA_PROXY_USER` | Proxy username — enables `novada_proxy_*` tools |
| `NOVADA_PROXY_PASS` | Proxy password |
| `NOVADA_PROXY_ENDPOINT` | Proxy endpoint hostname |

## Tool Filtering (NOVADA_GROUPS)

Load only the tools you need by setting `NOVADA_GROUPS`:

```json
{
  "env": {
    "NOVADA_API_KEY": "your_key",
    "NOVADA_GROUPS": "search,extract,research"
  }
}
```

Valid group names: `search`, `extract`, `crawl`, `map`, `research`, `scrape`, `proxy`, `verify`, `unblock`, `browser`, `health`, `discover`, `scraper_submit`, `scraper_status`, `scraper_result`, `proxy_residential`, `proxy_isp`, `proxy_datacenter`, `proxy_mobile`, `proxy_static`, `proxy_dedicated`, `browser_flow`.

## For B2B

All Novada products in one MCP — contact [sales@novada.com](mailto:sales@novada.com) for enterprise plans, custom rate limits, and dedicated support.

## Links

- Docs and API key: [novada.com](https://www.novada.com)
- Issues: [github.com/NovadaLabs/novada-search-mcp/issues](https://github.com/NovadaLabs/novada-search-mcp/issues)
