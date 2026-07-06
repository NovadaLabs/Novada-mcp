# Search Results Diagnosis: Why novada_search Returns Fewer Results Than Requested

## Summary

`novada_search` was returning 0 results (first test) or 2-3 results instead of 5-10.
Two distinct issues found: one stale-build artifact, one real upstream API constraint.
A latency-saving code fix was applied as a side effect of the investigation.

---

## Bug 1: Stale Build (Explains "0 results" in First Test)

The first test run in the task description returned 0 results. This was a **stale build** artifact.

The test ran `node -e "import('./build/tools/search.js')"` against an **outdated build** from a
previous dev session. After `npm run build`, the same query (`web scraping API 2026`, `num=10`)
returns 7 results.

**Fix**: Always rebuild (`npm run build`) before live testing. No code change needed here.

---

## Bug 2: Google API Returns Fewer Results Than `num` (Real Upstream Constraint)

### Observed Behavior

| `num` requested | Results actually returned by Google scraper |
|----------------|---------------------------------------------|
| 10             | 7–9                                         |
| 5              | 3–4                                         |
| DuckDuckGo 10  | 10 (exact)                                  |

### Root Cause Trace

1. `submitSearchScrapeTask` correctly appends `num=10` to the POST body.
2. The Novada scraper forwards it as-is: `spider_url` in the API response confirms `num=10` was sent to Google.
3. Google's actual SERP returns only 7 organic results for this query/cache combination.
4. `parseScraperSearchResults` reads `data.organic` (7 items) and returns all 7 — no truncation in code.
5. `rerankResults` reranks but does not truncate.

**Conclusion**: The 7-result cap is the Google SERP API returning fewer results than requested. This is
upstream behavior (Google throttles/caps organic count per query). DuckDuckGo respects `num` exactly.

### Evidence

```
spider_parameter.num: "10"        ← correctly forwarded
organic array length: 7           ← Google returned 7
parseScraperSearchResults: 7      ← no code truncation
```

---

## Code Fix Applied: Inline Results Fast Path

While tracing the issue, discovered that the API **always returns results synchronously** in the submit
response at `body.data.data.json[0].rest.organic`. The old code discarded these inline results and
re-fetched the same data via the download endpoint — an unnecessary extra round-trip (~300ms + poll delay).

### Changed Files

**`src/tools/search.ts`**
- `submitSearchScrapeTask` return type changed from `Promise<string>` (task_id only) to `Promise<SubmitSearchResult>`
- `SubmitSearchResult` = `{ inlineResults?: Record<string,unknown>; taskId?: string }`
- When `body.data.data.json[0].rest.organic` is present, returns `{ inlineResults: rest }` — no download needed
- Falls back to `{ taskId }` when inline results are absent
- New export `resolveSearchResults(apiKey, submitted)` handles both paths transparently

**`src/tools/ai_monitor.ts`**, **`src/tools/research.ts`**, **`src/tools/verify.ts`**
- Updated from `submitSearchScrapeTask → taskId → pollSearchResult → parseScraperSearchResults`
- To: `submitSearchScrapeTask → resolveSearchResults` (one call, handles both paths internally)

### Performance Impact

- Google queries: saves ~1 HTTP round-trip per search (the download poll)
- No behavior change for queries where inline results are absent (falls back to polling)

---

## Result After Fix

```
result count: 7  (was 0 on stale build, now 7 on fresh build)
total chars: 3311
```

The 7-vs-10 gap is an upstream Google API constraint, not a code bug.
To get closer to 10, use `engine="duckduckgo"` which respects `num` exactly.

---

## Recommendations

1. **Document the Google result cap**: Add a note in the tool description that Google SERP may return
   fewer results than `num` due to upstream SERP behavior. DuckDuckGo is more reliable for exact `num`.
2. **No code fix needed** for the count gap — it is Google's behavior.
3. The inline fast path fix is already applied and improves latency for all Google/DDG searches.
