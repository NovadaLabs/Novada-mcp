<p align="center">
  <h1 align="center">Novada MCP Server</h1>
  <p align="center"><strong>Search, extract, crawl, map, and research the web — from any AI agent or terminal.</strong></p>
  <p align="center">Powered by <a href="https://www.novada.com">novada.com</a> — 100M+ proxy IPs across 195 countries.</p>
</p>

<p align="center">
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/novada.com-API_Key-ff6b35?style=for-the-badge" alt="novada.com"></a>
  <a href="https://www.npmjs.com/package/novada-mcp"><img src="https://img.shields.io/npm/v/novada-mcp?style=for-the-badge&label=MCP&color=blue" alt="npm version"></a>
  <a href="https://lobehub.com/mcp/goldentrii-novada-mcp"><img src="https://lobehub.com/badge/mcp/goldentrii-novada-mcp" alt="MCP Badge"></a>
  <a href="https://smithery.ai/server/novada-mcp"><img src="https://img.shields.io/badge/Smithery-install-8B5CF6?style=for-the-badge" alt="Smithery"></a>
  <a href="#tools"><img src="https://img.shields.io/badge/tools-5-brightgreen?style=for-the-badge" alt="5 tools"></a>
  <a href="#nova--cli"><img src="https://img.shields.io/badge/CLI-nova-blueviolet?style=for-the-badge" alt="CLI nova"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/proxy_IPs-100M+-red?style=for-the-badge" alt="100M+ proxy IPs"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/countries-195-cyan?style=for-the-badge" alt="195 countries"></a>
  <img src="https://img.shields.io/badge/tests-124-green?style=for-the-badge" alt="124 tests">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow?style=for-the-badge" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/novada-mcp"><img src="https://img.shields.io/npm/dt/novada-mcp" alt="downloads"></a>
  <a href="https://github.com/NovadaLabs/novada-mcp"><img src="https://img.shields.io/github/stars/NovadaLabs/novada-mcp?style=social" alt="stars"></a>
</p>

<p align="center">
  <strong>Language:</strong>
  English &nbsp;·&nbsp; <a href="README.zh.md">中文</a>
</p>

---

**Jump to:** [Quick Start](#quick-start) · [Tools](#tools) · [What's New](#whats-new-in-v070) · [Examples](#real-output-examples) · [Use Cases](#use-cases) · [Comparison](#why-novada)

---

## What's New in v0.7.0

**Agent Intelligence Layer** — v0.7.0 adds an intelligence layer between the raw API and the agent, so every response is useful, not just "data returned."

- **Search auto-fallback**: if the requested engine fails, automatically retries with a working engine and tells the agent what happened
- **Research query anchoring**: sub-queries stay topically grounded — "production AI agents" no longer drifts to manufacturing/construction results
- **Research relevance filtering**: off-topic sources automatically removed, with metadata showing how many were dropped
- **Content quality detection**: extracts warn agents about thin content, wrong-language pages (geo-redirects), and CAPTCHA/block pages — in the metadata header, before the agent reads the content
- **Dynamic Agent Hints**: every response ends with context-specific guidance based on what actually happened, not generic boilerplate
- **Web Unblocker integration**: anti-bot bypass for protected sites via Novada Web Unblocker
- **30,000-char content limit**: up from 8,000 — full-page extraction for documentation and long-form content
- **124 tests**, all passing

---

## `nova` — CLI

```bash
npm install -g novada-mcp
export NOVADA_API_KEY=your-key    # Free at novada.com
```

```bash
nova search "best restaurants in Tokyo" --country jp
nova search "AI funding news" --time week --include "techcrunch.com,wired.com"
nova extract https://example.com
nova crawl https://docs.example.com --max-pages 10 --select "/api/.*"
nova map https://docs.example.com --search "webhook" --max-depth 3
nova research "How do AI agents use web scraping?" --depth deep --focus "production use cases"
```

---

## Quick Start

### Claude Code (1 command)

```bash
claude mcp add novada -e NOVADA_API_KEY=your-key -- npx -y novada-mcp
```

For all projects (`--scope user`):
```bash
claude mcp add --scope user novada -e NOVADA_API_KEY=your-key -- npx -y novada-mcp
```

### Smithery (1 click)

Install via [Smithery](https://smithery.ai/server/novada-mcp) — supports Claude Desktop, Cursor, VS Code, Windsurf, and more.

```bash
npx -y @smithery/cli install novada-mcp --client claude
```

<details>
<summary><strong>Cursor / VS Code / Windsurf / Claude Desktop — manual config</strong></summary>

**Cursor** — `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": { "NOVADA_API_KEY": "your-key" }
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
      "args": ["-y", "novada-mcp@latest"],
      "env": { "NOVADA_API_KEY": "your-key" }
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
      "args": ["-y", "novada-mcp@latest"],
      "env": { "NOVADA_API_KEY": "your-key" }
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
      "args": ["-y", "novada-mcp@latest"],
      "env": { "NOVADA_API_KEY": "your-key" }
    }
  }
}
```

</details>

<details>
<summary><strong>Python (subprocess)</strong></summary>

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

## Real Output Examples

### `nova search "best restaurants in Tokyo" --country jp`

```
## Search Results
results:5 | engine:google | country:jp

---

### 1. Best Restaurants in Tokyo 2025 — Michelin Guide
url: https://guide.michelin.com/en/tokyo-region/restaurants
snippet: Tokyo has more Michelin-starred restaurants than any other city in the world...

### 2. Top 10 Tokyo Restaurants — TimeOut
url: https://www.timeout.com/tokyo/restaurants/best-restaurants-in-tokyo
snippet: Sukiyabashi Jiro, Narisawa, Den — the definitive list for 2025...

---
## Agent Hints
- To read any result in full: `novada_extract` with its url
- To batch-read multiple results: `novada_extract` with `url=[url1, url2, ...]`
- For deeper multi-source research: `novada_research`
```

### `nova research "How do AI agents use web scraping?" --depth deep`

```
## Research Report
question: "How do AI agents use web scraping?"
depth:deep (auto-selected) | searches:6 | results:28 | unique_sources:12 | filtered:12/15 (3 off-topic removed)

---

## Key Findings
1. **How AI Agents Are Changing the Future of Web Scraping**
   https://medium.com/@davidfagb/...
   These agents can think, understand, and adjust to changes in web structure...

---
## Agent Hints
- 12 relevant sources found (3 off-topic removed). Extract with: `novada_extract` with url=[url1, url2]
- For more coverage: use depth='comprehensive' (8-10 searches).
```

### Map + Batch Extract Workflow

```bash
# Step 1: Discover all pages on a doc site
nova map https://docs.example.com --search "webhook" --max-depth 3

# Step 2: Batch-extract the relevant ones in one call
nova extract https://docs.example.com/webhooks/events https://docs.example.com/webhooks/retry
```

---

## Tools

### `novada_search`

Search the web via Google, Bing, DuckDuckGo, Yahoo, or Yandex. Auto-fallback: if the requested engine fails, retries with a working engine and tells you what happened.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query |
| `engine` | string | No | `"google"` | `google` `bing` `duckduckgo` `yahoo` `yandex` |
| `num` | number | No | `10` | Results count (1–20) |
| `country` | string | No | — | Country code (`us`, `jp`, `de`) |
| `language` | string | No | — | Language code (`en`, `ja`, `de`) |
| `time_range` | string | No | — | `day` `week` `month` `year` |
| `start_date` | string | No | — | Start date `YYYY-MM-DD` |
| `end_date` | string | No | — | End date `YYYY-MM-DD` |
| `include_domains` | string[] | No | — | Only return results from these domains (max 10) |
| `exclude_domains` | string[] | No | — | Exclude results from these domains (max 10) |

### `novada_extract`

Extract main content from any URL. Batch mode: up to 10 URLs in parallel. Content quality detection warns about thin pages, wrong-language content, and CAPTCHA blocks.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string \| string[] | Yes | — | URL or array of URLs (max 10) |
| `format` | string | No | `"markdown"` | `markdown` `text` `html` |
| `query` | string | No | — | Query context hint for agent-side relevance filtering |

### `novada_crawl`

Crawl a website BFS or DFS and extract content from multiple pages (up to 20). Per-page truncation metadata tells you exactly how much content was cut.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | Seed URL |
| `max_pages` | number | No | `5` | Max pages to crawl (1–20) |
| `strategy` | string | No | `"bfs"` | `bfs` (breadth-first) or `dfs` (depth-first) |
| `select_paths` | string[] | No | — | Regex patterns — only crawl matching paths |
| `exclude_paths` | string[] | No | — | Regex patterns — skip matching paths |
| `instructions` | string | No | — | Natural-language hint for which pages to prioritize |

### `novada_map`

Discover all URLs on a website without extracting content. Path-diverse queuing ensures broad coverage, not just one deep section. SPA detection included.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | Root URL |
| `search` | string | No | — | Filter discovered URLs by keyword |
| `limit` | number | No | `50` | Max URLs to return (1–100) |
| `max_depth` | number | No | `2` | BFS depth limit (1–5) |
| `include_subdomains` | boolean | No | `false` | Include subdomain URLs |

### `novada_research`

Multi-step web research with topic-anchored queries and relevance filtering. Generates 3–10 parallel searches, deduplicates sources, drops off-topic results, returns a cited report.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `question` | string | Yes | — | Research question (min 5 chars) |
| `depth` | string | No | `"auto"` | `auto` `quick` `deep` `comprehensive` |
| `focus` | string | No | — | Narrow sub-query focus (e.g. `"production use cases"`) |

---

## Prompts

Pre-built workflow templates visible in supported MCP clients (Claude Desktop, LobeChat, etc.).

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `research_topic` | Deep multi-source research with optional country and focus | `topic` (required), `country`, `focus` |
| `extract_and_summarize` | Extract one or more URLs and summarize | `urls` (required), `focus` |
| `site_audit` | Map site structure then extract and summarize key sections | `url` (required), `sections` |

---

## Resources

Read-only data agents can access via `novada://` URIs before deciding which tool to call.

| URI | Description |
|-----|-------------|
| `novada://engines` | All 5 engines with characteristics and recommended use cases |
| `novada://countries` | 195 country codes for geo-targeted search |
| `novada://guide` | Decision tree for choosing between tools and common workflow patterns |

---

## Use Cases

| Use Case | Tools | How It Works |
|----------|-------|-------------|
| **RAG pipeline** | `search` + `extract` | Search → batch-extract full text → vector DB |
| **Agentic research** | `research` | One call → multi-source cited report with relevance filtering |
| **Real-time grounding** | `search` | Facts beyond model training cutoff |
| **Competitive intelligence** | `crawl` | Crawl competitor sites → extract changes |
| **Lead generation** | `search` | Structured company/product lists |
| **SEO tracking** | `search` | Keywords across 5 engines, 195 countries |
| **Site audit** | `map` → `extract` | Discover all pages, batch-extract targets |
| **Domain-filtered research** | `search` | `include_domains` to restrict to trusted sources |
| **Trend monitoring** | `search` | `time_range=week` for recent-only results |

---

## Why Novada?

| Feature | Novada | Tavily | Firecrawl | Brave Search |
|---------|--------|--------|-----------|-------------|
| Web search | **5 engines** | 1 engine | 1 engine | 1 engine |
| Search auto-fallback | **Yes** | No | No | No |
| URL extraction | Yes | Yes | Yes | No |
| Batch extraction | **Yes (10 URLs)** | No | Yes | No |
| Content quality detection | **Yes** | No | No | No |
| Website crawling | BFS/DFS | Yes | Yes (async) | No |
| URL mapping | Yes | Yes | Yes | No |
| Multi-source research | **Relevance-filtered** | Yes | No | No |
| MCP Prompts | **3** | No | No | No |
| MCP Resources | **3** | No | No | No |
| Geo-targeting | **195 countries** | Country param | No | Country param |
| Domain filtering | **include/exclude** | No | No | No |
| Anti-bot bypass | **Proxy + Web Unblocker** | No | Headless Chrome | No |
| CLI | **`nova` command** | No | No | No |
| Agent Hints | **Dynamic, per-response** | No | No | No |

---

## Prerequisites

- **API key** — [Sign up free at novada.com](https://www.novada.com/)
- **Node.js** v18+

---

## About

[Novada](https://www.novada.com/) — web data infrastructure for developers and AI agents. 100M+ proxy IPs, 195 countries.

## License

MIT
