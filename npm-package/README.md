> **This folder IS the npm package published as `novada-mcp`** — a local stdio MCP server (`npx novada-mcp`). It lives inside the [novada-mcp monorepo](../README.md); the hosted mcp.novada.com wrapper is in [`../hosted-server/`](../hosted-server/README.md).

# Novada MCP

> One MCP server for all web data — search, extract, scrape, crawl, proxy, research, browser — 23 tools, one install, one API key.

[![npm version](https://img.shields.io/npm/v/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![npm downloads](https://img.shields.io/npm/dm/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![CI](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Get started (30 seconds)

**1. Get an API key + $10 free credits at [novada.com](https://www.novada.com)**

**2. Add the server to your MCP client:**

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

**3. Try it:**
```
novada_setup()                                          — validates your key, shows balance
novada_search({query: "Claude MCP tutorials"})          — web search
novada_extract({url: "https://example.com"})            — read any URL
novada_research({question: "how do MCP servers work?"}) — parallel multi-source research
```

> Always use `npx -y novada-mcp` (not a global install). A globally installed binary can silently shadow the package and run an old cached version.

## Tool catalog

**23 curated tools across 6 categories.** Call `novada_discover` from any MCP client to list them with descriptions.

### Content retrieval

| Tool | When to use |
|------|-------------|
| `novada_search` | Find pages by query. Engines: google (default), duckduckgo, yandex. **Bing is currently degraded — avoid it.** Supports time_range, domain filters, auto-extract on top results. |
| `novada_extract` | Read one URL or batch up to 10 in parallel. Auto-escalates: static fetch → JS render → Browser CDP. Use `fields=["price","title"]` for structured data. |
| `novada_research` | One call → 3–10 parallel searches → dedup → cited source passages. Returns extractive material for your agent to reason over, not a generated summary. |
| `novada_crawl` | Crawl up to 20 pages BFS/DFS from a root URL. Returns page bodies inline. Use `select_paths` globs to target sections. |
| `novada_map` | Discover URLs on a site (sitemap.xml first, then BFS) without fetching content. Returns up to 100 URLs. |
| `novada_site_copy` | Copy an entire docs site to disk as one .md file per page. Returns a manifest, not page bodies. |
| `novada_search_feedback` | Rate a prior `novada_search` result set to improve future ranking. |

### Scraping and verification

| Tool | When to use |
|------|-------------|
| `novada_scrape` | Structured data from 13 platform scrapers in one call: Amazon, Walmart, LinkedIn, TikTok, YouTube, Instagram, GitHub, Google, Bing, DuckDuckGo, Yandex, X, Facebook. Returns clean records (markdown/json/csv). |
| `novada_verify` | Fact-check a claim: runs 3 parallel searches (supporting, skeptical, fact-check angles) and returns a verdict — supported / unsupported / contested / insufficient_data — with a confidence signal. |
| `novada_ai_monitor` | Search indexed public pages on AI-company domains (openai.com, perplexity.ai, anthropic.com, grok.com) for brand mentions and sentiment. **Searches indexed pages only — does NOT query live AI models.** |
| `novada_monitor` | Detect page changes over time. First call sets a baseline; subsequent calls return changed/unchanged with optional field-level diffs. Session-scoped — baseline is lost on server restart. |

### Proxy

| Tool | When to use |
|------|-------------|
| `novada_proxy` | Get connection credentials for your own HTTP client. `type=residential\|isp\|datacenter\|mobile\|static\|dedicated`. Returns proxy URL, shell exports, or curl flag. Set `country` (ISO 2-letter), `city`, and `session_id` for sticky routing. **These creds are for your own HTTP client — novada_extract and novada_crawl handle proxying internally.** |

### Browser

| Tool | When to use |
|------|-------------|
| `novada_browser` | Full browser interaction: navigate, click, type, fill forms, screenshot, aria_snapshot, evaluate JS, scroll — up to 20 actions per call. Sessions persist via `session_id`. No separate setup — auto-provisioned from your API key. |
| `novada_browser_flow` | Multi-step automation via a simpler action sequence API (click/scroll/wait/type/screenshot). Use `novada_browser` for CDP-level control. |

### Account and billing

| Tool | When to use |
|------|-------------|
| `novada_account` | Balance, plan quotas, usage history, traffic stats, capture logs — all in one tool. Pass `section=summary\|balance\|usage\|plans\|traffic`. |
| `novada_proxy_account_create` | Create a proxy sub-account. WRITE operation — requires `confirm:true` after human approval. |
| `novada_proxy_account_list` | List proxy sub-accounts (paginated). |
| `novada_ip_whitelist` | Manage the proxy IP whitelist (add/list/del/remark) for Residential, Unlimited, and Static ISP products. |
| `novada_capture_apikey` | Get or reset the Capture API key. Reset requires `confirm:true`. |
| `novada_static_ip_mgmt` | Open, renew, export, or list static ISP IPs. Open and renew require `confirm:true`. |

### Health and discovery

| Tool | When to use |
|------|-------------|
| `novada_discover` | List all tools with name, description, category, and status. Call this first if you are unsure which tool to use. |
| `novada_setup` | Onboarding and API key validation. Auth-free — never errors on a missing key; guides you through getting one. Call this first on a fresh install. |
| `novada_session_stats` | Per-process usage telemetry: call counts, recent calls, uptime. In-memory, resets on server restart. |

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOVADA_API_KEY` | **Yes** | Covers search, extract, crawl, scrape, research, browser, and account tools. Get one at [novada.com](https://www.novada.com). |
| `NOVADA_BROWSER_WS` | No | Browser API WebSocket URL. Auto-provisioned from your API key if not set. |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port. Required only if you use `novada_proxy` with your own HTTP client. User/pass are auto-fetched from your API key. |
| `NOVADA_TOOLS` | No | Load specific tools only: `"search,extract,research"`. |
| `NOVADA_GROUPS` | No | Load tool groups: `"search,proxy,browser"`. Groups: search, proxy, browser, scraper, health, account. |

## Notes

- **Bing engine is currently degraded.** Use `engine="google"` (default) or `engine="duckduckgo"` for reliable results.
- **`novada_proxy` gives creds for your own HTTP client** — it does not proxy requests made through other Novada tools; those handle proxying internally.
- **`novada_browser` needs no separate setup.** The Browser API is auto-provisioned from your API key. Optionally set `NOVADA_BROWSER_WS` for faster sessions.
- **`novada_monitor` state is session-scoped.** Baselines live in memory and are lost when the server restarts. For durable monitoring, schedule calls from your own job runner and store diffs externally.
- **`novada_scrape` platform list:** Amazon, Walmart, Google, Bing, DuckDuckGo, Yandex, X/Twitter, TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub.

## Links

- API key + docs: [novada.com](https://www.novada.com)
- npm: [npmjs.com/package/novada-mcp](https://www.npmjs.com/package/novada-mcp)
- GitHub: [github.com/NovadaLabs/novada-mcp](https://github.com/NovadaLabs/novada-mcp)
- Issues: [github.com/NovadaLabs/novada-mcp/issues](https://github.com/NovadaLabs/novada-mcp/issues)

## License

MIT
