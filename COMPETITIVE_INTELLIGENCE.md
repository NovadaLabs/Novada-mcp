# Novada MCP — Competitive Intelligence Report
**Date:** 2026-04-24
**Prepared by:** Novada Engineering
**Sources:** GitHub releases, product blogs, live extraction via novada-mcp

---

## Executive Summary

Three MCP competitors are actively shipping in the web intelligence space:
**Bright Data** (market leader, 2.3k stars, fastest release cadence),
**Firecrawl** (developer-first, Claude official plugin, browser automation focus),
and **Oxylabs** (thin wrapper, mostly stagnant MCP, strong backend).

Novada has unique advantages none of them share — auto-escalation routing, 129-platform structured scrapers, `novada_verify`, and `novada_research`. The critical gaps are PDF extraction, persistent browser sessions, SERP availability, and distribution (Claude plugin marketplace listing).

---

## 1. Bright Data MCP

**GitHub:** `brightdata/brightdata-mcp` | Stars: **2.3k** | Latest: **v2.9.3**
**Positioning:** Enterprise-grade, all-in-one, tool sprawl (65 tools) managed via Tool Groups

### Recent Releases (Jan–Apr 2026)

| Version | Date | What Shipped |
|---------|------|-------------|
| **v2.9.3** | Apr 2026 | `code` tool group: `web_data_npm_package` + `web_data_pypi_package` — structured npm/PyPI lookups for coding agents |
| **v2.8.6** | Mar 2026 | `scrape_batch` minified markdown — strips decorative formatting, preserves links/code |
| **v2.8.5** | Feb 2026 | Geo-targeted search — `geo_location` param on `search_engine` + `search_engine_batch` |
| **v2.8.3** | Jan 2026 | `POLLING_TIMEOUT` env var, browser country targeting, batch size 10→5 for reliability |
| **v2.8.1** | Jan 2026 | `scraping_browser_fill_form` tool, tool annotations for better LLM understanding |
| **v2.8.0** | Dec 2025 | Token optimization — 30–60% reduction via markdown minification. Published benchmark table |
| **v2.7.0** | Nov 2025 | Tool Groups system — `GROUPS="browser,ecommerce"` to load only needed tools |
| **v2.6.0** | Oct 2025 | ARIA snapshot browser automation, multi-session isolation, client observability dashboard |

### Strategic Signals

- **Token optimization is their marketing story.** They published a benchmark table showing 37,500 → 14,500 tokens (61% reduction) across tool group + minification + custom tools. This is a competitive differentiator they are actively promoting.
- **Tool Groups solves the 65-tool sprawl.** Instead of loading all tools, agents configure `GROUPS="browser,ecommerce"` — only relevant tools appear. We have 10 smart tools vs their 65, but they now match our simplicity advantage.
- **MCP Evaluations Framework (mcpjam).** They built eval suites for all 8 tool groups — ecommerce, social, finance, browser, etc. Public eval framework = enterprise trust signal.
- **ARIA snapshots for browser automation** (v2.6.0). Stable semantic refs instead of brittle CSS selectors; 70% snapshot compression. More reliable than raw Playwright.
- **Coding agent tools** (v2.9.3). Direct npm/PyPI registry queries — positions them as the web intelligence layer for coding agents (Claude Code, Cursor, Windsurf).

### Where We Beat Them

| Capability | Bright Data | Novada |
|-----------|-------------|--------|
| Structured platform scrapers | 38 datasets | **129 platforms** |
| Auto-escalation routing | ✗ | **✓ (unique)** |
| Claim verification | ✗ | **✓ novada_verify** |
| Multi-source research synthesis | ✗ | **✓ novada_research** |
| Token count for same task | High (65 tools) | **Low (10 smart tools)** |

### Where They Beat Us

| Capability | Bright Data | Novada |
|-----------|-------------|--------|
| PDF extraction | ✓ | ✗ |
| Persistent browser sessions | ✓ | ✗ |
| Token benchmark (published) | ✓ | ✗ |
| GitHub stars / community | 2.3k | Early stage |
| Async webhook callbacks | ✓ | ✗ |
| MCP eval framework | ✓ | ✗ |

---

## 2. Firecrawl MCP

**GitHub:** `mendableai/firecrawl` | **Official Claude Code plugin** | Positioning: Developer-first, AI-native scraping

### Recent Launches

| Feature | What It Is | Significance |
|---------|-----------|-------------|
| **Official Claude Code Plugin** | `claude plugin install firecrawl@claude-plugins-official` — 5 slash commands in Claude | **Distribution advantage — they are in the marketplace, we are not** |
| **`/interact` endpoint** | Scrape a page then take browser actions (click, fill, navigate) in the same persistent session. NL prompts OR Playwright code. Sessions persist 10 min | Direct competitor to our browser tool — but with persistence and NL control |
| **Fire-PDF** | Rust-based PDF engine, 3.5–5.7× faster, <400ms/page, text pages skip GPU entirely | Closes a gap we don't address at all |
| **`firecrawl-agent` open source** | 2-command scaffold for a full web agent (Next.js / Express / Library template, bring your own LLM) | Developer acquisition play; open-source funnel |

### The `/interact` Endpoint — Detail

Firecrawl's most significant new capability:

```
POST /v2/scrape         → returns scrapeId + page content
POST /v2/scrape/{id}/interact → takes actions (NL or Playwright code)
DELETE /v2/scrape/{id}/interact → ends session
```

- **Named profiles** save cookies/localStorage across scrapes — stays logged in between sessions
- **Live view URLs** — embed a browser stream in your own UI (read-only or interactive human takeover)
- **Cost:** 2 credits per session minute

This enables: paginated scraping, form submission, multi-step authenticated workflows — all the things our stateless browser tool cannot do today.

### Strategic Signals

- **Claude plugin marketplace = distribution moat.** Once installed, users get `novada_extract`-equivalent functionality with zero configuration. Firecrawl is ahead in developer mindshare in the Claude ecosystem.
- **Open-sourcing the agent stack** (firecrawl-agent) is a classic developer acquisition strategy — free scaffolding that requires a paid API key.
- **SKILL.md playbooks** — domain-specific agent procedures encoded as markdown files, auto-discovered. Similar to what we'd want for `novada_research` focus areas.
- **Fire-PDF** addresses the biggest content gap in web extraction. PDFs are ubiquitous in finance, legal, academic — not having PDF support is a real limitation.

### Where We Beat Them

| Capability | Firecrawl | Novada |
|-----------|-----------|--------|
| Structured platform scrapers | ✗ | **✓ 129 platforms** |
| Residential proxies | ✗ | **✓** |
| SERP / web search | ✓ | Partial (B1 blocker) |
| Auto-escalation routing | ✗ | **✓** |
| Claim verification | ✗ | **✓** |
| Cost-aware routing | ✗ | **✓** |

### Where They Beat Us

| Capability | Firecrawl | Novada |
|-----------|-----------|--------|
| Claude plugin marketplace | **✓ official** | ✗ |
| PDF extraction | **✓ Fire-PDF** | ✗ |
| Persistent browser sessions | **✓ /interact** | ✗ |
| Open-source agent scaffold | **✓** | ✗ |

---

## 3. Oxylabs MCP

**GitHub:** `oxylabs/oxylabs-mcp` | Stars: **94** | Language: Python
**Positioning:** Enterprise proxy provider bolting MCP onto existing Web Scraper API

### Recent Activity

| Date | Activity |
|------|----------|
| Apr 23, 2026 | Dependency updates only (#53, #54) — no new features |
| Dec 2025 | AI Studio params update |
| Nov 2025 | New output types for AI Studio apps |
| Aug 2025 | Added AI Studio tools to MCP |
| Mar 2025 | MCP first launched |

### Product Updates (Blog)

- **Agent-Skills Repository** (Mar 2026) — SKILL.md playbooks to eliminate API hallucinations. Same concept as Firecrawl's Skills.
- **Web Intelligence Index** (Jan 2026) — sub-second structured search index for RAG / real-time agents
- **AI Studio** (Jul 2025) — natural language data collection UI; MCP is a thin wrapper around this
- **Headless Browser** (Feb 2026) — standalone headless browser for agents. Not yet integrated into MCP.
- **AI-generated SERP scrapers** (Aug 2025) — ChatGPT, Perplexity, Google AI Mode results

### Assessment

Oxylabs' MCP is **the weakest of the three** — low stars, minimal commits, thin wrapper around one API. Their strength (100M+ IPs, enterprise proxy infrastructure) is not meaningfully exposed through the MCP. Their AI Studio product is more interesting but disconnected from the MCP layer.

**Conclusion: Oxylabs is not an immediate competitive threat in the MCP space.** Their proxy scale could matter if they invest properly in an MCP-native product.

---

## Competitive Matrix — Full Feature View

| Feature | Bright Data | Firecrawl | Oxylabs | **Novada** |
|---------|------------|-----------|---------|------------|
| Structured platform scrapers | 38 datasets | ✗ | ✗ | **129 platforms** |
| Web search (SERP) | ✓ | ✓ | ✓ | Partial (B1 blocker) |
| JS rendering / anti-bot | ✓ | ✓ | ✓ | ✓ |
| Browser automation | ✓ (14 tools) | ✓ (/interact) | Partial | ✓ (8 actions) |
| Persistent browser sessions | ✓ | ✓ | ✗ | ✗ |
| Auto-escalation routing | ✗ | ✗ | ✗ | **✓ UNIQUE** |
| Claim verification | ✗ | ✗ | ✗ | **✓ UNIQUE** |
| Multi-source research | ✗ | ✗ | ✗ | **✓ UNIQUE** |
| Residential proxy tool | ✓ | ✗ | ✓ | ✓ |
| PDF extraction | ✓ | ✓ (Fire-PDF) | ✗ | ✗ |
| Async webhook callbacks | ✓ | ✓ | ✗ | ✗ |
| Batch URL extraction | ✓ | ✓ | ✗ | ✓ (max 10) |
| Output formats (JSON/CSV/Excel) | ✓ | Partial | ✗ | ✓ (5 formats) |
| Geo-targeted proxy | ✓ | ✗ | ✓ | ✓ |
| Token optimization (published) | ✓ (61% reduction) | ✓ | ✗ | ✗ |
| MCP eval framework | ✓ | ✗ | ✗ | ✓ (playbook.test.ts) |
| Claude plugin marketplace | ✗ | **✓ official** | ✗ | ✗ |
| Open-source agent scaffold | ✗ | **✓** | ✗ | ✗ |
| GitHub stars | 2.3k | High | 94 | Early |

---

## Priority Gaps to Close

| Gap | Competitor Pressure | Effort | Priority |
|-----|-------------------|--------|---------|
| SERP quota (B1 backend blocker) | All 3 have it | Backend only | **P0** |
| Claude plugin marketplace listing | Firecrawl is official | Low (config) | **P0** |
| PDF extraction | Bright Data + Firecrawl | Medium | **P1** |
| Persistent browser sessions | Bright Data + Firecrawl | High | **P1** |
| Publish token benchmark | Bright Data published 61% | Low (docs) | **P1** |
| Async webhook callbacks | Bright Data + Firecrawl | Medium | **P2** |
| Open-source agent scaffold | Firecrawl | Medium | **P2** |
| MCP eval framework (public) | Bright Data | Low (exists) | **P2** |

---

*Sources: GitHub releases (live extracted 2026-04-24), product blogs, direct extraction via novada-mcp.*
