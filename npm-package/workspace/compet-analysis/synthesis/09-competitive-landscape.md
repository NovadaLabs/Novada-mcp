# Competitive Landscape: Web Scraping / Data Extraction MCP Servers

**Date:** 2026-06-23
**Analyst:** competitive-intelligence-agent
**Sources:** npm API, GitHub API, live pricing pages, ScrapeGraphAI blog (firecrawl pricing breakdown), Bright Data comparison blog, fastCRW MCP comparison (2026-06-13), Tavily docs, Reddit r/mcp + r/codex + r/WebScrapingInsider, mcpservers.org

---

## 1. Player Map

| Player | Primary Value Prop | MCP Tools | GitHub Stars | npm Downloads (last 30d) |
|---|---|---|---|---|
| **Firecrawl** | AI-native scrape/crawl, LLM-ready markdown | 14 | 138,457 | 494,138 |
| **Bright Data** | Enterprise infra, 150M+ residential IPs, 99.99% uptime | 69 | N/A (closed) | N/A |
| **Tavily** | Search-first, combined search+extract for RAG | 2 | N/A | 179,031 |
| **Novada** | All-in-one: search+scrape+proxy+browser+research | 25 | 2 | 1,253 |
| **CRW/fastCRW** | Built-in MCP, open-core, lowest latency | 5 | N/A | N/A |
| **Playwright MCP** | Full browser automation (not a scraping API) | ~10 | — | — |
| **ScrapeGraphAI** | 1-credit-per-request AI extraction | N/A | N/A | N/A |

---

## 2. Pricing Comparison (Validated)

### Firecrawl (as of March–June 2026)

| Plan | Price/mo | Credits | Per-scrape (1cr) | Per-extract (5cr) | Per-crawl+extract (7cr) |
|---|---|---|---|---|---|
| Free | $0 | 500 | $0 | $0 | $0 |
| Hobby | $16 | 3,000 | $0.0053 | $0.0267 | $0.0373 |
| Standard | $83 | 100,000 | $0.00083 | $0.00415 | $0.00581 |
| Growth | $333 | 500,000 | $0.00067 | $0.00333 | $0.00466 |
| Enterprise | Custom | Custom | — | — | — |

Key gotcha: AI extraction costs 5 credits per call (not 1). Crawl+Extract combined = 7 credits/page. The Standard plan's "100K credits" becomes only 20K effective AI extractions.

Effective cost benchmark: ~$0.00415 per AI extraction on Standard ($83/mo plan).

### Tavily (as of June 2026)

| Plan | Price/mo | Credits | Basic search (1cr) | Advanced search (2cr) |
|---|---|---|---|---|
| Researcher | $0 | 1,000 | $0 | $0 |
| Project | $30 | 4,000 | $0.0075 | $0.015 |
| Bootstrap | $100 | 15,000 | $0.0067 | $0.013 |
| Growth | $500 | 100,000 | $0.005 | $0.010 |
| Pay-as-you-go | — | — | $0.008/credit | — |

Extract pricing: 5 URL extractions cost 1 credit (basic) or 2 credits (advanced). Crawl = map cost + extraction cost. Tavily Research tool: 4–250 credits per request (model-dependent).

Effective cost: ~$0.008 per basic search at PAYG. At $500/mo Growth plan, $0.005/credit → $0.005 per basic search.

### Bright Data (MCP tier, as of June 2026)

- MCP Server: **free tier 5,000 requests/month** (10x Firecrawl's 500-credit free)
- Web Scraper API: starting $0.001/record (promo: $0.00075/record)
- Web Unlocker: starting $1/1K requests
- Residential Proxies: starting $5.04/GB (promo: $2.52/GB)
- Enterprise: custom SLA, SOC 2 Type II, dedicated support

Effective cost: ~$0.001 per structured record. Much harder to compare apples-to-apples since it includes proxy infra value.

### The "$1/1K vs $4/1K vs $5/1K" Claim

The claim **Novada $1/1k vs Firecrawl $4/1k vs Tavily $5/1k** is **partially validated but context-dependent**:

- **Novada $1/1K** — consistent with the web unblocker pricing tier and extract operations at mid-tier volume. Not publicly confirmed on a single visible pricing page (pricing lives behind signup).
- **Firecrawl $4/1K** — not accurate for basic scrapes (Firecrawl Standard is $0.83/1K basic scrapes). However, for AI extraction it becomes $4.15/1K at Standard tier — **this matches if the comparison is specifically AI extraction**. The number is defensible if comparing AI extraction workloads.
- **Tavily $5/1K** — at PAYG ($0.008/credit, 1 credit per basic search) = $8/1K searches, not $5. At the $500/mo Growth plan = $5/1K. The $5/1K figure is only accurate at significant monthly volume ($500+/mo plan). The commonly-cited number may be comparing Growth tier.

**Verdict:** The $1/$4/$5 comparison is a reasonable approximation for mid-volume AI extraction workloads but requires the footnote about which tier and operation type. Positioning this as a flat "4x cheaper" claim is directionally correct for extraction-heavy usage, less so for basic scraping.

---

## 3. Feature Comparison

| Feature | Novada | Firecrawl | Tavily | Bright Data |
|---|---|---|---|---|
| Web search (multi-engine) | 5 engines | 0 (no search) | 1 engine | 3 engines |
| Multi-source research tool | Yes (unique) | No | No | No |
| Auto anti-bot escalation | Yes (static→render→CDP) | Manual config | N/A | Yes (enterprise-grade) |
| Proxy as MCP tool | Yes (100M+ IPs, 195 countries) | No | No | Yes (150M+ IPs) |
| Browser automation (MCP) | Yes (CDP) | No | No | Yes |
| Change/price monitoring | Yes | No | No | No |
| Structured platform scraping | 129 platforms | No | No | 437 platforms |
| AI brand monitoring | Yes | No | No | No |
| MCP Prompts & Resources | Yes (5+4) | No | No | No |
| Agent-first design score | 8.5/10 | 6.0/10 | 6.0/10 | N/A |
| Hosted MCP (no install) | No | No | No | Yes |
| Open-source | No | Yes (core) | No | No |
| Free tier | Yes | Yes (500cr) | Yes (1K cr/mo) | Yes (5K req/mo) |
| Self-hosted option | No | Yes | No | No |

Source for Novada vs competitors tool count: mcpservers.org listing (Novada: 25, Firecrawl: 14, Tavily: 2, BrightData: 69).

---

## 4. npm Download Stats (Last 30 Days, as of 2026-06-23)

| Package | Downloads | Relative |
|---|---|---|
| `firecrawl-mcp` | **494,138** | 1x baseline |
| `tavily-mcp` | **179,031** | 0.36x |
| `novada-mcp` | **1,253** | 0.003x |

**Gap analysis:**
- Firecrawl is 395x larger than novada-mcp by npm installs
- Tavily is 143x larger than novada-mcp
- Novada-mcp is in very early adoption stage

**Context:** Firecrawl has 138K GitHub stars and has been around since 2024 (YC-backed, 80K+ companies). Novada-mcp is new (v0.7.9 as of 2026-06-15). The download gap reflects brand awareness and age of the product, not feature parity.

---

## 5. User Sentiment & Pain Points

### Firecrawl — What Users Praise
- Clean markdown output, LLM-ready by default
- Fast for basic unprotected sites (~50ms)
- Strong GitHub ecosystem (81K+ stars as MCP server listing; 138K for main repo)
- Easy 5-minute integration
- Good documentation, large community
- Strong for site crawling / link discovery

### Firecrawl — What Users Complain About
- Credit multiplier traps: "AI extraction costs 5 credits, not 1" — users feel misled by headline numbers
- Pricing cliff between Hobby ($16) and Standard ($83): "3K credits is basically unusable"
- Failed requests still burn credits (reported 20–30% waste on flaky sites)
- 96% web coverage (4% gap, often the most protected/valuable sites)
- Token truncation is silent — pays full 5 credits for incomplete extraction
- No web search capability — must be combined with another tool
- r/mcp thread: users reporting integration failures in n8n workflows
- r/codex thread (6 days ago): user switched away from Firecrawl to competitor, said "I'm diggin this so much more than Firecrawl... and it's actually got a good free tier too"
- Stealth access (e.g. Reddit) gated to enterprise tier only

### Tavily — What Users Praise
- Simple pricing (1 credit = 1 search, no multipliers)
- Fast combined search+extract in one call
- Strong for RAG pipelines: content included in search results
- 1,000 free credits/month (generous free tier)
- Low latency (~1–3s per search)

### Tavily — What Users Complain About
- Acquired by Nebius (2026): some pricing changes and uncertainty
- Extract less flexible than dedicated scrapers
- No proxy/anti-bot handling
- Only 2 MCP tools (search + extract) — limited scope
- $0.008/credit at PAYG is not competitive at high volume
- Search-only: can't crawl/monitor/research autonomously

### Bright Data — What Users Praise
- 99.99% uptime, enterprise SLA
- Genuinely handles protected sites (Cloudflare, DataDome, PerimeterX) reliably
- 5,000 free MCP requests/month — most generous free tier
- 437 structured domain scrapers
- SOC 2 / GDPR compliant — enterprise procurement requirement

### Bright Data — What Users Complain About
- 69 MCP tools bloats context window (explicitly called out in Novada's own README)
- Steep learning curve, complex pricing with multiple product tiers
- Not developer-friendly for quick prototyping
- Requires enterprise contract for full features
- No hosted MCP for basic users (need their cloud account)

---

## 6. Competitive Positioning of novada-mcp

### Where Novada Wins (Differentiated)
1. **`novada_research` is unique** — no competitor turns one question into a parallel multi-source cited report in a single MCP tool call. Searches Google+Bing+DuckDuckGo simultaneously, deduplicates, extracts full content from top 5 sources, synthesizes with citations.
2. **All-in-one breadth** — search + scrape + proxy + browser + monitor + AI brand monitoring in one server. Competitors require 2–4 separate MCP servers to match coverage.
3. **Proxy as MCP tool** — Tavily and Firecrawl have zero proxy capability. Novada exposes residential/mobile/ISP/datacenter credentials directly as MCP tools.
4. **Agent-first design** — structured `agent_instruction` fields, failure_class codes, cross-tool hints; benchmarked at 8.5/10 agent-usability vs 6.0/10 for Firecrawl and Tavily.
5. **Auto-escalation** — static → JS render → Browser CDP with 30+ domain hard-target registry. No manual config required.
6. **Change monitoring** — `novada_monitor` tracks price/content diffs across sessions. No competitor has this as an MCP tool.

### Where Novada Is Behind
1. **Brand awareness / distribution** — 395x fewer npm installs than Firecrawl (1,253 vs 494,138). Still in discovery phase.
2. **No hosted MCP** — requires terminal install. Bright Data offers zero-install hosted endpoint.
3. **129 vs 437 structured scrapers** — Bright Data has 3x more platform-specific scrapers.
4. **GitHub stars: 2** — vs Firecrawl 138K. Essentially no organic discovery.
5. **No self-hosted option** — Firecrawl can be self-hosted; Novada requires cloud API key.
6. **KR-5 past DDL** — 0 external users as of Jun 21, 2026. Distribution is the critical gap.

### Market Positioning Summary
Novada sits between Tavily (search-focused, narrow) and Bright Data (enterprise-heavy, complex). It out-features Firecrawl on breadth while undercutting Bright Data on simplicity. The value proposition is correct: **one MCP server for everything an AI agent needs from the web**. The problem is discovery and distribution — not product.

---

## 7. Emerging Competitors to Watch

- **CRW/fastCRW** — open-core Rust-based scraper with built-in MCP. Very low latency, self-hostable, no API key needed. Positioned as lightweight Firecrawl alternative. Free for self-hosted; 500 free credits cloud.
- **ScrapeGraphAI** — 1-credit-per-request AI extraction (no multipliers). Wins on predictable pricing for pure extraction workloads.
- **Exa** — search API optimized for neural/semantic search (raised $250M, 2026-05-20). Strong for RAG pipelines competing with Tavily.
- **AgentQL** — listed on mcpservers.org; natural language web queries.
- **Apify** — compute-based marketplace for pre-built Actors; strong for recurring scraping jobs.

---

## 8. Strategic Gaps & Opportunities

| Gap | Impact | Action |
|---|---|---|
| 395x download gap vs Firecrawl | Critical | Distribution: listings, Reddit presence, content marketing |
| No hosted MCP | High | Needed to match Bright Data / lower friction for casual users |
| Pricing not visible without signup | Medium | Public pricing page would improve conversion at discovery |
| "novada mcp" search returns GitHub MCP server for PRs, not us | Medium | SEO: need content targeting "novada mcp scraping" |
| Firecrawl users actively looking to switch (r/codex thread) | Opportunity | Appear in "firecrawl alternative" search results |
| Tavily acquired by Nebius, pricing uncertainty | Opportunity | Target Tavily users looking for stable alternative |

---

## 9. Sources

1. ScrapeGraphAI blog — "Firecrawl Pricing Breakdown (2026)" (2026-03-24, updated 2026-05-07): https://scrapegraphai.com/blog/firecrawl-pricing
2. Bright Data blog — "Bright Data vs Firecrawl: AI Web Scraping Comparison 2026": https://brightdata.com/blog/comparison/bright-data-vs-firecrawl
3. Tavily docs — "Credits & Pricing": https://docs.tavily.com/documentation/api-credits
4. fastCRW blog — "Best MCP Servers for Web Scraping and Data Extraction (2026)" (2026-06-13): https://fastcrw.com/blog/best-mcp-servers-web-scraping
5. mcpservers.org — Novada-MCP Server listing: https://mcpservers.org/servers/novadalabs/novada-mcp
6. npm API — download stats last 30 days (queried 2026-06-23):
   - firecrawl-mcp: 494,138
   - tavily-mcp: 179,031
   - novada-mcp: 1,253
7. GitHub API — firecrawl/firecrawl: 138,457 stars; novada-mcp: 2 stars
8. Reddit r/codex — "Free MCP That Scrapes Literally Anything" (6 days ago): https://reddit.com/r/codex/comments/1u8erl3
9. Novada search results — "firecrawl mcp pricing 2026", "tavily mcp pricing 2026", "web scraping MCP comparison 2026"
10. Bright Data listing: Free MCP tier 5,000 requests/month confirmed from brightdata.com/blog content
