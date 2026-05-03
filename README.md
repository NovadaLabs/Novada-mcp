<p align="center">
  <h1 align="center">Novada Search MCP</h1>
  <p align="center"><strong>Search, extract, crawl, map, and research the web — from any AI agent or terminal.</strong></p>
  <p align="center">Powered by <a href="https://www.novada.com">novada.com</a> — 100M+ proxy IPs across 195 countries.</p>
</p>

<p align="center">
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/novada.com-API_Key-ff6b35?style=for-the-badge" alt="novada.com"></a>
  <a href="https://www.npmjs.com/package/novada-search"><img src="https://img.shields.io/npm/v/novada-search?style=for-the-badge&label=MCP&color=blue" alt="npm version"></a>
  <a href="https://lobehub.com/mcp/goldentrii-novada-search"><img src="https://lobehub.com/badge/mcp/goldentrii-novada-search" alt="MCP Badge"></a>
  <a href="https://smithery.ai/server/novada-search"><img src="https://img.shields.io/badge/Smithery-install-8B5CF6?style=for-the-badge" alt="Smithery"></a>
  <a href="#tools"><img src="https://img.shields.io/badge/tools-11-brightgreen?style=for-the-badge" alt="11 tools"></a>
  <a href="#novada_search"><img src="https://img.shields.io/badge/engines-5-orange?style=for-the-badge" alt="5 engines"></a>
  <a href="#nova--cli"><img src="https://img.shields.io/badge/CLI-nova-blueviolet?style=for-the-badge" alt="CLI nova"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/proxy_IPs-100M+-red?style=for-the-badge" alt="100M+ proxy IPs"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/countries-195-cyan?style=for-the-badge" alt="195 countries"></a>
  <img src="https://img.shields.io/badge/tests-460-green?style=for-the-badge" alt="460 tests">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow?style=for-the-badge" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/novada-search"><img src="https://img.shields.io/npm/dt/novada-search" alt="downloads"></a>
  <a href="https://github.com/NovadaLabs/novada-search"><img src="https://img.shields.io/github/stars/NovadaLabs/novada-search?style=social" alt="stars"></a>
</p>


---

<p align="center">
  <strong>Language / 语言：</strong>
  <a href="#english-docs">English</a> · <a href="#中文文档">中文</a>
</p>

---

<h2 id="english-docs">English</h2>

**Jump to:** [API Keys](#api-keys--environment-variables) · [Quick Start](#quick-start) · [When to Use](#when-to-use-which-tool) · [Tools](#tools) · [Prompts](#prompts) · [Resources](#resources) · [Examples](#real-output-examples) · [Use Cases](#use-cases) · [Comparison](#why-novada)

---

## Quick Install

**Claude Code:**
```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-search
```
Get your key at [dashboard.novada.com](https://dashboard.novada.com).

---

### API Keys & Environment Variables

Different capabilities require different credentials. Here is what you need and where to get each one.

| Variable | Required For | Where to Get |
|----------|-------------|--------------|
| `NOVADA_API_KEY` | **All tools** — search, extract, crawl, map, research, proxy, verify | [novada.com](https://www.novada.com/) — free tier available |
| `NOVADA_WEB_UNBLOCKER_KEY` | `render="render"` mode — JS-heavy sites, anti-bot bypass | Upgrade at [novada.com](https://www.novada.com/) |
| `NOVADA_BROWSER_WS` | `render="browser"` mode — full CDP (Playwright) for fingerprint-protected sites | Contact [novada.com](https://www.novada.com/) for Browser API access |
| `NOVADA_PROXY_USER` / `NOVADA_PROXY_PASS` / `NOVADA_PROXY_ENDPOINT` | `novada_proxy` — required for proxy credential generation | Get from [dashboard.novada.com](https://dashboard.novada.com) → Residential Proxies → Endpoint Generator |

**Which tools work with just `NOVADA_API_KEY`:**
- `novada_search`, `novada_extract` (static mode), `novada_crawl`, `novada_map`, `novada_research`, `novada_proxy`, `novada_verify`

**Which tools need additional keys:**
- `render="render"` → needs `NOVADA_WEB_UNBLOCKER_KEY`
- `render="browser"` → needs `NOVADA_BROWSER_WS`
- `novada_unblock` → needs `NOVADA_WEB_UNBLOCKER_KEY` or `NOVADA_BROWSER_WS`
- `novada_browser` → needs `NOVADA_BROWSER_WS`
- `novada_scrape` → needs Scraper API product activation (contact support)

**Minimum setup (get started immediately):**
```bash
export NOVADA_API_KEY=your-key    # Free at novada.com
```

**Full setup (all features enabled):**
```bash
export NOVADA_API_KEY=your-key
export NOVADA_WEB_UNBLOCKER_KEY=your-unblocker-key   # For JS-heavy sites
export NOVADA_BROWSER_WS=wss://user:pass@upg-scbr2.novada.com  # For browser automation
```

> **For AI agents:** Set these environment variables in your MCP client config (see Quick Start). The agent will automatically use the best available method — if `NOVADA_WEB_UNBLOCKER_KEY` is set, it uses JS rendering when needed; if `NOVADA_BROWSER_WS` is set, it falls back to full browser for fingerprint-protected sites.

---

### `nova` — CLI

```bash
npm install -g novada-search
export NOVADA_API_KEY=your-key    # Free at novada.com
```

```bash
nova search "best desserts in Düsseldorf" --country de
nova search "AI funding news" --time week --include "techcrunch.com,wired.com"
nova extract https://example.com
nova extract https://example.com --render render      # JS-heavy sites
nova crawl https://docs.example.com --max-pages 10 --select "/api/.*"
nova map https://docs.example.com --search "webhook" --max-depth 3
nova research "How do AI agents use web scraping?" --depth deep --focus "production use cases"
nova proxy --type residential --country us --format env
nova scrape --platform amazon.com --operation amazon_product_by-keywords --keyword "iphone 16" --num 5 --format csv
nova verify "The Eiffel Tower is 330 meters tall" --context "as of 2024"
```

---

### Real Output Examples

#### `nova search "best desserts in Düsseldorf" --country de`

```
## Search Results
results:3 | engine:google | country:de

---

### 1. THE BEST Dessert in Düsseldorf
url: https://www.tripadvisor.com/Restaurants-g187373-zfg9909-Dusseldorf...
snippet: Heinemann Konditorei Confiserie (4.4★), Eis-Café Pia (4.5★), Cafe Huftgold (4.3★)

### 2. Top 10 Best Desserts Near Dusseldorf
url: https://www.yelp.com/search?cflt=desserts&find_loc=Dusseldorf...
snippet: Namu Café, Pure Pastry, Tenten Coffee, Eiscafé Pia...

### 3. Good Dessert Spots : r/duesseldorf
url: https://www.reddit.com/r/duesseldorf/comments/1mxh4bj/...
snippet: "I'm moving to Düsseldorf soon and I love trying out desserts!"

---
## Agent Hints
- To read any result in full: `novada_extract` with its url
- To batch-read multiple results: `novada_extract` with `url=[url1, url2, ...]`
- For deeper multi-source research: `novada_research`
```

#### `nova research "How do AI agents use web scraping?" --depth deep`

```
## Research Report
question: "How do AI agents use web scraping?"
depth:deep (auto-selected) | searches:6 | results:28 | unique_sources:15

---

## Search Queries Used
1. How do AI agents use web scraping?
2. ai agents web scraping overview explained
3. ai agents web scraping vs alternatives comparison
4. ai agents web scraping best practices real world
5. ai agents web scraping challenges limitations
6. "ai" "agents" site:reddit.com OR site:news.ycombinator.com

## Key Findings
1. **How AI Agents Are Changing the Future of Web Scraping**
   https://medium.com/@davidfagb/...
   These agents can think, understand, and adjust to changes in web structure...

## Sources
1. [How AI Agents Are Changing Web Scraping](https://medium.com/...)

---
## Agent Hints
- 15 sources found. Extract the most relevant with: `novada_extract` with url=[url1, url2]
- For more coverage: use depth='comprehensive' (8-10 searches).
```

#### Map → Batch Extract Workflow

```bash
# Step 1: Discover pages
nova map https://docs.example.com --search "webhook" --max-depth 3

# Step 2: Batch-extract multiple pages in one call
nova extract https://docs.example.com/webhooks/events https://docs.example.com/webhooks/retry
```

---

### Quick Start

#### Claude Code (1 command)

```bash
claude mcp add novada -e NOVADA_API_KEY=your-key -- npx -y novada-search
```

`--scope user` for all projects:
```bash
claude mcp add --scope user novada -e NOVADA_API_KEY=your-key -- npx -y novada-search
```

With JS rendering + browser automation:
```bash
claude mcp add --scope user novada \
  -e NOVADA_API_KEY=your-key \
  -e NOVADA_WEB_UNBLOCKER_KEY=your-unblocker-key \
  -e NOVADA_BROWSER_WS=wss://user:pass@upg-scbr2.novada.com \
  -- npx -y novada-search
```

#### Smithery (1 click)

Install via [Smithery](https://smithery.ai/server/novada-search) — supports Claude Desktop, Cursor, VS Code, and more.

```bash
npx -y @smithery/cli install novada-search --client claude
```

<details>
<summary><strong>Cursor / VS Code / Windsurf / Claude Desktop</strong></summary>

**Cursor** — `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "your-key",
        "NOVADA_WEB_UNBLOCKER_KEY": "your-unblocker-key"
      }
    }
  }
}
```

**VS Code** — `.vscode/mcp.json`:
```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "your-key",
        "NOVADA_WEB_UNBLOCKER_KEY": "your-unblocker-key"
      }
    }
  }
}
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "your-key"
      }
    }
  }
}
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "your-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Python (via CLI)</strong></summary>

```python
import subprocess, os

result = subprocess.run(
    ["nova", "search", "AI agent frameworks"],
    capture_output=True, text=True,
    env={**os.environ, "NOVADA_API_KEY": "your-key"}
)
print(result.stdout)
```

</details>

---

### When to Use Which Tool

| Situation | Use |
|-----------|-----|
| Find pages on a topic you don't have URLs for | `novada_search` |
| Read the content of a URL you already know | `novada_extract` |
| Read content from multiple known URLs at once | `novada_extract` with `url=[url1, url2, ...]` |
| Extract from a JS-heavy / anti-bot site | `novada_extract` with `render="render"` or `"browser"` |
| Force JS render or unblock a specific page | `novada_unblock` |
| Automate a browser interaction (click, fill, screenshot) | `novada_browser` |
| Read every page under a docs site | `novada_crawl` |
| Discover which URLs exist on a site | `novada_map` (tries sitemap.xml first — fast) |
| Comprehensive multi-source research | `novada_research` |
| Route HTTP traffic through residential proxies | `novada_proxy` |
| Structured data from Amazon, Reddit, TikTok, etc. | `novada_scrape` |
| Verify a factual claim before citing it | `novada_verify` |

**Common workflows:**

```
# Research workflow
novada_search → novada_extract (batch top results) → synthesize

# Docs deep-dive
novada_map → novada_crawl (select_paths=["/api/.*"]) → synthesize

# Platform data
novada_scrape (amazon.com, amazon_product_by-keywords) → analyze

# Anti-bot site
novada_unblock → novada_browser (click, scroll, screenshot)
```

**Don't:**
- Use `novada_crawl` for a single page — use `novada_extract`
- Use `novada_research` when you already have the URLs — use `novada_extract`
- Use `novada_map` to read content — it only returns URLs, use `novada_extract` next

---

### Tools

#### `novada_search`

Search the web via Google, Bing, or 3 other engines. Returns structured results with titles, URLs, and snippets.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query |
| `engine` | string | No | `"google"` | `google` `bing` `duckduckgo` `yahoo` `yandex` |
| `num` | number | No | `10` | Results count (1-20) |
| `country` | string | No | — | Country code (`us`, `uk`, `de`) |
| `language` | string | No | — | Language code (`en`, `zh`, `de`) |
| `time_range` | string | No | — | `day` `week` `month` `year` |
| `start_date` | string | No | — | Start date `YYYY-MM-DD` |
| `end_date` | string | No | — | End date `YYYY-MM-DD` |
| `include_domains` | string[] | No | — | Only return results from these domains |
| `exclude_domains` | string[] | No | — | Exclude results from these domains |
| `extract_options` | object | No | — | When set, auto-extracts content from top N results in a single call. Fields: `top_n` (default 3), `format`, `fields`, `max_chars`. |

> **Inline extraction:** Pass `extract_options: { top_n: 3, format: "markdown" }` to automatically extract content from the top N search results in a single call.

#### `novada_extract`

Extract the main content from any URL. Supports batch extraction (up to 10 URLs in parallel). Auto-escalates from static → JS render → Browser API on JS-heavy sites. Uses a 70-domain registry to skip probe latency for known sites.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string \| string[] | Yes | — | URL or array of URLs (max 10 for batch) |
| `urls` | string[] | No | — | Array of URLs to extract in parallel (max 10); alias for `url`. Preferred for batch workflows. |
| `format` | string | No | `"markdown"` | `markdown` `text` `html` |
| `render` | string | No | `"auto"` | `auto` (escalates if JS-heavy) · `static` (fast, no JS) · `render` (Web Unblocker) · `browser` (full CDP) |
| `query` | string | No | — | Query context hint for agent-side filtering |
| `fields` | string[] | No | — | Specific fields to extract: `["price", "author", "rating", "date"]` (max 20). Sources: JSON-LD → regex → scan |
| `max_chars` | number | No | `25000` | Max characters to return (default 25000, max 100000). Don't default to 100000 — use only when large content is needed. |

**`fields` example output:**
```
## Requested Fields
price: $299.99 *(from schema)*
author: John Smith *(pattern)*
rating: 4.5/5 *(from schema)*
availability: In Stock *(pattern)*
```

#### `novada_crawl`

Crawl a website and extract content from multiple pages concurrently.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | Seed URL |
| `max_pages` | number | No | `5` | Max pages (1-20) |
| `strategy` | string | No | `"bfs"` | `bfs` (breadth-first) or `dfs` (depth-first) |
| `render` | string | No | `"auto"` | `auto` · `static` · `render` (JS rendering for whole crawl) |
| `select_paths` | string[] | No | — | Regex patterns — only crawl matching paths |
| `exclude_paths` | string[] | No | — | Regex patterns — skip matching paths |
| `instructions` | string | No | — | Natural-language hint for agent-side filtering |

#### `novada_map`

Discover all URLs on a website. Fast — collects links without extracting content.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | Root URL |
| `search` | string | No | — | Filter URLs by search term |
| `limit` | number | No | `50` | Max URLs (1-100) |
| `max_depth` | number | No | `2` | BFS depth limit (1-5) |
| `include_subdomains` | boolean | No | `false` | Include subdomain URLs |

#### `novada_research`

Multi-step web research. Runs 3-10 parallel searches, deduplicates, returns a cited report.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `question` | string | Yes | — | Research question (min 5 chars) |
| `depth` | string | No | `"auto"` | `auto` `quick` (3 searches) `deep` (5-6) `comprehensive` (8-10) |
| `focus` | string | No | — | Narrow sub-query focus (e.g. `"production use cases"`) |

#### `novada_proxy`

Generate ready-to-use proxy credentials (residential, mobile, ISP, datacenter).

> **Requires:** `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, and `NOVADA_PROXY_ENDPOINT` environment variables. Get these from [dashboard.novada.com](https://dashboard.novada.com) → Residential Proxies → Endpoint Generator.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string | No | `"residential"` | `residential` `mobile` `isp` `datacenter` |
| `country` | string | No | — | ISO 2-letter code (`us`, `gb`, `de`) |
| `city` | string | No | — | City-level targeting (requires `country`) |
| `session_id` | string | No | — | Sticky session — same ID returns same IP |
| `format` | string | No | `"url"` | `url` · `env` (export commands) · `curl` (--proxy flag) |

#### `novada_scrape`

Structured data from 129 platforms (Amazon, Reddit, TikTok, LinkedIn, Google Shopping…). Returns clean records — no HTML parsing needed.

> **Note:** Requires Scraper API product activation. Contact [novada.com](https://www.novada.com/) support if you see error 11006.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `platform` | string | Yes | — | Domain (e.g. `amazon.com`, `reddit.com`, `tiktok.com`) |
| `operation` | string | Yes | — | Operation ID (e.g. `amazon_product_by-keywords`, `reddit_posts_by-keywords`) |
| `params` | object | No | `{}` | Operation-specific params (e.g. `{ keyword: "iphone 16", num: 5 }`) |
| `limit` | number | No | `20` | Max records (1-100) |
| `format` | string | No | `"markdown"` | `markdown` (default, agent-optimized table) · `json` (structured records for programmatic use). Note: `csv`/`html`/`xlsx` are available via the `nova` CLI only. |

**Example operations:**

```bash
# Amazon product search
nova scrape --platform amazon.com --operation amazon_product_by-keywords --keyword "iphone 16" --num 5

# Reddit posts
nova scrape --platform reddit.com --operation reddit_posts_by-keywords --keyword "AI agents" --num 10

# Google Shopping
nova scrape --platform google.com --operation google_shopping_by-keywords --keyword "mechanical keyboard"
```

Full platform/operation list: [developer.novada.com](https://developer.novada.com/novada/advanced-proxy-solutions/scraper-api)

#### `novada_verify`

Verify a factual claim against live web sources. Runs 3 parallel searches (supporting, skeptical, and neutral fact-check angles) and returns a structured verdict.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `claim` | string | Yes | — | The factual claim to verify (min 10 chars) |
| `context` | string | No | — | Optional context to narrow search (e.g. `"as of 2024"`, `"in the US"`) |

**Verdict values:** `supported` · `unsupported` · `contested` · `insufficient_data`

**Confidence:** 0–100 — how far from a 50/50 split. 100 = all evidence agrees, 0 = completely uncertain.

**Note:** Verdict is signal-based (search result balance), not a definitive fact ruling. For contested claims, use `novada_extract` on the returned source URLs for full context.

#### `novada_unblock`

Force JS render or unblock a specific URL using Web Unblocker or Browser API CDP. Use when `novada_extract` with `render="render"` is too slow and you want a direct unblock call.

> **Requires:** `NOVADA_WEB_UNBLOCKER_KEY` or `NOVADA_BROWSER_WS`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | URL to unblock |
| `method` | string | No | `"render"` | `render` (Web Unblocker) · `browser` (full CDP) |

#### `novada_browser`

Cloud browser automation via CDP (Playwright). Execute up to 20 chained actions per session. Useful for sites requiring login flows, form fills, or screenshot capture.

> **Requires:** `NOVADA_BROWSER_WS`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `actions` | array | Yes | — | Ordered list of browser actions (max 20) |

**Supported actions:** `navigate` · `click` · `type` · `screenshot` · `aria_snapshot` · `evaluate` · `wait` · `scroll` · `hover` · `press_key` · `select`

**Example:**
```json
{
  "actions": [
    { "type": "navigate", "url": "https://example.com/login" },
    { "type": "type", "selector": "#email", "text": "user@example.com" },
    { "type": "type", "selector": "#password", "text": "pass" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "aria_snapshot" }
  ]
}
```

---

### Prompts

MCP prompts are pre-built workflow templates visible in supported clients (Claude Desktop, LobeChat, etc.).

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `research_topic` | Deep multi-source research with optional country and focus | `topic` (required), `country`, `focus` |
| `extract_and_summarize` | Extract one or more URLs and summarize | `urls` (required), `focus` |
| `site_audit` | Map site structure then extract key sections | `url` (required), `sections` |
| `scrape_platform_data` | Scrape structured data from a specific platform (Amazon, Reddit, TikTok, etc.) | `platform` (required), `data_type` (required), `query` (required) |
| `browser_stateful_workflow` | Automate a multi-step browser workflow with persistent session state | `url` (required), `workflow` (required), `session_id` |

---

### Resources

Read-only data agents can access before deciding which tool to call.

| URI | Description |
|-----|-------------|
| `novada://engines` | All 5 engines with characteristics and use cases |
| `novada://countries` | 195 country codes for geo-targeted search |
| `novada://guide` | Decision tree for choosing between tools |
| `novada://scraper-platforms` | 129 supported scraper platforms with valid operation IDs |

---

### Use Cases

| Use Case | Tools | How It Works |
|----------|-------|-------------|
| **RAG pipeline** | `search` + `extract` | Search → batch-extract full text → vector DB |
| **Agentic research** | `research` | One call → multi-source report with citations |
| **Real-time grounding** | `search` | Facts beyond training cutoff |
| **Competitive intel** | `crawl` | Crawl competitor sites → extract changes |
| **Lead generation** | `search` | Structured company/product lists |
| **SEO tracking** | `search` | Keywords across 5 engines, 195 countries |
| **Site audit** | `map` → `extract` | Discover pages (sitemap-first), then batch-extract targets |
| **Domain filtering** | `search` | `include_domains` to restrict to trusted sources |
| **Trend monitoring** | `search` | `time_range=week` for recent-only results |
| **E-commerce data** | `scrape` | Structured product data from Amazon, Shopify, etc. |
| **Social listening** | `scrape` | Posts/comments from Reddit, TikTok, LinkedIn |
| **Proxy routing** | `proxy` | Route agent HTTP calls through residential IPs |
| **JS-heavy sites** | `extract` + `render=render` | Anti-bot bypass via Web Unblocker |
| **Browser automation** | `browser` | Login flows, form submission, screenshots |
| **Claim verification** | `verify` | Fact-check before citing in reports |

---

### Why Novada?

| Feature | Novada | Tavily | Firecrawl |
|---------|--------|--------|-----------|
| Web search | **5 engines** | 1 engine | 1 engine |
| URL extraction | Yes | Yes | Yes |
| Batch extraction | **Yes (10 URLs)** | Yes (urls[]) | Yes |
| Website crawling | BFS/DFS + render modes | Yes | Yes (async) |
| URL mapping | **Sitemap-first** (fast) | BFS only | Sitemap option |
| Research | Yes | Yes | No |
| **Platform scrapers** | **129 platforms** | No | No |
| **Proxy tool** | **Residential/mobile/ISP** | No | No |
| **Browser automation** | **Yes (CDP, 20 actions)** | No | No |
| MCP Prompts | **5** | No | No |
| MCP Resources | **4** | No | No |
| Geo-targeting | **195 countries** | Country param | No |
| Domain filtering | **include/exclude** | No | No |
| JS rendering | Auto-escalation chain | No | Yes (agent mode) |
| Field extraction | **Built-in (JSON-LD + regex)** | No | LLM schema |
| Relevance reranking | **Built-in (keyword scoring)** | Built-in | No |
| Time-range filter | `day/week/month/year` | Yes | No |
| **Claim verification** | **Built-in** | No | No |
| **CLI** | **`nova` command** | No | No |

---

### Prerequisites

- **API key** — [Sign up free at novada.com](https://www.novada.com/)
- **Node.js** v18+

---

<h2 id="中文文档">中文文档</h2>

**跳转至：** [API 密钥](#api-密钥与环境变量) · [快速开始](#快速开始) · [工具](#工具) · [Prompts](#prompts-预置工作流) · [Resources](#resources-只读数据) · [示例](#真实输出示例) · [用例](#用例) · [对比](#为什么选择-novada)

---

### 简介

Novada MCP Server 让 AI 代理实时访问互联网 — 搜索、提取、爬取、映射和研究网络内容。所有请求通过 Novada 的代理基础设施（**1亿+ IP，195 个国家，反机器人绕过**）路由。

---

### API 密钥与环境变量

不同功能需要不同的密钥。以下是每项功能所需的配置及获取方式。

| 环境变量 | 用途 | 获取方式 |
|---------|------|---------|
| `NOVADA_API_KEY` | **所有工具** — 搜索、提取、爬取、映射、研究、代理、核查 | [novada.com](https://www.novada.com/) — 有免费套餐 |
| `NOVADA_WEB_UNBLOCKER_KEY` | `render="render"` 模式 — JS 密集型站点、反机器人绕过 | 在 [novada.com](https://www.novada.com/) 升级账户 |
| `NOVADA_BROWSER_WS` | `render="browser"` 模式 — 完整 CDP（Playwright），用于指纹保护站点 | 联系 [novada.com](https://www.novada.com/) 申请 Browser API 权限 |
| `NOVADA_PROXY_USER` / `NOVADA_PROXY_PASS` / `NOVADA_PROXY_ENDPOINT` | `novada_proxy` 自定义端点（可选） | 默认从 `NOVADA_API_KEY` 派生 |

**只需 `NOVADA_API_KEY` 就能使用的工具：**
- `novada_search`、`novada_extract`（静态模式）、`novada_crawl`、`novada_map`、`novada_research`、`novada_proxy`、`novada_verify`

**需要额外密钥的功能：**
- `render="render"` → 需要 `NOVADA_WEB_UNBLOCKER_KEY`
- `render="browser"` → 需要 `NOVADA_BROWSER_WS`
- `novada_unblock` → 需要 `NOVADA_WEB_UNBLOCKER_KEY` 或 `NOVADA_BROWSER_WS`
- `novada_browser` → 需要 `NOVADA_BROWSER_WS`
- `novada_scrape` → 需要 Scraper API 产品激活（联系客服）

**最小配置（立即开始）：**
```bash
export NOVADA_API_KEY=你的密钥    # 在 novada.com 免费获取
```

**完整配置（启用所有功能）：**
```bash
export NOVADA_API_KEY=你的密钥
export NOVADA_WEB_UNBLOCKER_KEY=你的解锁密钥   # 用于 JS 密集型站点
export NOVADA_BROWSER_WS=wss://用户:密码@upg-scbr2.novada.com  # 用于浏览器自动化
```

> **给 AI 代理的提示：** 在 MCP 客户端配置中设置这些环境变量（参见快速开始）。代理会自动选择最佳方式 — 设置了 `NOVADA_WEB_UNBLOCKER_KEY` 时会在需要时使用 JS 渲染；设置了 `NOVADA_BROWSER_WS` 时会对指纹保护站点回退到完整浏览器模式。

---

### 快速开始

```bash
npm install -g novada-search
export NOVADA_API_KEY=你的密钥    # 在 novada.com 免费获取
```

```bash
nova search "杜塞尔多夫最好的甜点" --country de
nova search "AI 融资新闻" --time week --include "techcrunch.com"
nova extract https://example.com
nova extract https://example.com --render render      # JS 密集型站点
nova crawl https://docs.example.com --max-pages 10 --select "/api/.*"
nova map https://docs.example.com --search "api" --max-depth 3
nova research "AI 代理如何使用网络抓取？" --depth deep --focus "生产用例"
nova proxy --type residential --country us --format env
nova scrape --platform amazon.com --operation amazon_product_by-keywords --keyword "iphone 16" --num 5
nova verify "The Eiffel Tower is 330 meters tall" --context "as of 2024"
```

#### 连接到 Claude Code

```bash
# 最小配置
claude mcp add novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-search

# 所有项目生效
claude mcp add --scope user novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-search

# 完整配置（含 JS 渲染 + 浏览器自动化）
claude mcp add --scope user novada \
  -e NOVADA_API_KEY=你的密钥 \
  -e NOVADA_WEB_UNBLOCKER_KEY=你的解锁密钥 \
  -e NOVADA_BROWSER_WS=wss://用户:密码@upg-scbr2.novada.com \
  -- npx -y novada-search
```

#### 通过 Smithery 一键安装

```bash
npx -y @smithery/cli install novada-search --client claude
```

<details>
<summary><strong>Cursor / VS Code / Windsurf / Claude Desktop</strong></summary>

**Cursor** — `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "你的密钥",
        "NOVADA_WEB_UNBLOCKER_KEY": "你的解锁密钥"
      }
    }
  }
}
```

**VS Code** — `.vscode/mcp.json`:
```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "你的密钥"
      }
    }
  }
}
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "你的密钥"
      }
    }
  }
}
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": {
        "NOVADA_API_KEY": "你的密钥"
      }
    }
  }
}
```

</details>

---

### 真实输出示例

#### `nova search "杜塞尔多夫最好的甜点" --country de`

```
## Search Results
results:3 | engine:google | country:de

---

### 1. THE BEST Dessert in Düsseldorf
url: https://www.tripadvisor.com/Restaurants-g187373-zfg9909-Dusseldorf...
snippet: Heinemann Konditorei Confiserie (4.4★), Eis-Café Pia (4.5★)

### 2. Top 10 Best Desserts Near Dusseldorf
url: https://www.yelp.com/search?cflt=desserts&find_loc=Dusseldorf...
snippet: Namu Café, Pure Pastry, Tenten Coffee...

---
## Agent Hints
- 完整阅读任一结果：使用 `novada_extract` 传入对应 url
- 批量读取多个结果：`novada_extract` 传入 `url=[url1, url2, ...]`
- 深度多源研究：使用 `novada_research`
```

#### `nova research "AI 代理如何使用网络抓取？" --depth deep`

```
## Research Report
question: "AI 代理如何使用网络抓取？"
depth:deep (auto-selected) | searches:6 | results:28 | unique_sources:15

---

## Search Queries Used
1. AI 代理如何使用网络抓取？
2. ai agents web scraping overview explained
3. ai agents web scraping best practices real world
...

## Key Findings
1. **How AI Agents Are Changing Web Scraping**
   https://medium.com/@davidfagb/...

---
## Agent Hints
- 找到 15 个来源。用 `novada_extract` 提取最相关的页面
- 更多覆盖：使用 depth='comprehensive'（8-10 次搜索）
```

---

### 工具

#### `novada_search` — 网络搜索

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | 是 | — | 搜索关键词 |
| `engine` | string | 否 | `"google"` | `google` `bing` `duckduckgo` `yahoo` `yandex` |
| `num` | number | 否 | `10` | 结果数量（1-20） |
| `country` | string | 否 | — | 国家代码（`us` `cn` `de`） |
| `language` | string | 否 | — | 语言代码（`en` `zh` `de`） |
| `time_range` | string | 否 | — | 时间范围：`day` `week` `month` `year` |
| `start_date` | string | 否 | — | 起始日期 `YYYY-MM-DD` |
| `end_date` | string | 否 | — | 截止日期 `YYYY-MM-DD` |
| `include_domains` | string[] | 否 | — | 只返回这些域名的结果 |
| `exclude_domains` | string[] | 否 | — | 排除这些域名的结果 |

#### `novada_extract` — 内容提取

内置 70 域名注册表（amazon、twitter、linkedin 等），对已知 JS 站点跳过静态探测，直接使用最优渲染模式。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string \| string[] | 是 | — | 单个 URL 或 URL 数组（最多 10 个，并行处理） |
| `format` | string | 否 | `"markdown"` | `markdown` `text` `html` |
| `render` | string | 否 | `"auto"` | `auto`（JS 密集时自动升级）· `static`（快速，无 JS）· `render`（Web Unblocker）· `browser`（完整 CDP） |
| `query` | string | 否 | — | 查询上下文，帮助 agent 聚焦相关内容 |
| `fields` | string[] | 否 | — | 指定要提取的字段：`["price", "author", "rating", "date"]`（最多 20 个） |

#### `novada_crawl` — 网站爬取

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 起始 URL |
| `max_pages` | number | 否 | `5` | 最大页面数（1-20） |
| `strategy` | string | 否 | `"bfs"` | `bfs`（广度优先）或 `dfs`（深度优先） |
| `render` | string | 否 | `"auto"` | `auto` · `static` · `render`（整站 JS 渲染） |
| `select_paths` | string[] | 否 | — | 正则表达式 — 只爬取匹配路径 |
| `exclude_paths` | string[] | 否 | — | 正则表达式 — 跳过匹配路径 |
| `instructions` | string | 否 | — | 自然语言说明，指导 agent 侧语义过滤 |

#### `novada_map` — URL 发现

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 根 URL |
| `search` | string | 否 | — | 按关键词过滤 URL |
| `limit` | number | 否 | `50` | 最多 URL 数（1-100） |
| `max_depth` | number | 否 | `2` | BFS 深度上限（1-5） |
| `include_subdomains` | boolean | 否 | `false` | 是否包含子域名 |

#### `novada_research` — 深度研究

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `question` | string | 是 | — | 研究问题（最少 5 个字符） |
| `depth` | string | 否 | `"auto"` | `auto` `quick` `deep` `comprehensive` |
| `focus` | string | 否 | — | 聚焦方向（如 `"技术实现"` `"市场趋势"`） |

#### `novada_proxy` — 代理凭据

生成即用代理凭据（住宅、移动、ISP、数据中心），无需单独申请账号 — 从 `NOVADA_API_KEY` 直接派生。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `type` | string | 否 | `"residential"` | `residential` `mobile` `isp` `datacenter` |
| `country` | string | 否 | — | ISO 2 字母国家代码（`us` `gb` `de`） |
| `city` | string | 否 | — | 城市级定向（需同时指定 `country`） |
| `session_id` | string | 否 | — | 粘性会话 — 相同 ID 返回同一 IP |
| `format` | string | 否 | `"url"` | `url` · `env`（export 命令）· `curl`（--proxy 参数） |

#### `novada_scrape` — 平台结构化数据

从 129 平台（Amazon、Reddit、TikTok、LinkedIn、Google Shopping 等）抓取结构化数据，无需手动解析 HTML。

> **注意：** 需要激活 Scraper API 产品。如果遇到错误 11006，请联系 [novada.com](https://www.novada.com/) 客服。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `platform` | string | 是 | — | 平台域名（如 `amazon.com` `reddit.com` `tiktok.com`） |
| `operation` | string | 是 | — | 操作 ID（如 `amazon_product_by-keywords`） |
| `params` | object | 否 | `{}` | 操作特定参数（如 `{ keyword: "iphone 16", num: 5 }`） |
| `limit` | number | 否 | `20` | 最大记录数（1-100） |
| `format` | string | 否 | `"markdown"` | `markdown` · `json` · `csv` · `html` · `xlsx` |

#### `novada_verify` — 事实核查

针对实时网络来源验证一个事实性声明。并行运行 3 次搜索（支持、质疑、中立核查角度），返回结构化裁定。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `claim` | string | 是 | — | 要验证的事实声明（最少 10 个字符） |
| `context` | string | 否 | — | 可选上下文，缩小搜索范围（如 `"截至 2024 年"` `"在美国"`） |

**裁定值：** `supported`（支持）· `unsupported`（不支持）· `contested`（存疑）· `insufficient_data`（数据不足）

#### `novada_unblock` — 强制解锁

> **需要：** `NOVADA_WEB_UNBLOCKER_KEY` 或 `NOVADA_BROWSER_WS`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 要解锁的 URL |
| `method` | string | 否 | `"render"` | `render`（Web Unblocker）· `browser`（完整 CDP） |

#### `novada_browser` — 浏览器自动化

> **需要：** `NOVADA_BROWSER_WS`

云端浏览器自动化（CDP / Playwright）。每次会话最多 20 个链式操作，支持：`navigate`（导航）· `click`（点击）· `type`（输入）· `screenshot`（截图）· `snapshot`（快照）· `evaluate`（执行 JS）· `wait`（等待）· `scroll`（滚动）。

---

### Prompts 预置工作流

MCP Prompts 是预置工作流模板，在支持的客户端（Claude Desktop、LobeChat 等）中可直接选用。

| Prompt | 功能 | 参数 |
|--------|------|------|
| `research_topic` | 对任意主题进行深度多源研究 | `topic`（必填）, `country`, `focus` |
| `extract_and_summarize` | 提取一个或多个 URL 的内容并生成摘要 | `urls`（必填）, `focus` |
| `site_audit` | 映射网站结构，然后提取并汇总关键部分 | `url`（必填）, `sections` |
| `scrape_platform_data` | 从指定平台（Amazon、Reddit、TikTok 等）抓取结构化数据 | `platform`（必填）, `data_type`（必填）, `query`（必填） |
| `browser_stateful_workflow` | 在持久会话中执行多步骤浏览器自动化工作流 | `url`（必填）, `workflow`（必填）, `session_id` |

---

### Resources 只读数据

Agent 在选择工具之前可以读取的参考数据。

| URI | 内容 |
|-----|------|
| `novada://engines` | 5 个搜索引擎的特性和推荐使用场景 |
| `novada://countries` | 195 个国家代码（地理定向搜索） |
| `novada://guide` | 工具选择决策树和工作流模式 |
| `novada://scraper-platforms` | 129 个平台的有效 operation ID 列表 |

---

### 用例

| 用例 | 工具 | 说明 |
|------|------|------|
| RAG 数据管道 | `search` + `extract` | 搜索 → 批量提取全文 → 向量数据库 |
| 智能研究 | `research` | 一次调用 → 多源综合带引用报告 |
| 实时知识 | `search` | 获取训练截止日期之后的事实 |
| 竞品分析 | `crawl` | 爬取竞品网站 → 提取内容变化 |
| 获客线索 | `search` | 结构化的公司/产品列表 |
| SEO 追踪 | `search` | 跨 5 个引擎、195 个国家追踪关键词 |
| 网站审计 | `map` → `extract` | 发现所有页面，然后批量提取目标内容 |
| 域名过滤 | `search` | `include_domains` 只搜索可信来源 |
| 趋势监控 | `search` | `time_range=week` 只获取最新结果 |
| 电商数据 | `scrape` | 从 Amazon、Shopify 等获取结构化商品数据 |
| 社交监听 | `scrape` | 从 Reddit、TikTok、LinkedIn 获取帖子/评论 |
| 代理路由 | `proxy` | 通过住宅 IP 路由 agent HTTP 请求 |
| JS 密集型站点 | `extract` + `render=render` | 通过 Web Unblocker 绕过反机器人检测 |
| 浏览器自动化 | `browser` | 登录流程、表单提交、截图捕获 |
| 事实核查 | `verify` | 在报告中引用前核查事实准确性 |

---

### 为什么选择 Novada？

| 特性 | Novada | Tavily | Firecrawl |
|------|--------|--------|-----------|
| 搜索引擎数量 | **5 个** | 1 个 | 1 个 |
| URL 内容提取 | 支持 | 支持 | 支持 |
| 批量提取 | **支持（最多 10 个）** | 支持 | 支持 |
| 网站爬取 | BFS/DFS + 渲染模式 | 支持 | 支持（异步） |
| URL 发现 | **Sitemap 优先**（快速） | 仅 BFS | Sitemap 选项 |
| 深度研究 | 支持 | 支持 | 不支持 |
| **平台数据爬取** | **129 平台** | 无 | 无 |
| **代理工具** | **住宅/移动/ISP** | 无 | 无 |
| **浏览器自动化** | **支持（CDP，20 步）** | 无 | 无 |
| MCP Prompts | **5 个** | 无 | 无 |
| MCP Resources | **4 个** | 无 | 无 |
| 地理定向 | **195 个国家** | 国家参数 | 无 |
| 域名过滤 | **include/exclude** | 无 | 无 |
| JS 渲染 | 自动升级链路 | 无 | 支持（agent 模式） |
| 字段提取 | **内置（JSON-LD + 正则）** | 无 | LLM schema |
| 相关性重排序 | **内置（关键词评分）** | 内置 | 无 |
| 时间过滤 | `day/week/month/year` | 支持 | 无 |
| **事实核查** | **内置** | 无 | 无 |
| CLI 工具 | **`nova` 命令** | 无 | 无 |

---

### 前置要求

- **API 密钥** — [在 novada.com 免费注册](https://www.novada.com/)
- **Node.js** v18+

---

## About

[Novada](https://www.novada.com/) — web data infrastructure for developers and AI agents. 100M+ proxy IPs, 195 countries.

## License

MIT
