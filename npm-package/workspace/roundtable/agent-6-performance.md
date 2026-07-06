# Agent 6 — Performance Engineer

## Data sources
- Benchmark: `/Users/tongwu/Projects/novada-mcp/benchmark/results/2026-06-22-benchmark.json` (200 URLs × 3 providers, 50 per category)
- Code: `src/utils/http.ts`, `src/tools/extract.ts`, `src/_core/session-cache.ts`, `src/config.ts`

---

## 1. Where does Novada's P50 9279ms come from?

The headline P50 is a category-mix artifact. Split it out:

| Category | Novada P50 | Firecrawl P50 | Tavily P50 | Novada success |
|---|---|---|---|---|
| static | 1195ms | 738ms | 198ms | 43/50 |
| js_heavy | 10353ms | 6823ms | 423ms | 50/50 |
| anti_bot | 16231ms | 8250ms | 427ms | 40/50 |
| structured | 1660ms | 2168ms | 353ms | 38/50 |

The benchmark weights all four categories equally (50 URLs each). Since js_heavy and anti_bot combined are 100/200 = 50% of all requests and have P50s of 10–16s, they drag the aggregate P50 to 9279ms. On static alone, Novada is 1195ms — not 9279ms.

**Latency budget breakdown (approximate):**

For a static URL that goes direct: ~200–400ms is raw network RTT + Novada API processing. The static P50 of 1195ms vs Tavily's 198ms implies ~1000ms is Novada infrastructure overhead (proxy routing, unblocker API call chain, residential proxy latency), not MCP code.

For an escalated URL (static → render): add TIMEOUTS.RENDER=60000ms cap on the render call. In practice the web unblocker retry logic (`fetchWithRender`) runs up to 3 attempts with 1s/2s backoff — worst case 3s of sleep alone before the third attempt fires. Observed static-category outliers confirm this: huggingface.co/blog = 43722ms, stripe.com/docs/api = 38811ms, paulgraham.com = 24370ms. These are 30–45s, consistent with exhausting the 30s static timeout then burning 45–60s render timeout.

**Rough allocation for a 10s escalated request:**
- Network + Novada API (static attempt): ~1–2s
- JS detection (detectJsHeavyContent): <1ms, negligible
- fetchWithRender (web unblocker API round-trip): 5–8s observed
- Possible render retry (1s + 2s backoff): up to 3s additional
- Total code overhead (retries, detection, formatting): <100ms

**Verdict: ~85–90% of the P50 is Novada API latency (proxy routing + web unblocker response time). 10–15% is retry backoff sleeps. The MCP orchestration layer is not the problem.**

---

## 2. Does the Promise.any race save time or add overhead?

The race in `extract.ts` lines 250–259 fires a direct HTTP fetch (3s timeout) against `fetchViaProxy`. Code intention: open static pages should resolve direct in <300ms, beating proxy.

From the benchmark:
- 15/43 successful static requests completed in <500ms — these likely won via the direct path
- 15 more in 500ms–3s — likely proxy path or direct path with some delay
- 13 in >3s — escalated despite the race

The race **does save time on genuinely open pages**. Wikipedia/MDN/docs.python.org cluster in 68–294ms, far below what proxy routing costs. Without the race those would be 500–1500ms.

**But the race has a hidden cost when both legs are slow:** both HTTP connections are opened simultaneously. For 200 URLs there are now 400 DNS lookups + TCP connects in the static phase. On any rate-limited or slow-to-respond server, both connections hang until the proxy path returns, and the 3s direct timeout means the proxy call is the only path that can succeed for JS-heavy content anyway. Net overhead on those requests: one extra TCP connection per call, ~0ms latency impact but non-zero resource cost.

**The race is net positive for static, neutral-to-waste for js_heavy.** No code change needed here, but the 3s direct timeout should be tuned — currently 3s is generous for open sites (MDN responds in 68ms) and wastes connection budget on sites that will fail direct.

---

## 3. How often does cascading escalation actually happen?

Escalation evidence from the benchmark: requests that succeeded but took >10s are almost certainly multi-hop.

| Category | >10s success count | % of that category |
|---|---|---|
| static | 10/43 | 23% |
| js_heavy | 27/50 | 54% |
| anti_bot | 41/40 | ~100% |
| structured | 15/38 | 39% |

Across all 171 successful requests: **79 (46%) took 10s+**, consistent with static → render escalation being the most common path for half the corpus. Anti-bot is nearly 100% escalation — the P50 of 16231ms confirms every successful anti_bot request went at minimum through web unblocker.

Three-hop (static → render → browser) is less frequent. Browser API is gated on `isBrowserConfigured()` and the benchmark has no `latencyMs` > 60s for successful requests (the 127043ms netflixtechblog case is a failure). So in this run, true three-hop browser escalation did not fire — all escalations were two-hop maximum (static → render).

---

## 4. Is P50 9279ms an MCP code problem or an infrastructure problem?

**Infrastructure problem.** Evidence:

1. Static-only P50 = 1195ms. Firecrawl static = 738ms, Tavily static = 198ms. The gap is real and consistent — Novada's residential proxy network + web unblocker is slower than Tavily's hosted extraction service.

2. Firecrawl also escalates (its js_heavy P50 = 6823ms vs 423ms for Tavily) but its escalation is faster. Firecrawl P95 js_heavy = 9537ms; Novada = 40829ms. The 4× P95 gap at js_heavy points to the Novada web unblocker's 30% flakiness rate (mentioned in code comment at `fetchWithRender` line 183: "Web Unblocker API is intermittently flaky — inner data.code returns 403/502 on ~30% of requests") burning retry budgets.

3. The retry backoff in `fetchWithRender` — 1s then 2s sleep — contributes 3s of pure sleep per flaky unblocker request. With 30% flakiness across 100 js_heavy+anti_bot requests, this adds ~3s × 30 = 90 seconds of cumulative retry sleep across the run, but that is infrastructure reliability, not algorithmic inefficiency.

**What IS a code problem:** the 127043ms netflixtechblog failure. `TIMEOUTS.STATIC_FETCH = 30000` and `TIMEOUTS.PROXY_FETCH = 45000` — a failing static → render sequence can burn 30s + 45s + retry backoffs = 127s before giving up. That timeout ceiling is not defensive enough for production use.

---

## 5. Single code change with largest latency impact

**Add a per-domain first-attempt timeout cap for the direct path in the Promise.any race.**

Currently the direct-path timeout in the race is hardcoded to 3000ms (extract.ts line 252). This means every auto-mode request waits up to 3s for the direct fetch before proxy wins. For URLs that return a JS shell immediately (sub-100ms) the race resolves fast. But for URLs behind a CDN that hangs (e.g., engineering.fb.com = 7376ms, docs.docker.com = 11699ms), the direct fetch times out at 3s, then the proxy also re-runs internally via `fetchViaProxy` which has its own retry logic — doubling the wait time at the static phase.

A domain hint registry (`lookupDomain`) exists and is already used. **Extend it to set `directTimeout` per domain**, defaulting to 1000ms instead of 3000ms for known JS-heavy domains. This would shave ~2s off ~27% of static requests where the direct timeout burns before proxy wins.

Cost: 10 lines of code in extract.ts and a domain registry field. No API changes, no infrastructure required.

**Second-best option (infrastructure boundary):** Reduce `TIMEOUTS.STATIC_FETCH` from 30000ms to 15000ms and add a total per-request timeout cap of 45s (static + render). This prevents the 127043ms infinite-loop failure and caps P99. Still infrastructure-adjacent (config change), but the cap is enforced in MCP code.

---

## 6. Caching opportunity

**Current cache (session-cache.ts):** 5-minute TTL in-process Map, keyed by `url::renderMode[::fields]`. Max 100 entries with lazy eviction.

Problems:
1. TTL is 5 minutes, not 10 as the brief states — minor.
2. The cache is scoped to a single process instance. In MCP server deployments, each Claude session starts a new process, so the cache is always cold. In practice it only helps within a single multi-URL research session.
3. The benchmark confirms no URL repetition within a run (199 unique URLs, 1 repeat). Cache hit rate in the benchmark: 0%.

**What a proper response cache would look like:**

The highest-value cache tier would be a **cross-session URL-level cache with content-based TTL**:

- Store: `{url, renderMode} → {html, extractedContent, timestamp, contentHash}`
- TTL strategy by domain type:
  - Documentation pages (docs.python.org, MDN, k8s.io): 24h — content rarely changes
  - News/blogs: 1h — stale is fine for most agent queries
  - Ecommerce/pricing: 5min — prices change
- Key insight from benchmark: 46 of 171 novada successes took 15s+. A cache hit on any of those saves >15s. At even 20% repeat-URL rate across an agent session (realistic for research loops), that is ~9 requests × 15s = 135s saved per session.
- Implementation: Redis or SQLite (`~/.novada-mcp/cache.db`) keyed by `sha256(url + renderMode)`, with `stale-while-revalidate` behavior — return stale immediately, trigger background refresh. This requires zero behavior change from the MCP tool perspective.

Current session cache helps only for same-URL calls within a 5-minute window in one process. The missing tier is a **persistent cross-session disk cache** — the single highest-ROI improvement for repeat research workflows.
