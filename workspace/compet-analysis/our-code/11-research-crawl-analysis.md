# Analysis: research, crawl, and map tools

Date: 2026-06-23

---

## novada_research

### How it works

`novadaResearch` is a two-phase pipeline:

**Phase 1 — Query generation and parallel search**

1. Resolves `depth` param (`auto` → `quick` or `deep` based on question length > 80 chars or comparison keywords).
2. Calls `generateSearchQueries` to produce 3 queries (quick) / 6 queries (deep) / 8 queries (comprehensive).
3. Fires all queries in parallel via `Promise.all`, each using `searchWithFallback` (Google primary → DDG + Bing race on failure).
4. Deduplicates results by normalized URL into a `Map<string, source>`.
5. Caps unique sources at 15.

**Phase 2 — Content extraction and synthesis**

1. Takes top 5 sources and calls `novadaExtract` on them via `Promise.allSettled` (parallel).
2. Sources that return `## Extract Failed` are demoted to snippet-only.
3. Calls `synthesizeAnswer` to build the Summary section.

### Parallel execution: yes, but incomplete

All queries run in parallel. All extractions run in parallel. However, Phase 2 only starts after Phase 1 is fully complete — there is no streaming or early-start on extraction for fast-resolving queries.

### Synthesis quality: heuristic ranking, not true NLP

`synthesizeAnswer` is keyword-overlap ranked, not semantically synthesized:

1. Strips headings from extracted content, splits into sentences, takes first 4.
2. Ranks fragments by count of question keywords found in fragment text (stop-word filtered).
3. Outputs top fragment as "Summary", fragments 2-4 as "Additional perspectives" bullets capped at 200 chars each.

This is **concatenation with light ranking**, not synthesis. It does not:
- Reconcile contradictory claims across sources
- Identify consensus vs. outlier positions
- Deduplicate overlapping information
- Draw a direct answer conclusion

The output quality depends heavily on whether extraction succeeds. If all 5 extractions fail, it falls back to snippets from search results (~150 chars each), which yields a very shallow summary.

### Sub-search count by depth

| Depth         | Query count | Notes                                    |
|---------------|-------------|------------------------------------------|
| quick         | 3           | Base + 2 domain-specific suffix variants |
| deep          | 6           | + domain[2], challenges, reddit          |
| comprehensive | 8           | + case study, 2024/2025 trends, HN       |
| auto (simple) | 3           | question < 80 chars, no comparison kw    |
| auto (complex)| 6           | otherwise resolves to deep               |

**Concern:** the query count is fixed by depth, not adaptive. A comprehensive query on a narrow technical topic wastes 5 extra searches on "reddit discussion opinions" and "hacker news discussion" that return noise. Firecrawl generates queries dynamically via LLM for each topic. Our approach is purely template-driven.

### Deduplication strategy

- Normalization via `normalizeUrl()` — strips trailing slashes, lowercases scheme/host, removes fragments.
- First-seen wins: second occurrence of same normalized URL is dropped.
- No content-level deduplication (two URLs with identical text both count as unique sources).
- Cap at 15 unique sources total, extract only top 5.

**Concern:** Taking "top 5" by insertion order (query 1 results first) is biased toward the primary query. Sources from query 3+ (domain-specific angles) may be more authoritative but are extracted last or not at all.

### Source selection strategy

Sources are ordered by insertion order into `uniqueSources` Map, which is determined by query order × result rank from the search engine. The top 5 for extraction are `sources.slice(0, 5)` — first 5 unique URLs across all queries in order.

There is no quality signal: no domain authority, no result position across multiple queries (a URL appearing in 3 queries should rank higher), no content length preview.

---

## novada_crawl

### BFS/DFS implementation

- Queue-based. BFS: `queue.shift()`. DFS: `queue.pop()`.
- Concurrency constant `CRAWL_CONCURRENCY = 3` — fetches 3 pages per batch via `Promise.all`.
- Each batch processes synchronously: batch N+1 does not start until batch N's links are discovered and enqueued.
- Link discovery filters: same `baseHostname` only (strips `www.`), `isContentLink()` filter (presumably skips assets), path regex filters via `compilePatterns`.

### Page limit enforcement

The limit is enforced at two points:
1. Batch assembly loop: `results.length + batch.length < maxPages`
2. Hard cap: `Math.min(params.max_pages ?? params.limit ?? 5, 20)`

The `maxPages = 20` hard cap is correct. However, there is a subtle issue: sparse pages (< 20 words) are skipped (`sparsePageCount++`, no push to results), but they still consume a batch slot and visit slot. This means the crawler may visit more than `maxPages` actual URLs to collect `maxPages` results. In a JS-heavy site where many pages are sparse, you could visit 40+ URLs and produce 5 results.

### Pagination and infinite scroll

Neither is handled. The crawler only follows `<a href>` links extracted from static HTML (via `extractLinks`). Infinite scroll pages (React virtualized lists, Twitter-style feeds) will yield only the initial viewport content. Pagination via JS click events is not discovered.

This is a fundamental limitation: for SPAs using client-side routing, `extractLinks` returns at most the links rendered in the initial HTML response, which is often just the shell.

### Auto-detection of JS-heavy pages

There is a render auto-detection path: if `renderMode === "auto"` and first batch contains JS-heavy pages (detected via `detectJsHeavyContent`), the crawler re-fetches those pages with render enabled and sets `renderDetected = true` for all subsequent batches.

Weakness: detection only fires on the **first batch**. If the first 3 pages are static (e.g., a blog index that is server-rendered) but subsequent pages are JS-rendered SPAs, `renderDetected` stays false for the rest of the crawl.

### Memory/resource concerns at 20 pages

- Content per page is capped at 3000 chars via `extractMainContent(html, url, 3000)`.
- Total crawl output is capped at 25,000 chars, with per-page truncation applied proportionally.
- The URL queue is unbounded — for a site with thousands of links, the queue grows unchecked. At 20 pages, discovered links can easily be 200-500 entries in memory with no eviction.
- Each page fetch holds the raw HTML string in memory until content extraction completes. With CRAWL_CONCURRENCY = 3 and JS render fetches potentially returning 500KB+ HTML, peak memory can spike to several MB.
- No timeout on total crawl duration. A slow site can hold the crawl open indefinitely if each page fetch takes the full `TIMEOUTS.CRAWL_STATIC` value.

---

## novada_map

### Discovery strategy

Two-phase with sitemap-first:

1. Checks `robots.txt` for `Sitemap:` directives, then falls back to `/sitemap.xml` and `/sitemap_index.xml`.
2. If sitemap found: parses `<loc>` tags. Handles sitemap index by recursing into up to 5 child sitemaps.
3. If no sitemap: parallel BFS crawl with `CONCURRENCY = 5`, `max_depth` capped at 5 (default 2).

BFS crawl has path prefix diversity cap: `MAX_PER_PREFIX = max(3, floor(maxUrls/5))`. This prevents any one directory from consuming all URL slots (e.g., a blog with 1000 posts).

### Limits

- Hard cap: `Math.min(params.limit || 50, 100)`.
- No content extraction — map only discovers URLs, not page text.
- SPA detection: if discovered ≤ 1 URL (only root), surfaces friendly `SPA_NO_URLS_FOUND` message instead of throwing.

---

## Improvement Areas

### research: accuracy

**Problem 1 — Synthesis is not synthesis.**
The current approach picks the most keyword-matched fragment as the answer. This works for simple fact lookups but fails for analytical questions ("what's the best X for Y"). No attempt is made to merge information from multiple sources into a coherent answer.

**Improvement:** Pass all extracted fragments to the LLM with a synthesis prompt. The model can reconcile conflicting data, identify consensus, and draw a direct conclusion. Cost: one additional LLM call per research query (the tool currently has no LLM calls).

**Problem 2 — Source selection ignores cross-query frequency.**
A URL appearing in 3 out of 8 queries should be ranked higher than one appearing in 1. The current Map insertion order does not capture this signal.

**Improvement:** Score each URL by frequency across queries before slicing to top 5 for extraction.

**Problem 3 — Query generation is template-driven.**
Domain detection (`tech|business|comparison|howto|general`) is regex-based and the suffix list is hardcoded. A question like "how does React Suspense differ from error boundaries" maps to `tech` and generates queries like "react suspense github" which may not be the best angle.

**Improvement:** Use an LLM call to generate diverse query framings. Cost: one fast LLM call before search. Firecrawl uses this approach.

### research: parallel sub-agents

The tool is already fully parallel within Node.js (Promise.all for both search and extraction). Spawning MCP sub-agents for search diversity would add process overhead and latency without improving parallelism — the bottleneck is I/O (scraper API latency), not CPU. This is not the right lever.

The right lever is **semantic query diversity via LLM** and **LLM synthesis**, not process-level parallelism.

### crawl: depth/breadth tradeoff

Current default: BFS, depth unbounded (queue-driven), concurrency = 3. This is reasonable for document sites (docs, blogs).

**Issues:**
1. BFS with concurrency 3 is conservative. Firecrawl runs 10-20 concurrent fetches. At 3, a 20-page crawl takes ~7 seconds minimum assuming 350ms/page static, more like 14s+ for render-required pages.
2. There is no max_depth parameter for crawl (only map has it). A deep site can crawl level 1 pages for all 20 slots without ever discovering level 2 content (BFS will reach L2 only if L1 < maxPages).
3. The queue is populated with all discovered links regardless of whether they will ever be fetched. A site with 500 nav links will queue all 500 even when maxPages=5.

**Improvement:** Add a `max_depth` param to crawl (as map has). Cap queue size to prevent unbounded growth. Raise concurrency to 5-6 for static mode.

### crawl: missing vs. Firecrawl

| Capability               | novada_crawl       | Firecrawl crawl         |
|--------------------------|-------------------|-------------------------|
| Pagination handling      | No                | Yes (pagination aware)  |
| JS infinite scroll       | No                | Partial (via actions)   |
| Webhooks / async job     | No (sync only)    | Yes (async + webhook)   |
| Structured JSON output   | Yes (basic)       | Yes (with schema)       |
| Custom CSS selectors      | No                | Yes (includeTags)       |
| Crawl deduplication      | URL-level only    | URL + content hash      |
| Sitemap-guided crawl     | No (map only)     | Yes (sitemap: include)  |
| External link following  | No                | Yes (allowExternalLinks)|
| Sub-domain traversal     | No (crawl)        | Yes                     |
| Max concurrency override | No                | Yes (maxConcurrency)    |
| Crawl delay              | No                | Yes (delay param)       |
| Progress / partial results | No (sync blocks) | Yes (webhook streaming) |

The most impactful missing capability for agent workflows is **async crawl with job polling**. Sync crawl at 20 pages works but blocks for 10-30s depending on render mode. For larger crawls this will hit MCP tool timeout limits.

### map: key gaps

1. Sitemap child recursion is limited to 5 child sitemaps (`childSitemaps.slice(0, 5)`). Large sites (e.g., e-commerce with category sitemaps) may have 20+ children, silently truncating discovery.
2. BFS fallback does not retry with render on SPA detection — it throws `SPA_NO_URLS_FOUND`. The outer catch formats a friendly message but the agent gets 0 URLs. There is no automatic escalation to render mode.
3. The prefix diversity cap (`MAX_PER_PREFIX`) can hide valid deep links when a site has many paths under a single prefix (e.g., `/docs/` with 80 pages on a limit=50 request, cap = 10 → only 10 docs pages returned).
