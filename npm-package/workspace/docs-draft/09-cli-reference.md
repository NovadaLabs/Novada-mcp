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

```bash
npm install -g novada-mcp
```

Exposes two binaries:

| Binary | Purpose |
|--------|---------|
| `novada-mcp` | Start the MCP server (stdio transport) |
| `novada` | Direct CLI for terminal usage |

### For AI agents

```bash
# Claude Code
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp

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
NOVADA_API_KEY=your_key npx novada-mcp
```

```
Novada MCP server v0.8.1 running on stdio — 39 tools loaded
```

### `novada-mcp --help`

Display server help, environment variable reference, and full tool list.

```bash
npx novada-mcp --help
```

### `novada-mcp --list-tools`

Print all available tools with one-line descriptions. Respects `NOVADA_TOOLS` and `NOVADA_GROUPS` filtering.

```bash
npx novada-mcp --list-tools
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
NOVADA_TOOLS="search,extract,crawl,map,research" npx novada-mcp

# Load by category
NOVADA_GROUPS="search,scraper" npx novada-mcp

# Combine both
NOVADA_TOOLS="verify" NOVADA_GROUPS="proxy" npx novada-mcp
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
npx novada-mcp --version

# CLI version
novada --version
```

Both print the same version number from `package.json`.
