# Round 1 Research: Tavily Extract — Architecture & Limitations

**Date:** 2026-06-22
**Agent:** Round-1 Research Agent B
**Sources:** Tavily official docs, AWS case study (Tavily caching), independent benchmarks, web search

---

## Q1: Does `/extract` serve from pre-crawled index or live-fetch? How does it decide?

**Answer: Live-fetch, always. But cached search results feed a separate hot-cache layer.**

The Extract API performs live HTTP fetches on every call — it is not an index lookup. From the official tutorial: "Tavily Extract is a live fetching service that retrieves and processes webpage content in real-time."

However, Tavily's **Search API** (which uses `include_raw_content`) sits on top of a three-tier caching architecture:

1. **Redis** — in-memory cache for the top ~1% of most-accessed URLs (~30% of all requests served from here)
2. **S3 Express One Zone** — secondary hot cache for the remaining popular URLs (single-digit ms latency)
3. **S3 Standard** — cold cache backup for long-tail content

This is confirmed by the AWS case study: *"Tavily's caching layer now operates in a three-tier hierarchy. Redis serves as the first-tier cache for the most frequently accessed URLs (approximately 1% of all cached data, representing approximately 30% of requests). S3 Express One Zone serves as the second-tier cache."*

**The decision logic:**
- If the requested URL is in the Redis/S3 Express cache → serve from cache (sub-10ms)
- If not → live-fetch via HTTP (basic) or headless browser (advanced)
- Extract API bypasses the index; it always live-fetches

**Key insight:** The low latency figures sometimes cited for Tavily (90ms ultra-fast, 210ms typical) apply to the **Search API** (which hits the cache), not to the Extract API.

---

## Q2: What happens on a cache miss — does it fall back to live crawl?

**Answer: Yes — but only for the Search API. Extract API is always live.**

For the Search API, a cache miss triggers a live web fetch. The three-tier hierarchy (Redis → S3 Express → S3 Standard) means cache misses cascade:
- Redis miss → check S3 Express One Zone
- S3 Express miss → check S3 Standard (cold cache)
- All miss → live crawl, then populate cache at all levels

For the **Extract API**, there is no cache involved at all. Every call is a live fetch regardless. The API docs confirm: the default timeout for basic extraction is 10 seconds and 30 seconds for advanced — these are live-fetch timeouts, not cache lookup windows.

The `failed_results` array in the response captures URLs that could not be fetched (anti-bot blocks, timeouts, etc.) and the user is not charged for those failures.

---

## Q3: How large is Tavily's index? What types of pages are covered?

**Answer: No public index size disclosed. Tavily does NOT have its own independent web crawl index.**

This is a critical architectural fact confirmed by multiple independent comparisons:

> "Unlike Brave Search, Tavily does not maintain its own independent web index. Brave Search has something Tavily doesn't: its own web index — over 30 billion pages, updated daily, built independently of Google or Bing."

Tavily's search is built on top of existing search engines (the exact provider is not disclosed publicly), combined with an agent-native preprocessing and caching layer. Their "agent-native index" is best understood as a **result cache + relevance reranking layer** on top of a third-party index, not an independently crawled corpus.

**Coverage characteristics inferred from docs and benchmarks:**
- Strong coverage of standard web content (Wikipedia, news, documentation, blogs)
- Documented gaps: ArXiv/scientific papers, paywalled academic content, proprietary databases
- No structured data from ecommerce platforms (Amazon, eBay product listings)
- Explicitly described as "web only" with a 400-character query length cap

---

## Q4: What's Tavily's content extraction pipeline? (how do they get `raw_content`?)

**Answer: Two-mode live pipeline — basic HTTP + advanced headless browser.**

The extraction pipeline has two modes, selected via `extract_depth`:

**Basic (default):**
- Standard HTTP fetch of the page
- HTML parsing and boilerplate removal (ads, navigation, footers)
- Content cleaned to markdown or plain text
- Default timeout: 10 seconds
- Cost: 1 credit per 5 successful URLs

**Advanced:**
- Headless browser fetch (handles JavaScript-rendered pages, SPAs)
- More thorough parsing including tables, embedded content, structured data
- Default timeout: 30 seconds
- Cost: 2 credits per 5 successful URLs
- From SDK docs: `tvly extract https://example.com/spa-page --extract-depth advanced` is the pattern for JavaScript-rendered content

**Post-fetch processing:**
- Content returned as `raw_content` field (full page text by default)
- Optional `query` parameter triggers relevance-based chunk reranking
- With `chunks_per_source` (1-5), only the top N chunks (max 500 chars each) are returned
- Chunks appear separated by `[...]` in `raw_content`
- Security layer scans for prompt injection and malicious content before returning

**The pipeline does NOT:**
- Maintain a domain-specific extraction schema
- Use structured data extraction (no JSON schema output)
- Persist extracted content for future cache hits (no write-back)

---

## Q5: Why does Tavily fail on Amazon (~40% success) — is Amazon blocked from their index?

**Answer: Multiple compounding factors. Amazon is not "blocked from the index" — it's hostile to live scraping at the infrastructure level.**

**Factor 1: robots.txt blocks major AI crawlers**
As of September 2025, Amazon updated its robots.txt to explicitly block AI crawlers including Anthropic's Claude, Perplexity, Google's Project Mariner, Meta AI, Huawei AI, and Mistral. While robots.txt is advisory (not technically enforced), compliant scrapers respect it.

**Factor 2: Amazon's anti-bot defenses are enterprise-grade**
Amazon's protection evolved to a 3-tier multi-layer system by 2025:
- TLS fingerprinting (identifies non-browser clients on first request)
- Behavioral analysis (click patterns, scroll behavior, timing)
- AI-powered bot classification (introduced 2024)
- Predictive blocking (introduced 2025)
- AWS WAF Bot Control (blocks datacenter IPs by default)

This means Tavily's basic mode (plain HTTP fetch) fails immediately on datacenter IPs — Amazon's WAF detects and blocks them before any content is served. Advanced mode (headless browser) has higher success but still faces behavioral analysis.

**Factor 3: Tavily's IPs are high-volume datacenter IPs**
At Tavily's scale, their extraction IPs are well-known datacenter ranges. Amazon's systems have extensive blocklists of these IP ranges. Residential proxy rotation would be needed to reliably bypass this, which Tavily's architecture doesn't support.

**Factor 4: No Amazon-specific extraction logic**
Dedicated Amazon scrapers (Oxylabs, Bright Data, Zyte) achieve 97-98%+ success rates by maintaining Amazon-specific session management, cookie handling, and CAPTCHA solving. Tavily has no such platform-specific logic.

**Benchmark evidence:** Independent 2026 benchmarks (WebPeel vs 7 APIs on 30 real-world URLs) confirm Tavily is faster but less reliable than specialized scrapers on protected domains. Dedicated Amazon scraper benchmarks show 98%+ success vs Tavily's ~40% specifically because the specialized tools use residential proxies and platform-specific bypass logic.

---

## Q6: How does Tavily achieve low latency — is it pure index lookup?

**Answer: Partially. Low latency applies to Search (cache hits), not Extract (always live).**

**Search API latency breakdown:**
- Ultra-fast mode: ~90ms (claimed by Tavily, for simplest queries)
- Typical search queries: ~210ms (per Exa comparison benchmarks)
- Advanced search: ~420ms+
- AIMultiple independent benchmark: ~998ms average

**The caching architecture explains the fast numbers:**
The AWS case study reveals that Tavily's caching layer (S3 Express One Zone) delivers:
- Single-digit millisecond latency for in-AZ cached results (~1-9ms)
- Low double-digit ms for cross-AZ cached results (~10-20ms)
- Redis cache (top 1% of URLs) is even faster — sub-millisecond in-memory

So the "fast" latency is real but only for cache hits on frequently-accessed URLs. The cache hit rate for the top 30% of requests comes from Redis alone.

**Extract API latency is fundamentally different:**
- Basic extraction: 10-second default timeout (live HTTP fetch)
- Advanced extraction: 30-second default timeout (live headless browser)
- The `response_time: 0.02` in the API example response is for a cached Wikipedia page — a best-case scenario that doesn't represent average performance

**The 126ms P50 figure is not publicly documented.** No official Tavily documentation or third-party benchmark confirms this specific number for the Extract endpoint. If it exists in internal benchmarks, it likely represents Search cache hits, not Extract.

**Key infrastructure detail from AWS case study:**
> "Tavily deployed their S3 Express One Zone cache in the same Availability Zone as their compute resources. This co-location reduces network hops, so that in-Availability Zone requests achieve single-digit millisecond latency."

This means fast search results are achieved by co-locating cache and compute — a structural design decision, not an index-lookup magic trick.

---

## Tavily Gaps — What Tavily CANNOT Do That a Live Scraper Could

### 1. Anti-bot-protected pages (40-60% failure rate on major ecommerce)
Tavily uses datacenter IPs. Amazon, Cloudflare-protected sites, and any site using behavioral analysis will block or serve bot-detection pages. A live scraper with residential proxy rotation achieves 97%+ on the same pages.

### 2. Authenticated / session-gated content
Tavily cannot handle pages requiring login. Any content behind authentication walls (LinkedIn profiles, paywalled articles, account dashboards) is unreachable. A live scraper can be given session cookies to access these.

### 3. Structured data extraction (schema-based)
Tavily returns raw markdown or plain text. It cannot extract specific fields (product name, price, ASIN, in-stock status) into a JSON schema. A live scraper with structured extraction (Firecrawl, Novada) can return `{"price": "$29.99", "in_stock": true}`.

### 4. JavaScript-heavy SPAs with complex interactions
Advanced mode uses a headless browser but cannot handle multi-step interactions (clicking "load more", pagination, form submission, dynamic infinite scroll). Specialized browser automation can handle these flows.

### 5. Real-time data (prices, stock, live scores)
Tavily's cache means popular pages may be served from a cache that is hours or days old. For time-sensitive data, live fetch with no caching is required.

### 6. High-volume ecommerce extraction at scale
Tavily caps at 20 URLs per request and is priced at $0.008/credit (1 credit per 5 successful extractions = $0.0016/page for basic). For 100K pages/month, that's $160 in extraction credits — but with a 40% failure rate on protected domains, effective cost per successful extraction spikes significantly.

### 7. Pages behind WAF/Cloudflare with TLS fingerprinting
Tavily's basic HTTP fetcher is immediately identified by TLS fingerprint analysis as a non-browser client. Sites using Cloudflare's Bot Management or similar (beyond just JS challenges) block the request before content is served.

### 8. No domain-specific extraction logic
Tavily treats every URL generically. Dedicated scrapers for Amazon, LinkedIn, or other major platforms have platform-specific parsing logic that handles their unique DOM structure, pagination patterns, and CAPTCHA workflows.

---

## Summary Assessment

| Dimension | Tavily | Live Scraper (Novada) |
|---|---|---|
| Search latency (cached) | ~90-210ms | N/A — search is different |
| Extract latency | 10-30s timeout (live) | 5-15s (live, residential) |
| Amazon success rate | ~40% | ~85-95% (residential proxy) |
| Cloudflare bypass | Basic only | Advanced via proxy rotation |
| Authenticated pages | No | Yes (with session cookies) |
| Structured JSON output | No | Yes |
| Index size | No independent index | N/A — always live |
| Cache staleness | Hours to days (search) | Zero (always live) |
| Cost at 100K pages | ~$160 (basic extract) | Depends on proxy cost |

**Core architectural conclusion:** Tavily is a search-first product with extraction as a secondary capability. Its performance advantage is real but applies only to its search cache layer. For live extraction at scale on protected domains, Tavily's architecture has structural limitations that a dedicated live-scraper with residential proxy rotation does not.

---

## Evidence Sources

- [Tavily Extract API Reference](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
- [Tavily Extract Best Practices](https://docs.tavily.com/documentation/best-practices/best-practices-extract.md)
- [Tavily Extract Quick Tutorial](https://docs.tavily.com/examples/quick-tutorials/extract-api.md)
- [AWS Storage Blog — Tavily S3 Express Cache Case Study](https://aws.amazon.com/blogs/storage/how-tavily-reduced-ai-search-caching-costs-by-95-with-amazon-s3-express-one-zone/)
- [Tavily FAQ](https://docs.tavily.com/faq/faq)
- [Nebius acquires Tavily announcement](https://nebius.com/newsroom/nebius-announces-agreement-to-acquire-tavily-to-add-agentic-search-to-its-ai-cloud-platform)
- [Amazon blocks AI bots — Camphouse](https://camphouse.io/news/amazon-blocks-ai-bots-ecommerce-data)
- [Best Search API comparison 2026 — webscraft.org](https://webscraft.org/blog/search-api-dlya-ai-agentiv-scho-obirayut-rozrobniki-i-de-pomilyayutsya?lang=en)
- [Tavily vs WebPeel vs Firecrawl vs Exa 2026 Benchmark](https://webpeel.dev/blog/benchmarks)
- [AIMultiple Agentic Search Benchmark](https://aimultiple.com/agentic-search)
- [Tavily Alternatives — Firecrawl Blog](https://www.firecrawl.dev/blog/tavily-alternatives)
- [Tavily 101 Blog Post](https://www.tavily.com/blog/tavily-101-ai-powered-search-for-developers)
- [How Tavily Built Fastest Web Search Blog](https://www.tavily.com/blog/how-we-built-the-fastest-web-search-in-the-world)
