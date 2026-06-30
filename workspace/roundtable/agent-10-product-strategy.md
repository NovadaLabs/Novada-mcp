# Agent 10 — Product & Business Strategy

**Date:** 2026-06-22
**Role:** Product & Business Strategist

---

## 1. Is "code architecture refactor" the right use of engineering time?

No. Emphatically no.

The roundtable loop just shipped 6 fixes that moved overall success from 70% to an estimated 82–85%. That is 15 percentage points of real-world reliability gain from one session of targeted fixes — not a refactor. The architecture is already working. The remaining gap is a routing problem (wrong proxy tier, missing CSS selector wait) not a structural one.

22 open KR-2 issues against 0 external users (KR-5 is past deadline) is the actual crisis. No external users means the benchmark improvements have zero revenue impact today. A pipeline refactor in this state is the textbook infra-over-revenue trap called out in CLAUDE.md. Every sprint spent on internal architecture is a sprint not spent on the one metric that unlocks everything: distribution.

---

## 2. Review aggregators — do they actually matter?

G2, Trustpilot, Capterra, Glassdoor are DataDome/Akamai-protected sites that require real residential IPs and browser fingerprint emulation to extract. They are used almost exclusively for:

- Competitor intelligence workflows (pull reviews of a rival product)
- Reputation monitoring pipelines
- Sales research (buying signals from negative reviews of incumbent tools)

These are real, recurring, agentic use cases. Marketing and sales automation teams run these workflows daily. However, they are NOT entry-level use cases. A developer evaluating Novada MCP will not test G2 extraction on day one — they will test search, extract on a news site, and basic scraping.

The 5.5pp gap vs Firecrawl on these domains is real but it is not the reason we have 0 external users. Closing it produces 0 new users by itself. It matters for retention once users are acquired, not for acquisition.

---

## 3. Does 9279ms latency matter for agent workflows?

It matters, but not the way it matters for humans.

Human web browsing at 9.3 seconds feels broken. Agent tool calls at 9.3 seconds are a different problem: they burn context window time and increase total task cost, but they do not fail. The critical threshold for agent workflows is not "feels fast" but "within the 30-second MCP tool timeout."

Novada at 9279ms P50 is inside that window. Firecrawl at 1944ms gives agents 4-5x more headroom for retries and parallel calls within a fixed token budget. That is a real quality-of-life difference for power users building complex pipelines.

However: Tavily at 399ms wins on search because it is mostly cache. Extract on Tavily is 10-30 seconds, worse than Novada. The latency comparison is misleading because Tavily's benchmark number reflects cache hits, not live fetches.

For the initial adoption decision, latency matters less than: does it work, does it cost less, and is it easy to install. Novada wins on cost (4-5x cheaper) and is competitive on reliability post-fixes. Latency is a P2 concern.

---

## 4. Product advantage of the "thick client" architecture

Firecrawl and Tavily are API-first thin clients: the intelligence lives on their servers, agents call their cloud, and the MCP wrapper is a thin shim. Novada's MCP layer IS the intelligence. This creates three hard-to-replicate advantages:

**Offline / on-premises deployment.** Enterprise customers with data residency requirements (legal, healthcare, finance) cannot send URLs to a third-party cloud. A thick client MCP that proxies through a customer's own infrastructure is the only compliant option. This is a $0 cost to implement for Novada and a structural moat that neither Firecrawl nor Tavily can match without a major architecture change.

**Credential injection at the tool level.** Multi-tenant SDK users can inject their own API keys and proxy credentials per call. Novada's architecture already supports this (ToolCredentials pattern) — thin clients cannot offer per-tenant routing without building an entirely new control plane.

**No API key required for static content.** The MCP can be shipped with zero required env vars for basic use cases. This dramatically lowers the "time to first successful tool call" — the most important conversion metric for developer tools.

---

## 5. Top 3 things that move business metrics more than a code refactor

**1. Fix the distribution blockers (1–2 days).** LobeHub listing is unclaimed (0 installs), Claude Plugin marketplace submission exists locally but has not been submitted, GitHub has 2 stars. These are free distribution points. The competitive report from 2026-04-30 identified these as P0 opportunities. None have shipped. One afternoon fixes all three and puts Novada in front of every Claude user browsing the plugin marketplace.

**2. Ship the hosted HTTP MCP endpoint (3–5 days).** The implementation path is fully documented: `StreamableHTTPServerTransport`, Express, Render.com, CNAME to `mcp.novada.ai`. Every competitor has a paste-URL install. Novada requires terminal + env var setup. This single gap blocks the largest segment of potential users — people who will not read an installation guide. The BrightData head-to-head from 2026-05-13 flagged this as a P0 adoption blocker. It is still open 6 weeks later.

**3. One published use-case guide with real output.** Not documentation — a concrete agent workflow (e.g., "competitor review monitoring with Novada + Claude") published on the GitHub README, X, and LobeHub. Developers do not buy capabilities; they copy working examples. A single high-quality example that runs end-to-end converts more users than 15 pages of API reference.

---

## 6. Recommendation: what should the next sprint be?

**Option (d): distribution, not code.**

The team just spent a full session on code quality and shipped 6 real improvements. The expected benchmark result is 82–85% success — a competitive position. More code work has diminishing returns until we have real users generating real failure reports.

The next sprint should be:
1. Re-run the benchmark to confirm 82–85% (one hour, validates the work done)
2. Submit to Claude Plugin marketplace and claim LobeHub listing (one afternoon)
3. Deploy the hosted HTTP endpoint to Render.com (three to five days, fully scoped)

The 5.5pp gap vs Firecrawl on review aggregators is a P2 item, not P1. The pipeline refactor is P3. Latency optimization is P2. The only P0 item is: get external users before KR-5 deadline damage becomes permanent.

Code quality is now good enough to ship. The bottleneck is not quality — it is reach.
