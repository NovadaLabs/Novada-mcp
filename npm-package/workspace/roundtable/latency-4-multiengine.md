# Agent 4 — Multi-Engine Strategist

## Source files examined
- `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts` (full)
- `/Users/tongwu/Projects/novada-mcp/src/config.ts`
- `/Users/tongwu/Projects/novada-mcp/benchmark/results/2026-06-22-search-v2.json`
- `/Users/tongwu/Projects/novada-mcp/workspace/roundtable/agent-6-performance.md`

---

## 1. What engines does novadaSearch support today?

`SCRAPER_SEARCH_ENGINES` (line 9) accepts: **google, bing, duckduckgo, yandex**.

Yahoo is explicitly trapped at entry and returns `YAHOO_UNAVAILABLE` immediately (lines 262-264).

Engine selection is **entirely caller-driven** — no routing logic exists. The `engine` field defaults to `"google"` when omitted (line 259). There is zero automatic engine switching. If a caller passes `engine="duckduckgo"`, that is what runs. If the caller omits engine, Google runs every time.

**How the engine is applied:**

```
engine param → ENGINE_MAP lookup → scraper_name + scraper_id + query_param + supports_num
                                  → submitSearchScrapeTask() → task_id → pollSearchResult()
```

Bing is the only engine with a special code path (`submitBingSearch`, lines 59-117) that uses `a_auto_push=false` instead of `is_auto_push=false` and has its own retry loop with 2s sleep between attempts (up to 3 attempts).

All other engines (google, duckduckgo, yandex) share the same `submitSearchScrapeTask` → `pollSearchResult` async path.

---

## 2. Does the current code support DuckDuckGo? What latency does it add vs Google?

**Yes, DuckDuckGo is supported** — it is in `SCRAPER_SEARCH_ENGINES` and `ENGINE_MAP`:

```
duckduckgo: { scraper_name: "duckduckgo.com", scraper_id: "duckduckgo", query_param: "q", supports_num: true }
```

**Critical finding: DuckDuckGo goes through the SAME async scraper path as Google.**

The code (lines 318-335) shows:

```
if (engine === "bing") {
  scraperResults = await submitBingSearch(...)        // special sync-ish path
} else {
  // google, duckduckgo, yandex all land here
  const taskId = await submitSearchScrapeTask(...)    // POST → get task_id
  const resultData = await pollSearchResult(...)      // poll until done (up to 90s)
  scraperResults = parseScraperSearchResults(resultData)
}
```

**There is no "direct HTML parse" path for DuckDuckGo.** The description string in `/src/index.ts` line 154 says "engine='duckduckgo' is 3x faster than Google" — but this claim is not backed by any code differentiation. DuckDuckGo is submitted to `SCRAPER_API_BASE/request` as a scraper job, gets a `task_id`, and is polled on `SCRAPER_DOWNLOAD_BASE`. This is structurally identical to Google's path.

**Actual latency from benchmark (search-v2.json):**
- Google scraper P50 across 22 successful queries: **1919ms**
- DuckDuckGo was not benchmarked separately (all benchmark queries ran google engine only)
- From code structure: DDG latency = Google latency ± scraper backend variance; no architectural basis for a 3x speedup

**Bing's path does differ:** it uses `a_auto_push=false` which can return an HTML body or `task_id` synchronously in the same response (lines 89-111). If the HTML is returned inline, Bing can skip the polling round-trip. But Bing retries up to 3x with 2s sleep per retry, so worst case Bing is `60s × 3 + 2s + 2s = 184s` before giving up — far worse than Google's 90s poll deadline.

---

## 3. Engine routing strategy: which engine is fastest per query type?

Based on code architecture (not runtime benchmarks — see finding above):

| Query type | Fastest option | Why |
|---|---|---|
| Technical (TypeScript, Docker, etc.) | Google | No architectural difference vs DDG; Google result quality is higher |
| News / current events | Bing | `a_auto_push=false` may return synchronous HTML; Bing is tuned for news freshness |
| Short/simple queries | Bing (if sync HTML returned) or Google | DDG has no code-level speed advantage |
| Privacy-sensitive | DuckDuckGo | No personalization, but same latency as Google |

**The "DuckDuckGo is faster" claim in the MCP description is marketing copy, not a code reality.** Both engines go through the same async scraper pipeline. Until DuckDuckGo is given a direct HTML parse path (bypassing the scraper API), it offers no latency advantage.

---

## 4. Fallback chain design: Google timeout → DuckDuckGo

**Current state:** No fallback chain exists. If Google's scraper times out at 90s (`pollSearchResult` deadline), the error propagates to the catch block (lines 336-346), which returns `SERP_UNAVAILABLE` or re-throws. There is no retry with a different engine.

**The premise of the brief (DuckDuckGo as a 500ms synchronous HTML fallback) does not match the code.** DuckDuckGo is also async-scraper-backed. A true fast fallback would require fetching `https://html.duckduckgo.com/html/?q=<query>` directly and parsing the response with cheerio — analogous to `parseBingHtml` but for DDG's HTML endpoint.

**What a real fallback chain would require:**

```typescript
// Step 1: Attempt Google via scraper API with 3s timeout gate
try {
  const taskId = await submitSearchScrapeTask(..., "google.com", "google_search", ...);
  // Add Promise.race with 3s abort signal
  const resultData = await Promise.race([
    pollSearchResult(apiKey, taskId),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))
  ]);
  return parseScraperSearchResults(resultData);
} catch (timeoutErr) {
  // Step 2: Direct DDG HTML fetch — no scraper API involved
  return await fetchDuckDuckGoDirectHtml(query);  // must be written
}
```

`parseBingHtml` (lines 30-51) is the only existing synchronous HTML parser. There is no `parseDuckDuckGoHtml` function. Building the DDG direct path would require:
1. A new `fetchDuckDuckGoDirectHtml(query)` function hitting `https://html.duckduckgo.com/html/?q=...`
2. A new `parseDuckDuckGoHtml(html)` using cheerio (DDG's HTML DOM selectors differ from Bing's `li.b_algo`)
3. A 3s timeout gate on the primary Google scraper call before invoking the fallback

**Neither (1) nor (2) exists today.**

---

## 5. Would DuckDuckGo fallback have saved the 2 failed keywords?

The 2 failed queries from search-v2.json:
- `Python dataclass vs pydantic comparison` — failed with empty error, 1424ms
- `machine learning model deployment best practices` — failed with empty error, 1737ms

Both failures are engine-agnostic: they appear to be Scraper API quota/auth failures (the error field is empty, consistent with the `SERP_UNAVAILABLE` branch at lines 336-346 catching AxiosError). These are **account-level failures, not engine-level failures**.

**DuckDuckGo via the same scraper API would fail identically.** The account lacks SERP quota; any engine routed through `SCRAPER_API_BASE` hits the same gate.

A **direct DDG HTML fetch** (bypassing the scraper API entirely) would have saved both queries, because it requires no API key and no quota — just a raw HTTP GET to DDG's HTML endpoint. This is the only architectural path that would rescue SERP-quota failures.

---

## 6. Engine router function by query type

This is a design proposal. The code does not contain anything like it today.

```typescript
type QueryEngine = "google" | "bing" | "duckduckgo";

interface QueryCharacteristics {
  isTechnical: boolean;
  isNews: boolean;
  isSimple: boolean;
}

function classifyQuery(query: string): QueryCharacteristics {
  const techKeywords = /\b(typescript|javascript|python|rust|go|docker|kubernetes|sql|api|react|vue|angular|aws|gcp|azure|linux|bash|git|npm|cargo|pip)\b/i;
  const newsKeywords = /\b(news|breaking|latest|today|yesterday|2024|2025|2026|announced|released|launch|update|report)\b/i;
  const wordCount = query.trim().split(/\s+/).length;

  return {
    isTechnical: techKeywords.test(query),
    isNews: newsKeywords.test(query),
    isSimple: wordCount <= 3,
  };
}

function selectEngine(query: string, params: { engine?: string }): QueryEngine {
  // Explicit engine from caller always wins
  if (params.engine && params.engine !== "google") {
    return params.engine as QueryEngine;
  }

  const { isTechnical, isNews } = classifyQuery(query);

  if (isNews) return "bing";          // Bing freshness index + potential sync HTML response
  if (isTechnical) return "google";   // Google depth on technical docs (no DDG advantage yet)
  return "google";                    // Default: Google scraper
  // Note: return "duckduckgo" only after a direct HTML parse path is implemented
}
```

**Current recommendation: do not route any queries to DuckDuckGo** until `fetchDuckDuckGoDirectHtml` exists. Routing to DDG via scraper API provides identical latency and worse result quality for technical queries.

---

## 7. P50 latency with 40% DuckDuckGo / 60% Google

**Based on code reality (DDG = same scraper path as Google, ~1915ms):**

| Mix | P50 |
|---|---|
| 100% Google | 1919ms (observed) |
| 40% DDG scraper + 60% Google | 1919ms (P50 unchanged — both groups are ~1919ms) |
| 40% DDG direct HTML (500ms) + 60% Google scraper (1919ms) | **1919ms** |

**Why P50 stays at 1919ms with 40% DDG direct:**

Sort the combined distribution: 40 values at 500ms followed by 60 values at 1915ms. The 50th value (P50) is the first item from the 1915ms group — **1919ms unchanged**. P50 only breaks below 1919ms when the fast-path share exceeds 50%.

| DDG direct share | P50 | Mean |
|---|---|---|
| 40% (500ms) | 1919ms | 1349ms |
| 50% (500ms) | 500ms (threshold crossed) | 1208ms |
| 60% (500ms) | 500ms | 1066ms |

**To move the P50, DDG direct must cover >50% of traffic.** At 40%, the P50 is unchanged but the mean drops from 1919ms to 1349ms (-29%). The P25 drops from 1919ms to 500ms, which is meaningful for the fastest half of the fast cohort.

**Real-world implication:** if 40% of queries are technical and routed to DDG direct (once the direct path exists), the agent-visible median latency stays at 1.9s but mean latency improves by ~570ms. To actually move the headline P50, coverage must exceed 50%, which would require routing news + simple queries to DDG direct as well.
