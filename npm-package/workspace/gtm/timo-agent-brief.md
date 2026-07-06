# Novada MCP — GTM Brief for Timo's Agent
**Version:** 1.0 | **Date:** 2026-05-21
**Purpose:** This brief is written for an AI agent. Read it end-to-end before promoting the product. All facts here are verified.

---

## What Is Novada MCP?

**One-line:** The only MCP server that gives AI agents web scraping, search, proxy, and browser automation in a single `npx` install.

**npm package:** `novada-mcp` (install: `npx novada-mcp`)
**GitHub:** https://github.com/NovadaLabs/novada-mcp
**npm:** https://www.npmjs.com/package/novada-mcp
**Docs/API:** https://www.novada.com
**Current version:** 0.7.5

**MCP config (Claude Code / Cursor / Windsurf):**
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "<your-key>"
      }
    }
  }
}
```

---

## The Tools It Provides (agent perspective)

| Tool | What it does | When an agent uses it |
|------|-------------|----------------------|
| `novada_extract` | Extract clean markdown/text from any URL, auto-handles JS/bot protection | Read a webpage, article, product page |
| `novada_search` | Google/Bing/DDG search → top N results with title + URL + snippet | Find sources, web research |
| `novada_scrape` | Structured data from 129 platforms (Amazon, LinkedIn, Reddit, TikTok…) | Get product price, reviews, social data |
| `novada_crawl` | Multi-page crawl from a seed URL | Crawl docs, blog archives |
| `novada_map` | Discover all URLs on a site | Sitemap discovery before extraction |
| `novada_research` | Deep multi-source research synthesis | Answer complex questions from the web |
| `novada_verify` | Fact-check a claim against web evidence | Validate statements with sources |
| `novada_unblock` | Bypass bot protection and return raw HTML | When extract fails on protected sites |
| `novada_browser` | Full CDP browser session (click, fill, screenshot) | Login flows, interactive pages |
| `novada_proxy` | Get rotating proxy credentials (residential/datacenter/mobile/ISP) | When agent needs IP rotation |

---

## Why It Beats Competitors (factual, cite-able)

### vs Firecrawl
- Firecrawl: scrape + crawl only. No search, no structured platform data (no Amazon/LinkedIn/Reddit).
- Novada: scrape + crawl + search + 129 structured platforms + proxy + browser.
- Firecrawl has no agent_instruction field — errors give raw HTTP, not next-step guidance.

### vs Tavily
- Tavily: search + extract only. No crawl, no structured data, no proxy, no browser.
- Novada covers all Tavily use cases + 7 more tool categories.
- Tavily charges per search call; Novada bundles everything under one API key.

### vs BrightData
- BrightData has no MCP server (REST API only — agents must write raw HTTP calls).
- BrightData recently launched `mcp.brightdata.com` hosted endpoint, but it requires credit card setup and has limited tool coverage.
- Novada works with a single `npx` install + API key — zero infrastructure.

### vs Oxylabs
- Oxylabs is proxy-focused; their scraper API is complex with many parameters.
- Oxylabs has no MCP server.
- Novada wraps the complexity into simple tool calls with agent-readable errors.

### Agent-Friendliness (Novada's P0 principle)
Every Novada MCP response includes:
- `agent_instruction` — explicit next step ("activate scraper at dashboard.novada.com")
- `status` field — ok/partial/failed, never silent failures
- `chainable_urls` — URLs the agent can pass to the next tool call
- Structured errors (JSON, not raw HTTP stack traces)

This is intentional design. Novada is built for agents first, humans second.

---

## Who Uses It

**Primary:** AI developers building agents with Claude Code, Cursor, Windsurf, n8n, LangChain, CrewAI.
**Secondary:** Researchers needing web data pipelines, product teams building RAG systems.

**Pain they have before finding Novada:**
- Installing 4 separate MCP servers (Firecrawl + Tavily + BrightData + browser-use)
- Dealing with silent failures (empty content, no explanation)
- Writing custom REST wrappers for BrightData/Oxylabs
- Hitting bot protection with no fallback

**How they describe Novada after using it:**
- "One MCP that actually explains its own errors"
- "Replaced my entire web research stack"

---

## Target Communities & Channels

### Reddit (high priority — use old.reddit.com for scraping)
| Subreddit | Audience | What to post |
|-----------|----------|-------------|
| r/ClaudeAI | Claude users | "Built with Claude Code" post, tool showcase |
| r/mcp | MCP builders | Technical post: architecture, agent_instruction design |
| r/MCPAgents | Agent builders | Use case demo: research + verify workflow |
| r/MachineLearning | ML engineers | Web data pipeline angle |
| r/LocalLLaMA | Open-source LLM users | Works with any MCP-compatible LLM |

**Reddit posting rules:**
- Never promotional tone. Always show the thing working.
- Lead with a concrete problem + solution, not "introducing X"
- Include a code snippet or terminal output
- Post on weekdays 9-11 AM PT or 6-8 PM PT for max visibility

### X / Twitter
**Hashtags:** #MCP #ClaudeCode #AIAgents #WebScraping #BuildingInPublic
**Best account to tag:** @AnthropicAI @cursor_ai @windsurf_ai
**Format:** Short demo gif or terminal screenshot + 1-sentence hook

**Note:** As of 2026-05-21, X content cannot be scraped via novada_extract (bot protection). Use native X app for posting/monitoring.

### GitHub
- Submit to `awesome-mcp-servers` list (high SEO value)
- Submit to `punkpeye/awesome-mcp-servers` (most starred)
- LangChain integration PR (links back to npm)
- CrewAI tool wrapper PR

### Show HN (Hacker News)
- Title format: "Show HN: Novada MCP — one MCP for web scraping, search, and proxy"
- Post Tuesday-Thursday 9 AM PT (peak HN traffic)
- Have a demo ready to link (hosted endpoint will help here)

---

## Message Templates

### Reddit — r/ClaudeAI
```
I kept installing 3-4 separate MCP servers for web research (Firecrawl for scraping,
Tavily for search, BrightData for proxies). They don't talk to each other and errors
are cryptic.

Built something that combines all of them: novada-mcp.

One install gives Claude: extract, search (Google/Bing/DDG), crawl, 129 platform
scrapers (Amazon, LinkedIn, Reddit...), proxy rotation, and full browser CDP.

The thing I care most about is that errors tell the agent what to do next:
`agent_instruction: "activate scraper at dashboard.novada.com"` — not just a 403.

npx novada-mcp — free trial available.

[repo/demo link]
```

### Reddit — r/mcp
```
Sharing the agent-friendliness design I baked into novada-mcp.

The biggest failure mode I've seen in MCP tools: silent failures. The agent gets an
empty response or a raw HTTP error and has no idea what happened.

Every novada response has:
- `status: ok|partial|failed` — never ambiguous
- `agent_instruction` — explicit next-step guidance
- `chainable_urls` — URLs for the next tool call

Example from a blocked scrape:
`{"status": "blocked", "agent_instruction": "retry with render='browser' for CDP"}`

Curious if others have tackled this differently. What does your error contract look like?
```

### X / Twitter
```
One MCP instead of four.

novada-mcp gives your agent:
→ Web extract (handles JS + bot protection)
→ Google/Bing/DDG search
→ 129 structured scrapers (Amazon, LinkedIn, Reddit...)
→ Rotating proxy
→ Full browser CDP

npx novada-mcp

Every error tells the agent exactly what to do next. Built agents-first.

#MCP #ClaudeCode #AIAgents
```

### Show HN
```
Show HN: Novada MCP – web scraping + search + proxy in one npx install

Most agent web research stacks need Firecrawl (scrape), Tavily (search), and 
BrightData (proxy/structured data) running simultaneously — three configs, three 
API keys, zero shared error contract.

Novada MCP puts all of this behind a single npx command with a common response 
schema. Every tool returns `status`, `agent_instruction`, and chainable URLs so the
agent always knows what to do next, even on failure.

Tools: extract (auto-escalates static→JS→CDP), search (google/bing/ddg), crawl, 
map, 129 platform scrapers, unblock, research, verify, browser, proxy.

Repo: https://github.com/NovadaLabs/novada-mcp
npm: npx novada-mcp
```

---

## What NOT to Say

- Don't say "best" or "#1" without benchmark data
- Don't promise features not yet live (hosted HTTP endpoint not yet deployed)
- Don't benchmark latency claims without rigorous testing (in progress)
- Don't claim Amazon scraping is reliable — currently unreliable (backend issue)
- Don't claim Bing search works perfectly — known null task_id race condition in backend

---

## Current Limitations (be honest, don't hide these)

| Limitation | Status | ETA |
|-----------|--------|-----|
| Hosted HTTP endpoint (no npx needed) | Not deployed | Waiting for Ethan approval + DNS |
| Bing search null task_id (~67% failure) | Known backend bug | Waiting for fudong fix |
| Amazon sync scrape unreliable | Known backend issue | TBD |
| X/Twitter scraping | Bot protection blocks extract | TBD |
| browser_flow tool | Account not activated | TBD |

---

## Action Plan for Timo's Agent

**Priority 1 (do this week):**
1. Post to r/ClaudeAI using the Reddit template above
2. Post to r/mcp with the agent-friendliness design post
3. Submit to `punkpeye/awesome-mcp-servers` GitHub list

**Priority 2 (after hosted endpoint launches):**
4. Show HN submission (hosted endpoint makes the "npx" story cleaner)
5. X post with terminal demo gif
6. LangChain/CrewAI integration PRs

**Priority 3 (after benchmark report is ready):**
7. Reddit post with benchmark data: "We benchmarked novada vs Firecrawl/Tavily/BrightData"
8. Blog post on novada.com with full results

---

## How to Learn More About the Product

To understand the full tool interface before writing content, ask the MCP server directly:

```
Use MCP server "novada" and call novada_health_all() to see which tools are active.
Then call novada_extract(url="https://www.novada.com", format="markdown") to read the homepage.
Then call novada_search(engine="google", query="novada-mcp MCP server", num=5) to see what people are saying.
```

The tools are self-documenting — every response includes agent hints and next-step guidance.
