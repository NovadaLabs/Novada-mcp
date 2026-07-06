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
