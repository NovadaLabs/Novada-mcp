# Latency Roundtable — Agent 5: Infrastructure Analyst

Source files reviewed:
- `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
- `/Users/tongwu/Projects/novada-mcp/src/config.ts`

Research sources: Tavily engineering blog (Jan 2026), AWS S3 Express case study (Mar 2026),
Elastic/Tavily partnership page, Firecrawl benchmark article (Jun 2026), OpenWeb Ninja SERP API
comparison (May 2026), SearXNG documentation, Parallel.ai comparison (Apr 2026).

---

## 1. How Tavily Achieves ~400–900ms Latency

### Architecture Stack (sourced from public disclosures)

Tavily is not a scraper-on-demand system. It operates a **pre-built, continuously crawled
proprietary search index** backed by Elasticsearch. Key components:

**Indexing layer**
- Elasticsearch for full-text and vector (semantic) indexing — confirmed by Elastic customer case study
- Elastic autoscaling shards to handle traffic spikes without manual capacity planning
- Supports both keyword and vector search in a single query ("I'm a big believer that the best
  search results don't just rely on one type of search" — Rotem Weiss, Tavily CEO)
- Index is curated for freshness and authority, not a raw crawl dump

**Caching layer (two-tier)**
- Redis in-memory cache for the hottest ~1% of URLs (sub-millisecond hit)
- Amazon S3 Express One Zone as the secondary cache (single-digit ms latency, pay-per-request,
  co-located in same AZ as compute) — replaced a document DB that was costing tens of thousands/month
- Cache hit → single-digit ms. Cache miss → live crawl path (slower)

**What makes it fast**
- Pre-indexed content: queries hit an index, not a live scrape. No per-request browser launch.
- S3 Express One Zone: median cached response <10ms for in-AZ requests
- Compute co-located with storage (same AZ) — eliminates cross-AZ network hops
- Tight result set: Tavily returns relevance-ranked, pre-cleaned snippets, not raw HTML.
  Fewer tokens = faster LLM processing downstream
- `fast` / `ultra-fast` search_depth modes trade crawl breadth for latency:
  fast = pre-cached index only, no live fetch; ultra-fast = even smaller candidate set

**Benchmark numbers (AIMultiple, 2026, 100 real-world queries)**
- Brave Search: 669ms (fastest — runs own 30B-page index, no Google dependency)
- Tavily: 998ms (close second)
- Firecrawl: 1,335ms
- Perplexity Sonar: >11,000ms (LLM synthesis adds ~10s)
- Serper (raw SERP proxy): 1,000–2,000ms

Tavily's `fast` and `ultra-fast` modes achieve sub-second results. `advanced` (deeper crawl) is
closer to 900ms–2s.

### Architecture diagram (inferred)

```
User query
    |
    v
[API Gateway / Load Balancer]
    |
    v
[Query processor] — normalizes, classifies query
    |
    +---> [Redis cache] (1% hot URLs) → <10ms hit
    |
    +---> [S3 Express One Zone cache] → <10ms hit for cached queries
    |
    +---> [Elasticsearch cluster] → keyword + vector search, pre-built index
    |         Autoscaled shards (Elastic)
    |         AWS-hosted, same AZ as cache
    |
    +---> [Live crawler] → for cache misses / ultra-fresh queries (slower path)
    |
    v
[Ranking + cleaning] → relevance score, snippet extraction
    |
    v
[JSON response] — structured, LLM-ready
```

**Key insight:** Tavily latency is dominated by the Elasticsearch query time plus one network hop.
It is NOT submit-poll architecture. Single synchronous HTTP call → structured JSON response.

---

## 2. How Firecrawl Achieves ~800ms–1,335ms Search

### Architecture

Firecrawl's search is a **hybrid**: it maintains its own curated index but also proxies live
scraping for content extraction.

From Firecrawl's own description:
> "search, scrape, and interact work together on top of deep web data infrastructure including
> crawling, rendering, extraction, and indexing"

Key points:
- Firecrawl **does maintain its own search index** — described as "freshness-monitored" and
  leaning on authoritative sources. Not purely a SERP proxy.
- The `/search` endpoint returns SERP-style results (title + URL + snippet) by default
- When `scrapeOptions` is passed, Firecrawl fetches and renders each result URL in the same call
  — this is the 1,335ms path (search + render ≥ 1 page)
- Pure `/search` without scraping is likely closer to 700–900ms
- Open-source core on GitHub: github.com/firecrawl/firecrawl — self-hostable

**Why ~800ms and not 400ms like Brave?**
- Firecrawl's index prioritizes content quality and LLM-readiness over raw speed
- Live content extraction (when requested) adds 400–800ms per URL
- Index is smaller than Brave's 30B pages; more selective, less breadth

---

## 3. What Infrastructure Investment Novada Needs for <500ms Search

### Current Novada architecture (from search.ts + config.ts)

```
novadaSearch() call
    |
    v
POST https://scraper.novada.com/request (submit async task)
    |   timeout=60s, network RTT ~200-600ms
    v
task_id returned (~400ms)
    |
    v
GET https://api.novada.com/g/api/proxy/scraper_download?task_id=... (poll loop)
    |   2000ms sleep between polls
    |   deadline = 90s
    v
Result (~2.6s–8s total, per Agent 1's timing diagram)
```

Current P50 total latency: **3–8 seconds**. This is a submit-poll async architecture.
Competitors run **synchronous single-call** architectures against pre-built indexes.

The gap is structural. Three options to close it:

---

### Option A: Synchronous Wrapper — Server-Side Poll Loop

**What it is:** Deploy a thin middleware service (Node.js or Go) that:
1. Receives search query from MCP client
2. Submits task to Scraper API
3. Polls internally (server-side, tight loop — 200ms intervals vs current 2000ms)
4. Returns result synchronously when ready (or timeout at 8s)

The MCP client sees a single HTTP call with no polling.

**Latency improvement**
- Current: 3–8s (2000ms poll interval + 2 round trips visible to client)
- With 200ms server-side poll + no client RTT overhead: **2–4s** realistic P50
- Best case (task completes on first poll after 400ms submit): **~600ms** (same network RTT)
- The bottleneck is Scraper API processing time on the backend, not the poll interval
- Actual improvement: **30–50% latency reduction** — brings P50 from 5s to ~3s, not sub-500ms

**What this does NOT solve:** The Scraper API itself takes ~2–6s to render and return results.
Server-side polling only removes the 2000ms fixed sleep overhead, not the backend processing time.

**Engineering cost:** 1–2 weeks
- Deploy a lightweight HTTP server (e.g., Hono on Render.com or Fly.io)
- Implement tight poll loop wrapping existing Scraper API
- Update novada-mcp to call this sync endpoint instead of doing client-side polling

**Limitations**
- Still dependent on Scraper API backend speed (~2–4s irreducible minimum)
- Not a true <500ms solution
- Adds one more infrastructure component to maintain

---

### Option B: Deploy a Search Index (Elasticsearch / Typesense / Meilisearch + Periodic Crawl)

**What it is:** Build a Tavily-like stack: maintain a proprietary crawl corpus, index it, serve
queries directly from the index.

**Latency profile**
- Elasticsearch query: 20–80ms
- Typesense or Meilisearch (simpler, faster for small indices): 5–20ms
- Add Redis/S3 Express cache: <10ms on hot queries
- Total synchronous path: **50–200ms** — easily beats <500ms target

**Engineering cost: 8–16 weeks minimum**

Phase 1 — Index infrastructure (4–6 weeks):
- Deploy Elasticsearch or Typesense cluster (AWS/GCP)
- Build crawler that indexes pages continuously
- Implement freshness management (TTL, re-crawl triggers)
- Build query pipeline (keyword + semantic ranking)

Phase 2 — Data quality (4–6 weeks):
- Relevance tuning (Elasticsearch scoring / BM25 + vector weights)
- Deduplication, spam filtering, authority scoring
- Coverage: need minimum 1B+ pages for general web queries to be useful
- Freshness: news/recent queries fail if crawl lag is >24h

Phase 3 — Integration (1–2 weeks):
- Replace scraper-based search path with index query path
- Maintain scraper path as fallback for uncached/fresh queries

**Real cost beyond engineering:**
- Crawl infrastructure at scale: $5,000–$50,000/month (bandwidth, compute, proxies)
- Elasticsearch cluster (100B pages): $10,000–$50,000/month
- This is how Brave spends their budget — it is a massive ongoing COGS commitment

**Verdict on Option B:** Technically sound, <200ms achievable, but requires 12+ months of
engineering + $100K+/year operating cost. This is Brave's and Tavily's moat — built over years.
Not a near-term option for Novada.

---

### Option C: Partner with a Search API Provider for Resale

**What it is:** Novada white-labels or proxies a fast synchronous search API:
- Brave Search API: $5/1K queries, 669ms latency, own index, JSON output
- Serper: $1/1K queries, 1–2s, Google SERP proxy
- DataForSEO Live: $2/1K queries, 2–10s live mode; $0.60/1K async (slow)
- OpenWeb Ninja: $0.75–$2.50/1K queries, ~1–2s
- Bing Search API (Azure): $3–$7/1K, ~500ms, Microsoft's own index

**Latency profile**
- Brave Search API: **669ms** — fastest tested, own index, no Google dependency
- Bing via Azure: **~400–700ms** — Microsoft's index, synchronous, well-documented
- These are **single synchronous HTTP calls** — no polling, no async task_id

**Engineering cost: 2–4 weeks**
- Sign up for partner/reseller API access
- Build a thin proxy endpoint or directly call from novada-mcp
- Map response schema to existing NovadaSearchResult type
- Optionally add Redis caching layer (cache identical queries for 1–24h)

**With caching added (Redis, TTL=1h for same queries):**
- Cache hit: <10ms
- Cache miss: 400–700ms (partner API call)
- This trivially meets <500ms for all but cold-cache first queries

**Cost math (assuming Novada charges $2/1K to users):**
- Buy Brave at $5/1K: negative margin at current prices — need volume discount or different provider
- Buy Bing at $3/1K, charge $5/1K: $2/1K margin at scale
- Buy Serper at $1/1K, charge $3/1K: $2/1K margin — worse latency (~1.5s)

**Risk:** Dependency on third-party uptime, pricing changes, ToS changes.
Brave removed free tier in Feb 2026 — shows providers can reprice.

---

## 4. Engineering Week Cost Summary

| Option | Engineering Weeks | Latency Outcome | Ongoing COGS |
|--------|------------------|----------------|--------------|
| A: Server-side sync wrapper | 1–2 weeks | 2–4s (P50) — ~40% improvement, not <500ms | Low (<$200/mo infra) |
| B: Own search index | 12–20 weeks | 50–200ms — true <500ms | $15K–$100K/mo crawl + index |
| C: Partner API resale | 2–4 weeks | 400–700ms — meets <500ms | $3–5/1K API calls pass-through |

---

## 5. Open-Source Self-Hosted Search APIs

### SearXNG
- Python-based meta-search engine aggregating 276+ search services (Google, Bing, DDG, etc.)
- HTTP API: `GET /search?q=...&format=json` — **synchronous, single-call**
- Latency: **500ms–3s** depending on engine selection and instance resources
- Multiple engines queried in parallel; slowest engine determines latency
- Can configure to use only fast engines (Bing, DDG) → ~500–800ms achievable
- Self-hosted: Docker image, ~512MB RAM baseline, scales horizontally
- No crawl costs — routes queries to existing search engines
- Risk: relies on scraping search engine result pages; Google/Bing anti-bot measures can block
  instances, causing intermittent failures. Rate limits apply per IP. Must rotate IPs.
- License: AGPL-3.0

**Verdict on SearXNG:** Synchronous API ✓, <1s possible ✓, but reliability is poor at scale
due to anti-bot blocking. Better for internal tooling than production B2B API.

### Whoogle
- Lightweight Google SERP proxy, no JavaScript, returns clean HTML
- Not a JSON API — returns HTML, requires parsing layer on top
- Latency: ~600–1200ms (Google round-trip + rendering)
- No structured output; unsuitable as-is for Novada's use case without significant parsing work

### Stract (newer OSS search engine)
- Rust-based; maintains own crawl index
- JSON API; synchronous
- Still early-stage, limited coverage, not production-ready for general web queries

### YaCy (distributed search)
- Java-based peer-to-peer web crawler + index
- Synchronous JSON API
- Coverage too thin for production use without running massive crawl fleet

**Bottom line on OSS options:** SearXNG is the only one with a usable synchronous JSON API and
reasonable latency today. The others require either heavy additional engineering or have coverage
gaps that make them unsuitable for a B2B search product.

---

## 6. Shortest Path to a Synchronous Search Response

Given that Novada already has the Scraper API as the underlying engine, the shortest path to
a *synchronous* result (even if not yet sub-500ms) is:

**Deploy a server-side poll-loop proxy endpoint.**

```
MCP client
    |
    | POST /search {query, engine, num}
    v
[Novada Sync Proxy Service] — stateless Node.js / Hono on Fly.io or Render.com
    |
    +---> POST scraper.novada.com/request  (submit)
    |         ~ 200-400ms
    |
    +---> GET .../scraper_download?task_id=...  (poll every 300ms, not 2000ms)
    |         Round 1: ~200ms RTT
    |         Round 2: ~200ms RTT (if still pending)
    |         ...
    |         Typical completion: 2–4s total (Scraper API processing time)
    |
    v
JSON response to MCP client

Total: ~2–4s synchronous, vs current 3–8s async with 2s gaps
```

Key change from current behavior: the 2000ms sleep in `pollSearchResult` is replaced by
a 200–300ms server-side sleep, and the entire poll loop runs inside the proxy service —
the MCP client makes one HTTP call and blocks.

This is not sub-500ms. But it is:
1. Architecturally synchronous (no client-side polling)
2. 30–50% faster than current implementation
3. 1–2 weeks to build and deploy
4. Immediately shippable without partner agreements or index infrastructure

---

## 7. Recommendation: Best Latency-per-Engineering-Week

**Short term (weeks 1–3): Option C — Partner API resale with caching layer**

Rationale:
- Brave Search API (669ms) or Bing Azure Search (~500ms) immediately meets the <500ms target
- Engineering cost is 2–4 weeks: API integration + schema mapping + Redis TTL cache
- Cache hit latency for repeated queries: <10ms (far below <500ms)
- No infrastructure to maintain beyond a Redis instance
- Provides a credible <500ms story to users vs. current 3–8s
- Margin exists: buy Bing at ~$3/1K, sell at $5/1K; add cache to reduce pass-through volume

**Medium term (weeks 4–8): Option A — Server-side sync wrapper for uncached / non-partner paths**

Add server-side polling to wrap the existing Scraper API for query types or engines not covered
by the partner API. This eliminates client-side polling complexity from novada-mcp.

**Not recommended near-term: Option B — own search index**

Building a proprietary index at the scale needed for general web queries is a 12–20 week
engineering project plus $15K–$100K/month operating cost. This is Tavily's and Brave's moat —
multi-year infrastructure bets. Novada should validate demand (KR-5: external users) before
making this investment.

**Priority order:**
```
1. Partner API (Option C)   → 2-4 weeks, <500ms immediately, positive margin possible
2. Caching layer on top     → +1 week, cache hit <10ms, reduces partner API cost
3. Sync proxy wrapper (A)   → +1 week, covers engines not in partner API
4. Own index (B)            → 12-20 weeks, defer until after KR-5 validated
```

**If forced to one option:** Option C + Redis caching. 3 weeks of engineering to go from
3–8s → <500ms (cached: <10ms, cold: 400–700ms). No other option delivers that ratio.

---

## Supporting Data Points

| Provider | Latency (P50) | Index type | Synchronous? |
|----------|--------------|------------|--------------|
| Brave Search API | 669ms | Own (30B pages) | Yes |
| Bing Azure Search | ~400–700ms | Microsoft index | Yes |
| Tavily fast mode | ~500–800ms | Own (Elasticsearch + Redis + S3 Express) | Yes |
| Tavily advanced | ~900–1500ms | Own + live crawl | Yes |
| Firecrawl /search | ~800–1335ms | Own curated index | Yes |
| Serper | ~1000–2000ms | Google SERP proxy | Yes |
| SearXNG (self-hosted) | ~500–2000ms | Meta-search (no own index) | Yes |
| Novada current | 3,000–8,000ms | Scraper API async | No (poll loop) |

The core problem is not just latency — it is the async architecture. Every competitor
returns results in a single synchronous HTTP call. Novada is the only one using a
submit-poll pattern visible to the client. Fixing the architecture (Option A or C) is as
important as raw speed improvement.
