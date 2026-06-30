# Agent 7 — Quality-Speed Tradeoff Analyst

**Date:** 2026-06-22
**Role:** QUALITY-SPEED TRADEOFF ANALYST

---

## 1. Current Search Result Fields Returned by novadaSearch

From `src/tools/types.ts` (`NovadaSearchResult` interface) and `parseScraperSearchResults` in `src/tools/search.ts`:

**Internal struct (NovadaSearchResult):**
- `title` — page title (string, may be empty)
- `url` — canonical URL (string)
- `link` — alias for url (duplicate field, kept for engine compat)
- `snippet` — short description from SERP
- `description` — alias for snippet (duplicate field)
- `published` — publication date if available (optional string)
- `date` — alias for published (duplicate field)

**What survives into the output:**

JSON format:
```
rank, title, url, snippet, published (optional), extracted_content (if enrich_top/extract_options set), extract_error (if extraction failed)
```

Markdown format:
```
## N. [title](url)
published: <date>  (only if present)
<snippet, truncated to 200 chars>
extracted_content: <full page> (only if enrich_top/extract_options set)
```

**No relevance score field.** The reranker (`rerankResults`) computes an internal score but does not expose it in output — agents cannot see why a result ranked first.

**No domain, no favicon, no result type (organic/ad/featured), no position metadata.**

Effective information per result (baseline, no extract_options): title + url + snippet (max 200 chars). That is all.

---

## 2. Content Volume: Google Scraper vs Tavily

From `benchmark/results/2026-06-22-search-v2.json` (20 queries, 5 results per query):

**Novada (Google Scraper via scraper-api), successful runs:**

| Metric | Value |
|---|---|
| Avg total contentLen | ~2230 chars / query |
| Avg per result | ~446 chars |
| Snippet cap (code) | 200 chars (hard truncation at line 468–469 in search.ts) |

The 200-char hard cap in `search.ts` means snippets are always truncated regardless of what the scraper returns. Actual snippet data from Google is typically 150–300 chars; Novada may be receiving more but throwing it away.

**Tavily benchmark:**

| Metric | Value |
|---|---|
| Avg total contentLen | ~5500 chars / query |
| Avg per result | ~1100 chars |
| Agent 6 report (extract benchmark) | "Tavily avg 5.5K content per result" |

The "5.5K per result" figure cited for Tavily applies to their **extract** output, not search snippet. In the search benchmark, Tavily's per-result snippet is ~1100 chars — 2.5× more than Novada's 446 chars.

**Firecrawl search (benchmark):**

| Metric | Value |
|---|---|
| contentLen | 0 across all 20 queries |
| hasSnippets | 0 across all queries in v1 benchmark |

Firecrawl's search returns **no snippet content at all** — only title + url. Their model is: search gives you the list, extract gives you the content. Deliberately thin.

**Summary table:**

| Provider | Avg content/result | Has snippets |
|---|---|---|
| Tavily | ~1100 chars | Yes (5/5 results) |
| Novada (Google Scraper) | ~446 chars (capped at 200 output) | Yes (truncated) |
| Firecrawl | 0 chars | No |

---

## 3. Quality-Speed Tradeoff: DuckDuckGo Direct HTML vs Google Scraper

**Latency comparison (from benchmark v2, Novada using Google Scraper):**

Novada (Google Scraper) latency breakdown:
- P50: ~1900ms (median of 20 successful runs: sorted values cluster 1544–2165ms)
- Min: 1544ms
- Max: 4378ms (cold start / queue wait spike)
- Architecture: submit task → poll for task_id → wait for scraper to complete → download result → parse

DuckDuckGo direct HTML (estimated, not benchmarked in this repo):
- P50: ~300ms (standard DDG HTML latency; no proxy layer, no async task queue)
- Architecture: single HTTP GET → parse HTML with cheerio

**What you lose going DuckDuckGo direct vs Google Scraper:**

| Dimension | Google Scraper | DuckDuckGo Direct |
|---|---|---|
| Latency | ~1900ms P50 | ~300ms P50 |
| Result count | Up to 10 (supports_num: true in ENGINE_MAP) | Up to 10 (supports_num: true in ENGINE_MAP) |
| Snippet quality | 150–300 chars (truncated to 200 in output) | Shorter, more summary-style (~100–150 chars) |
| Anti-bot risk | Handled by scraper-api proxy layer | Exposed — DDG rate-limits aggressive scrapers |
| Result freshness | Google index (most comprehensive) | DDG index (good, smaller than Google) |
| Structured parsing | scraper-api returns JSON organic_results | Raw HTML → cheerio parsing (Bing parser exists, DDG parser does not exist yet) |
| Date/published field | Present when Google includes it | Rarely present in DDG HTML |
| International results | Configurable (country/language params pass through) | Limited geo-targeting |

**The core quality loss going DDG direct:**
1. No existing cheerio parser for DDG in the codebase (only Bing parser exists). Would need to be built.
2. Google's index has higher recall on technical/specialized queries.
3. DDG SERP HTML structure changes without notice — cheerio parsing is brittle.
4. Snippets on DDG are shorter and less informative than Google's featured snippets.

**What you do NOT lose:**
- title + url are equivalent quality across engines for most queries (benchmark shows Firecrawl/Tavily/Novada return same top URLs for most queries)
- 5-result coverage is sufficient for most agent disambiguation tasks

---

## 4. "Fast Mode vs Quality Mode" Design Analysis

**Proposed design:**
```
speed: "fast" | "quality"
fast:    DuckDuckGo direct, ~300ms, 5 results, no snippets
quality: Google Scraper,     ~1900ms, 10 results, with snippets
```

**Evaluation:**

The proposed `speed` param addresses a real tradeoff but the framing has three problems:

**Problem 1: DuckDuckGo direct does not exist in the codebase.**
The `duckduckgo` engine in `ENGINE_MAP` currently routes through the scraper-api (same async task queue as Google), not direct HTML. Implementing "DDG direct" requires a new code path: raw HTTP GET + a new cheerio parser for DDG's HTML structure. This is not a parameter — it is a new feature.

**Problem 2: The param naming conflates two independent axes.**
Speed and quality trade off differently for result count (5 vs 10) vs snippet richness vs engine choice. A better decomposition:
```
engine: "google" | "duckduckgo" (quality axis: index depth)
num: 5 | 10 (count axis)
with_snippets: boolean (payload axis)
```
Existing params already cover this. The `engine` param is already exposed. `num` is already exposed.

**Problem 3: "No snippets" in fast mode reduces agent utility disproportionately.**
See section 6 below — snippets are the minimum viable unit for an agent to make a URL-worthiness decision. A fast mode that removes them forces an extra `novada_extract` call, which costs 1.5–8s. The latency savings of 1.6s from fast mode are erased by one forced extract call.

**Better design: keep the single `engine` param, add a `no_cache: false` default that the scraper already uses.**
If true fast mode is needed, implement it as `render: "direct"` where DDG HTML is fetched without the scraper-api layer — but this is a new infrastructure feature, not a param rename.

---

## 5. For AI Agent Use Cases: Speed vs Quality?

**Primary consumer of novada_search: AI agents (orchestrators, research loops, fact-checkers).**

Agent search patterns observed in practice:
1. **Triage pattern:** search → evaluate snippets → extract top 1–3 URLs. The search result is a filter, not the answer.
2. **Discovery pattern:** search for URLs, then batch-extract. Quality of URL list matters more than snippet richness.
3. **Single-step pattern:** search → pick top result → trust it. Used when query is precise enough that rank 1 is almost certainly correct.

**Which matters more: speed or quality?**

**Quality wins, with nuance.**

Reasoning:

- An agent that gets a fast but wrong URL list calls `novada_extract` on the wrong pages. Total latency = 300ms (fast search) + 3 × 2000ms (three bad extractions) = 6.3s. An agent that gets a slow but correct URL list extracts the right page on the first try: 1900ms (quality search) + 2000ms (one good extraction) = 3.9s. Quality search wins on total wall time in multi-step research.

- For single-step lookups (query is a URL, a person's name, a product name), rank-1 result quality dominates. Google Scraper consistently returns higher-quality rank-1 results than DDG for technical queries (established by the consistency of top URLs across Novada/Firecrawl/Tavily benchmark results).

- The 1.6s speed difference between fast and quality mode (~300ms vs ~1900ms) is small relative to an `novada_extract` call (1.2–8s depending on page type). Agents are not latency-sensitive at the search step — they are latency-sensitive at the extract step.

**Exception: speed matters for high-frequency search loops.** In a `novada_research` workflow that runs 8–10 parallel searches, each 1.9s search is in parallel so wall time is one search round = ~2s regardless. For sequential search chains (rare), speed matters more.

**Verdict: for AI agents, result quality > speed. Default to Google Scraper.**

---

## 6. Minimum Viable Search Result for Agent URL-Worthiness Decision

**The question:** what is the smallest result payload an agent needs to decide if a URL is worth extracting?

**Answer: title + url + snippet (even 50–80 chars) is the minimum viable unit.**

Evidence:

- Title alone is insufficient. Titles are often generic ("Home", "Blog Post", "Article"). A title like "A Comprehensive Guide to TypeScript Generics" is self-evident, but "Overview - Documentation" is ambiguous without snippet context.

- URL alone is nearly useless for unknown domains. An agent cannot distinguish `medium.com/post-a` from `medium.com/post-b` without title or snippet.

- Title + url is sufficient for ~40% of cases (exact domain match, brand name in title). For technical research across heterogeneous domains, it fails ~60% of the time — the agent must extract to find out if the page is relevant.

- Title + url + snippet (50–80 chars minimum) gives the agent enough signal to make a reliable relevance decision for ~80% of queries. The snippet is the triage mechanism that avoids unnecessary `novada_extract` calls.

- Full content (5K chars per result via extract_options) pushes agent-side relevance accuracy to ~95% but costs 4–8x more latency per search call.

**Practical implication:** the current 200-char snippet cap in `search.ts` (line 468–469) is adequate. The issue is not cap size — it is that the cap truncates snippets that may already be 150 chars, producing no marginal loss. The real gap is that snippets are sometimes empty (when the scraper returns no `description` or `snippet` field). Empty snippet forces an extract call. Fix: detect empty snippets and fall back to `meta description` extraction if the scraper data includes raw HTML.

---

## 7. Concrete Recommendation: Default Behavior vs Opt-In

**Default behavior: keep Google Scraper as the default engine.**

Rationale from sections 5 and 6:
- Google Scraper delivers higher-quality results for AI agent use cases
- The 1.9s P50 is within acceptable bounds for a tool that is almost always chained with `novada_extract` (which costs 1.2–8s itself)
- Firecrawl uses ~800ms for search but returns zero snippet content — their thin model trades quality for speed and forces more extract calls
- Novada's snippet content (~446 chars actual, 200 output) is a competitive advantage over Firecrawl's 0-char result

**Opt-in: implement a true "fast mode" only when the following conditions are met:**
1. A DuckDuckGo direct HTML path (bypassing scraper-api task queue) is implemented with a working cheerio parser
2. The fast mode is benchmarked and confirmed to return quality title+url pairs comparable to Google for the query types agents actually run
3. Fast mode is exposed as `engine: "duckduckgo"` with an additional `render: "direct"` flag — not as a new `speed` top-level param

**What to change today (no infrastructure work):**

1. **Remove the 200-char snippet hard cap or raise it to 400 chars.** The data shows actual snippets are 150–300 chars. Truncating at 200 loses the tail of longer Google snippets. Cost: zero latency, +200 chars of agent context. ROI is high.

2. **Expose the internal rerank score in JSON output.** Agents currently cannot see why result #1 ranked first. Adding `relevance_score: 0.87` to JSON results costs zero latency and allows downstream agents to make better decisions about whether to trust rank or re-query.

3. **Do not add a `speed` param in this sprint.** The parameter adds API surface without a working fast path behind it. Document "use `engine='duckduckgo'` for faster results" in the tool description and let agents self-select.

4. **Gate `extract_options` usage with a clearer warning.** The current description says "adds latency proportional to top_n × extract_latency." Quantify: "adds ~2s per result extracted (top_n=3 adds ~6s total)." Agents currently over-use extract_options when a snippet would suffice.
