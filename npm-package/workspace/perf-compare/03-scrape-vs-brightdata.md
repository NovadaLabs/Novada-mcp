# Novada Structured Scraping vs Bright Data — Performance Comparison

**Date:** 2026-06-25
**Method:** 3 platform scrapes (Google SERP, YouTube, Amazon), limit=3, JSON format, sequential
**Bright Data baseline:** 700+ scrapers, 69 MCP tools, session_stats tracking, zone-based auth

## Raw Results

| # | Platform | Operation | Latency | Payload | Status |
|---|----------|-----------|---------|---------|--------|
| 1 | Google SERP | google_search | 3365ms | 8193ch | OK |
| 2 | YouTube | youtube_video-post-keyword | 11243ms | 22362ch | OK |
| 3 | Amazon | amazon_product_keywords | 73718ms | 74849ch | OK |

Re-test (Google SERP, cold): **3284ms** — consistent within 2.5% variance.

## Architecture Comparison

| Dimension | Novada | Bright Data | Notes |
|-----------|--------|-------------|-------|
| **Scrapers** | 129 platforms | 700+ scrapers | BD has 5.4x more platform coverage |
| **MCP tools** | 35 tools | 69 tools | BD has 2x more tools (many are zone/session mgmt) |
| **API keys** | 1 key for everything | Multiple zone-specific keys | Novada simpler to configure |
| **Auth model** | Single API key | Zone + username + password per product | BD requires per-zone credentials |
| **Pricing** | ~$1/1k requests | Varies by zone ($5-15/GB residential) | Different pricing models (per-request vs per-GB) |
| **MCP server** | Hosted (mcp.novada.com) | npm package (self-hosted) | Novada: zero infra; BD: run your own |
| **Unique capability** | novada_research (multi-source synthesis) | session_stats, zone management | Different strengths |

## Latency Breakdown

| Platform | Novada | Bright Data (estimated) | Analysis |
|----------|--------|-------------------------|----------|
| Google SERP | 3.3s | 2-4s | Comparable. Both use async scraper APIs |
| YouTube | 11.2s | 5-15s | Within range. Video metadata extraction is heavy |
| Amazon | 73.7s | 10-30s | **Novada significantly slower** |

### Amazon latency deep dive

The 73.7s Amazon latency is an outlier. Breakdown (estimated):
| Stage | Cost |
|-------|------|
| Task submission | ~200ms |
| Queue wait | ~5-15s |
| Scraper execution (anti-bot) | ~20-40s |
| Poll intervals (5s x N) | ~15-20s cumulative |
| Result download + format | ~500ms |

The bottleneck is the async poll loop with 5s intervals. Amazon's anti-bot protection requires browser rendering + CAPTCHA solving, which is inherently slow. Bright Data's dedicated Amazon scrapers are purpose-built with pre-warmed browser pools, giving them a structural advantage on high-protection targets.

## Where Novada Loses

1. **Platform coverage.** 129 vs 700+. Bright Data covers niche platforms (real estate, travel, government) that Novada doesn't. For agents needing breadth across exotic platforms, BD wins.

2. **Heavy anti-bot targets.** Amazon at 73.7s is too slow for real-time agent workflows. BD's dedicated scrapers for Amazon/LinkedIn/Instagram are faster because they maintain warm browser pools and pre-solved CAPTCHA sessions.

3. **Granular session management.** BD exposes session_stats, zone rotation, IP stickiness per scraper. Novada's scraper is fire-and-forget with no session control. For workflows requiring IP persistence across scrape calls, BD is better.

4. **Async overhead.** Novada's submit-poll-download pattern adds polling latency (5s intervals). BD supports both sync and async, with sync being faster for small payloads.

## Where Novada Wins

1. **Single API key.** One key covers search, extract, scrape, crawl, proxy, browser, research, monitoring — 35 tools. BD requires separate zone credentials per product type. For agent integration, Novada's single-key model eliminates credential management complexity entirely.

2. **Hosted MCP endpoint.** `mcp.novada.com` — zero infrastructure. BD's MCP server runs locally via npm. For Claude Desktop / Cursor / cloud agents, hosted > self-hosted.

3. **Unified tool surface.** When a scraper fails, the agent can fall back to `novada_extract` (general extraction), `novada_unblock` (anti-bot bypass), or `novada_browser` (full CDP) — all with the same API key. BD's tools are scraper-specific with no general extraction fallback in the same MCP.

4. **novada_research has no BD equivalent.** One call runs 3-10 parallel searches across Google/Bing/DuckDuckGo, deduplicates, extracts top 5 sources, and returns a cited synthesis. BD has no research/synthesis capability — it's purely data extraction.

5. **Agent-first error handling.** Every Novada error includes `agent_instruction` telling the LLM what to do next. BD errors are raw HTTP status codes. This matters in agentic loops where the LLM needs to self-recover.

6. **Output formatting.** Novada returns markdown (agent-readable) or JSON with structured headers (`## Scrape Results`, `agent_instruction`, `## Agent Memory`). BD returns raw JSON arrays. The structured format reduces prompt engineering needed to parse results.

## Latency vs Completeness Trade-off

| Scenario | Winner | Why |
|----------|--------|-----|
| Google SERP (simple) | Tie | Both ~3s, comparable quality |
| Amazon products (anti-bot) | Bright Data | 10-30s vs 73s — BD's warm pools win |
| Multi-platform agent workflow | Novada | One key, fallback tools, error recovery |
| Research synthesis | Novada | No BD equivalent |
| Niche platform (Zillow, Airbnb) | Check coverage | Novada has both; BD has more |
| High-volume production | Bright Data | Per-GB pricing scales better at volume |
| Agent integration speed | Novada | Zero config vs zone setup |

## Verdict

Bright Data has the **deeper scraper catalog** (700+ vs 129) and **faster performance on anti-bot targets** like Amazon. For production scraping pipelines doing millions of requests across many platforms, BD's scale and speed justify the complexity.

Novada wins on **agent integration simplicity**: one API key, hosted MCP, fallback tool chain, structured error handling, and the unique `novada_research` synthesis. For AI agent workflows where the scraper is one tool among many (search + extract + scrape + proxy + browser), Novada's unified surface eliminates the multi-credential, multi-tool fragmentation that BD requires.

### Recommendation
- **Production scraping at scale (Amazon, LinkedIn, Instagram):** Bright Data. Faster, more platforms, purpose-built scrapers.
- **Agent-integrated workflows (Claude, Cursor, multi-tool chains):** Novada. Single key, hosted endpoint, fallback chain, research synthesis.
- **Hybrid:** Use Novada as the agent's default MCP, fall back to BD's API for high-volume platform-specific scraping when Novada's latency is unacceptable.
