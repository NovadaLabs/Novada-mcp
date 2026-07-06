# Novada Search vs Tavily — Performance Comparison

**Date:** 2026-06-25
**Method:** 5 diverse queries, sequential with 500ms spacing, Google engine, num=5
**Tavily baseline:** P50 376ms / P95 567ms (pre-indexed)

## Raw Results

| # | Query | Latency | Results |
|---|-------|---------|---------|
| 1 | best AI agent frameworks 2026 | 1910ms | 3 |
| 2 | web scraping API comparison | 1544ms | 4 |
| 3 | residential proxy pricing | 1485ms | 5 |
| 4 | python requests library tutorial | 1277ms | 4 |
| 5 | MCP server for Claude | 1530ms | 4 |

Cache hit (repeat query #1): **0ms**

## Percentile Comparison

| Metric | Novada | Tavily | Ratio |
|--------|--------|--------|-------|
| P50 | 1530ms | 376ms | 4.1x slower |
| P95 | 1910ms | 567ms | 3.4x slower |
| Cache hit | 0ms | N/A | Novada wins |
| Freshness | Live (real-time) | Pre-indexed | Novada wins |
| Result count | 3-5 per query | 5 (fixed) | Comparable |

## Analysis

### Where Novada loses
- **Cold latency is 4x slower.** Tavily pre-indexes popular queries and serves from cache. Novada hits live search engines on every uncached request. The 1.3-1.9s range is the real cost of live Google scraping through a proxy layer.

### Where Novada wins
- **Cache is instant (0ms).** Repeat queries return from in-memory cache with zero network cost. Tavily has no equivalent — every call hits their API.
- **Freshness is real-time.** Novada scrapes live SERPs. Tavily's pre-indexed results can be hours to days stale. For time-sensitive queries (news, pricing, availability), this matters.
- **No vendor lock-in on index.** Novada queries actual search engines (Google, Bing, DuckDuckGo). Results match what a human would see. Tavily's index is opaque.

### Latency breakdown (estimated)
| Stage | Cost |
|-------|------|
| Proxy routing + DNS | ~100-200ms |
| Google SERP fetch | ~800-1200ms |
| Parse + format | ~50-100ms |
| Network overhead (client-server) | ~100-200ms |

The bottleneck is Google SERP fetch time. This is structural — live search will always be slower than a pre-built index.

## Verdict

Novada search is **not competitive on raw latency** against Tavily's pre-indexed model. However, comparing them 1:1 on latency alone is misleading:

1. **Different architecture:** Tavily is a search index (like Algolia). Novada is a live search proxy (like SerpAPI). They solve different problems.
2. **Cache eliminates the gap for repeated queries.** In agent workflows where the same query fires multiple times (retry loops, multi-agent), Novada's 0ms cache makes it faster overall.
3. **Freshness guarantee.** For any query where recency matters, pre-indexed results are a liability.

### Recommendation
- For latency-critical, high-volume, repeated queries: Novada cache + warm-up strategy
- For real-time / freshness-critical queries: Novada is the correct choice regardless of latency
- For one-shot discovery queries where staleness is acceptable: Tavily wins on speed
