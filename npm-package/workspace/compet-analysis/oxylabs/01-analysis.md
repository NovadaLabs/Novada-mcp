# Oxylabs MCP Competitive Analysis

**Source:** `github.com/oxylabs/oxylabs-mcp` · PyPI `oxylabs-mcp`
**Date:** 2026-06-23

---

## Overview

Oxylabs MCP is a Python-based server with two distinct product lines merged into one MCP:
1. **Web Scraper API** — traditional scraper with username/password basic auth
2. **AI Studio** — a newer product with API-key-based access and AI-native tools

Both can run simultaneously if both credential sets are provided. The server dynamically hides tools when credentials for that product are absent.

---

## Architecture

- **Language:** Python, built on `fastmcp`
- **Auth:** Two separate credential systems (basic auth for scraper; API key for AI Studio)
- **Transport:** stdio + SSE + streamable-http (stateful or stateless)
- **Tool count:** 11 total (4 scraper + 7 AI Studio)
- **Also:** `oxylabs-hb-mcp` — a separate headless browser MCP using Playwright + Oxylabs CDP endpoint

---

## Tools

### Web Scraper API Tools (4)

```python
universal_scraper(url, render, user_agent_type, geo_location, output_format)
google_search_scraper(query, parse, render, user_agent_type, start_page, pages, limit,
                      domain, geo_location, locale, ad_mode, output_format)
amazon_search_scraper(query, category_id, merchant_id, currency, parse, render,
                      user_agent_type, start_page, pages, domain, geo_location, locale, output_format)
amazon_product_scraper(query, autoselect_variant, currency, parse, render, user_agent_type,
                       domain, geo_location, locale, output_format)
```

### AI Studio Tools (7)

```python
ai_scraper(url, output_format, schema, render_javascript, geo_location)
ai_crawler(url, user_prompt, output_format, schema, render_javascript,
           return_sources_limit, geo_location)
ai_browser_agent(url, task_prompt, output_format, schema, geo_location)
ai_search(query, limit, render_javascript, return_content, geo_location)
ai_map(url, search_keywords, user_prompt, max_crawl_depth, render_javascript,
       limit, geo_location, allow_subdomains, allow_external_domains)
generate_schema(user_prompt, app_name)  # Schema generator for structured extraction
```

---

## Enterprise Features

### 1. Dual-Product Credential Architecture
Oxylabs supports two independent credential systems simultaneously:
```python
OXYLABS_USERNAME / OXYLABS_PASSWORD   # Basic auth → Web Scraper API
OXYLABS_AI_STUDIO_API_KEY             # Bearer → AI Studio API
```
The server dynamically hides unavailable tools at list time via `_list_tools_mcp` override — agents only see tools they can actually use.

**What Novada lacks:** Novada has a single API key model. No multi-product credential routing.

### 2. Streamable-HTTP Transport with Per-Request Auth
When `MCP_TRANSPORT=streamable-http`, credentials are read from HTTP headers per request:
```python
# Header-based (OAuth2/proxy-friendly)
X-Oxylabs-Username: <username>
X-Oxylabs-Password: <password>
X-Oxylabs-AI-Studio-Api-Key: <key>

# Or query params (for clients that can't set custom headers)
?oxylabsUsername=X&oxylabsPassword=Y&oxylabsAiStudioApiKey=Z
```
Supports Smithery OAuth2 flow for zero-config MCP hub deployment.

**What Novada lacks:** Per-request header-based auth for multi-tenant hosted deployments.

### 3. Structured Logging via MCP Notifications
Every tool call logs to the client via `notifications/message`:
```json
{"level": "info", "data": "Create job with params: {\"url\": \"https://...\"}"}
{"level": "info", "data": "Job info: job_id=7333113830223918081 job_status=done"}
{"level": "error", "data": "Error: request to Oxylabs API failed"}
```
This is MCP-native structured logging — the client receives structured events, not just tool output. `LOG_LEVEL` env controls verbosity.

**What Novada lacks:** Novada doesn't emit MCP notification events for job lifecycle.

### 4. Parameter Design — Type-Safe Annotated Params
Oxylabs uses a centralized `url_params.py` with `Annotated[type, Field()]`:
```python
USER_AGENT_TYPE_PARAM = Annotated[
    Literal["desktop", "desktop_chrome", "desktop_firefox", "desktop_safari",
            "desktop_edge", "desktop_opera", "mobile", "mobile_ios",
            "mobile_android", "tablet"] | None,
    Field(description="Device type and browser...")
]
OUTPUT_FORMAT_PARAM = Annotated[
    Literal["links", "md", "html"] | None,
    Field(description="links — Most efficient when the goal is navigation...")
]
```
Every parameter has:
- Explicit type narrowing via `Literal[]`
- Concrete examples in descriptions
- Decision guidance embedded (e.g., "Use links first when you need to locate a specific page")

**What Novada lacks:** Some Novada params lack `Literal` type narrowing; fewer embedded agent decision hints in param descriptions.

### 5. AI Studio — Schema Generation Tool
```python
generate_schema(user_prompt, app_name: Literal["ai_crawler", "ai_scraper", "browser_agent"])
```
Agents can ask Oxylabs to generate extraction schemas before calling the actual tool:
- `"What schema should I use to extract product prices from this page?"` → returns OpenAPI-format JSON schema
- Reduces hallucinated schemas in structured extraction calls

**What Novada lacks:** No schema generation helper. Agents must construct `jsonOptions.schema` manually.

### 6. AI Browser Agent
```python
ai_browser_agent(url, task_prompt, output_format, schema, geo_location)
```
Goal-directed browser automation — agent gives a task prompt, Oxylabs AI Studio controls the browser end-to-end and returns structured data. No step-by-step tool calls needed.

Contrast with BrightData: BrightData exposes 15 browser control tools (agent controls each step). Oxylabs wraps this in a single AI-agent call.

**What Novada lacks:** No browser automation of any kind.

### 7. AI Crawler with Return-Sources Limit
```python
ai_crawler(url, user_prompt, output_format, return_sources_limit=25)
```
Crawls from a starting URL following links, extracting content guided by `user_prompt`. `return_sources_limit` caps output size (max 50).

**What Novada lacks:** `novada_crawl` exists but lacks prompt-guided extraction. No AI-directed crawl.

### 8. Site Mapper (`ai_map`)
```python
ai_map(url, search_keywords, user_prompt, max_crawl_depth=1,
       allow_subdomains, allow_external_domains, limit=25)
```
Maps URLs on a site filtered by keywords or AI prompt — useful for pre-crawl discovery.

**What Novada lacks:** `novada_map` exists and is similar, but lacks `user_prompt` AI guidance.

### 9. Headless Browser via External Playwright MCP
Oxylabs doesn't build browser tools into their main MCP. Instead they have a separate `oxylabs-hb-mcp` repo that wraps the official `@playwright/mcp` package, pointing it at Oxylabs' CDP endpoint:
```json
"@playwright/mcp@latest",
"--cdp-endpoint",
"wss://<username>:<password>@ubc.oxylabs.io"
```
This gives full Playwright MCP tool set (50+ tools) via Oxylabs' managed browser infrastructure.

**Architecture advantage:** By using `@playwright/mcp` as-is, Oxylabs gets all Playwright MCP updates automatically. BrightData maintains their own 15 browser tools.

### 10. SDK User-Agent Telemetry
```python
sdk_type = f"oxylabs-mcp-{client_name}/{version('oxylabs-mcp')} ({python_version}; {bits})"
headers["x-oxylabs-sdk"] = sdk_type
```
Tracks which MCP client is making requests (read from `clientInfo.name` in MCP session) plus SDK version and Python runtime info.

---

## Proxy Authentication Pattern

**Web Scraper API:** HTTP Basic Auth
```python
auth = BasicAuth(username=username, password=password)
```

**AI Studio:** API key via Bearer token internally

For `streamable-http` transport, credentials can be passed per-request via headers or query params rather than requiring env vars — enables multi-tenant hosted deployments.

---

## Parameter Design Comparison

Oxylabs has more granular scraping controls than Novada:

| Parameter | Oxylabs | BrightData | Novada |
|-----------|---------|------------|--------|
| Render JS | `render="html"` | automatic | `render="render"` |
| User-Agent type | 10 options via Literal | not exposed | not exposed |
| Pagination | `start_page`, `pages`, `limit` | cursor-based | not exposed |
| Parse structured | `parse=True` → returns JSON | automatic via dataset | automatic |
| Ad mode | `ad_mode=True` → google_ads source | not exposed | not exposed |
| Output format | `links/md/html` with decision guidance | markdown default | markdown default |
| Locale | `locale="en-US"` (Accept-Language) | not exposed | not exposed |
| Domain | `domain="co.uk"` | not exposed | not exposed |
| Amazon context | `category_id`, `merchant_id`, `currency` | not exposed | not exposed |

---

## Error Handling Pattern

```python
class MCPServerError(Exception):
    async def process(self) -> str:
        err = str(self)
        await get_context().error(err)  # sends to MCP notification stream
        return err                       # also returns as tool result
```
Errors are both returned as tool output AND emitted as MCP notification events simultaneously.

HTTP errors map to specific messages:
```
"HTTP error during POST request: 403 - {body}"
"Request error during POST request: {network error}"
"Oxylabs username and password must be set."
"AI Studio API key is not set"
"AI Studio API key is not valid"
```

---

## What Oxylabs Has That Novada Lacks

| Feature | Oxylabs | Novada |
|---------|---------|--------|
| Dual-product credential routing | Yes — scraper + AI Studio | No |
| Per-request header auth (streamable-http) | Yes | No |
| MCP notification events for job lifecycle | Yes | No |
| Schema generation tool | `generate_schema` | No |
| AI-directed browser agent | `ai_browser_agent` | No |
| AI-directed crawler | `ai_crawler` with prompt | Partial (`novada_crawl` no prompt) |
| User-Agent type selection (10 options) | Yes | No |
| Pagination controls | `start_page`, `pages`, `limit` | No |
| Ad-mode search (google_ads) | `ad_mode=True` | No |
| Locale header control | `locale="en-US"` | No |
| Domain-localized search | `domain="co.uk"` | No |
| Amazon context params | `category_id`, `merchant_id` | No |
| Smithery OAuth2 integration | Yes | No |
| Output format decision guidance in params | Yes — embedded in description | Partial |
| Headless browser (via Playwright MCP) | Separate repo | No |

---

## Novada Advantages

- Proxy type breadth: residential/ISP/mobile/datacenter/static/dedicated (6 types)
- Sub-account management tools
- Traffic monitoring and billing tools exposed to agents
- More proxy output formats (url/env/curl)
- Change monitoring (`novada_monitor`)
- Wallet/usage tracking
- 129-platform structured scraper vs Oxylabs' 4 core scrapers + AI Studio
- Geo-targeted proxy provisioning with city-level targeting
- Sticky sessions with explicit session IDs
- `novada_research` (multi-source synthesis)
- `novada_verify` (claim verification)

---

## Key Differentiators Summary

Oxylabs prioritizes **AI-native data extraction** (schema generation, prompt-directed crawl, AI browser agent) over **proxy infrastructure breadth**. Their AI Studio product abstracts away all the scraping complexity into goal-directed calls.

Novada's current model is stronger on the **proxy management/infrastructure side** but weaker on **AI-native extraction abstractions**. The gap Oxylabs exposes: agents using Oxylabs can describe what they want; agents using Novada must know how to ask for it step by step.
