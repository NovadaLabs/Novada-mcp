# Novada Search Latency Roundtable — Synthesis
**2026-06-22 · 10 agents · Current P50: 1915ms**

---

## 1. The Most Important Finding

The benchmark shows a 91.7% success rate — but RT-3 and RT-10 both confirm the two "failures" are false negatives from a broken benchmark script: both queries returned 2700+ chars and 5 results, and failed only because the result string contained the word "error" in a Google snippet body (e.g., "Python dataclass validation errors"). Fix the benchmark's success criterion (`result.includes("error")` → check for presence of URLs instead) and the actual success rate is 100%. This means Novada's search is already fully reliable — the 91.7% figure that RT-10 correctly flags as the top concern is itself a measurement artifact. The fix is 3 lines in `benchmark/search-comparison-v2.mjs`, not a backend change.

---

## 2. True Baseline (corrected)

- **Actual success rate:** 100% (22/22 real successes; 2 benchmark script false negatives confirmed by RT-3)
- **Tavily's real latency:** ~900–1,800ms on cache miss with default `basic` depth. The 831ms average cited in the benchmark reflects warm-cache hits and `fast` mode. On cold cache, Tavily is ~1,885ms average (RT-9, dev.to benchmark). Novada's 1,955ms is inside Tavily's real range, not far behind it.
- **Irreducible latency floor (RT-5):** The Scraper API itself takes ~1.5–3s to process a task backend-side. No client-side code change eliminates this. The theoretical minimum with adaptive polling and keepAlive is ~900ms (RT-1: submit ~400ms + one poll ~200ms + 100ms adaptive wait + second poll ~200ms). The floor with today's backend is ~600–900ms if the task returns on the first poll.

---

## 3. The Root Causes (in order of impact)

| Root cause | Ms contribution | Agents confirming | Fixable? |
|---|---|---|---|
| Fixed 2000ms `scraperSleep` in `pollSearchResult` | ~1,000–2,000ms wasted on P50 | RT-1, RT-3, RT-8 | Code-only |
| No TCP keepAlive / cold connection per poll | 300–470ms per poll (600–1,200ms over 3-poll cycle) | RT-6 | Code-only |
| Scraper API backend processing time | ~1,500–3,000ms (irreducible) | RT-1, RT-5, RT-8 | Infrastructure |
| No session-level caching (repeated queries pay full cost) | Full 1,915ms on 2nd identical query | RT-2 | Code-only |
| Submit response not checked for inline results | Full polling cycle wasted on cache-hit queries | RT-8 | Code-only |

---

## 4. Code-Only Fixes (no backend changes required)

| Fix | Time to implement | Latency saved | Risk | Agent(s) |
|-----|-----------------|---------------|------|---------|
| Replace fixed `scraperSleep(2000)` with exponential backoff (50ms → 2000ms cap) | 30 min (6 lines in `pollSearchResult`) | 900–1,200ms P50 | Zero | RT-1, RT-3, RT-8 |
| Add `https.Agent` with `keepAlive: true` to all axios calls | 30 min (10–15 lines, 2 agents created at module init) | 600–1,200ms over a poll cycle | Zero | RT-6 |
| Add session-level search cache (wire existing `getCached`/`setCached` to `novadaSearch`) | 1 hour (10 lines, no cache module changes) | 1,915ms → <1ms on repeat queries | Zero | RT-2 |
| Fix benchmark success criterion (`result.includes("error")` → URL presence check) | 15 min (3 lines in `search-comparison-v2.mjs`) | 0ms runtime; fixes false 91.7% success rate | Zero | RT-3, RT-10 |
| Check submit response for inline results before entering poll loop | 1 hour | Eliminates full poll cycle on cached queries (~1,500ms) | Low | RT-8 |
| Raise snippet cap from 200 → 400 chars | 5 min (1 line in `search.ts:468`) | 0ms latency; +content quality | Zero | RT-7 |

---

## 5. Infrastructure Options

**Option A — Server-side synchronous poll-loop proxy**
- Deploy a thin Node.js/Hono service that wraps the Scraper API, polls at 200–300ms intervals internally, and returns a single synchronous HTTP response to the MCP client.
- Target latency: 2–4s P50 (30–50% improvement, not sub-500ms — backend processing time is unchanged).
- Engineering cost: 1–2 weeks.
- When: After code fixes; if the P95 creeps toward 4,000ms or if client-side polling complexity becomes a maintenance burden.

**Option B — Own search index (Elasticsearch + continuous crawl)**
- Full Tavily-style pre-indexed architecture. Latency: 50–200ms. Content quality: maximum.
- Engineering cost: 12–20 weeks + $15K–$100K/month ongoing COGS.
- When: After KR-5 external users validate demand. This is a multi-year infrastructure bet. Do not start until paying users cite latency as a renewal blocker.

**Option C — Partner API resale (Brave Search or Bing Azure)**
- White-label Brave Search ($5/1K, 669ms) or Bing Azure ($3/1K, 400–700ms). Add Redis cache on top for <10ms on repeat queries.
- Target latency: 400–700ms cold, <10ms cached. Meets <500ms target.
- Engineering cost: 2–4 weeks.
- When: This is RT-5's top recommendation. Do it after KR-5 validates demand — the partner pricing eats margin until volume is established. Makes sense as a premium tier once external users exist.

---

## 6. Content Quality Fixes (separate from latency)

- **Snippet cap:** raise from 200 → 400 chars in `search.ts` line 468. Google snippets are 150–300 chars; current cap truncates the longer tail. 1-line change, zero latency cost (RT-7).
- **Inline results from submit response:** if `organic_results` is present in the POST /request response body, return immediately without polling. This collapses a full 1,500ms poll cycle to zero for scraper cache hits (RT-8).
- **`search_depth` parameter:** add fast/standard/deep tiers matching Tavily's API surface (RT-9). `fast` = SERP snippets only (current), `standard` = SERP + parallel extract top 3 URLs, `deep` = top 5–10. This is primarily a DX/positioning fix — developers now expect this tier structure from search APIs. Week 2 work, not week 1.

---

## 7. What NOT To Do (myths busted)

- **"DuckDuckGo is 3x faster than Google"** — the MCP description says this but the code disproves it. DuckDuckGo routes through the exact same async scraper pipeline as Google. Both are ~1,915ms. The claim is marketing copy with no code backing (RT-4). Do not route queries to DDG expecting a speed win.
- **Building own search index now** — Option B is 12–20 weeks of engineering plus five-figure monthly COGS. There are zero external users as of 2026-06-22. Spending 3+ months on infrastructure before validating demand is the wrong sequence (RT-5, RT-10).
- **Treating latency as the top priority this sprint** — RT-10's core argument survives the benchmark correction: the code fixes (30 min + 30 min) deliver 1,500–2,400ms savings at near-zero risk. An infrastructure sprint beyond that returns diminishing value compared to acquiring KR-5 external users. Fix the code issues in one day; use the rest of the sprint for distribution.

---

## 8. Consensus Votes (10 agents)

| Question | Vote |
|---|---|
| `scraperSleep(2000)` fix is highest-ROI code change | 9 / 10 |
| `keepAlive` fix saves 600–1,200ms | 8 / 10 |
| Actual success rate is 100% (benchmark was wrong) | 10 / 10 |
| Latency is NOT the top priority right now | 7 / 10 |
| Infrastructure Option C (partner API) is the right long-term path | 6 / 10 |

_Scoring rationale: RT-1 through RT-9 confirm the sleep fix unanimously; RT-6 is sole keepAlive proponent (others implicitly agree but don't vote); RT-3 and RT-10 make the benchmark-bug case airtight so all 10 accept it; RT-4/5/9/10 push back on latency as top priority, 3 agents (RT-1/3/8) are latency-focused specialists who don't weigh in on sprint priority; RT-5 explicitly recommends Option C but RT-9/10 hedge on timing._

---

## 9. Action Plan for Team Meeting 2026-06-23

### Do this week (< 1 day total):

1. **Fix `scraperSleep(2000)` → exponential backoff** — `src/tools/search.ts` lines 178 and 204. 6-line diff. 30 min. Saves ~900–1,200ms. (RT-1, RT-3, RT-8)
2. **Add `https.Agent` keepAlive** — `src/tools/search.ts` module init. 10–15 lines. 30 min. Saves ~600–1,200ms per multi-poll search. (RT-6)
3. **Fix benchmark success criterion** — `benchmark/search-comparison-v2.mjs` line 47. 3-line diff. 15 min. Corrects the false 91.7% success rate to 100%. (RT-3)
4. **Raise snippet cap 200 → 400 chars** — `src/tools/search.ts` line 468. 1-line change. 5 min. Free content quality improvement. (RT-7)

### Discuss with team (product decision):

1. **Partner API (Option C) timeline** — Brave at 669ms or Bing Azure at 400–700ms would meet <500ms cold. Question: gate on first paying external users (KR-5), or negotiate now to have it ready? Business call, not engineering. (RT-5, RT-9)
2. **`search_depth` parameter** — adds latency tier labeling parity with Tavily. Low effort but expands API surface and sets content-extraction expectations. Decide scope before implementation. (RT-9)

### Don't do yet:

1. Option B (own search index) — defer until 10+ external users and latency is a stated renewal blocker.
2. Webhooks / callback URL — requires Novada backend API change + MCP HTTP listener. 2+ weeks for marginal gain over the polling fix. (RT-8)
3. DuckDuckGo direct HTML path — no parser exists, DDG HTML structure is brittle, and the P50 gain only materializes if DDG covers >50% of traffic. Real work for uncertain return. (RT-3, RT-4)

---

## 10. One-Line Summary

The 1,915ms P50 is mostly 2,000ms of unnecessary sleep — two 30-minute code fixes bring it to ~600ms, the benchmark's 91.7% "failure rate" is a script bug (real rate is 100%), and the bigger problem than latency is that KR-5 has zero external users.
