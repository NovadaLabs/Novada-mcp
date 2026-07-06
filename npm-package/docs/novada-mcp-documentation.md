<!-- Novada MCP — Complete Documentation -->
<!-- 14 chapters · 100% Firecrawl structure coverage · 2026-06-24T16:56:04Z -->


---

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
npx -y novada-mcp@latest
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
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest
```

```json
// Claude Desktop, Cursor, VS Code, Windsurf
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

Get your API key at [novada.com](https://www.novada.com), then head to [Quick Start](/quickstart) to run your first query.

---

# Quick Start

Get Novada MCP running in under 2 minutes. One API key, one install command, every web data tool available to your AI agent.

---

## Step 1: Get Your API Key

1. Go to [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/)
2. Sign up or log in
3. Copy your API key

Your API key covers all products: Search, Extract, Crawl, Research, Scrape, Monitor, and Verify. Proxy and Browser require separate activation on the same key.

---

## Step 2: Install

Choose the method that matches your MCP client.

### Option A: Claude Code (recommended)

```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest
```

That's it. Restart Claude Code and the tools are available immediately.

### Option B: Claude Desktop / Cursor / VS Code / Windsurf

Add this to your MCP configuration file:

- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Cursor:** `.cursor/mcp.json` in your project root
- **VS Code:** `.vscode/mcp.json` in your project root
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

Save the file and restart your editor. The server starts automatically on first tool call.

### Option C: npm Global Install

> **Warning:** Do not use `npm install -g novada-mcp`. A global install shadows `npx`, causing subsequent `npx novada-mcp` calls to silently run the old global binary even when a newer version exists on npm. Always use `npx -y novada-mcp@latest` instead.

If you need a system-wide install for a Dockerfile or CI environment, pin the version explicitly and plan to update it: `npm install -g novada-mcp@latest`.

Then run the server directly:

```bash
NOVADA_API_KEY=your_key novada-mcp
```

Or export the key in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export NOVADA_API_KEY=your_key
```

---

## Step 3: Verify It Works

Ask your AI agent to run a health check:

```
Run novada_health_all() to check my Novada setup.
```

Or use the setup diagnostic:

```
Run novada_setup() to see my configuration status.
```

Either tool will report which products are active, which environment variables are set, and provide activation links for anything missing.

---

## Step 4: Your First Requests

### Extract a web page

```
novada_extract({
  url: "https://news.ycombinator.com",
  format: "markdown",
  render: "auto"
})
```

Returns clean markdown content from the page. `render: "auto"` handles static and JavaScript-rendered pages automatically.

### Search the web

```
novada_search({
  query: "best MCP servers 2026",
  engine: "google",
  num: 5,
  format: "markdown"
})
```

Returns titles, URLs, and snippets from Google. Swap `engine` to `bing`, `duckduckgo`, `yahoo`, or `yandex`.

### Run a deep research query

```
novada_research({
  question: "How do MCP servers work and what are the best practices?",
  depth: "deep"
})
```

One call generates 5-6 parallel searches, deduplicates sources, extracts full content from the top results, and returns a cited multi-source report. No other MCP server does this.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NOVADA_API_KEY` | **Yes** | Your Novada API key. Covers Search, Extract, Crawl, Scrape, Research, Verify, Monitor, and AI Monitor. Get it at [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/). |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port endpoint for `novada_proxy_*` tools. Required only if you need proxy credential routing (residential, mobile, ISP, datacenter). Also requires `NOVADA_PROXY_USER` and `NOVADA_PROXY_PASS`. |
| `NOVADA_PROXY_USER` | No | Proxy username. Required alongside `NOVADA_PROXY_ENDPOINT`. |
| `NOVADA_PROXY_PASS` | No | Proxy password. Required alongside `NOVADA_PROXY_ENDPOINT`. |
| `NOVADA_BROWSER_WS` | No | Browser API WebSocket URL for `novada_browser` and `novada_browser_flow`. Enables cloud browser automation (navigate, click, type, screenshot). |
| `NOVADA_WEB_UNBLOCKER_KEY` | No | Separate key for Web Unblocker, if different from your main API key. Used by `novada_unblock` with `method: "render"`. |
| `NOVADA_TOOLS` | No | Load only specific tools. Comma-separated list: `"extract,search,research,monitor"`. Reduces context window usage. |
| `NOVADA_GROUPS` | No | Load tool groups instead of individual tools: `"search,proxy,browser"`. Available groups: `search`, `proxy`, `browser`, `scraper`, `health`. |

### Full Configuration Example (all features)

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_api_key",
        "NOVADA_PROXY_ENDPOINT": "your_proxy_host:port",
        "NOVADA_PROXY_USER": "your_proxy_user",
        "NOVADA_PROXY_PASS": "your_proxy_pass",
        "NOVADA_BROWSER_WS": "wss://your_browser_ws_url"
      }
    }
  }
}
```

Most users only need `NOVADA_API_KEY`. Add proxy and browser variables later when those features are needed.

---

## What's Next

- **Tool Reference** -- See the full list of 25+ tools and their parameters
- **Use Cases** -- Common workflows: research pipelines, price monitoring, competitive intelligence, lead generation
- **Platform Scraping** -- 129 supported platforms with structured data extraction
- **Proxy Network** -- Route requests through 100M+ IPs across 195 countries

---

## Troubleshooting

**"NOVADA_API_KEY is not set"**
Make sure the environment variable is passed in your MCP config. Double-check there are no extra spaces or quotes around the key value.

**Tools don't appear in Claude Code**
Run `claude mcp list` to confirm the server is registered. If missing, re-run the `claude mcp add` command from Step 2.

**"Product not activated"**
Some products (Proxy, Browser, Scraper API) require separate activation on your Novada dashboard. Run `novada_health()` to see which products are active and get direct activation links.

**npx download is slow on first run**
The first `npx -y novada-mcp@latest` call downloads the package. Subsequent calls use the cached version. Do **not** install globally (`npm install -g novada-mcp`) — a global install shadows `npx` and will silently run a stale version on every future call. If startup time is critical, use a pinned local install in your project instead.

---

# MCP Server

Novada runs as a local MCP server via `npx`. One command, one API key, all tools.

You can also connect to the hosted server at `mcp.novada.com` if you prefer not to install anything locally (see [Hosted Mode](#hosted-mode) below).

---

## Prerequisites

1. **Node.js 18+** installed
2. **API key** from [novada.com](https://www.novada.com)

---

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

With all optional products enabled:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here",
        "NOVADA_BROWSER_WS": "wss://username:password@upg-scbr2.novada.com",
        "NOVADA_PROXY_ENDPOINT": "pr.novada.com:7777"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Claude Code

```bash
claude mcp add novada-mcp -e NOVADA_API_KEY=your-api-key-here -- npx -y novada-mcp@latest
```

With browser and proxy:

```bash
claude mcp add novada-mcp \
  -e NOVADA_API_KEY=your-api-key-here \
  -e NOVADA_BROWSER_WS=wss://username:password@upg-scbr2.novada.com \
  -e NOVADA_PROXY_ENDPOINT=pr.novada.com:7777 \
  -- npx -y novada-mcp@latest
```

Verify it was added:

```bash
claude mcp list
```

---

## VS Code (Copilot / Continue)

Add to `.vscode/mcp.json` in your project root (or `~/.vscode/mcp.json` for global):

```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

For Continue, add to `~/.continue/config.json` under the `mcpServers` key:

```json
{
  "mcpServers": [
    {
      "name": "novada",
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  ]
}
```

---

## Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-level):

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

---

## Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

---

## Hosted Mode

Connect to the remote Novada MCP endpoint without installing anything locally:

```
mcp.novada.com
```

Use this when your MCP client supports remote servers (SSE or Streamable HTTP transport). Pass your API key as a query parameter or header per your client's configuration. Refer to your MCP client's documentation for remote server setup.

---

## Self-Hosted Mode (npx)

All configurations above use `npx -y novada-mcp@latest`, which downloads and runs the server from npm on each launch. This is the recommended approach:

- Always gets the latest version
- No global install needed
- Works offline after first download (npm cache)

To pin a specific version:

```bash
npx -y novada-mcp@0.8.1
```

> **Do not install globally** (`npm install -g novada-mcp`). A global binary shadows `npx`, so every future `npx novada-mcp` call silently runs the old global version — you stop receiving updates. If you must install globally for a CI or Docker environment, use `npm install -g novada-mcp@latest` and update it explicitly when you upgrade.

---

## Environment Variables

One API key covers all products. Additional variables unlock proxy and browser features.

### Required

| Variable | Purpose |
|----------|---------|
| `NOVADA_API_KEY` | Your API key. Authenticates **all** products: search, extract, research, crawl, map, scrape, verify, monitor, unblock, and proxy auto-provisioning. Get it at [novada.com](https://www.novada.com). |

### Optional -- Proxy

| Variable | Purpose |
|----------|---------|
| `NOVADA_PROXY_ENDPOINT` | Proxy gateway (e.g. `pr.novada.com:7777`). When set, proxy tools become active. User/pass are auto-fetched from your account using `NOVADA_API_KEY` -- no need to set them manually. |
| `NOVADA_PROXY_USER` | Override proxy username. Only needed if you want to use specific sub-account credentials instead of auto-provisioned ones. |
| `NOVADA_PROXY_PASS` | Override proxy password. Same as above. |

### Optional -- Browser

| Variable | Purpose |
|----------|---------|
| `NOVADA_BROWSER_WS` | Browser API WebSocket URL (e.g. `wss://user:pass@upg-scbr2.novada.com`). Required for `novada_browser` and `novada_browser_flow`. Get the endpoint from your Novada dashboard under Browser API. |

### Optional -- Advanced

| Variable | Purpose |
|----------|---------|
| `NOVADA_WEB_UNBLOCKER_KEY` | Override key for the Web Unblocker. If not set, `NOVADA_API_KEY` is used as fallback. Only needed if your unblocker runs on a separate account. |
| `NOVADA_DEVELOPER_API_KEY` | Key for account management tools (wallet balance, proxy account CRUD, traffic logs). Falls back to `NOVADA_API_KEY` if not set. |
| `NOVADA_TOOLS` | Load only specific tools. Comma-separated: `"extract,search,research,monitor"`. Reduces context window usage. |
| `NOVADA_GROUPS` | Load tool groups instead of individual tools. Values: `search`, `proxy`, `browser`, `scraper`, `health`, `account`. Can combine with `NOVADA_TOOLS` (union). |

### Tool Filtering Examples

Load only search-related tools (8 tools instead of 25+):

```json
{
  "env": {
    "NOVADA_API_KEY": "your-key",
    "NOVADA_GROUPS": "search"
  }
}
```

Load specific tools only:

```json
{
  "env": {
    "NOVADA_API_KEY": "your-key",
    "NOVADA_TOOLS": "search,extract,research"
  }
}
```

Combine groups and individual tools:

```json
{
  "env": {
    "NOVADA_API_KEY": "your-key",
    "NOVADA_GROUPS": "search,proxy",
    "NOVADA_TOOLS": "browser"
  }
}
```

Available groups:

| Group | Tools Included |
|-------|---------------|
| `search` | search, extract, crawl, map, research, verify, ai_monitor, monitor |
| `proxy` | proxy, proxy_residential, proxy_isp, proxy_datacenter, proxy_mobile, proxy_static, proxy_dedicated |
| `browser` | browser, browser_flow |
| `scraper` | scrape, scraper_submit, scraper_status, scraper_result |
| `health` | health, health_all, discover, setup |
| `account` | wallet_balance, wallet_usage_record, proxy_account_create, proxy_account_list, traffic_daily, plan_balance_all, capture_logs, account_summary |

`novada_health` and `novada_setup` are always loaded regardless of filter settings, so agents can always diagnose issues.

---

## Verify Your Setup

After configuring, ask your AI agent to run:

```
Run novada_health_all() to check which products are active.
```

Or call the tool directly:

```
novada_health_all()
```

Expected output shows per-product status:

```
Product          | Status  | Latency
-----------------+---------+---------
Search API       | active  | 245ms
Extract API      | active  | 180ms
Scraper API      | active  | 312ms
Proxy API        | active  | 95ms
Browser API      | active  | 420ms
Web Unblocker    | active  | 280ms
```

Any product showing `PRODUCT_UNAVAILABLE` includes an activation link to enable it on your dashboard.

You can also run `novada_setup()` -- it works even before `NOVADA_API_KEY` is configured and shows the status of all environment variables plus setup commands for every MCP client.

---

## Troubleshooting

### "NOVADA_API_KEY is not set"

The API key environment variable is missing or empty.

**Fix:** Double-check the `env` block in your MCP config. The key must be a non-empty string. Restart your MCP client after updating the config.

```json
"env": {
  "NOVADA_API_KEY": "your-actual-key-here"
}
```

### "INVALID_API_KEY"

The key is set but rejected by the Novada API.

**Fix:** Verify the key at [novada.com](https://www.novada.com). Common causes: extra whitespace, partial key copied, or expired key.

### Proxy tools return "missing environment variables"

Proxy tools require `NOVADA_PROXY_ENDPOINT` to be set. User and password are auto-provisioned from your account.

**Fix:** Add the proxy endpoint:

```json
"env": {
  "NOVADA_API_KEY": "your-key",
  "NOVADA_PROXY_ENDPOINT": "pr.novada.com:7777"
}
```

Get the exact endpoint from your Novada dashboard under Residential Proxies > Endpoint Generator.

### Browser tools return "NOVADA_BROWSER_WS not configured"

The browser automation tools (`novada_browser`, `novada_browser_flow`) require a WebSocket endpoint.

**Fix:** Add the Browser API WebSocket URL:

```json
"env": {
  "NOVADA_API_KEY": "your-key",
  "NOVADA_BROWSER_WS": "wss://username:password@upg-scbr2.novada.com"
}
```

Get credentials from your Novada dashboard under Browser API.

### "Tool X is not in the active set"

You are using `NOVADA_TOOLS` or `NOVADA_GROUPS` and the requested tool is not in the allowed set.

**Fix:** Add the tool name to `NOVADA_TOOLS` or its group to `NOVADA_GROUPS`. Run `novada_discover()` to see all available tools and their groups.

### npx hangs or fails to download

Network or npm cache issue.

**Fix:**
```bash
# Clear npm cache and retry
npm cache clean --force
npx -y novada-mcp@latest --version
```

> Do **not** reach for `npm install -g novada-mcp` as a fallback — a global install shadows `npx` and will silently run a stale version on every future call. If you need offline startup, pre-warm the npm cache with `npm pack novada-mcp@latest` instead.

### Claude Desktop does not show Novada tools

Config file might be in the wrong location or has a JSON syntax error.

**Fix:**
1. Verify file location: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
2. Validate JSON syntax (no trailing commas, proper quoting)
3. Restart Claude Desktop completely (quit and reopen, not just close window)

### Scraper API returns "product not activated"

Some Scraper API platforms require separate activation on your Novada account.

**Fix:** Run `novada_health()` to see which products are active. Visit the activation link in the output to enable the Scraper API product.

---

# Extract & Search

The two tools you will use most often. `novada_extract` reads a page; `novada_search` finds pages.

---

## `novada_extract`

Extract clean, readable content from any URL. Handles Cloudflare, DataDome, and Kasada automatically via auto-escalation (static -> JS render -> Browser CDP). Pass an array of URLs (up to 10) for parallel batch extraction.

### When to use

- Reading a single page or a handful of known URLs.
- Pulling structured fields (price, author, date) from a product or article page.
- Batch-extracting the top results after a `novada_search` call.

### When NOT to use

- You need to discover URLs first -- use `novada_map`.
- You need content from many pages on one domain -- use `novada_crawl`.
- You need structured platform data (Amazon products, TikTok posts) -- use `novada_scrape`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string \| string[]` | Yes | -- | URL or array of URLs (max 10). Batch mode processes in parallel. |
| `urls` | `string[]` | No | -- | Alias for `url` when passing multiple URLs. |
| `format` | `string` | No | `"markdown"` | Output format: `"markdown"`, `"text"`, `"html"`, `"json"`. |
| `render` | `string` | No | `"auto"` | Rendering mode: `"auto"`, `"static"`, `"render"` / `"js"`, `"browser"`. |
| `fields` | `string[]` | No | -- | Specific fields to extract, e.g. `["price", "author", "rating"]`. Max 20. |
| `clean` | `boolean` | No | `false` | Set `true` to extract only the main article body (strips nav, footer, ads). |
| `max_chars` | `number` | No | `100000` | Maximum characters to return. Range: 1000--100000. |
| `query` | `string` | No | -- | Relevance hint so the agent can focus on relevant sections. |
| `wait_for` | `string` | No | -- | CSS selector to wait for before capture (browser mode only). Max wait: 15s. |
| `wait_ms` | `number` | No | -- | Fixed delay in ms after page load. Range: 0--30000. Prefer `wait_for`. |

### Render modes

| Mode | Speed | Use when |
|------|-------|----------|
| `"auto"` | Fastest | Default. Tries static first, escalates automatically if JS is detected. |
| `"static"` | Fastest | You know the page is plain HTML (blogs, docs, wikis). |
| `"render"` / `"js"` | ~3-5s | Known JS-heavy SPAs (React, Vue, Angular). Forces Web Unblocker. |
| `"browser"` | ~8-12s | Full Chromium CDP. Last resort for complex SPAs. Requires `NOVADA_BROWSER_WS`. |

**Key rule:** Leave `render="auto"`. It is 15-100x faster on static sites. Only override when you know the page requires JS rendering.

### Output

By default, returns the full page converted to clean markdown. When `clean=true`, returns only the main article body with navigation, footers, sidebars, and ads stripped.

Output is also saved to disk at:

```
~/Downloads/novada-mcp/YYYY-MM-DD/extract_{domain}_{HHmmss}.md
```

### Examples

#### 1. Basic: extract a blog post

```json
{
  "url": "https://blog.example.com/ai-agents-2026",
  "format": "markdown"
}
```

Returns the full page as structured markdown -- headings, paragraphs, images, links all preserved.

#### 2. With fields: extract specific data points

```json
{
  "url": "https://store.example.com/product/widget-pro",
  "fields": ["price", "title", "availability", "rating"]
}
```

Returns a `## Requested Fields` block with each field extracted. Checks JSON-LD structured data first, falls back to pattern matching.

#### 3. JS-heavy page: force rendering

```json
{
  "url": "https://app.example.com/dashboard",
  "render": "render",
  "wait_for": ".dashboard-content"
}
```

Forces JS rendering via the Web Unblocker. The `wait_for` selector delays capture until `.dashboard-content` appears in the DOM (max 15s).

#### 4. Clean mode: main content only

```json
{
  "url": "https://news.example.com/article/12345",
  "clean": true
}
```

Strips navigation bars, footers, sidebars, and ads. Returns only the article body -- ideal for summarization or RAG ingestion.

#### 5. Batch extraction

```json
{
  "urls": [
    "https://docs.example.com/api/auth",
    "https://docs.example.com/api/users",
    "https://docs.example.com/api/billing"
  ],
  "format": "markdown"
}
```

Extracts all three pages in parallel. Returns a structured document with one section per URL (`### [1/3] https://docs.example.com/api/auth`, etc.).

---

## `novada_search`

Search the web via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex). Returns titles, URLs, and snippets, reranked by relevance. Results are cached for 60 seconds -- repeating the same query returns instantly.

### When to use

- Finding URLs for a topic, product, or company.
- Current events and fact lookup.
- Competitive research and discovery.

### When NOT to use

- You already have the URL -- use `novada_extract`.
- You need a multi-source synthesized report -- use `novada_research` (it runs 3-10 searches + extraction + synthesis in one call).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | -- | Search query. |
| `engine` | `string` | No | `"google"` | Engine: `"google"`, `"bing"`, `"duckduckgo"`, `"yahoo"`, `"yandex"`. |
| `num` | `number` | No | `10` | Number of results. Range: 1--20. |
| `time_range` | `string` | No | -- | Time window: `"day"`, `"week"`, `"month"`, `"year"`. |
| `start_date` | `string` | No | -- | ISO date `YYYY-MM-DD`. Results published on or after this date. |
| `end_date` | `string` | No | -- | ISO date `YYYY-MM-DD`. Results published on or before this date. |
| `country` | `string` | No | `""` | ISO 2-letter country code for geo-targeting. |
| `language` | `string` | No | `""` | Language code for results. |
| `include_domains` | `string[]` | No | -- | Only return results from these domains. Max 10. |
| `exclude_domains` | `string[]` | No | -- | Exclude results from these domains. Max 10. |
| `format` | `string` | No | `"markdown"` | Output format: `"markdown"` or `"json"`. |
| `enrich_top` | `boolean` | No | `false` | Auto-extract full content from the top result. Adds ~2-4s latency. |
| `extract_options` | `object` | No | -- | Auto-extract content from top N results (see below). |

### `extract_options` (auto-extract from search results)

When provided, automatically runs `novada_extract` on the top search results and appends the content inline. Eliminates a separate extraction call.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `top_n` | `number` | `3` | How many top results to extract. Range: 1--10. |
| `format` | `string` | `"markdown"` | Extraction format: `"text"`, `"markdown"`, `"html"`, `"json"`. |
| `fields` | `string[]` | -- | Specific fields to extract from each result page. |
| `max_chars` | `number` | -- | Max characters per extracted page. Range: 1000--100000. |

### Engines

| Engine | Best for |
|--------|----------|
| `"google"` | General relevance (default). |
| `"bing"` | News and local results. |
| `"duckduckgo"` | Privacy-conscious queries. Similar speed to Google. |
| `"yahoo"` | Broad index. |
| `"yandex"` | Russian and Eastern European content. |

### Caching

Results are cached for 60 seconds. The same query + engine + num combination returns the cached response instantly with no API call. Cache is in-memory and resets when the MCP server restarts.

### Examples

#### 1. Basic search

```json
{
  "query": "best MCP servers for web scraping 2026",
  "num": 10
}
```

Returns 10 results as a markdown list with title, URL, and snippet for each.

#### 2. With date filtering

```json
{
  "query": "OpenAI API pricing changes",
  "time_range": "week",
  "engine": "google"
}
```

Returns only results from the last 7 days. Use `"day"` for breaking news, `"month"` for recent developments.

#### 3. With auto-extract: read the top results in one call

```json
{
  "query": "Stripe webhook best practices",
  "extract_options": {
    "top_n": 3,
    "format": "markdown"
  }
}
```

Searches, then automatically extracts the full content from the top 3 result URLs. Each result includes both the search snippet and the full extracted page content. No separate `novada_extract` call needed.

#### 4. Domain-scoped search

```json
{
  "query": "authentication middleware",
  "include_domains": ["github.com", "stackoverflow.com"],
  "num": 15
}
```

Restricts results to GitHub and Stack Overflow only.

#### 5. Quick enrichment with `enrich_top`

```json
{
  "query": "Next.js 16 release notes",
  "enrich_top": true
}
```

Shorthand for `extract_options.top_n=1`. Returns all search results plus the full extracted content of the top result. Adds ~2-4 seconds of latency.

---

## Extract vs. Search: decision guide

| I want to... | Use |
|---------------|-----|
| Read a page I already have the URL for | `novada_extract` |
| Find pages about a topic | `novada_search` |
| Find pages AND read the top results | `novada_search` with `extract_options` |
| Read multiple known URLs in parallel | `novada_extract` with `urls` array |
| Deep multi-source research with synthesis | `novada_research` |

---

# Scrape, Crawl & Map

Three tools for different scales of web data extraction: structured platform data (`novada_scrape`), multi-page content extraction (`novada_crawl`), and URL discovery (`novada_map`).

## When to Use Which

| Scenario | Tool | Why |
|----------|------|-----|
| Product data from Amazon, TikTok, LinkedIn | `novada_scrape` | Returns clean structured records |
| Extract content from 5-20 pages of a docs site | `novada_crawl` | BFS/DFS multi-page extraction |
| Find all URLs on a site before reading | `novada_map` | Fast URL discovery, no content download |
| Read a single known URL | `novada_extract` | Use extract, not crawl or scrape |
| Unknown domain not in the platform list | `novada_crawl` or `novada_extract` | Scrape only covers 13 platforms |

---

## novada_scrape

Retrieve structured data from 13 supported platforms (~78 operations). Returns clean tabular records instead of raw HTML -- product listings, social posts, company profiles, search results.

### Supported Platforms

| Platform | Domain | Category | Example Operations |
|----------|--------|----------|-------------------|
| Amazon | `amazon.com` | E-Commerce | Product search, ASIN lookup, reviews, seller info |
| Walmart | `walmart.com` | E-Commerce | Product search, SKU lookup, category browse |
| Google | `google.com` | Search | Web search, SERP, Maps, Shopping, Jobs, Hotels |
| Bing | `bing.com` | Search | Web, Maps, Images, Videos, News, Shopping |
| DuckDuckGo | `duckduckgo.com` | Search | Web search |
| Yandex | `yandex.com` | Search | Web search |
| YouTube | `youtube.com` | Social | Video search, comments, transcripts, profiles, audio |
| X / Twitter | `x.com` | Social | Profile by URL/username, post by URL |
| TikTok | `tiktok.com` | Social | Posts by URL, profiles |
| Instagram | `instagram.com` | Social | Profiles, reels, posts, comments |
| Facebook | `facebook.com` | Social | Events, posts, comments, profiles |
| LinkedIn | `linkedin.com` | Professional | Company info, job listings |
| GitHub | `github.com` | Developer | Repository info, search |

> **Not available:** Reddit, Glassdoor, Zillow, Airbnb, eBay, Etsy, and ~94 other platforms have 0 active operations. Use `novada_extract` for those sites.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `platform` | string | Yes | -- | Platform domain. E.g. `"amazon.com"`, `"x.com"`, `"linkedin.com"` |
| `operation` | string | Yes | -- | Exact operation ID from the platform list below |
| `params` | object | Yes | `{}` | Operation-specific parameters (keyword, url, asin, etc.) |
| `format` | string | No | `"markdown"` | Output format: `"markdown"`, `"json"`, or `"toon"` |
| `limit` | number | No | `20` | Max records to return (1-100) |

### Output Formats

- **markdown** (default) -- Human-readable table. Best for reading in chat.
- **json** -- Structured array. Best for programmatic processing.
- **toon** -- Token-optimized pipe-separated format. 40-65% smaller than JSON/markdown. Best for context-constrained agents.

Output files are automatically saved to `~/Downloads/novada-mcp/` as JSON or CSV.

### Examples

**Search Amazon for products:**

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_keywords",
  "params": { "keyword": "mechanical keyboard" },
  "limit": 10
}
```

**Look up a specific Amazon product by ASIN:**

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_asin",
  "params": { "asin": "B09V3KXJPB" }
}
```

**Get YouTube video details and search:**

```json
{
  "platform": "youtube.com",
  "operation": "youtube_video_search_label",
  "params": { "label": "MCP tutorial Claude" },
  "limit": 5
}
```

**Get LinkedIn company info:**

```json
{
  "platform": "linkedin.com",
  "operation": "linkedin_company_information_url",
  "params": { "url": "https://www.linkedin.com/company/anthropic/" }
}
```

**Scrape a Twitter/X profile:**

```json
{
  "platform": "x.com",
  "operation": "twitter_profile_username",
  "params": { "username": "AnthropicAI" }
}
```

**Google Shopping search:**

```json
{
  "platform": "google.com",
  "operation": "google_shopping_keywords",
  "params": { "keyword": "wireless earbuds" },
  "format": "json"
}
```

### Complete Operation Reference

#### Amazon (`amazon.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `amazon_product_keywords` | `{ keyword }` | Search products by keyword |
| `amazon_product_asin` | `{ asin }` | Lookup by ASIN |
| `amazon_product_url` | `{ url }` | Scrape product page URL |
| `amazon_product_category-url` | `{ url }` | Browse a category page |
| `amazon_product_best-sellers` | `{ url }` | Best sellers page |
| `amazon_global-product_url` | `{ url }` | Global product by URL |
| `amazon_global-product_category-url` | `{ url }` | Global category page |
| `amazon_global-product_seller-url` | `{ url }` | Global seller page |
| `amazon_global-product_keywords` | `{ keyword }` | Global keyword search |
| `amazon_global-product_keywords-brand` | `{ keyword }` | Global brand keyword search |
| `amazon_comment_url` | `{ url }` | Product reviews by URL |
| `amazon_seller_url` | `{ url }` | Seller profile |
| `amazon_product-list_keywords-domain` | `{ keyword }` | Product list by keyword+domain |

#### Walmart (`walmart.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `walmart_product_url` | `{ url }` | Product page |
| `walmart_product_category-url` | `{ url }` | Category page |
| `walmart_product_sku` | `{ sku }` | Lookup by SKU |
| `walmart_product_keywords` | `{ keyword }` | Search by keyword |
| `walmart_product_zipcodes` | `{ url, zip_code }` | Product with zip code pricing |

#### Google (`google.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `google_search` | `{ q, device?, domain?, country?, hl? }` | Web search |
| `google_serp_web` | `{ q }` | SERP web results |
| `google_serp_videos` | `{ q }` | SERP video results |
| `google_serp_hotels` | `{ q }` | SERP hotel results |
| `google_serp_jobs` | `{ q }` | SERP job results |
| `google_map-details_url` | `{ url }` | Google Maps by URL |
| `google_map-details_cid` | `{ cid }` | Google Maps by CID |
| `google_map-details_location` | `{ location }` | Google Maps by location |
| `google_map-details_placeid` | `{ place_id }` | Google Maps by place ID |
| `google_shopping_keywords` | `{ keyword }` | Shopping search |
| `google_comment_url` | `{ url }` | Google reviews |

#### Bing (`bing.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `bing_search` | `{ keyword }` | Web search |
| `bing_maps` | `{ keyword }` | Maps search |
| `bing_images` | `{ keyword }` | Image search |
| `bing_videos` | `{ keyword }` | Video search |
| `bing_news` | `{ keyword }` | News search |
| `bing_shopping` | `{ keyword }` | Shopping search |

#### DuckDuckGo (`duckduckgo.com`)

| Operation | Params |
|-----------|--------|
| `duckduckgo` | `{ keyword }` |

#### Yandex (`yandex.com`)

| Operation | Params |
|-----------|--------|
| `yandex` | `{ keyword }` |

#### YouTube (`youtube.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `youtube_video-post_url` | `{ url }` | Video details by URL |
| `youtube_video-post_search_filters` | `{ keyword }` | Search with filters |
| `youtube_video_search_label` | `{ label }` | Search by label |
| `youtube_video-post-podcast-url` | `{ url }` | Podcast episode |
| `youtube_video-post-keyword` | `{ keyword }` | Video by keyword |
| `youtube_video-post_explore` | `{ keyword }` | Explore trending |
| `youtube_product-videoid` | `{ video_id }` | Product info from video |
| `youtube_video-url` | `{ url }` | Video by URL |
| `youtube_audio_url` | `{ url }` | Audio extraction |
| `youtube_comment_id` | `{ video_id }` | Comments by video ID |
| `youtube_transcript_id` | `{ url }` | Transcript |
| `youtube_profiles_keyword` | `{ keyword }` | Channel search |
| `youtube_profiles_url` | `{ url }` | Channel by URL |

#### X / Twitter (`x.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `twitter_profile_profileurl` | `{ url }` | Profile by URL |
| `twitter_profile_username` | `{ username }` | Profile by username |
| `twitter_post_posturl` | `{ url }` | Single post by URL |

#### TikTok (`tiktok.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `tiktok_posts_url` | `{ url }` | Posts by URL |
| `tiktok_posts_profileurl` | `{ url }` | Posts from a profile |
| `tiktok_posts_listurl` | `{ url }` | Posts from a list |
| `tiktok_profiles_url` | `{ url }` | Profile details |
| `tiktok_profiles_listurl` | `{ url }` | Profile list |

#### Instagram (`instagram.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `ins_profiles_username` | `{ username }` | Profile by username |
| `ins_profiles_profileurl` | `{ url }` | Profile by URL |
| `ins_reel_url` | `{ url }` | Single reel |
| `ins_allreel_url` | `{ url }` | All reels from profile |
| `ins_posts_profileurl` | `{ url }` | Posts from profile |
| `ins_posts_posturl` | `{ url }` | Single post |
| `ins_comment_posturl` | `{ url }` | Comments on a post |

#### Facebook (`facebook.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `facebook_event_eventlist-url` | `{ url }` | Event list |
| `facebook_event_search-url` | `{ url }` | Event search |
| `facebook_event_events-url` | `{ url }` | Event details |
| `facebook_post_posts-url` | `{ url }` | Posts |
| `facebook_comment_comments-url` | `{ url }` | Comments |
| `facebook_profile_profiles-url` | `{ url }` | Profiles |

#### LinkedIn (`linkedin.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `linkedin_company_information_url` | `{ url }` | Company info |
| `linkedin_job_listings_information_job-listing-url` | `{ url }` | Job listing page |
| `linkedin_job_listings_information_job-url` | `{ url }` | Job details |
| `linkedin_job_listings_information_keyword` | `{ keyword }` | Job search |

#### GitHub (`github.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `github_repository_repo-url` | `{ url }` | Repository details |
| `github_repository_search-url` | `{ url }` | Search results page |
| `github_repository_url` | `{ url }` | Repository by URL |

### Common Errors

| Error Code | Meaning | Fix |
|------------|---------|-----|
| 11006 | Invalid operation ID or Scraper API not activated | Verify the operation ID against the table above. If correct, activate Scraper API at dashboard. |
| 11008 | Unknown platform name | Use the exact domain (e.g. `"amazon.com"`, not `"amazon"`) |
| 50001/50002 | Authentication error | Check `NOVADA_API_KEY` |

### Discovering Platforms Programmatically

Read the `novada://scraper-platforms` MCP resource for the complete platform list at runtime:

```
Read resource: novada://scraper-platforms
```

This returns the full list with operation IDs and required parameters, verified against the live dashboard.

---

## novada_crawl

Extract content from multiple pages of a website. Crawls via BFS or DFS, up to 20 pages, extracting readable text from each. Use path regex filters to target specific sections.

### When to Use

- You need content from multiple pages on one domain (e.g., all `/docs/*` pages).
- You need BFS discovery of related content under a path prefix.
- Building a knowledge base from a documentation site.

### When NOT to Use

- Single page -- use `novada_extract` (faster, simpler).
- URL discovery only -- use `novada_map` (no content download, much faster).
- Structured platform data -- use `novada_scrape`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Starting URL to crawl from |
| `max_pages` | number | No | `5` | Maximum pages to crawl (1-20) |
| `strategy` | string | No | `"bfs"` | `"bfs"` (breadth-first) or `"dfs"` (depth-first) |
| `select_paths` | string[] | No | -- | Regex patterns to restrict URL paths. E.g. `["/docs/.*"]` |
| `exclude_paths` | string[] | No | -- | Regex patterns for paths to skip. E.g. `["/blog/.*"]` |
| `instructions` | string | No | -- | Natural language hint for page prioritization |
| `format` | string | No | `"markdown"` | Output format: `"markdown"` or `"json"` |
| `render` | string | No | `"auto"` | `"auto"`, `"static"`, or `"render"` (JS rendering) |
| `limit` | number | No | -- | Alias for `max_pages` |
| `mode` | string | No | -- | Alias for `strategy` |

### Crawl Strategies

- **BFS (breadth-first)** -- Visits all pages at the current depth before going deeper. Good for broad discovery across a site's top-level sections.
- **DFS (depth-first)** -- Follows links deeply before backtracking. Good for exploring a specific path thoroughly (e.g., a nested documentation tree).

### Rendering Modes

- **auto** (default) -- Starts with static HTML. If JS-heavy content is detected on the first batch, auto-escalates to JS rendering for subsequent pages.
- **static** -- Always fetch static HTML only. Fastest (~0.5s/page).
- **render** -- Always use JS rendering. Handles React/Vue/Angular SPAs. Slower (~3-5s/page).

### Examples

**Crawl a documentation site (first 10 pages):**

```json
{
  "url": "https://docs.example.com",
  "max_pages": 10,
  "strategy": "bfs"
}
```

**Crawl only API reference pages:**

```json
{
  "url": "https://docs.example.com",
  "max_pages": 15,
  "strategy": "bfs",
  "select_paths": ["/docs/api/.*", "/docs/reference/.*"],
  "exclude_paths": ["/docs/blog/.*", "/docs/changelog/.*"]
}
```

**Crawl a JS-heavy SPA with rendering:**

```json
{
  "url": "https://spa-docs.example.com",
  "max_pages": 5,
  "strategy": "dfs",
  "render": "render"
}
```

**Crawl with natural language instructions:**

```json
{
  "url": "https://docs.stripe.com",
  "max_pages": 10,
  "instructions": "only API reference pages, skip blog and changelog"
}
```

**Get structured JSON output:**

```json
{
  "url": "https://docs.example.com",
  "max_pages": 8,
  "format": "json"
}
```

The JSON output includes per-page objects with `url`, `title`, `depth`, `word_count`, `js_content_missing`, and `text` fields.

### Performance Notes

- Crawl time scales linearly: ~1.4s/page (static), ~3-5s/page (rendered).
- At `max_pages=20`, expect 28s minimum (static) or 60-100s (rendered).
- Total output is capped at ~25,000 characters. Pages exceeding the cap are truncated with a notice to use `novada_extract` for full content.
- Use `select_paths` to restrict scope before setting `max_pages` high.

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "Sparse content" error | Site returns bot challenge or requires JS | Set `render="render"` |
| Stopped early, few pages | JavaScript SPA generates links dynamically | Use `render="render"` or `novada_map` first |
| Pages truncated | Total crawl text exceeded 25K chars | Use `novada_extract` on individual URLs for full content |
| Seed URL excluded | `select_paths` filter doesn't match the starting URL | Adjust regex to include the seed path |

---

## novada_map

Discover all URLs on a website without downloading page content. Tries sitemap.xml first (fast, complete coverage), falls back to parallel BFS link crawl.

### When to Use

- Site structure discovery before deciding which pages to read.
- Finding the correct subpage URL when you extracted the wrong page.
- Planning which pages to pass to `novada_extract` or `novada_crawl`.

### When NOT to Use

- You need page content -- follow up with `novada_extract` or `novada_crawl`.
- Structured platform data -- use `novada_scrape`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Root URL to map |
| `limit` | number | No | `50` | Maximum URLs to return (1-100) |
| `search` | string | No | -- | Filter discovered URLs by this substring |
| `include_subdomains` | boolean | No | `false` | Include URLs from subdomains |
| `max_depth` | number | No | `2` | Link-hops from root to follow (1-5). Higher = slower but more URLs. |

### Discovery Strategy

1. **Sitemap check** -- Reads `robots.txt` for sitemap references, then tries `/sitemap.xml` and `/sitemap_index.xml`. Fastest method; returns comprehensive URL lists when available.
2. **BFS crawl fallback** -- If no sitemap is found, performs a parallel breadth-first crawl to discover URLs by following links. Respects `max_depth` and `limit`.

### Examples

**Discover all pages on a site:**

```json
{
  "url": "https://docs.example.com",
  "limit": 100
}
```

**Search for specific pages:**

```json
{
  "url": "https://docs.example.com",
  "search": "authentication"
}
```

**Include subdomains:**

```json
{
  "url": "https://example.com",
  "limit": 50,
  "include_subdomains": true
}
```

**Deep crawl for more URLs:**

```json
{
  "url": "https://docs.example.com",
  "limit": 100,
  "max_depth": 4
}
```

### Typical Workflow: Map then Extract

```
Step 1: novada_map({ url: "https://docs.example.com", search: "api" })
        --> Returns list of URLs matching "api"

Step 2: novada_extract({ url: ["https://docs.example.com/api/auth", "https://docs.example.com/api/users"] })
        --> Extracts content from the 2 most relevant pages
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 0 URLs returned | JavaScript SPA with no static links | Use `novada_crawl` with `render="render"`, or `novada_search` with `site:domain.com` |
| Binary content detected | URL points to PDF/ZIP/image | Use `novada_extract` to read the document content |
| Fewer URLs than expected | Site has limited same-domain links | Increase `max_depth` or `limit` |
| No results for search term | Term not in any URL path | Remove `search` filter to see all URLs, then search manually |

---

## Combining the Three Tools

### Competitive Analysis Pipeline

```
novada_map("https://competitor.com", limit=50)
  --> discover all pages

novada_crawl("https://competitor.com", select_paths=["/pricing", "/features"], max_pages=10)
  --> extract pricing and features pages

novada_scrape("amazon.com", "amazon_product_keywords", { keyword: "competitor product" })
  --> get competitor product listings
```

### Documentation Ingestion

```
novada_map("https://docs.example.com", limit=100)
  --> discover all doc pages

novada_crawl("https://docs.example.com", select_paths=["/docs/api/.*"], max_pages=20)
  --> extract all API reference pages
```

### E-Commerce Research

```
novada_scrape("amazon.com", "amazon_product_keywords", { keyword: "standing desk" }, limit=20)
  --> get top 20 product listings

novada_scrape("walmart.com", "walmart_product_keywords", { keyword: "standing desk" }, limit=20)
  --> compare with Walmart listings
```

---

# Research, Verify & Monitor

Three tools that go beyond extraction. `novada_research` synthesizes multi-source reports in a single call -- something no other MCP server offers. `novada_verify` fact-checks claims against the live web. `novada_monitor` tracks page changes over time.

---

## novada_research

**The most powerful research tool in any MCP server.** One call fires 3-10 parallel searches across Google, Bing, and DuckDuckGo, deduplicates results, extracts full content from the top 5 sources, and returns a synthesized report with citations. It replaces 5-10 manual search-then-extract calls.

No other MCP server does this. Firecrawl, Exa, Tavily -- they all return raw search results or page content. Novada Research runs the entire pipeline: query generation, multi-engine search, dedup, content extraction, keyword-ranked synthesis. One tool call, one report.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `question` | string | Yes* | -- | The research question. Minimum 5 characters. |
| `query` | string | Yes* | -- | Alias for `question`. Use either one. |
| `depth` | string | No | `"auto"` | Controls how many parallel searches run. `"quick"` = 3, `"deep"` = 5-6, `"comprehensive"` = 8-10, `"auto"` = server decides based on question complexity. |
| `focus` | string | No | -- | Narrows sub-query generation. E.g. `"technical implementation"`, `"business impact"`, `"recent news only"`. |

*Either `question` or `query` must be provided.

### How It Works

1. **Query generation** -- The question is analyzed for domain (tech, business, comparison, how-to, general). Domain-specific sub-queries are generated: a tech question gets queries suffixed with "github", "documentation official", "stackoverflow solution"; a business question gets "case study", "market analysis benchmark", "industry report".

2. **Parallel search** -- All queries run simultaneously. Each query tries Google first (cheapest path), then races DuckDuckGo and Bing in parallel on failure. Best case: 1 API call per query. Worst case: 3.

3. **Dedup and rank** -- Results are deduplicated by normalized URL. Up to 15 unique sources are kept.

4. **Content extraction** -- The top 5 source URLs are extracted in parallel via `novada_extract`. Sources where extraction fails fall back to their search snippets.

5. **Synthesis** -- Extracted content is ranked by keyword overlap with the original question. The most relevant fragment leads the summary; additional perspectives follow.

### Depth Modes

| Depth | Queries | Best For |
|-------|---------|----------|
| `quick` | 3 | Simple factual questions, quick lookups |
| `deep` | 5-6 | Comparisons, trade-off analysis, multi-faceted topics |
| `comprehensive` | 8-10 | Market research, competitive intelligence, thorough coverage |
| `auto` | varies | Server decides: short simple questions get `quick`, complex questions (80+ chars, contains "compare", "vs", "pros and cons") get `deep` |

### Examples

**Market research**

```
novada_research({
  question: "What are the top MCP servers for web data access in 2026?",
  depth: "deep"
})
```

**Competitive analysis with focus**

```
novada_research({
  question: "How does Firecrawl compare to Novada for agent web scraping?",
  depth: "comprehensive",
  focus: "pricing and developer experience"
})
```

**Technical deep dive**

```
novada_research({
  question: "Best practices for implementing MCP tool servers in TypeScript",
  depth: "deep",
  focus: "error handling and streaming"
})
```

**Quick fact lookup**

```
novada_research({
  query: "When was the Model Context Protocol specification released?",
  depth: "quick"
})
```

### Response Structure

The output is a structured markdown report:

```
## Research: <topic>

**Query**: <original question>
**depth**: deep
**queries**: 5/6 succeeded
**generated_queries**:
  1. <query 1>
  2. <query 2>
  ...
**sources_extracted**: 4 full + 1 snippet-only
**search_strategy**: concurrent engine racing (google + duckduckgo + bing)
**timestamp**: 2026-06-23T10:30:00.000Z

---

## Summary
<synthesized answer with citations>

**Additional perspectives:**
- *Source A*: <relevant excerpt>
- *Source B*: <contrasting point>

## Key Findings
- **Title** (url) -- snippet
- ...

## Sources
- url -- title (full content extracted)
- url -- title (snippet only -- extraction failed)

## Agent Hints
- Use novada_extract with specific source URLs for full content
- For narrower research: add focus param
- For more coverage: use depth='comprehensive'
```

### When to Use (and When Not To)

| Scenario | Use novada_research? |
|----------|---------------------|
| Complex question needing multiple sources | Yes |
| Comparative analysis or trade-offs | Yes |
| Market research, competitive intel | Yes |
| Single fact lookup ("what is X?") | No -- use `novada_search` |
| Reading one known URL | No -- use `novada_extract` |
| Getting structured product data | No -- use `novada_scrape` |

---

## novada_verify

Fact-check a claim against live web sources. Runs 3 parallel searches from different angles (supporting, skeptical, neutral fact-check) and returns a verdict with confidence score.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `claim` | string | Yes | -- | The factual claim to verify. Minimum 10 characters. |
| `context` | string | No | -- | Narrows the search. E.g. `"as of 2024"`, `"in the United States"`, `"according to WHO"`. |

### How It Works

1. **Three search angles** -- The claim is searched from three perspectives:
   - **Supporting**: `"<claim>" evidence study research`
   - **Skeptical**: `"<claim>" debunked refuted disproved misinformation myth`
   - **Neutral**: `fact check "<first 10 words of claim>"`

2. **Parallel execution** -- All 3 searches run simultaneously. Partial failures are tolerated (confidence is capped at 60 if a key query fails).

3. **Dispute filtering** -- Skeptical results are filtered for genuine disagreement language ("false", "debunked", "myth", "no evidence"). Academic papers that merely cite the claim as a true example are excluded.

4. **Verdict calculation** -- Supporting evidence count (including neutral fact-check results) is compared against contradicting evidence:
   - Score >= 0.6 --> `supported`
   - Score <= 0.3 --> `unsupported`
   - Between 0.3 and 0.6 --> `contested`
   - No evidence from either side --> `insufficient_data`

5. **Confidence scoring** -- 0-100 scale. Higher means more agreement among sources. Capped at 60 when a search query failed. Floor of 50 for clear verdicts.

### Verdicts

| Verdict | Meaning |
|---------|---------|
| `supported` | Majority of sources confirm the claim |
| `unsupported` | Majority of sources contradict the claim |
| `contested` | Sources disagree -- evidence on both sides |
| `insufficient_data` | Not enough search results to determine |

### Examples

**Simple fact check**

```
novada_verify({
  claim: "Python is the most popular programming language in 2026"
})
```

**Claim with context**

```
novada_verify({
  claim: "OpenAI was founded in 2015",
  context: "San Francisco, nonprofit AI research lab"
})
```

**Checking a statistic**

```
novada_verify({
  claim: "Over 50% of enterprise developers use AI coding assistants",
  context: "as of 2025 survey data"
})
```

### Response Structure

```
## Claim Verification

claim: "Python is the most popular programming language in 2026"
verdict: supported
confidence: 80  (0 = completely uncertain, 100 = all evidence agrees)

---

## Supporting Evidence (4 sources)

1. **TIOBE Index June 2026**
   Python maintains #1 position with 18.2% market share...

2. **Stack Overflow Developer Survey**
   ...

## Contradicting Evidence (1 source)

1. **Alternative Ranking Methodology**
   When measuring by lines of code in production...

---
## Agent Hints
- Verdict is based on search result balance, not deep reasoning.
- Supporting URLs: url1, url2, url3
- Contradicting URLs: url4
```

### Important Caveats

- The verdict is **signal-based**, not a definitive ruling. It reflects the balance of search results, not deep semantic reasoning.
- Confidence 0-100 indicates how much sources agree, not how "true" the claim is.
- For "contested" results, use `novada_extract` on the source URLs to read the full arguments.
- For "insufficient_data", try `novada_research` for a deeper multi-source investigation.

---

## novada_monitor

Track changes on a web page over time. Extracts content, computes a SHA-256 hash, and compares it against the previous check. Supports field-level diffs with percentage change annotations.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | The page to monitor. Must be HTTP/HTTPS. |
| `fields` | string[] | No | -- | Specific fields to track, e.g. `["price", "availability", "rating"]`. Up to 20. Without fields, monitors full page content hash. |
| `format` | string | No | `"markdown"` | Output format. `"markdown"` for human-readable reports, `"json"` for structured data. |

### How It Works

1. **Extract** -- The URL is fetched via `novada_extract` with `render: "auto"`.
2. **Hash** -- Content is SHA-256 hashed (first 16 hex chars stored).
3. **Field extraction** -- If `fields` are specified, values are extracted from the content using pattern matching: `field: value` labels, markdown headings, and currency patterns for price fields.
4. **Compare** -- If a previous check exists for the same URL, hashes and field values are compared.
5. **Diff** -- Changed fields get annotations: numeric changes show percentage (e.g. "27.3% decrease"), non-numeric changes show "changed".
6. **Store** -- The current state replaces the previous one in memory.

### Session-Scoped State

Monitor state lives in the MCP server's process memory. It persists across multiple calls within the same session but is **lost when the server restarts**. This means:

- First call to a URL records the baseline
- Subsequent calls detect changes relative to the last check
- Restarting the server resets all baselines

For persistent monitoring across sessions, use Novada's cloud monitoring API or build a wrapper that stores state externally.

### Examples

**Basic page monitoring (full content hash)**

```
novada_monitor({
  url: "https://example.com/pricing"
})
```

First call returns `status: baseline_recorded`. Second call returns `status: unchanged` or `status: changed`.

**Field-level price monitoring**

```
novada_monitor({
  url: "https://example.com/product/abc",
  fields: ["price", "availability", "rating"]
})
```

Returns field-level diffs:

```
## Changed Fields
- price: $29.99 --> $24.99 (16.7% decrease)
- availability: In Stock --> In Stock (unchanged)
- rating: 4.5 --> 4.6 (2.2% increase)
```

**JSON format for programmatic use**

```
novada_monitor({
  url: "https://competitor.com/pricing",
  fields: ["price"],
  format: "json"
})
```

Returns:

```json
{
  "url": "https://competitor.com/pricing",
  "status": "changed",
  "current_hash": "a1b2c3d4e5f6g7h8",
  "previous_hash": "z9y8x7w6v5u4t3s2",
  "total_checks": 3,
  "checks_since_change": 0,
  "fields_tracked": ["price"],
  "current_fields": { "price": "$24.99" },
  "changed_fields": [
    {
      "field": "price",
      "previous": "$29.99",
      "current": "$24.99",
      "annotation": "16.7% decrease"
    }
  ]
}
```

### Response States

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `baseline_recorded` | First check for this URL | Call again later to detect changes |
| `unchanged` | Content hash matches previous check | Call again later to continue monitoring |
| `changed` | Content hash differs from previous check | Process changes or alert user |
| `error` | Failed to extract content | Check URL accessibility, retry later |

### Use Cases

| Scenario | fields Parameter |
|----------|-----------------|
| Competitive pricing alerts | `["price", "plan_name", "features"]` |
| Stock/availability tracking | `["availability", "stock", "price"]` |
| Content change detection | omit (uses full hash) |
| Job listing monitoring | `["salary", "title", "location"]` |
| Regulatory/compliance page changes | omit (uses full hash) |

---

## Combining the Three Tools

These tools compose naturally in agent workflows:

**Research-then-verify pipeline:**
1. `novada_research` to investigate a topic
2. `novada_verify` to fact-check specific claims from the report
3. `novada_extract` on source URLs for full context on contested claims

**Competitive monitoring pipeline:**
1. `novada_research` to identify competitor pages
2. `novada_monitor` to track pricing/feature changes over time
3. `novada_verify` to validate competitor claims

**Due diligence workflow:**
1. `novada_research` with `depth: "comprehensive"` for full coverage
2. `novada_verify` on each key claim in the report
3. Synthesize into a verified brief

---

# Proxy & Browser Tools

Novada provides 6 proxy types for routing your own HTTP requests, plus 2 browser automation tools for interactive page workflows.

> These tools return proxy credentials and browser session handles for **your own HTTP clients** (curl, requests, axios). They do not fetch pages themselves. For page extraction, use `novada_extract` or `novada_crawl` — they handle proxy routing internally.

---

## Proxy Tools — Quick Reference

| Tool | Zone | IP Source | Anti-Bot Strength | Geo-Targeting | Sticky Session | Required Params |
|------|------|-----------|-------------------|---------------|----------------|-----------------|
| `novada_proxy_residential` | `zone-res` | 100M+ real home ISP IPs | Strongest | country, city | session_id | format |
| `novada_proxy_isp` | `zone-isp` | ISP-assigned IPs | Strong | n/a (ignored) | session_id | format |
| `novada_proxy_mobile` | `zone-mob` | 4G/5G cellular IPs | Strong | country, carrier | session_id | format |
| `novada_proxy_datacenter` | `zone-dcp` | Datacenter IPs | Weak | country | session_id | format |
| `novada_proxy_static` | per-IP creds | Dedicated static ISP IP | Strong | country (required) | session_id (required) | country, session_id, format |
| `novada_proxy_dedicated` | per-IP creds | Exclusive datacenter IP | Medium | n/a | session_id (required) | session_id, format |

### Escalation Path

When a proxy type gets blocked, escalate upward:

```
datacenter → isp → residential → mobile
  (fastest)                        (strongest)
```

---

## Proxy Type Details

### novada_proxy_residential

Real home ISP addresses from a 100M+ IP pool. Best anti-bot bypass for geo-restricted or protected pages.

**When to use:** Anti-bot protected pages, geo-restricted content, platforms that block datacenter IPs.

**Parameters:**
- `country` — ISO 2-letter code (e.g. `us`, `gb`, `de`). Optional.
- `city` — City-level targeting (e.g. `london`, `new-york`). Requires `country`.
- `session_id` — Same ID = same IP across requests. Optional.
- `format` — `url` (default), `env`, or `curl`.

**Example output (`format: "url"`):**
```
## Residential Proxy Configuration
zone: residential
targeting: US / new-york
session: my-session (sticky IP)
proxy_url: http://user-zone-res-region-us-city-newyork-session-my-session:***@proxy.novada.com:7777
```

---

### novada_proxy_isp

ISP-assigned IPs that look like genuine home users. Ideal for social media and ecommerce platforms.

**When to use:** Social media scraping, ecommerce platforms, any site that distinguishes home users from datacenter IPs.

**Parameters:**
- `country` — Accepted by schema but **has no effect on the backend**. Use `novada_proxy_residential` for geo-targeting.
- `session_id` — Sticky IP routing. Optional.
- `format` — `url`, `env`, or `curl`.

---

### novada_proxy_mobile

4G/5G IPs from real mobile devices on cellular networks.

**When to use:** Mobile-targeted content, app APIs, platforms that serve different content to mobile vs desktop.

**Parameters:**
- `country` — ISO 2-letter code. Optional.
- `carrier` — Carrier-level targeting (e.g. `verizon`, `att`, `t-mobile`). Optional.
- `session_id` — Sticky IP routing. Optional.
- `format` — `url`, `env`, or `curl`.

**Tip:** Pair with a mobile User-Agent header for full mobile simulation.

---

### novada_proxy_datacenter

Fastest and most cost-effective. Best for high-volume scraping of non-protected targets.

**When to use:** APIs, public data feeds, high-volume scraping without aggressive anti-bot.

**Parameters:**
- `country` — ISO 2-letter code. Optional.
- `session_id` — Sticky IP routing. Optional.
- `format` — `url`, `env`, or `curl`.

**Limitation:** Datacenter IPs are detectable by advanced bot-protection systems. Escalate to ISP or residential if blocked.

---

### novada_proxy_static

A dedicated static ISP IP that never changes for a given `session_id` + `country` pair.

**When to use:** Account management, login-dependent workflows, platforms that flag IP changes as suspicious.

**Parameters:**
- `country` — **Required.** Each country has a distinct pool of dedicated IPs.
- `session_id` — **Required.** Determines which dedicated IP is assigned.
- `format` — `url`, `env`, or `curl`.

**Setup:** Static proxies use per-IP credentials (not zone-based routing). Purchase IPs at `dashboard.novada.com/overview/proxies/` and set `NOVADA_STATIC_PROXY_LIST` env var with format `IP:PORT:USER:PASS` (one per line).

---

### novada_proxy_dedicated

An exclusive datacenter IP not shared with any other user. Clean reputation, zero contamination risk.

**When to use:** High-trust platforms, workflows needing a pristine IP with no negative history.

**Parameters:**
- `session_id` — **Required.** Maps to your exclusive dedicated IP.
- `format` — `url`, `env`, or `curl`.

**Setup:** Like static proxies, dedicated proxies use per-IP credentials. Set `NOVADA_DEDICATED_PROXY_LIST` env var with format `IP:PORT:USER:PASS` (one per line).

---

## Output Formats

All 6 proxy tools support 3 output formats:

| Format | Returns | Use Case |
|--------|---------|----------|
| `url` | Proxy URL + Node.js/Python usage examples | Programmatic HTTP clients |
| `env` | Shell `export` commands for `HTTP_PROXY`/`HTTPS_PROXY` | Terminal sessions, shell scripts |
| `curl` | `curl --proxy` flag ready to paste | Quick CLI testing |

**Password masking:** All outputs show `***` in place of the password. The agent reads `NOVADA_PROXY_PASS` from the environment at runtime.

---

## Auto-Provisioning

Zone-based proxies (residential, ISP, mobile, datacenter) support automatic credential resolution:

```
Priority 1: Explicit env vars
  NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT → no API call needed

Priority 2: Auto-fetch via NOVADA_API_KEY
  NOVADA_PROXY_ENDPOINT set but user/pass missing →
  fetches first active sub-account from POST /v1/proxy_account/list
  using NOVADA_API_KEY as Bearer token. Cached 6 hours.
```

**Minimum config for zone-based proxies:**
```json
{
  "env": {
    "NOVADA_API_KEY": "your-api-key",
    "NOVADA_PROXY_ENDPOINT": "proxy-host:port"
  }
}
```

User/pass are fetched automatically from your account's first active proxy sub-account.

**For static and dedicated proxies:** These require per-IP credentials. Set `NOVADA_STATIC_PROXY_LIST` or `NOVADA_DEDICATED_PROXY_LIST` manually.

---

## Proxy Account Management

Two additional tools manage proxy sub-accounts via the Developer API:

| Tool | Action | Key Detail |
|------|--------|------------|
| `novada_proxy_account_list` | List sub-accounts | Requires `product` code (1=Residential, 2=ISP, 3=Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile) |
| `novada_proxy_account_create` | Create sub-account | **Write operation** with 2-step confirm gate. Without `confirm: true`, returns a dry-run preview only. |

---

## Browser Tools

Two tools provide cloud browser automation via Novada's Browser API. Both require the `NOVADA_BROWSER_WS` environment variable.

### novada_browser

Full browser automation via CDP (Chrome DevTools Protocol) WebSocket. Connects to Novada's cloud Chromium instance using `playwright-core`.

**Actions supported (up to 20 per call):**
- `navigate` — Go to URL. Supports `wait_until`: `load`, `domcontentloaded` (default), `networkidle`.
- `click` — Click a CSS selector.
- `type` — Fill text into a CSS selector.
- `screenshot` — Full-page screenshot (returns base64 PNG).
- `snapshot` — Raw HTML of current page (truncated at 30K chars).
- `aria_snapshot` — Accessibility tree as YAML. ~70% smaller than HTML, semantic selectors.
- `evaluate` — Execute arbitrary JavaScript.
- `wait` — Wait for a CSS selector or a fixed delay.
- `scroll` — Scroll `up`, `down`, `top`, or `bottom`.
- `hover` — Hover over a CSS selector.
- `press_key` — Press a keyboard key (e.g. `Enter`, `Tab`, `Escape`).
- `select` — Select option in a `<select>` element.
- `close_session` — Release a named session (must be only action in call).
- `list_sessions` — List active session IDs (must be only action in call).

**Session management:**
- Pass `session_id` to reuse the same browser page across calls. Preserves cookies, localStorage, login state.
- Warm reuse: ~1.5s. Cold start: ~8s.
- Sessions expire after 10 minutes of inactivity.

**Parameters:**
- `actions` — Array of actions (1-20).
- `timeout` — Total timeout in ms (default 60000, max 120000).
- `session_id` — Optional. Sticky session for multi-call flows.
- `country` — ISO 2-letter code for browser exit node geo-targeting.

**Example:**
```json
{
  "actions": [
    { "action": "navigate", "url": "https://example.com", "wait_until": "domcontentloaded" },
    { "action": "click", "selector": "#login-button" },
    { "action": "type", "selector": "#email", "text": "user@example.com" },
    { "action": "screenshot" }
  ],
  "timeout": 60000,
  "session_id": "login-flow-1"
}
```

---

### novada_browser_flow

Multi-step browser automation via Novada's REST API (`POST /v1/browser_flow/browser_flow_use`). Simpler action set, server-side execution.

**Actions supported (up to 20 per call):**
- `click` — CSS selector.
- `scroll` — `up` or `down`.
- `wait` — Fixed delay.
- `type` — Fill text into CSS selector.
- `screenshot` — Capture page.

**Parameters:**
- `url` — **Required.** Page to open.
- `actions` — Array of actions (1-20).
- `country` — ISO 2-letter code. Optional.
- `session_id` — Sticky session. Optional.

**Key difference from `novada_browser`:**
- `novada_browser` uses CDP WebSocket directly — more action types, richer error detail, requires `playwright-core`.
- `novada_browser_flow` uses a REST API — simpler setup (no playwright dependency), but fewer action types.
- If `novada_browser_flow` fails, fall back to `novada_browser`.

---

## Browser Setup

```json
{
  "env": {
    "NOVADA_API_KEY": "your-api-key",
    "NOVADA_BROWSER_WS": "wss://username:password@upg-scbr2.novada.com"
  }
}
```

- `NOVADA_API_KEY` — Required for `novada_browser_flow` (REST API auth).
- `NOVADA_BROWSER_WS` — Required for `novada_browser` (CDP connection). Get credentials at `dashboard.novada.com/overview/browser/`. Format: `wss://user:pass@host`.

**SPA tip:** Use `wait_until: "domcontentloaded"` (default) for React, X/Twitter, TikTok. Never use `"networkidle"` for SPAs — they continuously poll and will timeout at 30s.

**Geo-restrictions:** TikTok is banned in some regions. Pass `country: "us"` for geo-restricted platforms.

---

## When to Use What

| Goal | Tool |
|------|------|
| Extract content from a URL | `novada_extract` (proxies handled internally) |
| Route your own HTTP requests through a proxy | `novada_proxy_*` |
| Interactive browser automation (click, type, login) | `novada_browser` |
| Simple multi-step browser flow without playwright | `novada_browser_flow` |
| Render JS-heavy page and get raw HTML | `novada_unblock` |

---

# Account Management & Advanced

## Account Management Tools

All account tools authenticate via `NOVADA_DEVELOPER_API_KEY` (falls back to `NOVADA_API_KEY`).

| Tool | Description | Key Params |
|------|-------------|------------|
| `novada_account_summary` | Single-call dashboard. Runs wallet + plan balances + capture logs in parallel, returns unified headline + per-section detail. | -- |
| `novada_wallet_balance` | Read master wallet balance (currency credit). | -- |
| `novada_wallet_usage_record` | Paginated wallet transaction / usage history. | `page`, `page_size` (max 200), `start_time`/`end_time` (YYYY-MM-DD) |
| `novada_plan_balance_all` | Per-product quota balance across 6 products (residential/isp/mobile/datacenter/static/capture) in parallel. | `products` (optional subset) |
| `novada_traffic_daily` | Aggregate daily traffic consumption across 5 proxy products in parallel. | `start_time`/`end_time` (YYYY-MM-DD), `products` (optional subset) |
| `novada_capture_logs` | Paginated capture-task logs for auditing and debugging. | `page`, `page_size` (max 200), `status` (success/failed/all), `start_time`/`end_time` |

### Proxy Sub-Account Management

| Tool | Description | Key Params |
|------|-------------|------------|
| `novada_proxy_account_create` | Create a proxy sub-account. **WRITE** -- two-step confirm gate. Without `confirm: true`, returns a dry-run preview. | `product` (1=Residential, 2=ISP, 3=Datacenter, 4=Unlimited, 7=Unblocker, 9=Mobile), `account`, `password`, `confirm` |
| `novada_proxy_account_list` | List proxy sub-accounts. | `product` (required), `page`, `limit` (max 200), `status`, `account` |
| `novada_ip_whitelist` | Manage IP whitelist for proxy products. Supports add/list/delete/remark via `action` discriminator. | `action` (add/list/del/remark), `product` (1=Residential, 4=Unlimited, 5=Static ISP), `confirm` for writes |

### Write Safety Gate

`novada_proxy_account_create` and `novada_ip_whitelist` (actions `add` and `del`) are gated by a two-step confirmation:

1. Call without `confirm` -- returns a `confirmation_required` preview with masked credentials.
2. Show the preview to the human user.
3. Re-call with the same parameters plus `confirm: true` only after explicit approval.

Agents must never set `confirm: true` without human consent.

### Choosing the Right Balance Tool

| Question | Tool |
|----------|------|
| "How much credit do I have?" | `novada_wallet_balance` |
| "Do I have quota left on residential/mobile/...?" | `novada_plan_balance_all` |
| "How much traffic did I use this week?" | `novada_traffic_daily` |
| "Give me a full account snapshot" | `novada_account_summary` |
| "What did I spend money on?" | `novada_wallet_usage_record` |

---

## Advanced Features

### Discovery & Diagnostics

| Tool | Description | Auth Required |
|------|-------------|---------------|
| `novada_setup` | Environment diagnostics with step-by-step setup instructions. Returns status of all env vars and config snippets for Claude Code / Cursor / VS Code / Windsurf. | No |
| `novada_discover` | List all available tools with name, category, and status (active/todo). Filter by category. | Yes |
| `novada_health` | Quick check: which Novada products are active on your API key. Returns status table for 5 products. | Yes |
| `novada_health_all` | Extended health check: tests all 6 product endpoints in parallel. Returns per-product latency, status, and activation links for inactive products. | Yes |

**Recommended startup sequence for agents:**

```
1. novada_setup          -- verify env vars are configured
2. novada_health_all     -- confirm which products are reachable
3. novada_discover       -- see full tool catalog
```

### AI Brand Monitoring

| Tool | Description | Key Params |
|------|-------------|------------|
| `novada_ai_monitor` | Check how AI models (ChatGPT, Perplexity, Grok, Claude, Gemini) reference a brand or product. Returns per-model sentiment, key claims, competitor mentions, source URLs. | `brand` (required), `models` (default: chatgpt, perplexity, grok), `topics` (optional filter) |

Use cases:
- Track how AI search engines recommend your product vs competitors.
- Detect inaccurate claims about your brand across AI platforms.
- Monitor competitive positioning in AI-generated responses.

### Tool Filtering

Reduce tool count by exposing only the categories you need:

```bash
# Individual tools
NOVADA_TOOLS="extract,search,crawl"

# Category bundles
NOVADA_GROUPS="search,proxy"

# Both set = union
NOVADA_TOOLS="extract" NOVADA_GROUPS="account"
```

Available group bundles:

| Group | Tools Included |
|-------|---------------|
| `search` | search, extract, crawl, map, research, verify, ai_monitor, monitor |
| `proxy` | proxy, proxy_residential, proxy_isp, proxy_datacenter, proxy_mobile, proxy_static, proxy_dedicated |
| `browser` | browser, browser_flow |
| `scraper` | scrape, scraper_submit, scraper_status, scraper_result |
| `health` | health, health_all, discover, setup |
| `account` | wallet_balance, wallet_usage_record, proxy_account_create, proxy_account_list, traffic_daily, plan_balance_all, capture_logs, account_summary, ip_whitelist |

`novada_health` and `novada_setup` are always included regardless of filter, so agents can diagnose issues.

---

## Output Pipeline

All tools that produce structured results can save output to the local filesystem.

**Directory structure:**

```
~/Downloads/novada-mcp/
  2026-06-23/
    scrape_amazon_com_143052001.json
    extract_example_com_143055123.md
    search_react_hooks_143100456.csv
```

**Naming convention:** `{tool}_{domain_or_hint}_{HHmmssSSS}.{format}`

**Supported formats:**

| Format | Extension | Content |
|--------|-----------|---------|
| JSON | `.json` | Pretty-printed with 2-space indent |
| CSV | `.csv` | Auto-generated headers from all record keys, proper escaping |
| Markdown | `.md` | Raw text or stringified JSON |

The output directory is created automatically on first write. Each day gets its own subdirectory (`YYYY-MM-DD`).

---

# Staying on the latest version / Troubleshooting stale versions

**Always use `npx -y novada-mcp@latest`.** Never run a bare `npx novada-mcp` and never do `npm install -g novada-mcp`.

**Why global installs are dangerous:** When a global `novada-mcp` binary exists on `PATH`, every `npx novada-mcp` invocation resolves to the global binary — npm's registry is never checked. You silently run whatever version was installed, which may be many versions behind. The global install on your maintainer machine was running `0.7.4` while npm latest was `0.9.2`.

**If you see the wrong version running:**

```bash
# 1. Compare what you are running vs what npm has published
npx novada-mcp@latest --version
npm view novada-mcp version

# 2. Remove any stale global install
npm uninstall -g novada-mcp

# 3. Verify the cache is clean
npm cache verify

# 4. Confirm the correct version now starts
npx -y novada-mcp@latest --version
```

**Convention for client configs and docs:** All MCP client configuration examples (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Zed, n8n) must use `npx -y novada-mcp@latest`. Never document a bare `npx novada-mcp` or a global/bare install in user-facing instructions.

---

# CLI Reference

Novada ships two command-line interfaces from a single npm package: the **MCP server** (`novada-mcp`) that AI agents connect to via stdio, and the **direct CLI** (`novada`) for running web data commands from your terminal.

---

## Installation

### Zero-install (recommended)

```bash
npx -y novada-mcp@latest
```

Runs the MCP server directly. No global install, always up to date.

### Global install

> **Warning:** Avoid `npm install -g novada-mcp` for development or client configs. A global binary shadows `npx`, so every future `npx novada-mcp` call silently runs the old global version — you stop receiving updates without any warning. Use `npx -y novada-mcp@latest` instead.
>
> Global install is appropriate for Docker images and CI environments where you control the rebuild cadence. Pin `@latest` and rebuild when upgrading: `npm install -g novada-mcp@latest`.

```bash
npm install -g novada-mcp@latest
```

Exposes two binaries:

| Binary | Purpose |
|--------|---------|
| `novada-mcp` | Start the MCP server (stdio transport) |
| `novada` | Direct CLI for terminal usage |

### For AI agents

```bash
# Claude Code
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest

# Verify it's connected
claude mcp list
```

See the [Quick Start](./02-quickstart.md) page for Claude Desktop, Cursor, VS Code, and Windsurf configuration.

---

## Authentication

Novada uses a single API key for all products. No token exchange, no OAuth, no separate keys per product.

```bash
export NOVADA_API_KEY=your_key
```

Get your key at [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/).

---

## MCP Server Commands

The `novada-mcp` binary starts the MCP server. It communicates over stdio and is designed to be launched by MCP clients, not run interactively.

### `novada-mcp`

Start the MCP server.

```bash
NOVADA_API_KEY=your_key npx -y novada-mcp@latest
```

```
Novada MCP server v0.8.1 running on stdio — 39 tools loaded
```

### `novada-mcp --help`

Display server help, environment variable reference, and full tool list.

```bash
npx -y novada-mcp@latest --help
```

### `novada-mcp --list-tools`

Print all available tools with one-line descriptions. Respects `NOVADA_TOOLS` and `NOVADA_GROUPS` filtering.

```bash
npx -y novada-mcp@latest --list-tools
```

```
  novada_search — Search the web via Google, Bing, and 3 more engines
  novada_extract — Extract content from any URL (smart auto-routing)
  novada_crawl — Crawl a website (BFS/DFS, up to 20 pages)
  ...
```

### `novada-mcp --version`

Print the server version and exit.

---

## Direct CLI Commands

The `novada` binary provides direct terminal access to all Novada tools. Every command prints results to stdout and exits.

### `novada search`

Search the web across multiple engines with deduplication and relevance ranking.

```bash
novada search "best AI frameworks 2025"
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--engine` | string | `google` | Search engine: `google`, `bing`, `duckduckgo`, `yahoo`, `yandex` |
| `--num` | integer | `10` | Number of results (1-20) |
| `--country` | string | | ISO 2-letter country code for geo-targeting |
| `--language` | string | | Language code (e.g. `en`, `de`) |
| `--time` | string | | Time range: `day`, `week`, `month`, `year` |
| `--from` | string | | Start date (ISO YYYY-MM-DD) |
| `--to` | string | | End date (ISO YYYY-MM-DD) |
| `--include` | string | | Comma-separated domains to include |
| `--exclude` | string | | Comma-separated domains to exclude |

**Examples:**

```bash
# Recent news from the last week
novada search "GPT-5 release" --time week --country us

# Restrict to specific domains
novada search "best AI tools" --include "github.com,arxiv.org"

# Date-bounded search
novada search "AI regulation" --from 2025-01-01 --to 2025-06-30
```

---

### `novada extract`

Extract clean content from any URL. Handles Cloudflare, DataDome, and Kasada automatically via smart escalation (static -> JS render -> browser CDP).

```bash
novada extract https://example.com
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--format` | string | `markdown` | Output format: `markdown`, `text`, `html` |
| `--render` | string | `auto` | Rendering mode: `auto`, `static`, `render`, `browser` |

**Examples:**

```bash
# Default markdown extraction
novada extract https://docs.anthropic.com/en/docs/overview

# Force JS rendering for SPA pages
novada extract https://app.example.com/dashboard --render render

# Get raw HTML
novada extract https://example.com --format html
```

> **Tip:** Leave `--render` on `auto`. It tries static first (15x faster), then escalates to JS rendering only when needed.

---

### `novada crawl`

Crawl a website and extract content from multiple pages. Supports BFS (breadth-first) and DFS (depth-first) traversal.

```bash
novada crawl https://docs.example.com --max-pages 10
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--max-pages` | integer | `5` | Maximum pages to crawl (1-20) |
| `--pages` | integer | `5` | Alias for `--max-pages` |
| `--strategy` | string | `bfs` | Traversal order: `bfs`, `dfs` |
| `--render` | string | `auto` | Rendering mode: `auto`, `static`, `render` |
| `--select` | string | | Comma-separated regex patterns for URL paths to include |
| `--exclude-paths` | string | | Comma-separated regex patterns for URL paths to exclude |
| `--instructions` | string | | Natural language hint for page prioritization |

**Examples:**

```bash
# Crawl API docs only
novada crawl https://docs.example.com --max-pages 10 --select "/api/.*"

# Use natural language filtering
novada crawl https://docs.example.com --instructions "only quickstart pages"

# Deep-first crawl, skip blog
novada crawl https://example.com --strategy dfs --exclude-paths "/blog/.*,/changelog/.*"
```

---

### `novada map`

Discover all URLs on a site without downloading content. Tries sitemap.xml first (fast), falls back to BFS crawl.

```bash
novada map https://example.com
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--search` | string | | Filter URLs by search term |
| `--limit` | integer | `50` | Maximum URLs to return (1-100) |
| `--max-depth` | integer | `2` | Link hops from root to follow (1-5) |

**Examples:**

```bash
# Find pricing pages
novada map https://example.com --search "pricing" --max-depth 3

# Full sitemap discovery
novada map https://docs.example.com --limit 100
```

---

### `novada research`

Multi-step web research that runs 3-10 parallel searches, deduplicates, extracts full content from top sources, and produces a synthesized report with citations.

```bash
novada research "How do AI agents use web scraping?"
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--depth` | string | `auto` | Research depth: `quick` (3 queries), `deep` (5-6), `comprehensive` (8-10), `auto` |
| `--focus` | string | | Focus area to guide sub-query generation |

**Examples:**

```bash
# Deep research with focus
novada research "How do AI agents use web scraping?" --depth deep --focus "production use cases"

# Quick fact-finding
novada research "Latest funding rounds in AI infrastructure" --depth quick
```

---

### `novada proxy`

Generate proxy credentials for residential, ISP, datacenter, or mobile IPs. Does not require `NOVADA_API_KEY` (uses proxy-specific credentials).

```bash
novada proxy --type residential --country us
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--type` | string | `residential` | Proxy type: `residential`, `mobile`, `isp`, `datacenter` |
| `--country` | string | | ISO 2-letter country code |
| `--format` | string | `url` | Output format: `url`, `env`, `curl` |
| `--session` | string | | Session ID for sticky IP routing |

**Examples:**

```bash
# Residential proxy URL for the US
novada proxy --type residential --country us --format url

# Shell export commands for scripting
novada proxy --type residential --country us --format env

# Sticky session for multi-request workflows
novada proxy --type isp --country gb --session my-session-1
```

---

### `novada scrape`

Extract structured data from supported platforms (Amazon, TikTok, LinkedIn, GitHub, Reddit, and more). Returns clean tabular records.

```bash
novada scrape --platform amazon.com --operation amazon_product_keywords --keyword "iphone 16"
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--platform` | string | **required** | Platform domain (e.g. `amazon.com`, `tiktok.com`) |
| `--operation` | string | **required** | Operation ID (e.g. `amazon_product_keywords`) |
| `--format` | string | `markdown` | Output format: `markdown`, `json`, `csv`, `html`, `xlsx` |
| `--limit` | integer | `20` | Maximum records to return (1-100) |
| `--*` | varies | | Any additional flags are passed as operation-specific params |

Operation-specific parameters (like `--keyword`, `--url`, `--asin`, `--num`) are passed through directly. Numeric values are auto-coerced.

**Examples:**

```bash
# Amazon keyword search with CSV output
novada scrape --platform amazon.com --operation amazon_product_keywords \
  --keyword "iphone 16" --num 5 --format csv

# GitHub repository info
novada scrape --platform github.com --operation github_repository_repo-url \
  --url "https://github.com/anthropics/anthropic-sdk-python"

# TikTok posts
novada scrape --platform tiktok.com --operation tiktok_posts_url \
  --url "https://www.tiktok.com/@example" --format json
```

---

### `novada verify`

Check a factual claim against web sources. Runs parallel searches from supporting, skeptical, and fact-check angles. Returns a verdict with confidence score.

```bash
novada verify "The Eiffel Tower is 330 meters tall"
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--context` | string | | Context to narrow the search (e.g. "as of 2024", "in the US") |

**Examples:**

```bash
novada verify "The Eiffel Tower is 330 meters tall" --context "as of 2024"
novada verify "GPT-4 was released in March 2023"
```

---

### `novada health`

Check which Novada products are active on your API key. No arguments needed.

```bash
novada health
```

Returns a status table for Search, Extract, Scraper API, Proxy, Browser API, and Web Unblocker.

---

## Output Handling

### File output

Long-form results (search, extract, research, scrape) are automatically saved to:

```
~/Downloads/novada-mcp/YYYY-MM-DD/
```

Files are named using the pattern `{tool}_{hint}_{HHmmssSSS}.{format}`:

```
~/Downloads/novada-mcp/2026-06-23/
  search_GPT_5_release_143022450.json
  extract_docs_anthropic_com_143045120.md
  research_AI_agents_web_scraping_143112890.md
  scrape_amazon_com_143200340.csv
```

### Supported formats

| Format | Extension | Best for |
|--------|-----------|----------|
| Markdown | `.md` | Reading, agent consumption |
| JSON | `.json` | Programmatic processing, piping |
| CSV | `.csv` | Spreadsheets, data analysis |
| HTML | `.html` | Browser viewing |
| XLSX | `.xlsx` | Excel (scrape output only) |

### Piping and composition

CLI output goes to stdout, making it composable with standard Unix tools:

```bash
# Pipe search results through jq
novada search "AI funding 2025" | jq '.results[].url'

# Save extract output to a specific file
novada extract https://example.com > page.md

# Chain map into extract
novada map https://docs.example.com --search "api" | head -5 | \
  while read url; do novada extract "$url"; done
```

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `NOVADA_API_KEY` | Your Novada API key. Covers all products: search, extract, crawl, research, scrape, unblock, and proxy auto-provisioning. Get it at [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/). |

### Optional (unlock additional capabilities)

| Variable | Description |
|----------|-------------|
| `NOVADA_BROWSER_WS` | Browser API WebSocket endpoint. Format: `wss://user:pass@upg-scbr.novada.com`. Enables `novada_browser` and `novada_browser_flow` tools. |
| `NOVADA_PROXY_ENDPOINT` | Proxy gateway `host:port`. When set, proxy user/pass are auto-provisioned from your account using `NOVADA_API_KEY`. |
| `NOVADA_PROXY_USER` | Override proxy username. Auto-fetched from your account if `NOVADA_PROXY_ENDPOINT` is set but this is not. |
| `NOVADA_PROXY_PASS` | Override proxy password. Auto-fetched from your account if `NOVADA_PROXY_ENDPOINT` is set but this is not. |
| `NOVADA_WEB_UNBLOCKER_KEY` | Override Web Unblocker key. Falls back to `NOVADA_API_KEY` if not set. |
| `NOVADA_DEVELOPER_API_KEY` | Developer API key for account management tools (wallet, traffic, sub-accounts). Falls back to `NOVADA_API_KEY`. |

### Tool filtering (MCP server only)

These variables control which tools the MCP server exposes. Useful for reducing context window usage when agents only need a subset of capabilities.

| Variable | Description |
|----------|-------------|
| `NOVADA_TOOLS` | Comma-separated list of tool names to enable. Accepts short names (`search`, `extract`) or full names (`novada_search`, `novada_extract`). |
| `NOVADA_GROUPS` | Comma-separated category bundles to enable. If both `NOVADA_TOOLS` and `NOVADA_GROUPS` are set, the union is used. |

**Available groups:**

| Group | Tools included |
|-------|---------------|
| `search` | `search`, `extract`, `crawl`, `map`, `research`, `verify`, `ai_monitor`, `monitor` |
| `proxy` | `proxy`, `proxy_residential`, `proxy_isp`, `proxy_datacenter`, `proxy_mobile`, `proxy_static`, `proxy_dedicated` |
| `browser` | `browser`, `browser_flow` |
| `scraper` | `scrape`, `scraper_submit`, `scraper_status`, `scraper_result` |
| `health` | `health`, `health_all`, `discover`, `setup` |
| `account` | `wallet_balance`, `wallet_usage_record`, `proxy_account_create`, `proxy_account_list`, `traffic_daily`, `plan_balance_all`, `capture_logs`, `account_summary`, `ip_whitelist` |

> `health` and `setup` tools are always available regardless of filtering.

**Examples:**

```bash
# Only search and extraction tools (14 tools instead of 39)
NOVADA_TOOLS="search,extract,crawl,map,research" npx -y novada-mcp@latest

# Load by category
NOVADA_GROUPS="search,scraper" npx -y novada-mcp@latest

# Combine both
NOVADA_TOOLS="verify" NOVADA_GROUPS="proxy" npx -y novada-mcp@latest
```

### HTTP transport authentication (MCP server only)

| Variable | Description |
|----------|-------------|
| `NOVADA_AUTH_USER` | Username for HTTP basic auth when running the server over HTTP transport. |
| `NOVADA_AUTH_PASS` | Password for HTTP basic auth. |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (missing API key, invalid arguments, API failure) |

Errors are printed to stderr with a descriptive message:

```
Error: NOVADA_API_KEY not set. Get your key at https://www.novada.com
Error: search requires an argument. Run 'novada --help' for usage.
```

---

## Version

```bash
# MCP server version
npx -y novada-mcp@latest --version

# CLI version
novada --version
```

Both print the same version number from `package.json`.

---

# Build with AI

Novada is built for AI agents. Not adapted for them, not compatible with them -- built for them. Every tool description, every error message, every response format is designed so an LLM can read it, understand it, and act on it without human intervention.

This page is your entry point to using Novada inside any AI agent, coding assistant, or autonomous workflow.

---

## Why AI Agents Love Novada

**One API key covers everything.** Search, extract, crawl, scrape, research, verify, monitor, browser automation, and proxies. No juggling multiple services, billing dashboards, or credential sets. One `NOVADA_API_KEY` and you're running.

**40+ tools designed for agent consumption.** Each tool has a precise `description` in its MCP schema that tells the agent exactly when to use it, when NOT to use it, and what common mistakes to avoid. Agents pick the right tool on the first try.

**`agent_instruction` in every error response.** When something goes wrong, the error payload includes a structured next-step hint. No stack traces to parse, no docs to look up. The agent reads the instruction and self-corrects.

**Results auto-saved to local files.** Every extraction, search, and scrape writes output to `~/Downloads/novada-mcp/YYYY-MM-DD/`. Agents can reference files by path without holding large payloads in context.

**Multi-source research in one call.** `novada_research` fires 3-10 parallel searches across Google, Bing, and DuckDuckGo, deduplicates sources, extracts the top 5 pages, and returns a cited report. No other MCP server does this. One tool call replaces an entire search-extract-synthesize pipeline.

**Auto-escalation handles anti-bot.** Cloudflare, DataDome, Kasada, PerimeterX -- `novada_extract` starts with a fast static fetch, detects bot challenges, and escalates through JS rendering to full browser CDP automatically. Zero configuration.

---

## Get Started in 60 Seconds

### 1. Get your API key

Go to [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/), sign up, and copy your key. It covers all core products immediately.

### 2. Install for your platform

#### Claude Code

```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest
```

Done. Restart Claude Code and all tools are available.

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

#### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

#### VS Code

Add to `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

### 3. Verify it works

Ask your agent:

```
Run novada_health_all() to check my setup.
```

You should see a status table with latency for each active product.

---

## Using Novada as a Tool

### Search — `novada_search`

**What it does:** Search the web via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex) with relevance-ranked results.

**When to use:** Finding URLs for a topic, current events, fact lookup, competitive discovery.

**Example call:**

```json
{
  "query": "best practices for MCP server development 2026",
  "engine": "google",
  "num": 10,
  "format": "markdown"
}
```

**What you get back:** A ranked list of titles, URLs, and snippets. Add `enrich_top: true` to auto-extract the #1 result's full content inline.

---

### Extract — `novada_extract`

**What it does:** Convert any URL to clean markdown, plain text, HTML, or structured JSON. Handles anti-bot automatically.

**When to use:** Reading a known URL, batch-extracting pages, pulling specific fields (price, author, rating).

**Example call:**

```json
{
  "url": "https://docs.example.com/api/authentication",
  "format": "markdown",
  "render": "auto"
}
```

**What you get back:** Clean markdown with headings, paragraphs, code blocks, and links preserved. For specific data points, pass `fields: ["price", "rating"]` to get a structured extraction.

---

### Scrape — `novada_scrape`

**What it does:** Structured data extraction from 13 platforms (Amazon, LinkedIn, TikTok, YouTube, GitHub, Instagram, X/Twitter, Facebook, Google, Bing, Walmart, DuckDuckGo, Yandex) with ~78 operations.

**When to use:** Product listings, social media profiles, company data, job listings -- any platform where you need tabular records, not raw HTML.

**Example call:**

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_keywords",
  "params": { "keyword": "wireless earbuds" },
  "limit": 10,
  "format": "markdown"
}
```

**What you get back:** A structured table with product title, price, rating, ASIN, URL, and more for each result. Use `format: "json"` for programmatic processing or `format: "toon"` for token-optimized output (40-65% smaller).

---

### Research — `novada_research`

**What it does:** One call triggers 3-10 parallel searches across multiple engines, deduplicates results, extracts full content from the top 5 sources, and returns a synthesized report with citations. No other MCP server offers this.

**When to use:** Complex questions needing multiple sources, comparative analysis, market research, competitive intelligence.

**Example call:**

```json
{
  "question": "How do Firecrawl, Tavily, and Novada compare for AI agent web data access?",
  "depth": "deep",
  "focus": "developer experience and pricing"
}
```

**What you get back:** A structured report with generated sub-queries, source count, a synthesized summary with citations, key findings, and full source URLs. Includes agent hints for follow-up actions.

---

### Crawl + Map — `novada_crawl`, `novada_map`

**What `novada_crawl` does:** Extract content from multiple pages of a site. BFS or DFS traversal, up to 20 pages, with regex path filters.

**What `novada_map` does:** Discover all URLs on a site without downloading content. Uses sitemap.xml first (fast), falls back to link crawl.

**When to use:** Building knowledge bases from documentation sites (crawl), planning which pages to extract (map).

**Typical workflow:**

```
Step 1: novada_map({ url: "https://docs.stripe.com", search: "webhooks" })
        --> Returns URLs matching "webhooks"

Step 2: novada_extract({ urls: ["https://docs.stripe.com/webhooks", "https://docs.stripe.com/webhooks/signatures"] })
        --> Extracts full content from the most relevant pages
```

---

### Proxy — `novada_proxy_*`

**What it does:** Route your own HTTP requests through residential, ISP, mobile, datacenter, static, or dedicated IPs across 195 countries.

**When to use:** Geo-restricted content, IP rotation, bypassing rate limits, account management workflows needing a consistent IP.

**6 proxy types, one escalation path:**

```
datacenter --> isp --> residential --> mobile
 (fastest)                          (strongest anti-bot)
```

**Example call:**

```json
{
  "type": "residential",
  "country": "us",
  "city": "new-york",
  "format": "curl"
}
```

**What you get back:** A ready-to-paste `curl --proxy` command with credentials. Also available as a proxy URL (`format: "url"`) or shell exports (`format: "env"`).

> Note: `novada_extract` and `novada_crawl` handle proxy routing internally. These tools are for routing your own HTTP requests.

---

### Browser — `novada_browser`

**What it does:** Full browser automation via CDP. Navigate, click, type, fill forms, take screenshots, run JavaScript, and maintain sessions with cookies and login state.

**When to use:** Login flows, paginated content behind interactions, SPAs that require clicking through, visual verification with screenshots.

**Example call:**

```json
{
  "actions": [
    { "action": "navigate", "url": "https://example.com/login", "wait_until": "domcontentloaded" },
    { "action": "type", "selector": "#email", "text": "user@example.com" },
    { "action": "type", "selector": "#password", "text": "securepass" },
    { "action": "click", "selector": "#submit" },
    { "action": "wait", "ms": 3000 },
    { "action": "screenshot" }
  ],
  "session_id": "login-session",
  "timeout": 60000
}
```

**What you get back:** Action results including screenshots (base64 PNG), page snapshots, or evaluation output. The `session_id` keeps cookies and state alive across multiple calls (10-minute inactivity timeout).

---

### Verify — `novada_verify`

**What it does:** Fact-check a claim against live web sources. Runs 3 parallel searches (supporting, skeptical, neutral) and returns a verdict: `supported`, `unsupported`, `contested`, or `insufficient_data`.

**When to use:** Validating claims before citing them, cross-checking research findings, detecting misinformation.

**Example call:**

```json
{
  "claim": "Python is the most popular programming language in 2026",
  "context": "based on TIOBE and Stack Overflow data"
}
```

---

### Monitor — `novada_monitor`

**What it does:** Track changes on a web page over time. First call records a baseline; subsequent calls return field-level diffs with percentage changes.

**When to use:** Price monitoring, availability tracking, content change detection, competitive pricing alerts.

**Example call:**

```json
{
  "url": "https://competitor.com/pricing",
  "fields": ["price", "plan_name", "features"],
  "format": "markdown"
}
```

---

## How Agents Chain Novada Tools

Novada tools are designed to compose. Here are three real workflows that agents build naturally.

### Workflow 1: Deep Research Pipeline

**Goal:** Answer a complex question with cited, multi-source analysis.

```
1. novada_research({
     question: "What are the security implications of MCP servers?",
     depth: "comprehensive"
   })
   --> Cited report with 8-10 source searches, 5 extracted pages

2. novada_verify({
     claim: "MCP servers can execute arbitrary code on the host machine"
   })
   --> Verdict: supported/unsupported/contested

3. novada_extract({
     url: "https://spec.modelcontextprotocol.io/specification/security"
   })
   --> Full content from the official spec for authoritative detail
```

**Why this works:** `novada_research` provides breadth. `novada_verify` validates specific claims. `novada_extract` adds depth on the most important source.

### Workflow 2: E-Commerce Price Intelligence

**Goal:** Monitor competitor pricing and validate their marketing claims.

```
1. novada_scrape({
     platform: "amazon.com",
     operation: "amazon_product_keywords",
     params: { keyword: "noise cancelling headphones" },
     limit: 20
   })
   --> Structured product data: titles, prices, ratings, ASINs

2. novada_monitor({
     url: "https://competitor.com/product/flagship-headphones",
     fields: ["price", "availability", "rating"]
   })
   --> Baseline recorded on first call; diffs on subsequent calls

3. novada_verify({
     claim: "Our headphones have the best noise cancellation in their price range",
     context: "under $300 wireless headphones 2026"
   })
   --> Fact-check the competitor's marketing claim against web sources
```

**Why this works:** `novada_scrape` gets the market landscape. `novada_monitor` tracks changes over time. `novada_verify` checks if claims hold up.

### Workflow 3: Competitive Intelligence Report

**Goal:** Build a comprehensive competitive analysis from scratch.

```
1. novada_search({
     query: "Firecrawl vs Tavily vs Bright Data MCP comparison",
     num: 10,
     extract_options: { top_n: 3, format: "markdown" }
   })
   --> Search results + full content from top 3 pages

2. novada_map({
     url: "https://docs.firecrawl.dev",
     search: "pricing"
   })
   --> Find the exact pricing page URL

3. novada_extract({
     urls: [
       "https://docs.firecrawl.dev/pricing",
       "https://tavily.com/pricing",
       "https://brightdata.com/pricing"
     ]
   })
   --> Extract all three pricing pages in parallel

4. novada_scrape({
     platform: "linkedin.com",
     operation: "linkedin_company_information_url",
     params: { url: "https://www.linkedin.com/company/firecrawl/" }
   })
   --> Structured company data: employee count, funding, description
```

**Why this works:** `novada_search` with `extract_options` does discovery and reading in one call. `novada_map` finds specific pages. `novada_extract` with batch URLs reads them in parallel. `novada_scrape` adds structured data from platforms.

---

## Novada Docs for Agents

Novada includes built-in tools and resources that help agents discover capabilities at runtime.

### `novada_discover()`

Lists all available Novada tools with name, description, category, and status. Filter by category to see only the tools relevant to your task.

```
novada_discover()                              --> all tools
novada_discover({ category: "Proxy" })         --> proxy tools only
novada_discover({ category: "Content Retrieval" }) --> search, extract, crawl, etc.
```

### `novada_setup()`

Environment diagnostics. Returns the status of every environment variable, which tools are active, and copy-paste setup commands for every MCP client. Works even before `NOVADA_API_KEY` is configured.

### `novada://guide`

MCP resource containing the full usage guide. Agents can read this resource to understand tool selection, common patterns, and error handling without consuming a tool call.

```
Read resource: novada://guide
```

### `novada://scraper-platforms`

MCP resource listing all supported scraper platforms with their operation IDs and required parameters. Essential for agents that need to discover what platforms are available and how to call them.

```
Read resource: novada://scraper-platforms
```

---

## Framework Integrations

Novada works with any framework that supports the Model Context Protocol. The MCP server runs as a local stdio process, so any MCP-compatible client can connect.

### LangChain

Use the `langchain-mcp-adapters` package to connect LangChain agents to Novada's MCP tools:

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

async with MultiServerMCPClient({
    "novada": {
        "command": "npx",
        "args": ["-y", "novada-mcp@latest"],
        "env": {"NOVADA_API_KEY": "your_key"}
    }
}) as client:
    tools = client.get_tools()
    # tools now contains all Novada MCP tools as LangChain tools
```

### CrewAI

CrewAI supports MCP tools natively. Add Novada as an MCP server in your crew configuration:

```python
from crewai import Agent, Crew
from crewai.tools import MCPServerAdapter

novada = MCPServerAdapter(
    command="npx",
    args=["-y", "novada-mcp@latest"],
    env={"NOVADA_API_KEY": "your_key"}
)

researcher = Agent(
    role="Market Researcher",
    tools=novada.tools()
)
```

### AutoGen / AG2

Connect via the MCP tool integration:

```python
from autogen.tools.mcp import MCPToolManager

mcp = MCPToolManager()
mcp.add_server("novada", command="npx", args=["-y", "novada-mcp@latest"],
               env={"NOVADA_API_KEY": "your_key"})
tools = mcp.get_tools("novada")
```

### Any MCP-Compatible Framework

Novada's MCP server uses standard stdio transport. Any framework that can spawn a child process and speak MCP protocol can connect:

```bash
npx -y novada-mcp@latest
```

Set `NOVADA_API_KEY` in the process environment. The server registers all tools via the standard MCP `tools/list` method.

Frameworks with confirmed MCP support include: Claude Code, Claude Desktop, Cursor, VS Code (Copilot), Windsurf, Continue, Google ADK, Mastra, Vercel AI SDK, OpenAI Agents SDK, and n8n.

---

## Reducing Context Window Usage

Loading all 40+ tools consumes context. Use `NOVADA_TOOLS` or `NOVADA_GROUPS` to load only what you need:

```json
{
  "env": {
    "NOVADA_API_KEY": "your_key",
    "NOVADA_GROUPS": "search"
  }
}
```

| Group | Tools Loaded |
|-------|-------------|
| `search` | search, extract, crawl, map, research, verify, ai_monitor, monitor |
| `scraper` | scrape, scraper_submit, scraper_status, scraper_result |
| `proxy` | proxy, proxy_residential, proxy_isp, proxy_datacenter, proxy_mobile, proxy_static, proxy_dedicated |
| `browser` | browser, browser_flow |
| `health` | health, health_all, discover, setup |
| `account` | wallet_balance, wallet_usage_record, proxy_account_create, proxy_account_list, traffic_daily, plan_balance_all, capture_logs, account_summary |

For most AI agent use cases, `NOVADA_GROUPS="search"` provides the 8 most commonly used tools. Add `scraper` if you need platform-specific data, or `browser` for interactive automation.

`novada_health` and `novada_setup` are always available regardless of filter settings.

---

## What Makes Novada Different

| Capability | Novada | Firecrawl | Tavily | Bright Data |
|-----------|--------|-----------|--------|-------------|
| MCP tools | 25+ | 14 | 2 | 69 |
| Search engines | 5 | 1 | 1 | 3 |
| Multi-source research | Yes | No | No | No |
| Proxy as MCP tool | Yes | No | No | No |
| Auto anti-bot bypass | Yes | No | N/A | No |
| Change monitoring | Yes | No | No | No |
| Platform scrapers | 13 | 0 | 0 | 437 |
| Browser automation | Yes | Yes | No | Yes |
| `agent_instruction` in errors | Yes | No | No | No |

**Novada's unique advantage:** `novada_research` replaces 5-10 manual tool calls with a single call that searches, deduplicates, extracts, and synthesizes. No competitor offers this. Combined with auto-escalation for anti-bot bypass and `agent_instruction` error guidance, agents using Novada spend less time on plumbing and more time on the actual task.

---

## Next Steps

- **[Quick Start](/quickstart)** -- Full installation walkthrough with verification
- **[Extract & Search](/extract-search)** -- Deep reference for the two most-used tools
- **[Research, Verify & Monitor](/research-verify-monitor)** -- The tools that set Novada apart
- **[Scrape, Crawl & Map](/scrape-crawl-map)** -- Platform scraping and multi-page extraction
- **[Proxy & Browser](/proxy-browser)** -- IP routing and browser automation
- **[MCP Server Reference](/mcp-server)** -- Environment variables, tool filtering, troubleshooting

---

# Advanced Scraping Guide

This guide covers the internal mechanics of Novada MCP's rendering, anti-bot handling, domain routing, and extraction pipeline. It progresses from foundational concepts to advanced techniques.

---

## Render Modes

Every URL extraction in Novada flows through a **smart rendering router** (`routeFetch`) that selects the cheapest viable method to fetch a page. There are four modes:

| Mode | Cost | Latency | When to use |
|------|------|---------|-------------|
| `auto` | varies | varies | Default. Let the router decide. |
| `static` | low ($0) | ~170ms P50 | Server-rendered HTML (Wikipedia, GitHub, docs sites) |
| `render` | medium (~$0.001/req) | 5-15s | JS-heavy SPAs, Cloudflare-protected pages |
| `browser` | high (~$3/GB) | 10-30s | Heavy anti-bot fingerprinting, TLS challenges |

### How `auto` mode works

The `auto` router follows a cost-minimizing escalation chain:

```
1. Check DOMAIN_REGISTRY for a known optimal method
   - If match found: use that method directly (skip probing)
   - If no match: continue to step 2

2. Static fetch via Scraper API proxy
   - If page has real content (no JS signals, no bot challenge): return
   - If JS-heavy or bot challenge detected: escalate to step 3

3. Web Unblocker with JS rendering
   - If bot challenge still present AND browser configured: escalate to step 4
   - If JS content resolved: return
   - If still JS-heavy AND browser configured: try step 4

4. Browser API via CDP (last resort)
   - If success: return
   - If failure: return best result from earlier steps
```

### Decision tree for choosing a mode

```
Is the page a known SPA (React, Vue, Angular)?
  YES -> render="render"
  NO  -> Does the page use Cloudflare/DataDome/Kasada protection?
           YES -> render="auto" (router will escalate automatically)
           NO  -> Is the page server-rendered (docs, Wikipedia, news)?
                    YES -> render="static" (fastest)
                    NO  -> render="auto" (safest default)

Need to interact with the page (click, scroll, fill forms)?
  YES -> Use novada_browser tool instead of novada_extract
```

### Forcing a specific mode

```typescript
// Fastest: skip detection, assume server-rendered
novada_extract({ url: "https://docs.python.org/3/library/json.html", render: "static" })

// Force JS rendering for a known SPA
novada_extract({ url: "https://react.dev/learn", render: "render" })

// Force full browser for fingerprint-heavy sites
novada_extract({ url: "https://booking.com/hotel/us/example", render: "browser" })
```

### Understanding the `render-failed` mode

When Web Unblocker is not configured (missing `NOVADA_WEB_UNBLOCKER_KEY`) and `render` mode is requested, the router falls back to static fetch and returns `mode: "render-failed"`. This signals to the caller that JS rendering did NOT occur. The quality score applies a -15 penalty for this mode.

---

## Handling Anti-Bot Protection

Novada detects and handles anti-bot systems automatically in `auto` mode.

### Detection signals

The router uses two detection functions:

**`detectJsHeavyContent`** -- identifies pages that need JS rendering:
- Page content shorter than 200 characters (threshold: `JS_DETECTION_THRESHOLD = 200`)
- Strings like "enable javascript", "javascript is required", "checking your browser"
- Cloudflare markers: "ray id", "cf-browser-verification", `__cf_chl`
- Generic loading indicators: "loading...</p>", "ddos-guard"

**`detectBotChallenge`** -- identifies active bot challenge pages:
- Cloudflare: "just a moment", "cf-browser-verification", `__cf_chl_opt`
- DataDome: "datadome" in page source
- PerimeterX/HUMAN: `_pxhd`, `px-captcha`
- Kasada: "kasada" in page source
- Akamai: `akamai-bm` patterns

### Anti-bot provider identification

After detection, `identifyAntiBot` pinpoints the specific provider for diagnostic output:

| Provider | Detection signal | Typical domains |
|----------|-----------------|-----------------|
| Cloudflare | `cf_chl_`, `cf-browser-verification` | Medium, Reuters, Zillow, Indeed |
| DataDome | `datadome` cookie/script | Amazon (all TLDs), Shein, Ticketmaster |
| PerimeterX/HUMAN | `_pxhd`, `px-captcha` | Walmart, Airbnb, TripAdvisor, Wayfair |
| Kasada | `kasada` script | G2.com |
| Akamai | `akamai-bm` | Steam, Target, Best Buy, Nike, Home Depot |

### The full escalation chain

```
Static fetch
  |
  |--> Content OK? --> Return (cost: low)
  |
  |--> JS-heavy or bot challenge detected
         |
         |--> Web Unblocker (render)
                |
                |--> Content OK? --> Return (cost: medium)
                |
                |--> Still bot challenge?
                       |
                       |--> Browser configured?
                              YES --> Browser API (CDP)
                                        |
                                        |--> Success --> Return (cost: high)
                                        |--> Failure --> Return render-failed + static HTML
                              NO  --> Return render-failed + static HTML
```

### Proxy tiers

Some domains in the registry specify `proxyTier: "residential"`, meaning they require residential IP addresses to bypass IP-reputation-based blocks. Without residential proxy credentials, these domains silently fall back to datacenter IPs, which may trigger additional bot challenges.

Required env vars for residential proxies:
```bash
export NOVADA_RESIDENTIAL_PROXY_USER="your_user"
export NOVADA_RESIDENTIAL_PROXY_PASS="your_pass"
export NOVADA_RESIDENTIAL_PROXY_ENDPOINT="your_endpoint"
```

At startup, the server warns (via stderr) if residential-tier domains exist in the registry but credentials are not configured.

---

## Domain-Specific Routing

### The DOMAIN_REGISTRY

Novada ships with a pre-configured registry of 80+ domains and their optimal fetch strategies. When a URL matches a known domain, the router skips the static-probe step and goes directly to the right method.

Registry entries have this shape:

```typescript
interface DomainEntry {
  method: "static" | "render" | "browser";
  note: string;
  provider?: "cloudflare" | "datadome" | "kasada" | ...;
  proxyTier?: "residential" | "datacenter";
}
```

### Categories in the registry

**Static domains** (cheapest, fastest):
- Developer platforms: `github.com`, `gitlab.com`, `stackoverflow.com`
- Documentation: `docs.python.org`, `developer.mozilla.org`, `docs.anthropic.com`
- News (SSR): `techcrunch.com`, `theverge.com`, `apnews.com`, `arstechnica.com`
- Package registries: `pypi.org`, `crates.io`, `pkg.go.dev`
- Reference: `wikipedia.org`, `arxiv.org`, `archive.org`

**Render domains** (JS execution required):
- E-commerce: `amazon.com` (all TLDs), `ebay.com`, `etsy.com`, `walmart.com`
- Social media: `twitter.com`/`x.com`, `youtube.com`, `instagram.com`, `linkedin.com`
- SPA documentation: `react.dev`, `nextjs.org`, `tailwindcss.com`, `svelte.dev`
- CF-protected content: `medium.com`, `reuters.com`, `openai.com`, `martinfowler.com`
- Chinese platforms: `zhihu.com`, `weibo.com`, `bilibili.com`, `juejin.cn`, `36kr.com`

**Browser domains** (full CDP required):
- `booking.com` -- JS fingerprinting challenge (PerimeterX)
- `glassdoor.com` -- aggressive anti-bot (Cloudflare)
- `g2.com` -- Kasada protection
- `ticketmaster.com`, `stubhub.com` -- DataDome
- `cloudflare.com`, `blog.cloudflare.com` -- self-hosted CF, blocks unblocker
- `discord.com` -- TLS fingerprinting

### Domain lookup logic

The `lookupDomain` function resolves URLs to registry entries:

1. Parse the hostname, strip `www.` prefix
2. Try exact match in registry
3. Try stripping subdomains (e.g., `shop.example.com` matches `example.com`)
4. Return `null` if no match found (falls through to auto-detection)

```typescript
// These all resolve to the amazon.com entry:
lookupDomain("https://www.amazon.com/dp/B09V3K...")    // exact (www stripped)
lookupDomain("https://smile.amazon.com/dp/B09V3K...")  // subdomain match
lookupDomain("https://amazon.com/dp/B09V3K...")        // exact match
```

### When a domain is not in the registry

For unknown domains, `auto` mode performs the full probe chain (static -> detect -> escalate). This works well for most sites but adds latency from the initial static probe. If you know a site is JS-heavy, force `render` mode to skip the probe:

```typescript
// Unknown SPA not in registry -- skip the wasted static probe
novada_extract({ url: "https://some-new-spa.dev/docs", render: "render" })
```

---

## Structured Data Extraction

### The extraction pipeline

Novada's HTML-to-markdown pipeline (`extractMainContent`) processes pages in four stages:

```
1. CLEAN: Remove non-content elements
   - Tags: script, style, noscript, svg, iframe, nav, footer, aside
   - Conditional: site headers (with nav/logo), forms (high link density)
   - Boilerplate: sidebar, menu, cookie, banner, popup, modal, ad regions
   - HTML comments

2. LOCATE: Find the main content area (priority order)
   a. Semantic selectors: <main>, <article>, [role="main"], [class*="content"]
   b. Density scoring: score div/section elements by text length,
      link density, heading count, paragraph count
   c. Fallback: body with boilerplate removed

3. CONVERT: Transform to markdown
   - Headings -> # / ## / ### (preserve hierarchy)
   - Links -> [text](url) with URL resolution
   - Lists -> - / 1. (ordered vs unordered)
   - Code blocks -> ``` with language hint from class="language-xxx"
   - Tables -> markdown tables (data) or plain text (layout)
   - Images -> ![alt](src) (skip base64 data URIs)
   - Inline formatting -> **bold**, *italic*, `code`

4. TRUNCATE: Cap at maxChars (default 25,000)
   - Cut at last paragraph boundary before limit
   - If no good boundary in last 20%, hard-cut at limit
```

### Using the `fields` parameter

The `fields` parameter on `novada_extract` requests specific data points. The extraction pipeline checks JSON-LD structured data first (fastest, most reliable), then falls back to pattern matching.

```typescript
// Extract specific fields from a product page
novada_extract({
  url: "https://amazon.com/dp/B09V3KXJPB",
  fields: ["price", "availability", "rating", "brand"]
})

// Extract article metadata
novada_extract({
  url: "https://techcrunch.com/2024/01/15/some-article",
  fields: ["author", "datePublished", "headline"]
})
```

Supported JSON-LD types and their extractable fields:

| Type | Fields |
|------|--------|
| Product | name, price, currency, availability, description, brand, ratingValue, reviewCount, sku |
| Article/NewsArticle/BlogPosting | headline, author, datePublished, dateModified, description, publisher |
| Event | name, startDate, endDate, location, description, organizer |
| Person | name, jobTitle, description, url |
| Organization | name, description, url, telephone |

### Extraction quality scoring

Every extraction result receives a quality score (0-100) based on additive signals:

| Signal | Points | Condition |
|--------|--------|-----------|
| Structured data found | +20 | Page has JSON-LD |
| Content length >= 5000 chars | +20 | Rich content |
| Content length >= 1000 chars | +10 | Moderate content |
| Content length < 200 chars | -20 | Too little content |
| Has list items (>= 10) | +10 | Structured listings |
| Has 20+ content lines | +5 | Well-structured |
| Link density 5-60% | +10 | Healthy link ratio |
| Has headings (H2/H3) | +10 | Structured content |
| Has code blocks | +5 | Technical content |
| Static mode used | +10 | Cheapest method worked |
| Render mode used | +5 | Mid-cost method |
| Render-failed mode | -15 | JS rendering didn't happen |
| Bot challenge in HTML | -40 | Extraction likely failed |
| Truncated (>= 25k chars) | -5 | Content was cut off |

Quality labels: `excellent` (80+), `good` (60+), `moderate` (40+), `poor` (20+), `low` (<20).

---

## Platform Scraping

For popular platforms (Amazon, Reddit, TikTok, LinkedIn, etc.), `novada_scrape` uses specialized scrapers that return structured records instead of raw HTML.

### How it works

```
1. Submit task: POST to Scraper API with platform + operation + params
2. Poll for result: GET download endpoint every 2s (up to 180s timeout)
3. Extract records: Parse response, flatten nested objects, apply limit
4. Format output: markdown table, JSON, or TOON (token-optimized)
```

### Output formats

| Format | Best for | Token cost |
|--------|----------|------------|
| `markdown` | Human reading, quick review | Medium |
| `json` | Programmatic processing, downstream code | Medium |
| `toon` | Agent consumption, token-constrained contexts | Low (40-65% savings) |

### Operation aliases

Some operation IDs have aliases that auto-resolve:

```
amazon_product_by-keywords  -->  amazon_product_keywords
amazon_product_by-asin      -->  amazon_product_asin
google_shopping             -->  google_shopping_keywords
google_shopping_by-keyword  -->  google_shopping_keywords
```

### Common errors and their meaning

| Code | Error | What to do |
|------|-------|-----------|
| 11006 | Operation ID rejected | Read `novada://scraper-platforms` for the exact ID. Don't guess. |
| 11008 | Unknown platform | Use exact domain (e.g., `amazon.com` not `amazon`). |
| 27202 | Task still processing | Wait and poll again (automatic in `novada_scrape`). |
| 27203 | Server-side task failure | Transient. Retry once. |

---

## Handling JavaScript-Heavy Pages

### Single-Page Applications (React, Vue, Angular)

SPAs serve a minimal HTML shell with JavaScript that renders content client-side. Static fetch returns nearly empty HTML (< 200 chars triggers `detectJsHeavyContent`).

```typescript
// Explicit render for known SPAs
novada_extract({ url: "https://react.dev/learn", render: "render" })

// Auto mode also works -- the router detects the empty HTML and escalates
novada_extract({ url: "https://react.dev/learn", render: "auto" })
```

### Dynamic content with `wait_for`

Some pages load content asynchronously after initial render. Use `wait_for` to delay extraction until a specific CSS selector appears in the DOM:

```typescript
// Wait for price element to load before extracting
novada_extract({
  url: "https://amazon.com/dp/B09V3KXJPB",
  render: "render",
  wait_for: ".a-price-whole"
})

// Wait for search results to render
novada_extract({
  url: "https://example.com/search?q=term",
  render: "browser",
  wait_for: "[data-testid='search-results']"
})
```

### Infinite scroll and pagination

For pages that load content on scroll, use `novada_browser` with scroll actions:

```typescript
novada_browser({
  actions: [
    { action: "navigate", url: "https://example.com/feed", wait_until: "domcontentloaded" },
    { action: "wait", ms: 2000 },
    { action: "scroll", direction: "down" },
    { action: "wait", ms: 2000 },
    { action: "scroll", direction: "down" },
    { action: "wait", ms: 2000 },
    { action: "aria_snapshot" }  // capture the loaded content
  ],
  timeout: 30000
})
```

### Pages behind login

For authenticated content, use `novada_browser` with session persistence:

```typescript
// Step 1: Log in
novada_browser({
  session_id: "my-session",
  actions: [
    { action: "navigate", url: "https://example.com/login", wait_until: "domcontentloaded" },
    { action: "type", selector: "#email", text: "user@example.com" },
    { action: "type", selector: "#password", text: "password" },
    { action: "click", selector: "#submit" },
    { action: "wait", ms: 3000 }
  ],
  timeout: 30000
})

// Step 2: Extract authenticated content (same session_id reuses login state)
novada_browser({
  session_id: "my-session",
  actions: [
    { action: "navigate", url: "https://example.com/dashboard", wait_until: "domcontentloaded" },
    { action: "aria_snapshot" }
  ],
  timeout: 30000
})
```

---

## Batch Operations

### Multi-page extraction with `novada_crawl`

`novada_crawl` performs BFS or DFS crawling up to 20 pages from a starting URL:

```typescript
// Crawl API docs (BFS, up to 10 pages)
novada_crawl({
  url: "https://docs.example.com/api",
  max_pages: 10,
  strategy: "bfs",
  format: "markdown",
  render: "auto",
  select_paths: ["/api/.*"]  // only follow /api/* URLs
})

// Deep crawl a specific section (DFS)
novada_crawl({
  url: "https://docs.example.com/guides/auth",
  max_pages: 5,
  strategy: "dfs",
  format: "json",
  render: "auto",
  exclude_paths: ["/blog/.*", "/changelog/.*"]
})
```

**Performance note:** Crawl time scales linearly at ~1.4s/page. At `max_pages: 20`, expect 28s minimum. Keep `max_pages` low and use `select_paths` to restrict scope.

### URL discovery with `novada_map`

`novada_map` discovers URLs on a site without downloading content. It tries `sitemap.xml` first (fast), then falls back to BFS link crawling:

```typescript
// Discover all URLs on a site
novada_map({ url: "https://example.com", limit: 50 })

// Search for specific pages
novada_map({ url: "https://docs.example.com", search: "authentication" })
```

Use `novada_map` to find URLs, then `novada_extract` to read specific pages. This is faster and cheaper than crawling everything.

### Output pipeline

All extraction and scrape results are automatically saved to `~/Downloads/novada-mcp/`:

```
~/Downloads/novada-mcp/
  extract/
    github-com-20240115-143022.md
    react-dev-20240115-143156.md
  search/
    ai-agents-20240115-142800.md
  scrape/
    amazon-com-20240115-144500.csv
    reddit-com-20240115-145200.json
  crawl/
    docs-example-com-20240115-150000.md
```

---

## Performance Optimization

### Search cache

Search results are cached in memory for 60 seconds. Identical queries (same engine + query + num) return instantly from cache:

```typescript
// First call: hits the API (~2-5s)
novada_search({ query: "AI agents 2024", engine: "google", num: 10 })

// Second call within 60s: returns from cache (~0ms)
novada_search({ query: "AI agents 2024", engine: "google", num: 10 })
```

The cache holds up to 100 entries. When full, the oldest entry is evicted. Empty results are also cached to prevent repeated failed API calls.

### HTTP connection pooling

All HTTP clients use `keepAlive: true` with `maxSockets: 10`, reusing TCP connections across requests. This eliminates TLS handshake overhead for repeated calls to the same host.

### Expected latency by mode

| Operation | P50 latency | Notes |
|-----------|------------|-------|
| Static extract | ~170ms | Direct proxy fetch, no JS |
| Render extract | 5-15s | Web Unblocker JS execution |
| Browser extract | 10-30s | Full Chromium launch + render |
| Search (Google) | 2-5s | Scraper API submit + poll |
| Platform scrape | 10-180s | Depends on platform complexity |

### Tips for faster extractions

1. **Use `static` mode** when you know the page is server-rendered. Skips the JS-detection probe.
2. **Use `auto` mode** (default) for unknown pages. The DOMAIN_REGISTRY shortcut avoids wasted probes for known domains.
3. **Avoid `browser` mode** unless necessary. It is 50-100x more expensive than static.
4. **Batch with `novada_extract`** (array of URLs, up to 10) for parallel extraction.
5. **Use `novada_map`** before `novada_crawl` to identify which URLs actually matter.

---

## Troubleshooting

### Error codes and what they mean

Novada uses typed error codes with structured `agent_instruction` hints:

| Code | Class | Retryable | Meaning |
|------|-------|-----------|---------|
| `INVALID_API_KEY` | auth | No | API key missing or invalid |
| `RATE_LIMITED` | quota | Yes (30s) | Too many requests, back off |
| `URL_UNREACHABLE` | transient | Yes (10s) | Target URL down or unreachable |
| `SPA_NO_URLS_FOUND` | permanent | No | JS SPA, static crawl found nothing |
| `API_DOWN` | transient | Yes (30s) | Novada API temporarily unavailable |
| `INVALID_PARAMS` | permanent | No | Bad parameters, fix and retry |
| `PRODUCT_UNAVAILABLE` | permanent | No | Product not activated on account |
| `TASK_NOT_FOUND` | permanent | No | Scraper task expired or invalid |
| `TASK_PENDING` | transient | Yes (5s) | Scraper task still processing |
| `SESSION_EXPIRED` | permanent | No | Browser session timed out |
| `PROXY_AUTH_FAILURE` | auth | No | Proxy credentials invalid |

### Reading `agent_instruction` hints

Every error response includes an `agent_instruction` field with actionable next steps. These are designed to be read and acted upon by AI agents:

```
error_code: PRODUCT_UNAVAILABLE
failure_class: permanent
retry_recommended: false
agent_instruction: "This Novada product is not active on your API key. Three options:
  Option 1 -- Activate (recommended): Visit https://dashboard.novada.com/overview/
  Option 2 -- Use alternatives: novada_extract, novada_unblock, novada_crawl
  Option 3 -- Contact support: support@novada.com"
```

### Diagnostics with `novada_health_all`

Run `novada_health_all` to test all 6 Novada product endpoints in parallel:

```typescript
novada_health_all()
// Returns:
// | Product   | Status | Latency | Notes |
// |-----------|--------|---------|-------|
// | Search    | OK     | 234ms   |       |
// | Extract   | OK     | 178ms   |       |
// | Scraper   | OK     | 312ms   |       |
// | Proxy     | OK     | 89ms    |       |
// | Browser   | NOT_CONFIGURED | - | Set NOVADA_BROWSER_WS |
// | Unblock   | OK     | 1,203ms |       |
```

If a product shows `PRODUCT_UNAVAILABLE`, the output includes a direct activation link. If it shows `NOT_CONFIGURED`, export the required environment variable and restart the MCP server.

### Common troubleshooting patterns

**Empty or minimal content returned:**
1. Check if the page is a JS SPA -- try `render="render"`
2. If still empty, try `render="browser"`
3. If the page requires login, use `novada_browser` with session persistence
4. Run `novada_map` on the domain to find the correct URL

**Bot challenge detected (quality score < 20):**
1. `auto` mode should handle this, but check if residential proxies are configured
2. Try `novada_unblock` with `method="browser"` for the toughest sites
3. Check `novada_health_all` to confirm all products are active

**Scraper returns "code 11006":**
1. The operation ID is wrong. Do not guess operation IDs.
2. Read the `novada://scraper-platforms` resource for the exact canonical ID.
3. Try known aliases (e.g., `amazon_product_by-keywords` auto-resolves to `amazon_product_keywords`).
4. If the operation ID is confirmed correct, the Scraper API product may not be activated.

**Slow extractions (> 30s):**
1. Force `render="static"` if you know the page is server-rendered
2. Reduce `max_chars` to avoid processing large DOMs
3. For batch work, use `novada_crawl` with `select_paths` to restrict scope
4. Check if the domain is in `DOMAIN_REGISTRY` -- unknown domains add a probe step

---

# Platform Quickstarts

Platform-specific setup guides for Novada MCP. Each section is self-contained: install, configure, verify, troubleshoot.

**Prerequisites:** A Novada API key from [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/).

---

## 1. Claude Code

**CLI-based AI coding agent by Anthropic.**

### Install

```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp@latest
```

One command. No config file to edit.

### Verify

```bash
claude mcp list
```

Confirm `novada` appears in the output. Then ask Claude Code:

```
Run novada_health() to check my setup.
```

### Full Features (proxy + browser)

```bash
claude mcp add novada \
  -e NOVADA_API_KEY=your_key \
  -e NOVADA_PROXY_ENDPOINT=your_proxy_host:port \
  -e NOVADA_PROXY_USER=your_proxy_user \
  -e NOVADA_PROXY_PASS=your_proxy_pass \
  -e NOVADA_BROWSER_WS=wss://your_browser_ws_url \
  -- npx -y novada-mcp@latest
```

### Reduce Tool Count

Load only the tools you need to save context window:

```bash
claude mcp add novada \
  -e NOVADA_API_KEY=your_key \
  -e NOVADA_GROUPS=search,health \
  -- npx -y novada-mcp@latest
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Tools not appearing after install | Run `claude mcp list` to confirm registration. Re-run `claude mcp add` if missing. |
| `npx` download slow on first run | First run downloads the package; subsequent runs use the npm cache. Do **not** install globally — see [Staying on the latest version](#staying-on-the-latest-version-troubleshooting-stale-versions). |
| "NOVADA_API_KEY is not set" | Check for extra spaces or quotes in the `-e` flag value. |
| Too many tools cluttering context | Set `NOVADA_GROUPS` or `NOVADA_TOOLS` to load a subset. |

---

## 2. Claude Desktop

**Anthropic's desktop app for Claude conversations.**

### Config File Location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Configuration

Create or edit the config file:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

Save the file and **restart Claude Desktop** (quit fully, reopen).

### Verify

In a new conversation, ask:

```
Run novada_setup() to see my configuration status.
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Tools not appearing after restart | Ensure the JSON is valid (no trailing commas). Use a JSON validator. |
| "command not found: npx" | Node.js is not in Claude Desktop's PATH. Use the full path: `"command": "/usr/local/bin/npx"` (macOS) or `"command": "C:\\Program Files\\nodejs\\npx.cmd"` (Windows). |
| Multiple MCP servers conflict | Each server needs a unique key in `mcpServers`. Novada uses `"novada"`. |
| Config file doesn't exist | Create it at the path above. The parent directory must exist. |

---

## 3. Cursor

**AI-powered code editor built on VS Code.**

### Config File Location

Project-level (recommended): `.cursor/mcp.json` in your project root.

### Configuration

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

### Verify

1. Open Cursor Settings > MCP
2. Confirm `novada` appears with a green status indicator
3. In Composer or Chat, ask: `Run novada_health() to verify my Novada setup.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| MCP section shows red/error status | Click the refresh icon next to the server entry. Check the error log in Cursor's output panel. |
| Tools not available in Chat mode | MCP tools are available in Composer (Agent mode). Switch from Chat to Composer. |
| "Cannot find module" errors | Ensure Node.js >= 18 is installed. Run `node --version` to check. |
| Config not picked up | Restart Cursor after creating `.cursor/mcp.json`. The file must be in the project root, not a subdirectory. |

---

## 4. VS Code Copilot

**GitHub Copilot's MCP integration in VS Code.**

### Config File Location

Project-level: `.vscode/mcp.json` in your project root.

### Configuration

```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

Note: VS Code uses `"servers"` as the top-level key, not `"mcpServers"`.

### Verify

1. Open the Copilot Chat panel (Ctrl+Shift+I / Cmd+Shift+I)
2. Switch to Agent mode (click the mode dropdown)
3. Click the tools icon to confirm Novada tools are listed
4. Ask: `Use novada_health to check my setup.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| No MCP tools in Copilot Chat | MCP requires Agent mode. Switch from "Ask" or "Edit" to "Agent" in the chat mode dropdown. |
| "MCP server failed to start" | Check VS Code's Output panel > "MCP" channel for error details. Usually a PATH issue with `npx`. |
| Config schema mismatch | VS Code uses `"servers"`, not `"mcpServers"`. Double-check the top-level key. |
| Tools appear but calls fail silently | Ensure `NOVADA_API_KEY` is set correctly in the `env` block. No quotes around the key name. |

---

## 5. VS Code Continue

**Open-source AI coding assistant for VS Code and JetBrains.**

### Config File Location

Global: `~/.continue/config.json`

### Configuration

Add the `mcpServers` section to your existing Continue config:

```json
{
  "mcpServers": [
    {
      "name": "novada",
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  ]
}
```

Note: Continue uses an array format for `mcpServers`, not an object.

### Verify

1. Open the Continue sidebar in VS Code
2. Type `@novada` to see if Novada tools are available
3. Ask: `Run novada_health to check my setup.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| MCP tools not loading | Reload the VS Code window (Cmd+Shift+P > "Reload Window") after editing config. |
| Config format errors | Continue expects `mcpServers` as an array of objects, each with a `name` field. Not the same format as Cursor or Claude Desktop. |
| "npx: command not found" | Set the full path to npx in the `command` field. Find it with `which npx`. |

---

## 6. Windsurf

**AI-powered IDE by Codeium.**

### Config File Location

| OS | Path |
|----|------|
| macOS | `~/.codeium/windsurf/mcp_config.json` |
| Windows | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |
| Linux | `~/.codeium/windsurf/mcp_config.json` |

### Configuration

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

### Verify

1. Open Windsurf Settings > MCP
2. Confirm `novada` shows as connected
3. In Cascade, ask: `Run novada_health() to verify my Novada tools.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| Server shows "disconnected" | Click the restart button in the MCP settings panel. Check that Node.js >= 18 is installed. |
| Config file location unclear | Run `novada_setup()` from any connected MCP client -- it outputs the exact path for Windsurf. |
| Tools timeout on first call | The first `npx` invocation downloads the package. Subsequent calls use the npm cache and are fast. Do **not** install globally — a global install shadows `npx` and will silently run a stale version. |

---

## 7. Zed

**High-performance code editor with AI features.**

### Config File Location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Zed/settings.json` |
| Linux | `~/.config/zed/settings.json` |

### Configuration

Add to your Zed `settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "novada": {
      "command": {
        "path": "npx",
        "args": ["-y", "novada-mcp@latest"],
        "env": {
          "NOVADA_API_KEY": "your_key"
        }
      }
    }
  }
}
```

Note: Zed uses `context_servers` with a nested `command` object containing `path`, `args`, and `env`.

### Verify

1. Open the Assistant panel (Cmd+Shift+A)
2. Check that Novada tools appear in the tool list
3. Ask: `Use novada_health to check which products are active.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| "Failed to start context server" | Zed requires the `path` field (not `command`). Ensure the nested structure matches the example above. |
| Tools not visible in Assistant | MCP support in Zed requires a recent version. Update to the latest Zed release. |
| npx not found | Use the full path: `"path": "/usr/local/bin/npx"` |

---

## 8. n8n

**Workflow automation platform with MCP support.**

### Setup

n8n supports MCP servers as tool nodes in AI agent workflows.

1. In your n8n workflow, add an **MCP Client Tool** node
2. Configure the connection:

| Field | Value |
|-------|-------|
| Command | `npx` |
| Arguments | `-y novada-mcp` |
| Environment Variables | `NOVADA_API_KEY=your_key` |

3. Connect the MCP Client Tool node to an AI Agent node

### Self-Hosted n8n

If running n8n via Docker, ensure Node.js is available in the container:

```yaml
# docker-compose.yml (n8n service)
services:
  n8n:
    image: n8nio/n8n
    environment:
      - NOVADA_API_KEY=your_key
    volumes:
      - n8n_data:/home/node/.n8n
```

### Verify

1. Open the MCP Client Tool node settings
2. Click "Test Connection" or "Refresh Tools"
3. Confirm Novada tools appear in the tool list

### Common Issues

| Symptom | Fix |
|---------|-----|
| "npx not found" in n8n container | Install Node.js in your n8n Docker image so `npx` is available, then use `npx -y novada-mcp@latest`. Avoid a bare global install — it shadows `npx` and pins you to a stale version. |
| MCP tools timeout | n8n may have a short default timeout for MCP connections. Increase the timeout in the MCP Client Tool node settings. |
| Environment variables not passed | In n8n Cloud, set env vars through the platform's credentials/secrets UI, not the node config. |

---

## 9. Remote / Hosted (mcp.novada.com)

**Zero-install access via Novada's hosted MCP endpoint.**

> Note: Hosted MCP is in development. Check [novada.com](https://www.novada.com) for availability.

### Configuration

For MCP clients that support remote/HTTP transport:

```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/sse",
      "headers": {
        "Authorization": "Bearer your_key"
      }
    }
  }
}
```

### When to Use

- No local Node.js installation available
- Cloud-hosted AI platforms that support remote MCP
- Environments where `npx` is blocked or unavailable
- Quick testing without local setup

### Limitations

- Requires network access to `mcp.novada.com`
- Slightly higher latency compared to local stdio transport
- Proxy and Browser tools may require additional configuration

### Common Issues

| Symptom | Fix |
|---------|-----|
| Connection refused | Confirm the hosted endpoint is available. Fall back to local `npx` install if needed. |
| "Unauthorized" response | Verify your API key in the `Authorization` header. Format: `Bearer your_key` (with space). |
| SSE connection drops | Some corporate firewalls block SSE. Try the WebSocket transport if available. |

---

## 10. Docker

**Containerized setup for reproducible environments.**

### Dockerfile

```dockerfile
FROM node:20-slim

# Pin @latest so the image always installs the current release.
# Rebuild the image periodically to pick up new versions.
RUN npm install -g novada-mcp@latest

ENV NOVADA_API_KEY=your_key

ENTRYPOINT ["novada-mcp"]
```

### Build and Run

```bash
docker build -t novada-mcp .
docker run -e NOVADA_API_KEY=your_key novada-mcp
```

### Docker Compose

```yaml
services:
  novada-mcp:
    build: .
    environment:
      - NOVADA_API_KEY=${NOVADA_API_KEY}
      # Optional: proxy and browser features
      # - NOVADA_PROXY_ENDPOINT=your_proxy_host:port
      # - NOVADA_PROXY_USER=your_proxy_user
      # - NOVADA_PROXY_PASS=your_proxy_pass
      # - NOVADA_BROWSER_WS=wss://your_browser_ws_url
    stdin_open: true
```

### Using with MCP Clients

Point your MCP client to the Docker container using stdio transport:

```json
{
  "mcpServers": {
    "novada": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "NOVADA_API_KEY=your_key", "novada-mcp"],
      "env": {}
    }
  }
}
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Container exits immediately | MCP servers use stdio transport and need `-i` (interactive) flag. Add `stdin_open: true` in Compose. |
| "Cannot connect to Docker daemon" | Ensure Docker Desktop is running. On Linux, check that your user is in the `docker` group. |
| Environment variable not set | Pass via `-e` flag at runtime, not hardcoded in the Dockerfile. Use `.env` files with Docker Compose. |
| Slow startup | The `node:20-slim` image is ~50MB. Use `node:20-alpine` (~18MB) for faster pulls if you don't need glibc. |

---

## Quick Reference: Config Paths

| Platform | Config Location | Top-Level Key |
|----------|----------------|---------------|
| Claude Code | CLI (no file) | -- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` |
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| VS Code Copilot | `.vscode/mcp.json` | `servers` |
| VS Code Continue | `~/.continue/config.json` | `mcpServers` (array) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| Zed | `~/Library/Application Support/Zed/settings.json` | `context_servers` |
| n8n | UI-based | -- |
| Hosted | Remote URL | `url` + `headers` |
| Docker | Dockerfile / Compose | -- |

---

## Environment Variables Reference

All platforms use the same environment variables. Only `NOVADA_API_KEY` is required.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOVADA_API_KEY` | Yes | API key for all core tools (search, extract, crawl, research, scrape, verify, monitor) |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port for `novada_proxy_*` tools |
| `NOVADA_PROXY_USER` | No | Proxy username |
| `NOVADA_PROXY_PASS` | No | Proxy password |
| `NOVADA_BROWSER_WS` | No | WebSocket URL for `novada_browser` and `novada_browser_flow` |
| `NOVADA_WEB_UNBLOCKER_KEY` | No | Separate Web Unblocker key (if different from main API key) |
| `NOVADA_TOOLS` | No | Load specific tools only: `"extract,search,research"` |
| `NOVADA_GROUPS` | No | Load tool groups: `"search,proxy,browser"` |

---

# Agentic Debugging

A self-help guide for AI agents when Novada MCP tools fail. Every error is structured and machine-readable. Follow the `agent_instruction` field first -- it contains the exact next step.

---

## When Tools Fail

Every Novada error response includes four structured fields:

| Field | Type | Purpose |
|-------|------|---------|
| `failure_class` | `auth` \| `quota` \| `transient` \| `permanent` | What category of failure this is |
| `retry_recommended` | `true` \| `false` | Whether retrying the same call may succeed |
| `retry_after_ms` | integer | Milliseconds to wait before retrying (only present when retry is recommended) |
| `agent_instruction` | string | Plain-language guidance on what to do next |

### Decision Tree

```
Error received
  |
  +-- Read agent_instruction FIRST
  |
  +-- Check failure_class:
  |     |
  |     +-- auth       --> credentials are wrong or missing. Do not retry.
  |     +-- quota      --> rate limit hit. Wait retry_after_ms, then retry.
  |     +-- transient  --> temporary failure (network, API down). Retry after delay.
  |     +-- permanent  --> bad params, product not activated, or invalid request. Fix input.
  |
  +-- Check retry_recommended:
        |
        +-- true  --> wait retry_after_ms, retry the same call
        +-- false --> do NOT retry. Fix the issue described in agent_instruction.
```

### Retry Timing by Error Code

| Error Code | failure_class | retry_recommended | retry_after_ms | Action |
|------------|---------------|-------------------|----------------|--------|
| `RATE_LIMITED` | quota | true | 30000 | Wait 30s, retry. Use exponential backoff. |
| `URL_UNREACHABLE` | transient | true | 10000 | Wait 10s, retry once. Try `novada_unblock` if second attempt fails. |
| `API_DOWN` | transient | true | 30000 | Wait 30s, retry. Check status.novada.com if persistent. |
| `TASK_PENDING` | transient | true | 5000 | Wait 5s, poll `novada_scraper_status` again. Backoff: 5s, 10s, 20s, 40s. |
| `INVALID_API_KEY` | auth | false | -- | Fix the API key. Run `novada_setup` for instructions. |
| `PRODUCT_UNAVAILABLE` | permanent | false | -- | Activate the product at dashboard.novada.com. |
| `INVALID_PARAMS` | permanent | false | -- | Fix parameters. Check tool description for constraints. |
| `TASK_NOT_FOUND` | permanent | false | -- | Task expired (24h TTL). Re-submit with `novada_scraper_submit`. |
| `SESSION_EXPIRED` | permanent | false | -- | Browser session expired (10min idle). Start a new session. |
| `PROXY_AUTH_FAILURE` | auth | false | -- | Check `NOVADA_PROXY_USER` and `NOVADA_PROXY_PASS`. |
| `SPA_NO_URLS_FOUND` | permanent | false | -- | Site is a JS SPA. Use `novada_crawl` with `render="render"` instead of `novada_map`. |
| `UNKNOWN` | permanent | false | -- | Unexpected error. Check message for details. Contact support@novada.com. |

---

## Diagnostic Tools

Three built-in tools for diagnosing issues. Run them in this order when something is wrong.

### 1. `novada_setup()` -- Environment Check

**When to use:** First tool to run. Shows whether environment variables are configured correctly.

**What it returns:**
- Status of all env vars (`NOVADA_API_KEY`, `NOVADA_PROXY_*`, `NOVADA_BROWSER_WS`)
- Whether each variable is set, empty, or missing
- Step-by-step setup instructions for the current MCP client
- Config snippets ready to copy-paste

**No authentication required.** This tool works even when `NOVADA_API_KEY` is not set.

```
novada_setup()
```

### 2. `novada_health_all()` -- Product Endpoint Test

**When to use:** After confirming env vars are set. Tests all 6 product endpoints in parallel.

**What it returns:**
- Per-product status table: product name, status, latency, notes
- Products tested: Search, Extract, Scraper, Proxy, Browser, Unblock
- Activation links for any product showing `PRODUCT_UNAVAILABLE`
- Partial failures are isolated -- one product down does not block others

```
novada_health_all()
```

### 3. `novada_discover()` -- Tool Catalog

**When to use:** To see all available tools, their categories, and status (active/todo).

**What it returns:**
- Full tool list grouped by category
- Category filter supported: `"Content Retrieval"`, `"Scraping & Verification"`, `"Proxy"`, `"Browser & Rendering"`, `"Health & Discovery"`, `"Auth"`

```
novada_discover()
novada_discover({ category: "Proxy" })
```

### Diagnostic Sequence

When a tool fails and you need to figure out why:

```
Step 1: novada_setup()        -- Are env vars configured?
Step 2: novada_health_all()   -- Are product endpoints reachable?
Step 3: novada_discover()     -- Is the tool loaded? (Check NOVADA_TOOLS / NOVADA_GROUPS filters)
```

If all three pass and the tool still fails, the issue is with the specific request parameters or the target URL.

---

## Common Issues and Fixes

### Authentication and Configuration

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Error [INVALID_API_KEY]: Invalid or missing API key` | `NOVADA_API_KEY` not set or contains invalid value | Set `NOVADA_API_KEY` in your MCP config. Get a key at dashboard.novada.com. Run `novada_setup()` for config snippets. |
| `Error [PROXY_AUTH_FAILURE]: Proxy authentication failed` | Proxy credentials wrong or expired | Check `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, and `NOVADA_PROXY_ENDPOINT`. Regenerate at dashboard.novada.com/overview/proxy/. |
| `Error [PRODUCT_UNAVAILABLE]: Product not activated` | The specific product (Scraper, Proxy, Browser) is not enabled on your plan | Visit dashboard.novada.com/overview/products/ to activate. Alternative: use a different tool (e.g., `novada_extract` instead of `novada_scrape`). |
| Tools not appearing in MCP client | `NOVADA_TOOLS` or `NOVADA_GROUPS` filter is excluding them | Remove the filter env vars, or add the needed tool/group. `novada_health` and `novada_setup` are always loaded regardless of filters. |

### Content Extraction

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_extract` returns empty or navigation-only content | Page is JavaScript-rendered (SPA) | Set `render: "render"` to force JS rendering. Or add `wait_for: ".main-content"` (CSS selector) to wait for dynamic content. |
| `novada_extract` returns truncated content | Content exceeds `max_chars` limit (default 25000) | Increase `max_chars` up to 100000. Do not set to 100000 by default -- only when needed. |
| `novada_extract` returns wrong page content | URL redirects to a different page | Check the actual URL after redirect. Use `novada_unblock` to see the raw HTML and find the correct URL. |
| `novada_crawl` returns 0 pages | `select_paths` regex too restrictive or site blocks crawlers | Broaden the regex. Try without `select_paths` first. Set `render: "render"` for JS-heavy sites. |

### Search and Research

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_search` returns 0 results | Engine temporarily unavailable or query too specific | Try a different `engine` (google, bing, duckduckgo). Broaden the query. Check `time_range` is not too narrow. |
| `novada_research` takes too long | `depth: "comprehensive"` generates 8-10 parallel queries | Use `depth: "quick"` (3 queries) or `depth: "auto"` (server decides). |
| Search results are irrelevant | Query is too broad or uses keywords instead of natural language | Rewrite query as a natural-language description of the ideal page. Use `include_domains` to restrict to known-good sources. |

### Proxy

| Symptom | Cause | Fix |
|---------|-------|-----|
| Proxy tools return "credentials not configured" | `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, or `NOVADA_PROXY_ENDPOINT` not set | Set all three env vars. Run `novada_setup()` to see which are missing. |
| Proxy connection refused (HTTP 407) | Wrong username/password or account expired | Regenerate credentials at dashboard.novada.com. Verify with `novada_health_all()`. |
| Sticky session returns different IPs | `session_id` not passed or format invalid | Pass `session_id` parameter (alphanumeric + underscore/hyphen, max 64 chars). Same `session_id` = same IP. |

### Browser Automation

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_browser` returns "NOVADA_BROWSER_WS not set" | WebSocket URL not configured | Set `NOVADA_BROWSER_WS` env var. Get the URL from your Novada dashboard. |
| `Error [SESSION_EXPIRED]: Browser session expired` | Session inactive for >10 minutes | Remove `session_id` param to start a new session. Sessions auto-expire after 10min of inactivity. |
| Actions timeout on SPA pages | Page never reaches `networkidle` | Use `wait_until: "domcontentloaded"` instead of `networkidle`. SPAs continuously poll and never reach network idle. |
| Screenshots are blank | Page not fully loaded before screenshot action | Add a `wait` action before `screenshot`: `{action: "wait", ms: 3000}` or `{action: "wait", selector: "#content"}`. |

### Scraping

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_scrape` returns "operation not found" | Wrong `operation` ID for the platform | Run `novada_discover()` or read the `novada://scraper-platforms` resource for valid operation IDs. |
| Async scraper task stuck in "pending" | Long processing time or backend queue | Poll `novada_scraper_status` with exponential backoff (5s, 10s, 20s, 40s). Tasks can take up to 5 minutes. |
| Scraper returns partial data | Platform page layout changed or rate-limited | Retry once. If still partial, use `novada_extract` on the URL directly as fallback. |

---

## Reading Error Responses

Every Novada error follows the same structure. Here is a real error response with annotations:

```
Error [INVALID_API_KEY]: Invalid or missing API key. Get one at https://www.novada.com
failure_class: auth
retry_recommended: false
agent_instruction: "Your API key is missing or invalid. Do not retry until the key is fixed.

Setup (one-time):
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada

Verify the key is active:
  Run novada_health -- it will confirm which products are accessible.

Get a key: https://dashboard.novada.com/overview/"
```

### Field Breakdown

| Line | Field | Meaning |
|------|-------|---------|
| `Error [INVALID_API_KEY]: ...` | Error code + message | Machine-parseable code in brackets. Human-readable message after colon. |
| `failure_class: auth` | Classification | This is an authentication error. Other values: `quota`, `transient`, `permanent`. |
| `retry_recommended: false` | Retry signal | Do not retry this call -- it will fail again with the same input. |
| `agent_instruction: "..."` | Next step | The exact action to take. Follow this first. Contains setup commands, alternative tools, and dashboard links. |

### Another Example: Retryable Error

```
Error [RATE_LIMITED]: Rate limit exceeded. API is throttling your requests.
failure_class: quota
retry_recommended: true
retry_after_ms: 30000
agent_instruction: "You have hit the Novada API rate limit. This is temporary and retryable.

Action: Wait 30-60 seconds before retrying this tool call.
Strategy: Use exponential backoff for automated retries (delay doubles each attempt).
Avoid: Parallel calls to the same endpoint -- serialize them instead."
```

Note the additional `retry_after_ms: 30000` field. This only appears when `retry_recommended` is `true`.

### Another Example: Product Not Activated

```
Error [PRODUCT_UNAVAILABLE]: Product not activated on your account.
failure_class: permanent
retry_recommended: false
agent_instruction: "This Novada product is not active on your API key. Three options:

Option 1 -- Activate (recommended):
  Visit: https://dashboard.novada.com/overview/products/
  Enable the required product, then retry.

Option 2 -- Use an alternative tool:
  novada_search unavailable? Try: novada_research (uses internal search)
  novada_scrape unavailable? Try: novada_extract on the target URL directly
  novada_unblock unavailable? Try: novada_browser with navigate action

Option 3 -- Contact support:
  Email: support@novada.com -- include your API key prefix and this error code."
```

The `agent_instruction` provides three escalation paths, ordered by likelihood of success.

---

## Escalation Paths

When the `agent_instruction` does not resolve the issue:

| Step | Action |
|------|--------|
| 1 | Follow the `agent_instruction` exactly as written |
| 2 | Run `novada_setup()` to verify environment configuration |
| 3 | Run `novada_health_all()` to test all product endpoints |
| 4 | Try an alternative tool (see "Alternative Tools" below) |
| 5 | Check status.novada.com for platform-wide incidents |
| 6 | Contact support@novada.com with the full error text and your API key prefix |

### Alternative Tools

When one tool fails, another may accomplish the same goal:

| Failed Tool | Alternative | When to Switch |
|-------------|-------------|----------------|
| `novada_search` | `novada_research` | Research uses its own internal search |
| `novada_scrape` | `novada_extract` | Extract works on any URL, just returns markdown instead of structured records |
| `novada_extract` | `novada_unblock` | Use when extract returns empty on bot-protected pages |
| `novada_unblock` | `novada_browser` | Use when unblock fails -- browser has full CDP control |
| `novada_map` | `novada_crawl` | Map fails on SPAs; crawl with `render="render"` handles them |
| `novada_crawl` | `novada_extract` (batch) | Pass `url` as an array of known URLs instead of crawling |
| `novada_browser` | `novada_browser_flow` | Flow is a simpler API for common automation patterns |

---

## Error Code Reference

Complete list of all error codes, their classification, and the recommended response.

| Code | Class | Retryable | Default Delay | Summary |
|------|-------|-----------|---------------|---------|
| `INVALID_API_KEY` | auth | No | -- | API key missing, invalid, or expired |
| `RATE_LIMITED` | quota | Yes | 30s | Too many requests. Backoff and retry. |
| `URL_UNREACHABLE` | transient | Yes | 10s | Target URL is down or unreachable |
| `SPA_NO_URLS_FOUND` | permanent | No | -- | JavaScript SPA detected, no static URLs |
| `API_DOWN` | transient | Yes | 30s | Novada API returning 5xx errors |
| `INVALID_PARAMS` | permanent | No | -- | Parameters failed validation |
| `PRODUCT_UNAVAILABLE` | permanent | No | -- | Product not activated on API key |
| `TASK_NOT_FOUND` | permanent | No | -- | Async task ID expired or invalid |
| `TASK_PENDING` | transient | Yes | 5s | Async task still processing |
| `SESSION_EXPIRED` | permanent | No | -- | Browser session timed out |
| `PROXY_AUTH_FAILURE` | auth | No | -- | Proxy credentials invalid |
| `UNKNOWN` | permanent | No | -- | Unclassified error |

---

# Docs for Agents

This page explains how AI agents can programmatically discover, read, and use Novada MCP documentation. Everything here is designed for machine consumption -- no browser required.

---

## llms.txt

```
https://novada.com/docs/llms.txt
```

Returns a plain-text index of all documentation pages with one-line descriptions. AI agents should fetch this first to understand what documentation is available and where to find specific topics.

The file follows the [llms.txt specification](https://llmstxt.org/) -- a lightweight standard for making documentation discoverable by language models.

---

## Tool Discovery

Call `novada_discover()` with no arguments to get a categorized list of all 40+ tools with descriptions and availability status.

```
novada_discover()
```

Returns a markdown table grouped by category: Content Retrieval, Scraping & Verification, Proxy, Browser & Rendering, Health & Discovery. Each entry includes the tool name, a one-line description, and whether the tool is active or planned.

Use `novada_discover()` when you need to find the right tool for a task. Use `novada_health()` when you need to check which products are activated on your API key.

---

## MCP Resources

Novada exposes read-only MCP resources that agents can access before making tool calls. These reduce hallucination and help agents make correct tool selection decisions without trial and error.

| Resource URI | Description |
|---|---|
| `novada://guide` | Decision tree and workflow patterns for choosing between all tools. Includes failure recovery patterns, token efficiency tips, and common mistakes to avoid. |
| `novada://scraper-platforms` | Full catalog of 13 active platforms and ~78 scraper operations with exact operation IDs and required parameters. Read this before calling `novada_scrape`. |
| `novada://engines` | Supported search engines with characteristics and recommended use cases. |
| `novada://countries` | All 195 ISO 3166-1 alpha-2 country codes for geo-targeted search and proxy routing. |
| `novada://llms-txt` | Concise LLM-friendly reference for all tools. One paragraph per tool with best-for, not-for, required params, and example. 60% shorter than the full guide. |

### How to Read a Resource

In an MCP-compatible client, request the resource by URI:

```
read_resource("novada://guide")
```

The response is plain text, optimized for context injection into agent prompts.

---

## Structured Error Responses

Every error from Novada MCP is classified and returned with machine-readable fields that tell the agent exactly what happened and what to do next.

### Error Fields

| Field | Type | Description |
|---|---|---|
| `failure_class` | `auth` &#124; `quota` &#124; `transient` &#124; `permanent` | Category of the failure. Determines whether the error is fixable by retrying, by changing configuration, or not at all. |
| `retry_recommended` | `boolean` | Whether the agent should retry the same call. `true` for transient errors (network, rate limit, API downtime). `false` for auth, config, or permanent errors. |
| `retry_after_ms` | `number` | Present only when `retry_recommended` is `true`. Minimum wait time in milliseconds before retrying. |
| `agent_instruction` | `string` | Step-by-step plain-text instructions for resolving the error. Includes setup commands, alternative tools, dashboard links, and escalation paths. |

### Example Error Output

```
Error [RATE_LIMITED]: Rate limit exceeded. API is throttling your requests.
failure_class: quota
retry_recommended: true
retry_after_ms: 30000
agent_instruction: "You have hit the Novada API rate limit. This is temporary and retryable.

Action: Wait 30-60 seconds before retrying this tool call.
Strategy: Use exponential backoff for automated retries (delay doubles each attempt).
Avoid: Parallel calls to the same endpoint -- serialize them instead."
```

### Error Classification Reference

| Error Code | Failure Class | Retryable | Retry Delay |
|---|---|---|---|
| `INVALID_API_KEY` | auth | No | -- |
| `RATE_LIMITED` | quota | Yes | 30s |
| `URL_UNREACHABLE` | transient | Yes | 10s |
| `API_DOWN` | transient | Yes | 30s |
| `TASK_PENDING` | transient | Yes | 5s |
| `SPA_NO_URLS_FOUND` | permanent | No | -- |
| `INVALID_PARAMS` | permanent | No | -- |
| `PRODUCT_UNAVAILABLE` | permanent | No | -- |
| `TASK_NOT_FOUND` | permanent | No | -- |
| `SESSION_EXPIRED` | permanent | No | -- |
| `PROXY_AUTH_FAILURE` | auth | No | -- |

### Agent Error Handling Pattern

```
result = call_novada_tool(...)

if result.error:
    if result.retry_recommended:
        wait(result.retry_after_ms)
        retry once
    else:
        read result.agent_instruction
        follow the steps (fix config, use alternative tool, or escalate)
```

---

## Best Practices for Agents

### 1. Check your environment first

Call `novada_setup()` at the start of a session to see which environment variables are set, which products are active, and get setup instructions for anything missing.

### 2. Discover tools before guessing

Call `novada_discover()` or read `novada://guide` to find the right tool. Do not guess tool names or parameters -- Novada has 40+ tools with specific use cases.

### 3. Read agent_instruction before retrying

When a tool call fails, read the `agent_instruction` field in the error response. It contains the exact steps to fix the problem. Blindly retrying a `permanent` error wastes API calls.

### 4. Use novada_research for complex questions

`novada_research` is unique to Novada -- one call generates 3-10 parallel searches across multiple engines, deduplicates sources, extracts content from the top results, and returns a cited report. No other MCP server does this. Use it instead of manually chaining search and extract calls.

### 5. Batch extract calls

`novada_extract` accepts up to 10 URLs in a single call. Pass them as an array instead of making 10 separate calls.

### 6. Read novada://scraper-platforms before calling novada_scrape

The scraper has 13 active platforms with ~78 operations. Each operation has a specific ID and required parameters. Reading the resource first prevents invalid operation ID errors.

### 7. Use novada_health_all for systematic debugging

If multiple tools fail, call `novada_health_all()` to test all product endpoints in parallel. It returns per-product status with latency measurements and activation links.

---

## Tool Selection Decision Tree

```
You have a question, no URL
  Simple lookup        → novada_search
  Multi-source report  → novada_research

You have a URL
  Read one page        → novada_extract
  Read many pages      → novada_crawl
  Discover all URLs    → novada_map

You need platform data (Amazon, TikTok, LinkedIn...)
  → novada_scrape (read novada://scraper-platforms first)

You need to interact with a page
  → novada_browser

You need proxy credentials for your own requests
  → novada_proxy_residential / _isp / _datacenter / _mobile / _static / _dedicated

You need to fact-check a claim
  → novada_verify

Something is broken
  → novada_health_all
```
