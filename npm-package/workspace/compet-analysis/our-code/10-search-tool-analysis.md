# novadaSearch Deep-Dive Analysis

Source: `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
Supporting: `src/utils/rerank.ts`, `src/tools/types.ts`
Date: 2026-06-23

---

## 1. Complete novadaSearch Function Flow

```
novadaSearch(params, apiKey)
  │
  ├── 1. Fast-path: engine === "yahoo" → return YAHOO_UNAVAILABLE (no I/O)
  │
  ├── 2. Build rawParams (q, api_key, engine, num, country, language)
  │       + Bing: inject mkt="en-US" default locale
  │       + time_range / start_date / end_date
  │       + include_domains / exclude_domains
  │
  ├── 3. check SCRAPER_SEARCH_ENGINES.has(engine) → if not → return SERP_UNAVAILABLE
  │       (set: google, bing, duckduckgo, yandex)
  │
  ├── 4. Apply domain filters as query modifiers (site: / -site: syntax appended to query string)
  │
  ├── 5. Execute scraper path (try/catch → AxiosError or permission regex → SERP_UNAVAILABLE)
  │       ├── engine === "bing":
  │       │     submitBingSearch() — 3 retries, 2s between
  │       │       ├── POST /request with a_auto_push=false
  │       │       ├── if task_id → pollSearchResult() → parseScraperSearchResults()
  │       │       ├── elif html → parseBingHtml() (cheerio)
  │       │       └── elif organic_results → parseScraperSearchResults()
  │       └── else (google / duckduckgo / yandex):
  │             submitSearchScrapeTask() → task_id
  │             pollSearchResult(task_id) — 90s deadline, exponential backoff 100ms→2000ms
  │             parseScraperSearchResults()
  │
  ├── 6. Zero results → return structured empty message with agent hints
  │
  ├── 7. rerankResults(results, query) — keyword scoring (title 3x/2x, snippet 1x/0.5x)
  │
  ├── 8. Optional extract_options / enrich_top:
  │       Promise.all(urlsToExtract.map(novadaExtract)) — PARALLEL
  │       attach extracted_content or extract_error to each result
  │
  └── 9. Render output
          format === "json" → JSON.stringify with agent_instruction
          format === "markdown" (default) → markdown with Agent Hints + Chainable Output + Agent Memory
```

---

## 2. Supported Engines and Selection

**Schema-allowed:** `google | bing | duckduckgo | yahoo | yandex` (Zod enum, default: `google`)

**Actual execution paths:**

| Engine     | Path                          | Notes                                      |
|------------|-------------------------------|--------------------------------------------|
| google     | submit task → poll download   | `num` param supported                      |
| bing       | submitBingSearch (3 retries)  | uses `a_auto_push=false`, no `num` param   |
| duckduckgo | submit task → poll download   | `num` param supported                      |
| yandex     | submit task → poll download   | query param is `keyword` not `q`, no `num` |
| yahoo      | fast-path stub                | returns YAHOO_UNAVAILABLE immediately      |

**Engine map** (`ENGINE_MAP` object, lines 21-26):
- `google` → scraper_name `google.com`, scraper_id `google_search`
- `bing` → scraper_name `bing.com`, scraper_id `bing_search` (different code path entirely)
- `duckduckgo` → scraper_name `duckduckgo.com`, scraper_id `duckduckgo`
- `yandex` → scraper_name `yandex.com`, scraper_id `yandex`

**Engine selection:** caller-controlled, no automatic failover between engines.

---

## 3. Polling Loop — Exact Backoff Intervals

`pollSearchResult()` (lines 172-222):

```
deadline = Date.now() + 90_000   // 90 second hard cap
pollAttempt = 0

while (Date.now() < deadline):
  GET scraper_download?task_id=...

  if code === 27202 (pending):
    sleep( min(100 * 2^pollAttempt, 2000) )
    pollAttempt++
    // actual sleep sequence: 100, 200, 400, 800, 1600, 2000, 2000, 2000, ...
```

**Exact delays (ms):** 100, 200, 400, 800, 1600, 2000, 2000, 2000 ... (capped at 2000)

**Bing retry loop** (separate, lines 63-121):
- 3 attempts max
- 2000ms fixed sleep between attempts (`if (attempt > 0) await scraperSleep(2000)`)
- No timeout enforced on this outer loop beyond the individual axios timeout (60s)

**Race condition assessment:** No race condition in the polling loop itself — it is strictly sequential (single `while` loop, no concurrent polls). However, `pollAttempt` never resets if the task briefly completes then a different branch is taken — this is benign since the loop exits on completion.

---

## 4. Result Parsing

**`parseScraperSearchResults()`** (lines 225-240) — handles multiple API response shapes:

```
data.organic_results  // primary Google path
data.organic          // alternate key
data.results          // generic
data.items            // generic
```

Each item mapped to `NovadaSearchResult`:
- `title` — direct
- `url` — `item.url ?? item.link ?? item.source.link`
- `snippet` — `item.snippet ?? item.description`
- `published` — `item.published ?? item.date`

**`parseBingHtml()`** (lines 33-54) — cheerio fallback for Bing sync response:
- Selects `li.b_algo` elements
- Extracts `.b_caption p`, `p.b_para`, or first `p` for snippet
- Quality: lower than API path — depends on Bing's HTML structure not changing

**Parsing quality issues:**
- No validation of extracted URLs (empty strings pass through, filtered only at render time with `if (!rawUrl) continue`)
- `url` and `link` fields are kept separately and often redundant (both set to same value)
- `description` and `snippet` are also kept separately and redundant
- No deduplication of `url`/`link` field — result object carries both

---

## 5. Zero Results Handling

```typescript
if (results.length === 0) {
  return [
    `## Search Results`,
    `results:0 | engine:${engine}`,
    `No results found for: "${params.query}"`,
    `## Agent Hints`,
    `- Try a broader or rephrased query`,
    `- Try a different engine: engine="duckduckgo" or engine="bing"`,
    `- Use novada_research for multi-source investigation`,
    `- Use novada_map + novada_extract if you have a known site`,
  ].join("\n");
}
```

**Assessment:** Reasonably helpful. Provides engine context and concrete alternatives.

**Gap:** No distinction between "scraper returned 0 results" vs "scraper returned results but all were filtered" (would only apply if filtering were implemented). The message doesn't expose what engine actually returned so the agent can't tell if the query itself is the problem or if the engine is the problem.

**Missing:** When `include_domains` is set and returns 0 results, the error does not tell the agent "no results in your domain filter — try removing include_domains".

---

## 6. Snippet Truncation — 400 chars

Line 476-478:
```typescript
const cleanSnippet = fullSnippet.length > 400
  ? fullSnippet.slice(0, 397) + "..."
  : fullSnippet || "No description";
```

**Is 400 optimal for LLMs?**

Context analysis:
- A typical LLM context window budget for search results: with 10 results × ~600 chars per result entry (title + snippet + url + formatting) = ~6000 tokens — acceptable
- SERP snippets from Google are typically 150-300 chars of useful content; 400 gives reasonable headroom
- For agents deciding whether to call `novada_extract`, 400 chars is usually enough to determine relevance
- Competitive tools: Tavily uses ~200-300 chars per snippet; Exa provides full content by default (different model)

**Problems with current implementation:**
- Truncation happens in the MARKDOWN path only. JSON output uses `r.description || r.snippet` directly with NO truncation limit
- This means `format="json"` can return unbounded snippets that could blow context in edge cases
- The truncation cuts at a hard character boundary without attempting to break at word/sentence boundaries

**Recommendation:** 400 chars is defensible for markdown. JSON path needs a max (e.g., 800 chars) to prevent unbounded output.

---

## 7. Pagination

**No pagination implemented.** The `num` parameter (max 20 via Zod, default 10) is the only control. There is no `page`, `offset`, or cursor parameter.

**Should there be?**

For an agent-first tool, pagination adds significant complexity and agents rarely need page 2 of search results — they use `novada_research` or `novada_extract` for deeper dives. The current design aligns with standard SERP tool patterns (Brave, Tavily, Exa all cap at 20 with no pagination in their primary tool).

**What's missing instead:** The `num` cap of 20 is from the Zod schema, but it's not clear whether the backend actually returns more than 10 reliably. There's no indication in the code of what the actual scraper API `num` ceiling is.

---

## 8. Date and Domain Filtering

### Date filtering
**Exposed params:**
- `time_range` — enum: day/week/month/year
- `start_date` — ISO string YYYY-MM-DD
- `end_date` — ISO string YYYY-MM-DD

**Mechanism:** Added to `rawParams` → `cleaned` object, then passed to... nothing.

**Critical bug:** `cleaned` is built (lines 274-303) but never actually used in the scraper API request. The domain filter params are converted to `site:` query modifiers appended to the query string. The time/date params are added to `rawParams` and `cleaned` but `cleaned` is not sent anywhere — the `submitSearchScrapeTask` and `submitBingSearch` functions do not accept or forward these parameters.

**Date filtering is silently ignored for all engines.** The params are accepted by the schema, stored in `cleaned`, but never forwarded to the scraper backend.

### Domain filtering
**Exposed params:** `include_domains` (array, max 10), `exclude_domains` (array, max 10)

**Mechanism:** Both are converted to `site:` query modifiers appended to `effectiveQuery` (lines 312-323):
- Single include domain: `query site:domain.com`
- Multiple include domains: `query (site:d1.com OR site:d2.com OR ...)`
- Exclude domains: `query -site:d1.com -site:d2.com ...`

This is a reliable approach that works across all engines. However, domain filters are also added to `rawParams.include_domains` / `rawParams.exclude_domains` and `cleaned` — but again `cleaned` is unused.

### Hidden / unused params
`rawParams` and `cleaned` are constructed but `cleaned` is completely unused after construction. The only params that actually reach the scraper API are those explicitly appended to the `URLSearchParams` form object inside `submitSearchScrapeTask` and `submitBingSearch`. This means `country`, `language`, and all filter params beyond the query are effectively dead code for the scraper path.

---

## 9. Response Format — Agent Optimization Assessment

**Markdown output sections:**
1. `## Search Results` header with metadata line (`results:N | engine:... | source:live | reranked:true | filters...`)
2. Per-result: `## N. [title](url)` + optional `published:` + snippet + optional extracted_content
3. `## Agent Hints` — concrete next-action guidance
4. `## Chainable Output` — `result_count` + `top_urls` list
5. `## Agent Memory` — `remember: Top result for '...'` pattern

**Strengths:**
- Metadata line is machine-parseable (pipe-separated key:value)
- Agent Hints are specific and actionable
- Chainable Output provides structured URL list for downstream tool calls
- reranked:true in metadata signals quality processing occurred

**Weaknesses:**
- `## Agent Memory` section is weak: the `remember:` prefix is not a real MCP tool call; it's just text. An agent won't auto-save this to any memory store — it's cargo-cult memory
- `## N. [title](url)` heading level conflicts with the outer `## Search Results` section — all at h2 creates a flat hierarchy that's harder to parse programmatically
- `top_urls` block is useful but only lists 5 URLs even when `num` returns 20; agents scanning for specific URLs would miss items 6-20
- `source: live` is hardcoded — if caching is ever added, this won't update

**JSON output:**
```json
{
  "status": "ok",
  "query": "...",
  "engine": "...",
  "source": "live",
  "result_count": N,
  "results": [{ "rank": 1, "title": "...", "url": "...", "snippet": "...", "published": "..." }],
  "agent_instruction": "..."
}
```
Clean and well-structured. Missing: filter summary, reranked flag.

---

## 10. Result Deduplication

**No deduplication.** There is no URL-based deduplication pass. If the scraper API returns duplicate URLs (possible when using multiple `site:` filters or when `include_domains` + organic results overlap), the same URL can appear multiple times in the output.

Given that results come from a single scraper call per `novadaSearch` invocation (not merged from multiple sources), duplicates are rare in practice. The lack of deduplication becomes a real issue if `novada_research` uses multiple `novadaSearch` calls and merges results (would need to check `research.ts`).

---

## 11. Race Conditions in Polling Loop

**No race conditions** — the polling loop in `pollSearchResult` is strictly sequential (`while` + `await`). No concurrent requests to the same task_id endpoint.

**Potential issue:** The `submitBingSearch` retry loop (lines 63-121) could theoretically overlap with an earlier task_id still being processed if a `task_id` is returned on attempt 1 and `pollSearchResult` is called, but that call fails, and then attempt 2 also gets a different `task_id`. In practice, this is handled correctly: `pollSearchResult` is awaited synchronously within each retry attempt before proceeding to the next. The old task is simply abandoned.

**Actual latency risk:** The `pollSearchResult` 90s deadline + Bing's 3-retry × 2s + inner `pollSearchResult` calls = theoretically up to 90s + 90s + 90s = 270s worst case for Bing. The axios timeout on the submission request is 60s, so the actual worst case is ~60s (submission) + 90s (poll) × 3 retries = 330s worst case. This is excessive but unlikely in production.

---

## Suggested Improvements

### Latency

**1. Parallel multi-engine search (not currently possible — single engine per call)**
The architecture doesn't support parallel engine dispatch in a single call. If `novada_research` calls `novadaSearch` multiple times with different engines, those are sequential. Adding a `engines: string[]` array param with Promise.all dispatch could halve latency for multi-engine research. Cost: significant refactor.

**2. Reduce Bing retry delay**
The 2000ms fixed sleep between Bing retries is aggressive. The null data issue is a race condition on the backend, not a rate limit. 500ms would be safer to try first.

**3. Reduce initial poll delay**
First poll is at 100ms — reasonable. But the exponential jumps to 2000ms after only 4 polls (1.5s total). For fast engines like Google that return in 2-5s, the poll might be catching the long wait. A tighter curve: 200, 400, 800, 1000, 1500, 2000 would be more responsive.

**4. Keep-alive agent is already in use** — good, no change needed.

### Result Quality

**5. Fix silent date filter dropping**
`time_range`, `start_date`, `end_date` params are accepted but never forwarded to the scraper API. Either forward them correctly (if the scraper supports them as form params) or remove them from the schema to avoid misleading agents into thinking date filtering works.

**6. Reranker is bag-of-words only**
Current reranker: keyword frequency in title + snippet, no TF-IDF, no positional signal, no domain authority. For agents that need "most relevant result first," this is adequate for simple queries but fails for long-tail or ambiguous queries. A semantic similarity score (even cosine over word embeddings) would improve precision. Short-term improvement: add a phrase-match bonus (consecutive query terms appearing in title score 5x instead of individual 3x).

**7. Snippet quality: word-boundary truncation**
Current 400-char hard cut often breaks mid-sentence. Change to: find last sentence-end (`. `, `! `, `? `) before char 400, truncate there. This makes snippets more readable and more useful for agent relevance judgment.

**8. JSON format: add snippet length cap**
JSON output path has no snippet truncation. Add 800-char cap to match markdown quality.

### Error Messages

**9. Zero results: domain-filter context**
When `include_domains` is set and returns 0 results, the error message should say:
> "No results found in the specified domains (include_domains: [...]). Try removing the domain filter or broadening the query."

**10. Error swallowing is too broad**
The catch block at lines 344-354 maps all `AxiosError` to `SERP_UNAVAILABLE` — including transient network failures, timeouts, and 500s. A 500 from the backend should throw rather than silently return the unavailability message. Currently an agent gets `SERP_UNAVAILABLE` and switches to alternatives even if the real problem was a temporary backend hiccup.

**11. `cleaned` is a dead variable**
`rawParams` is cleaned with `cleanParams()` into `cleaned` but `cleaned` is never used. This is either dead code or a bug where the cleaned params were intended to be forwarded somewhere. Should be removed or actually used. This also means `country` and `language` are silently dropped.

### Missing Parameters Agents Would Want

**12. `safe_search` param**
Currently hardcoded to `off` for Bing only. Should be exposed as an optional boolean/enum.

**13. `sources` param for Google (news vs web vs images)**
Agents researching recent events want `source: "news"`. The backend may support this but it's not exposed.

**14. `num` ceiling transparency**
Zod caps at 20, but the actual backend ceiling per engine is undocumented. If yandex only returns 10 reliably, the agent requesting 20 gets a silent shortfall.

**15. `filter` param (search operators passthrough)**
Competitive tools (Brave, Tavily) expose a `filter` string for custom search operators. Agents using advanced operators (filetype:, intitle:, AROUND(N)) have no way to pass these without injecting into the `query` string directly — which they do already via description guidance, but it's not formalized.

**16. Result source labeling in JSON**
JSON output doesn't indicate which result came from what country/language context or whether date filters applied. Agents can't distinguish a result from a filtered search vs an unfiltered one.

---

## Summary of Critical Bugs

| Severity | Issue | Location |
|----------|-------|----------|
| HIGH | Date filtering (time_range, start_date, end_date) is silently dropped — never forwarded to scraper API | search.ts lines 291-293, `cleaned` unused |
| HIGH | country + language params also silently dropped (same reason) | search.ts lines 278-280, `cleaned` unused |
| MEDIUM | JSON output path has no snippet length cap (unbounded) | search.ts lines 429-430 |
| MEDIUM | All AxiosErrors → SERP_UNAVAILABLE (masks transient failures) | search.ts lines 344-353 |
| LOW | Snippet truncation breaks mid-word at char 400 | search.ts line 477 |
| LOW | `## Agent Memory` remember: text has no actual effect | search.ts lines 509-513 |
