# Novada MCP — Competitive Intelligence v2
**Date:** 2026-04-24  
**Supersedes:** COMPETITIVE_INTELLIGENCE.md (v1, same date)  
**Focus:** Agent experience gaps, not feature lists. What do agents actually struggle with?

---

## What's New in v2

v1 covered feature parity (what each competitor has). v2 focuses on **agent experience design** — how competitors structure their MCP to help agents succeed, and where novada-mcp has gaps that cause agent failures independent of backend capability.

Research sources: R1 (MCP spec analysis), R2 (Bright Data token optimization + new entrants), R3 (9 documented agent workflow failures), A2 (audit of all 11 novada-mcp tools).

---

## 1. Agent Experience Gaps — Root Cause Analysis

### Gap 1 — Tool Selection Confusion (score impact: 2+ tools degraded)

**What A2 found:** Agents consistently pick the wrong tool because tool descriptions overlap without clear triage rules.

| Confusion pair | Agent behavior | Loss |
|----------------|---------------|------|
| `novada_unblock` vs `novada_extract(render="render")` | Agent picks unblock for all anti-bot, missing that extract auto-escalates | 2x API calls |
| `novada_scrape` — what operations exist? | Agent guesses operation names, fails on first call | 1-3 retries |
| `novada_browser` vs `novada_unblock` | Agent doesn't know when to escalate to browser | Wrong tool 30% |

**Why unblock exists:** Returns raw HTML without extraction — useful for custom DOM parsing. Extract+render returns clean text. Different use cases but descriptions are too similar.

**Fix required:** Descriptions must encode the triage decision, not just the capability.

---

### Gap 2 — Scraper Platform Opacity (score: 6/10 → fix to 9/10)

**What A2 found:** `novada_scrape` has 129 platforms but agents can't discover them.

- `operation` field says "See Novada docs for the full list" — agents can't open a browser mid-task
- Agents guess operation IDs, fail, retry with different guesses
- No MCP resource exists for platform list

**Fix required:** `novada://scraper-platforms` resource with all platforms + top operations. Reference it from the scrape description.

---

### Gap 3 — Browser Description Out of Date (quick win)

**What A2 found:** `novada_browser` description says "No state persists between calls." — this was true pre-v0.8.2. Sessions were added in v0.8.2 with `session_id` param.

Agents reading the description skip session_id entirely, creating new contexts for every call in multi-step workflows. This costs 2-3x more in connection overhead.

**Fix required:** Update description to lead with session_id.

---

### Gap 4 — Snapshot Returns HTML, Not ARIA Tree (score impact: browser at 7/10)

**What R1 found:** Bright Data v2.6.0 introduced ARIA snapshots — `page.accessibility.snapshot()` output formatted as indented YAML. This is 70% smaller than raw HTML and gives agents stable semantic refs (role + name) instead of brittle CSS selectors.

**Current novada-mcp:** `snapshot` action calls `page.content()` (raw HTML, up to 30K chars). Agents then have to parse HTML to find elements, which is slow and error-prone.

**Fix required:** Add `aria_snapshot` action using Playwright's accessibility API.

---

### Gap 5 — No Workflow Prompts for Scrape/Browser (MCP UX gap)

**What R1 found:** MCP Prompts are slash commands that inject pre-rendered workflow guides. Firecrawl has `/scrape`, `/map`, `/crawl` as slash commands with clear parameter guidance.

**Current novada-mcp:** Has 3 prompts (`research_topic`, `extract_and_summarize`, `site_audit`) but nothing for the 2 hardest tools — scrape and browser. These are exactly the tools agents struggle with most.

**Fix required:** Add `scrape_platform_data` and `browser_automation` prompts.

---

## 2. Competitor Agent Experience Update

### Bright Data v2.9.3 (current leader)

**Token optimization story (their #1 marketing differentiator):**
- `data_format: 'parsed_light'` on search → only link/title/description (~40% smaller)
- `remark` + `strip-markdown` pipeline → keeps links/code, strips headings/bold (~30% smaller)
- Null removal from JSON → variable 10-20% smaller
- **Stack all three: 37,500 → 14,500 tokens (61% reduction)**

This is a real advantage. Their benchmark table is public and cited in the developer community.

**novada-mcp response:** Our tools already produce compact output (no duplicate headings, no verbose JSON). Search output with Agent Hints is well-structured. We don't need to match their exact pipeline — our output is already agent-optimized by default.

**New capability (v2.9.3): npm/PyPI registry tools**
Direct structured queries for coding agents. Not in our scope (we focus on web intelligence, not code registries).

**ARIA snapshots (v2.6.0) — now the standard:**
Bright Data uses `page.accessibility.snapshot({ interestingOnly: false })` formatted as YAML. Stable refs instead of CSS selectors. This is now the expected standard for browser automation in MCP.

### Firecrawl (Claude plugin, developer-first)

**Distribution advantage:** `claude plugin install firecrawl@claude-plugins-official` — they are in the marketplace. We are not.

**SKILL.md playbooks:** Domain-specific agent procedures auto-discovered from `~/.claude/skills/`. Firecrawl ships scraping playbooks as SKILL.md files that guide agents through common workflows. This is the right abstraction for teaching agents how to use complex tools.

**`/interact` persistent sessions:** Scrape + interact in the same session. State (cookies, localStorage) preserved across calls. We have this with `session_id` — but we need to document it better.

### New entrants (from R2)

| Entrant | Stars | Differentiation | Relevance to us |
|---------|-------|-----------------|-----------------|
| Exa | 4300★ | Semantic search (vectors, not keywords) | Different category — we search the open web |
| Tavily | 1800★ | AI-optimized search, clean structured JSON | Good benchmark for search output quality |
| Apify | 1100★ | Actor marketplace (100+ pre-built scrapers) | Close competitor for structured platform data |

**Apify insight:** Their Actor marketplace model (community-contributed scrapers) is Bright Data's direction too (65+ dataset tools). novada-mcp's 129-platform Scraper API is already ahead — but agents don't know what platforms exist. Platform discoverability is our Achilles heel here.

### MCP Tasks spec (experimental)

**What R3 found:** `tools/call` with `task:{ttl}` returns a taskId immediately; states: working/input_required/completed/failed/cancelled.

**Client support:** Only Glama, mcpc, MCPJam currently support it. Claude Code, Claude Desktop, Cursor — NO support as of 2026-04-24.

**Decision:** Do NOT implement MCP Tasks in novada-mcp. Zero client support means zero benefit. Revisit in v1.0 if Claude Code adopts it.

---

## 3. Agent Workflow Failure Patterns (R3 findings)

9 documented failures from GitHub issues across MCP tools. Relevant to novada-mcp design:

| Pattern | Impact | novada-mcp risk |
|---------|--------|----------------|
| JSON EOF / malformed callback | Silent failure | LOW — we return strings, not streaming JSON |
| Poll-loop context burn | Agent fills context polling for completion | LOW — we don't have async tools |
| 429 hard-fail (no retry guidance) | Agent fails entire workflow | MEDIUM — our error messages could be clearer |
| CDP stale context (browser) | Error after page navigation | MEDIUM — browser.ts handles this but message is cryptic |
| Tool description too long (>1000 chars) | LLM truncates description, misuses tool | LOW — our descriptions are concise |
| Double unit confusion (ambiguous output) | Agent wrong 30% of time | LOW — we use consistent units |

**Takeaway for novada-mcp:** Our error messages on 429/503 need explicit retry guidance. Currently they say "rate limited" without telling the agent what to do next.

---

## 4. Prioritized Improvement Plan (Round 2)

### P0 — Must ship (agent-blocking gaps)

| # | Change | Files | Impact |
|---|--------|-------|--------|
| 1 | `novada://scraper-platforms` resource | `src/resources/index.ts` | High — scrape usable without docs |
| 2 | Update `novada_browser` description (session_id) | `src/index.ts` | High — agents waste API on stateless calls |
| 3 | Update `novada_scrape` description (reference resource) | `src/index.ts` | High — pairs with #1 |

### P1 — Strong improvements

| # | Change | Files | Impact |
|---|--------|-------|--------|
| 4 | `aria_snapshot` browser action | `src/tools/types.ts`, `src/tools/browser.ts` | Medium-High — stable refs, 70% smaller |
| 5 | `scrape_platform_data` + `browser_automation` prompts | `src/prompts/index.ts` | Medium — workflow discoverability |
| 6 | Operation field examples in ScrapeParamsSchema | `src/tools/types.ts` | Medium — pairs with resource |

### P2 — Nice to have (defer)

| # | Change | Notes |
|---|--------|-------|
| 7 | 429 retry guidance in error messages | Low risk, small impact |
| 8 | Claude plugin marketplace submission | Distribution, not experience |
| 9 | Token optimization benchmark table | Marketing, not code |

---

## 5. What novada-mcp Does Better (keep and amplify)

1. **Auto-escalation routing** — unique. No competitor has this. Static → render → browser is invisible complexity reduction. Emphasize in all descriptions.
2. **129-platform structured scrapers** — market-leading coverage. Just needs discoverability.
3. **`novada_verify`** — no competitor has claim verification as a dedicated tool.
4. **`novada_research`** — multi-source synthesis. Bright Data has no equivalent.
5. **Smart routing by domain** — domain registry (70+ entries) eliminates probe overhead.

---

*This document is local-only — contains competitive strategy. Do not push to public repository.*
