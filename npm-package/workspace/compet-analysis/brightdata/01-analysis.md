# BrightData MCP Competitive Analysis

**Source:** `github.com/brightdata/brightdata-mcp` · npm `@brightdata/mcp@2.11.0`
**Date:** 2026-06-23

---

## Overview

BrightData positions their MCP as "The Web MCP" — a full-stack enterprise web data platform
exposed through a single MCP server. They are the market category leader.

---

## Architecture

- **Language:** Node.js (ESM), built on `fastmcp`
- **Auth:** Single `API_TOKEN` env var (Bearer token to BrightData API)
- **Transport:** stdio + hosted remote (`https://mcp.brightdata.com/mcp?token=TOKEN`)
- **Zones:** On startup, automatically checks for and creates required proxy zones (`mcp_unlocker`, `mcp_browser`) via the BrightData API. Zone creation is fully automated.
- **Tool count (Pro mode):** 60+ tools total across 11 named groups

---

## Tool Architecture

### Tiered Mode System

Three distinct tiers, controlled by env vars:

| Mode | Env | Tools Available |
|------|-----|-----------------|
| Rapid (Free) | default | `search_engine`, `scrape_as_markdown`, `discover`, batch variants |
| Pro | `PRO_MODE=true` | All 60+ tools |
| Custom | `GROUPS="ecommerce,browser"` or `TOOLS="tool_name"` | Explicit allowlist |

**Key insight:** Free tier gives 5,000 credits/month with no credit card — lowers barrier for agent developers to start. Pro mode is pay-as-you-go.

### Tool Groups

```
ecommerce    — Amazon, Walmart, eBay, HomeDepot, Zara, Etsy, BestBuy, Google Shopping
social       — LinkedIn (person/company/jobs/posts/search), Instagram, Facebook, TikTok, YouTube, Reddit, X
browser      — 15 scraping browser tools (navigate, snapshot, click, type, screenshot, scroll, network_requests)
finance      — Yahoo Finance
business     — Crunchbase, ZoomInfo, Google Maps reviews, Zillow, Booking.com
research     — GitHub repo file, Reuters news
app_stores   — Google Play, Apple App Store
travel       — Booking.com
geo          — ChatGPT/Grok/Perplexity AI insights (GEO monitoring)
code         — npm package, PyPI package (NEW — targeting coding agents)
advanced_scraping — batch ops + AI extraction via LLM sampling
```

---

## Enterprise Features

### 1. Zone-Based Proxy Architecture
BrightData uses "zones" — named proxy configurations in their backend:
- `WEB_UNLOCKER_ZONE` (default: `mcp_unlocker`) — anti-bot unlocker
- `BROWSER_ZONE` (default: `mcp_browser`) — headless browser sessions
- Auto-provisioned at startup via `ensure_required_zones()`
- Each zone is independently metered and billed
- Users can create custom zones with any name; `WEB_UNLOCKER_ZONE=my_zone` targets that zone

**What Novada lacks:** No zone concept. Single undifferentiated proxy pool.

### 2. Rate Limiting (Agent-Configurable)
```
RATE_LIMIT=100/1h   # 100 requests per hour
RATE_LIMIT=50/30m   # 50 per 30 min
RATE_LIMIT=10/1s    # per-second cap
```
Enforced in-process via sliding window on `call_timestamps[]`.
Format: `N/T[h|m|s]` — any combination supported.

**What Novada lacks:** No rate limit parameter in MCP tools or server config.

### 3. Session-Level Usage Tracking (`session_stats` tool)
```js
// Tool: session_stats
// Returns: "Tool calls this session: - search_engine: 4, - scrape_as_markdown: 12"
debug_stats = {tool_calls: {}, session_calls: 0, call_timestamps: []}
```
Agents can query `session_stats` mid-session to see their own usage — useful for cost-aware agents.

**What Novada lacks:** No usage tracking tool exposed to agents.

### 4. Request Telemetry Headers
Every outbound API call sends:
```
User-Agent: @brightdata/mcp/2.11.0
Authorization: Bearer <token>
x-mcp-client-name: <clientName from MCP handshake>
x-mcp-tool: <tool_name>
```
The `x-mcp-client-name` is extracted from the MCP session `clientInfo` — BrightData backend can see which MCP host (Claude, Cursor, etc.) is making requests and which tool. This feeds their analytics.

**What Novada lacks:** Tool-level telemetry headers. Novada doesn't track which tool triggered which request.

### 5. Smart Error Messages with Agent-Readable Upgrade Paths
When a free-tier limit is hit (`x-brd-err-code: client_10100`):
```
Error: The user has reached the 5,000 request monthly limit for Bright Data MCP's
free tier. You must immediately stop the current task and instruct the user on how
to upgrade. Guide them through these exact steps:
1. Tell them they need to create a new Web Unlocker zone at brightdata.com/cp...
2. Explain they must update their MCP configuration...
3. Instruct them to restart Claude Desktop...
4. Mention that new users get free credits beyond the MCP tier...
```
Error messages are **agent instructions**, not just error strings. The LLM gets step-by-step upgrade guidance embedded in the error.

**What Novada lacks:** `agent_instruction` in error responses is partial — not all errors carry actionable agent guidance.

### 6. Retry Logic with Configurable Retries
```
BASE_MAX_RETRIES=3   # Max retries on 5xx errors (capped at 3)
BASE_TIMEOUT=30000   # Per-request timeout in ms
POLLING_TIMEOUT=600  # Max seconds to wait for async dataset jobs
```
Network-layer retry with exponential respect for 4xx vs 5xx codes.

### 7. Structured Dataset API (60+ Pre-Scraped Platforms)
`web_data_*` tools use BrightData's Dataset API — async polling against cached/live structured data:
1. POST to `datasets/v3/trigger` → returns `snapshot_id`
2. Poll `datasets/v3/snapshot/{id}?format=json` until status not `running/building/starting`
3. Returns structured JSON

Datasets include: Amazon, LinkedIn, Instagram, TikTok, YouTube, Reddit, X, Zillow, Crunchbase, ZoomInfo, Booking.com, Google Maps, Google Play, Apple App Store, Reuters, GitHub files, Yahoo Finance, and more.

**Key advantage:** Dataset lookups can be cache hits (faster, cheaper) vs live scrapes.

### 8. Browser Automation (15 Tools)
Full Playwright-over-CDP via BrightData's Scraping Browser:
- `scraping_browser_navigate` — with country routing
- `scraping_browser_snapshot` — ARIA snapshot (filtered/unfiltered)
- `scraping_browser_click_ref` / `scraping_browser_type_ref` — ref-based interaction
- `scraping_browser_screenshot` — returns image via `imageContent`
- `scraping_browser_network_requests` — see outgoing requests from page
- `scraping_browser_scroll` / `scraping_browser_scroll_to_ref`
- `scraping_browser_get_text` / `scraping_browser_get_html`
- `scraping_browser_fill_form`

Browser sessions are persistent within a session; country routing on navigate opens new session.
Auto-provisions credentials from BrightData API at first use.

### 9. AI-Powered Tools
- `extract` — scrape + LLM sampling to structured JSON (uses `session.requestSampling`)
- `discover` — async web search ranked by AI relevance (polling with `task_id`)
- GEO tools — query ChatGPT/Grok/Perplexity directly and get structured markdown responses

### 10. Agent Prompts (MCP Prompts API)
Two prompts registered via `server.addPrompts()`:
1. `web_scraping_strategy` — Decision tree: `web_data_* → scrape_as_markdown → browser`
2. `diagnose_scraping_approach` — Two-step diagnostic for new sites

These are callable by agents to get tool selection guidance embedded in the protocol.

**What Novada lacks:** No MCP prompts registered.

### 11. Hosted Remote MCP
```
https://mcp.brightdata.com/mcp?token=YOUR_API_TOKEN_HERE
```
Zero-install option. Directly usable in Claude Desktop connectors without `npx`.

---

## Proxy Authentication Pattern

Auth is purely token-based:
```
API_TOKEN=<brightdata_api_token>
```
Browser sessions dynamically fetch credentials from BrightData API:
```js
GET https://api.brightdata.com/zone/passwords?zone=mcp_browser
→ password = response.data.passwords[0]
→ CDPendpoint = wss://brd-customer-{customer}-zone-{browser_zone}-country-{country}:{password}@brd.superproxy.io:9222
```
Customer ID fetched from `GET https://api.brightdata.com/status`.

---

## Error Message Patterns

```
// Free tier exhausted (actionable agent instruction)
"The user has reached the 5,000 request monthly limit..."

// HTTP errors
"HTTP 403: <response body>"
"HTTP 429: <response body>"

// Zone not found
"Browser zone 'mcp_browser' does not exist"

// Browser credential fetch
"Error retrieving browser credentials: <message>"

// Missing token
"Cannot run MCP server without API_TOKEN env"

// Rate limit
"Rate limit exceeded: 100/1h"

// Discover/dataset timeout
"Timeout after 600 seconds waiting for data"
```

---

## What BrightData Has That Novada Lacks

| Feature | BrightData | Novada |
|---------|-----------|--------|
| Zone-based proxy management | Yes — named zones, auto-provisioned | No — undifferentiated |
| Agent-configurable rate limits | `RATE_LIMIT=100/1h` | No |
| In-session usage tracking | `session_stats` tool | No |
| Per-tool telemetry headers | `x-mcp-client-name`, `x-mcp-tool` | No |
| Agent-readable error upgrade paths | Embedded step-by-step in error | Partial |
| Pre-scraped dataset API (60+ platforms) | Yes | Limited (novada_scrape with 129 platforms but different model) |
| Browser automation (15 tools) | Full Playwright-over-CDP | No |
| AI-powered extraction (LLM sampling) | `extract` tool | No |
| AI brand visibility monitoring | ChatGPT/Grok/Perplexity insights tools | No |
| MCP prompts for agent guidance | 2 decision-tree prompts | No |
| Hosted remote MCP endpoint | `https://mcp.brightdata.com/mcp` | No |
| Free tier (no credit card) | 5,000 credits/month | No |
| Geo-targeted requests per tool | `geo_location` param on every tool | Yes (country param) |
| Batch operations | `search_engine_batch`, `scrape_batch` (up to 5) | `novada_extract` batch (up to 10) |
| Dataset search with Elasticsearch | `search_dataset` with filter trees | No |
| Progress reporting on long ops | `ctx.reportProgress` on async polls | No |

---

## Novada Advantages

- More proxy types (residential/ISP/mobile/datacenter/static/dedicated)
- Sub-account management (`novada_proxy_account_create/list`)
- Traffic consumption logs (`novada_traffic_daily`, `novada_capture_logs`)
- Wallet/billing tools for agents (`novada_wallet_balance`, `novada_wallet_usage_record`)
- More platforms in structured scraper (129 vs ~40 named datasets)
- Dedicated/static ISP proxies with sticky session guarantees
- Change monitoring (`novada_monitor`)
- Research synthesis tool (`novada_research`)
