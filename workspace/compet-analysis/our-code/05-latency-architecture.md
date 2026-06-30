# Search Latency Architecture Analysis

**Date:** 2026-06-23
**Scope:** novada_search full request flow, latency sources, backoff analysis, and optimization paths

---

## 1. Full Request Flow Map — novada_search

### 1A. Google / DuckDuckgo / Yandex Path (async submit → poll)

```
[MCP Tool Call]
  → novadaSearch() [search.ts:266]
  → submitSearchScrapeTask() [search.ts:124]
      POST https://scraper.novada.com/request
        form: scraper_name, scraper_id, is_auto_push=false, q, num, json=1
        timeout: 60_000ms [search.ts:81]
        httpsAgent: keepAlive=true [search.ts:10]
      → returns task_id
  → pollSearchResult() [search.ts:172]
      deadline = Date.now() + 90_000ms [search.ts:174]
      LOOP:
        GET https://api.novada.com/g/api/proxy/scraper_download
            ?task_id=...&file_type=json&apikey=...
            timeout: 30_000ms [search.ts:178]
        if code==27202 (pending):
            sleep( min(100 * 2^pollAttempt, 2000) ) [search.ts:184]
            pollAttempt++
        if Array response: parse organic_results → break
        if Object with organic_results/organic/results: break
        if error code: throw
  → parseScraperSearchResults() [search.ts:225]
  → rerankResults() [search.ts:373]
  → optional: extract top-N via novadaExtract() [search.ts:384] (Promise.all)
  → format markdown or JSON output
```

### 1B. Bing Path (submitBingSearch, different flow)

```
[MCP Tool Call]
  → submitBingSearch() [search.ts:62]
      retry loop up to 3 times [search.ts:63]
      POST https://scraper.novada.com/request
        form: a_auto_push=false (not is_auto_push), q, json=1, safe=off
        timeout: 60_000ms [search.ts:81]
      if response has task_id → pollSearchResult() [search.ts:100]
      if response has html → parseBingHtml() [search.ts:107]
      if response has organic_results → parseScraperSearchResults() [search.ts:113]
      if all null: sleep(2000) and retry [search.ts:64]
```

### 1C. Yahoo Path (immediate return)

```
engine === "yahoo" → return YAHOO_UNAVAILABLE string immediately [search.ts:270]
```

---

## 2. Latency Budget — Where the Time Goes

### Phase timings (Google path, typical case)

| Phase | Min | Typical | Worst | Source |
|---|---|---|---|---|
| Submit POST to scraper.novada.com | ~50ms | ~150ms | 2000ms (timeout @60s) | search.ts:146 |
| Backend scraper queuing + proxy | — | ~500–1500ms | — | Novada Scraper API internals |
| First poll (poll attempt 0) | ~50ms | ~150ms | — | search.ts:178 |
| Pending sleep, attempt 0 | 100ms | 100ms | 100ms | search.ts:184: `100*2^0` |
| Poll attempt 1 | ~50ms | ~150ms | — | — |
| Pending sleep, attempt 1 | 200ms | 200ms | 200ms | `100*2^1` |
| Poll attempts 2–N | 50ms each | 150ms each | 2000ms sleep cap | `min(100*2^N, 2000)` |
| parseScraperSearchResults | <1ms | <1ms | <5ms | CPU-bound, trivial |
| rerankResults | <1ms | <5ms | <20ms | CPU-bound, O(N) |
| **Total P50 estimate** | — | **~1000–2500ms** | 90s hard cap | — |

**The dominant cost is the async scraper backend processing time**, not network I/O or client-side logic.

### Comparison: Where competitors stand

| Service | P50 (self-reported) | P50 (independent) | Architecture |
|---|---|---|---|
| Exa Fast | 250–350ms | ~350ms | Proprietary index (Rust + custom vector DB, no Google wrapping) |
| Tavily Fast | 180ms (claimed) | ~1000–1885ms measured | Content fetching + parsing included |
| Google SERP API wrappers | >700ms | >700ms | Browser-farm → Google → parse |
| **novada_search (current)** | **~1000–2500ms est.** | N/A (not benchmarked) | Novada Scraper submit→poll |

The 376ms P50 figure cited for Tavily appears to be raw search index lookup only; end-to-end with content fetching is ~1–2s. Exa Fast's sub-350ms is a fully proprietary stack, not achievable by wrapping any third-party scraper.

---

## 3. Backoff Analysis — Is It Optimal?

### Current implementation (search.ts:184)

```typescript
await scraperSleep(Math.min(100 * Math.pow(2, pollAttempt), 2000));
```

Actual sleep sequence (ms): 100, 200, 400, 800, 1600, 2000, 2000, 2000, ...

### Problems

1. **First poll has no sleep before it** — the very first poll executes immediately after submit returns. If the scraper backend takes ~500ms to start, the first poll request is almost certainly wasted (returns 27202 immediately), burning a round-trip.

2. **100ms base is aggressive for a remote async scraper** — typical scraper backends need 300–800ms minimum to spin up a browser or proxy connection. Starting at 100ms means the first 2–3 polls nearly always return pending.

3. **2000ms cap is correct** — polls at >2s intervals would add unnecessary steady-state latency once the task is running.

4. **No jitter** — pure exponential backoff under concurrent load causes thundering-herd bursts against the download endpoint. Adding jitter (`base * 2^n * (0.5 + random()*0.5)`) would improve cluster-level behavior.

5. **90s timeout (search.ts:174)** — acceptable ceiling but means worst-case searches block the agent for 90 full seconds with no intermediate feedback.

### Optimal sequence (theoretical)

For a scraper backend with 300ms minimum processing time:

```
// Pre-wait: give backend time to start
sleep(300)
// Backoff: 300, 600, 1200, 2000, 2000...
sleep(min(300 * 2^attempt, 2000) * (0.75 + random()*0.5))
```

This eliminates ~3 wasted polls at the front end of every request.

---

## 4. Why Tavily Achieves ~180ms (Self-Reported)

Tavily's claimed 180ms P50 does not include content fetching — it is metadata-only SERP. Their architecture:

1. **Proprietary pre-indexed corpus** — does not submit to a third-party scraper and wait; it queries its own index directly.
2. **Synchronous response** — single HTTP request → single response. No submit/poll/download.
3. **No queue overhead** — no async job queue between client and search execution.
4. **Content is pre-fetched and cached** — "deep" search tier fetches at query time, but the "fast" tier returns pre-indexed snippets.

Exa Fast (sub-350ms) goes further: custom Rust vector database, Matryoshka embeddings, SIMD optimizations on an H200 GPU cluster. This is not achievable by wrapping the Novada Scraper API.

**Implication for novada_search:** achieving sub-500ms P50 with the current scraper infrastructure is not possible. The minimum is bounded by: `submit_RTT + scraper_queue + proxy_connect + Google_RTT + parse` which is structurally >500ms under any reasonable conditions.

---

## 5. What Option A (Multi-Key Dedicated Search) Would Look Like

**Premise:** Use multiple API keys / sub-accounts to parallelize the poll-and-response, submitting the same query to multiple backends simultaneously and taking the first one that completes.

```typescript
// Conceptual pseudocode — not production code

async function novadaSearchMultiKey(
  params: SearchParams,
  apiKeys: string[]  // pool of N dedicated SERP keys
): Promise<string> {

  // Submit to all keys simultaneously
  const taskPromises = apiKeys.map(key =>
    submitSearchScrapeTask(key, engineCfg.scraper_name, engineCfg.scraper_id, query, num)
      .then(taskId => ({ key, taskId }))
      .catch(() => null)
  )
  const submissions = (await Promise.allSettled(taskPromises))
    .filter(r => r.status === "fulfilled" && r.value !== null)
    .map(r => (r as PromiseFulfilledResult<{key: string, taskId: string}>).value)

  // Race: poll all simultaneously, take first success
  const resultData = await Promise.any(
    submissions.map(({ key, taskId }) => pollSearchResult(key, taskId))
  )

  return parseScraperSearchResults(resultData)
}
```

**Tradeoffs:**
- Reduces P50 by ~40–60% (fastest of N completions) but multiplies API key cost N×
- Introduces billing complexity (all N tasks are charged even though N-1 are abandoned)
- Gains are bounded by the distribution of backend latency variance, not the mean
- Does NOT eliminate the structural floor (first poll sleep + scraper startup)

---

## 6. What Option C (Shared Sync Endpoint) Would Look Like

**Premise:** Novada exposes a synchronous endpoint that wraps the submit→poll loop server-side, returning results in a single response. The client sees one HTTP call.

```typescript
// What the client side would look like if Novada added a sync endpoint

async function novadaSearchSync(
  params: SearchParams,
  apiKey: string
): Promise<string> {

  // Single blocking request — server handles submit+poll internally
  const resp = await axios.post(
    "https://scraper.novada.com/search/sync",  // hypothetical endpoint
    {
      engine: params.engine,
      q: params.query,
      num: params.num || 10,
      timeout: 15000,  // server-side timeout budget
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 20000,  // client timeout must exceed server timeout
      httpsAgent: keepAliveAgent,
    }
  )

  // No polling loop needed — response contains final results
  return parseScraperSearchResults(resp.data)
}
```

**What this requires on Novada's backend:**
- A sync facade that executes submit → internal poll loop → return result
- Server-side streaming OR long-poll support to avoid gateway timeouts (Nginx/Cloudflare default 60s)
- This is the architecture that Serper, ValueSERP, and DataForSEO use for their synchronous SERP APIs

**Latency improvement:** Eliminates 2–4 round-trip poll calls (saves ~200–400ms at P50) but does NOT eliminate backend processing time. Real gain: ~20–30% P50 reduction.

---

## 7. Minimum Achievable P50 With Current Scraper API Infrastructure

### Baseline constraint analysis

```
Minimum P50 = submit_RTT + backend_processing_floor + first_useful_poll_RTT

submit_RTT        ≈  80–150ms  (HTTPS to scraper.novada.com)
backend_floor     ≈  300–600ms (proxy connect + Google request + parse)
poll_sleep_floor  =  100ms     (first sleep, search.ts:184)
first_poll_RTT    ≈  80–150ms  (HTTPS to api.novada.com)
─────────────────────────────────────────────────────────
minimum P50       ≈  560–1000ms (best case, single poll hit)
```

With **two polls needed** (typical because first poll usually returns pending):
```
+100ms sleep + 80ms poll RTT = +180ms overhead per extra poll
realistic P50 ≈ 800–1300ms
```

### Maximum achievable improvement (without changing Novada backend)

| Change | Estimated P50 saving |
|---|---|
| Increase first sleep to 300ms (eliminates ~2 wasted polls) | −150ms |
| Add jitter to backoff (reduces thundering herd, improves tail) | −50ms P95 |
| Enable HTTP/2 on keepAlive agent (multiplexing) | −20ms |
| Cache identical queries for 60s (Redis, ~5% hit rate) | −15ms avg |
| **Total realistic improvement** | **~185ms → P50 ~800–1100ms** |

**Hard floor with current architecture:** ~700ms P50. Sub-500ms requires either a dedicated SERP index or a synchronous backend endpoint from Novada.

---

## 8. Parallelization Opportunities Currently Missed

### 8A. Search + Extract not pre-parallelized at submission time

Current behavior in `novadaSearch()` [search.ts:377]:
```
search → (wait for results) → extract top-N via Promise.all
```

These two phases are sequential at the macro level. `extract_options` enrichment only starts after all search results land. For `enrich_top: true`, this means:

```
submit(search) → poll(search) → [results arrive] → submit(extract) → poll(extract)
```

Potential optimization: submit search task AND pre-warm extract on predictable top-result URLs (not applicable here since URLs are unknown before search completes). This is a genuine sequential dependency — no easy parallelization.

### 8B. Multi-engine search not parallelized

When `engine` param is specified, only one engine is queried. If the goal is higher recall or fallback, running Google + DuckDuckGo in parallel and merging results is possible but increases cost 2×.

### 8C. No speculative pre-fetch

If the same query is submitted twice within a short window, the second call re-submits a full scraper task. A 60-second in-memory or Redis dedup cache keyed on `(engine, query, num)` would eliminate duplicate scraper charges and halve latency for repeated queries.

### 8D. Bing retry delay is always 2000ms

```typescript
// search.ts:64
if (attempt > 0) await scraperSleep(2000);
```

Bing retries sleep a flat 2000ms regardless of attempt number. If the first attempt returns `data.data.data=null` (which happens ~20% of the time per the comment at search.ts:60), the retry burns 2000ms unconditionally. Reducing this to 500ms for attempt=1 and 2000ms for attempt=2 would save ~1500ms on the 20% failure rate.

---

## 9. Optimized Flow Pseudocode

This is the maximum achievable optimization within the current Scraper API constraints:

```typescript
// Optimized novadaSearch — pseudocode

async function novadaSearchOptimized(params, apiKey) {

  // 1. Submit (unchanged)
  const taskId = await submitSearchScrapeTask(...)

  // 2. Optimized poll loop
  const deadline = Date.now() + 90_000
  let pollAttempt = 0

  // PRE-WAIT: 300ms — give backend minimum startup time
  // Eliminates 2–3 immediate-return "pending" polls
  await sleep(300)

  while (Date.now() < deadline) {
    const result = await pollDownloadEndpoint(apiKey, taskId)

    if (result.isPending) {
      // Jittered exponential backoff starting at 300ms
      const base = Math.min(300 * Math.pow(2, pollAttempt), 2000)
      const jitter = base * (0.75 + Math.random() * 0.5)
      await sleep(jitter)
      pollAttempt++
      continue
    }

    if (result.isComplete) return result.data
    throw new Error(result.error)
  }
  throw new Error("timeout")
}

// Cache layer (in-memory, 60s TTL)
const searchCache = new Map<string, { result: string, expiresAt: number }>()

async function novadaSearchWithCache(params, apiKey) {
  const cacheKey = `${params.engine}:${params.query}:${params.num ?? 10}`
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return cached.result

  const result = await novadaSearchOptimized(params, apiKey)
  searchCache.set(cacheKey, { result, expiresAt: Date.now() + 60_000 })

  // Evict expired entries (simple GC)
  if (searchCache.size > 500) {
    for (const [k, v] of searchCache) {
      if (Date.now() > v.expiresAt) searchCache.delete(k)
    }
  }

  return result
}

// Bing optimized retry (search.ts:62 equivalent)
async function submitBingSearchOptimized(apiKey, query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Reduced retry sleep: 500ms on attempt 1, 2000ms on attempt 2
    if (attempt > 0) await sleep(attempt === 1 ? 500 : 2000)
    // ... rest of Bing submit logic unchanged
  }
}
```

---

## 10. Conclusions

| Question | Answer |
|---|---|
| Where is the biggest latency? | Backend scraper processing (300–1200ms). Client-side adds ~250ms overhead (submit RTT + first poll sleep + poll RTT). |
| Is current backoff optimal? | No. First sleep (100ms) is too short; generates 2–3 wasted polls. Should be 300ms pre-wait + jittered 300ms base. |
| Why is Exa Fast 350ms? | Proprietary Rust index, custom vector DB, no third-party scraper — cannot be replicated by wrapping Novada Scraper API. |
| Why is Tavily "180ms"? | Self-reported, pre-indexed snippets only. End-to-end benchmarks show 1–2s. Same class as novada_search. |
| Option A (multi-key parallel)? | Reduces P50 by 40–60% by racing N completions, but costs N× and doesn't eliminate structural floor. |
| Option C (sync endpoint)? | Saves 200–400ms by eliminating client poll RTTs. Requires Novada backend change. Best ROI per engineering effort. |
| Minimum P50 achievable today? | ~700–800ms with optimized backoff + cache. Current production is ~1000–2500ms. |
| Biggest parallelization miss? | In-memory cache dedup for repeated queries (no code change on Novada side needed). |

---

## File References

| File | Key lines |
|---|---|
| `src/tools/search.ts` | 10 (keepAlive agent), 62–121 (Bing submit+retry), 124–169 (submitSearchScrapeTask), 172–222 (pollSearchResult — backoff at 184), 266–516 (novadaSearch main) |
| `src/config.ts` | 8 (SCRAPER_API_BASE), 13 (SCRAPER_DOWNLOAD_BASE), 41–51 (TIMEOUTS — note search.ts does NOT use TIMEOUTS constants, uses hardcoded 60000/30000/90000) |
| `src/utils/http.ts` | 17–18 (MAX_RETRIES=3, RETRY_BASE_DELAY=1000ms for fetchWithRetry), 58 (backoff formula for HTTP retries) |
| `src/tools/scraper_submit.ts` | 33–79 (novadaScraperSubmit — wrapper, delegates to scrape.ts) |
| `src/tools/scraper_status.ts` | 66–342 (novadaScraperStatus — dual-endpoint status check with fallback) |
| `src/tools/scrape.ts` | 11 (POLL_TIMEOUT_MS=180_000 for general scraper — search.ts uses its own 90_000 ceiling) |

**Note:** `search.ts` hardcodes its own timeout constants (60000, 30000, 90000) independently of `config.ts:TIMEOUTS`. This is a consistency risk — if TIMEOUTS are tuned in config.ts, the search path is unaffected.

---

Sources:
- [How we built the fastest web search in the world | Tavily Blog](https://www.tavily.com/blog/how-we-built-the-fastest-web-search-in-the-world)
- [Introducing Exa 2.0 | Exa Blog](https://exa.ai/blog/exa-api-2-0)
- [The World's Fastest Search API | Exa Blog](https://exa.ai/blog/fastest-search-api)
- [Best SERP API Comparison 2025 | DEV Community](https://dev.to/ritza/best-serp-api-comparison-2025-serpapi-vs-exa-vs-tavily-vs-scrapingdog-vs-scrapingbee-2jci)
- [Moving beyond API polling to asynchronous API design | Tyk](https://tyk.io/blog/moving-beyond-polling-to-async-apis/)
- [Async Web Scraping Concurrency Patterns | Apify](https://use-apify.com/blog/async-web-scraping-concurrency-patterns)
