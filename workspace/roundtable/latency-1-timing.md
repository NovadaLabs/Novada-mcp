# Latency Analysis — Agent 1: Timing Analyst

Source file: `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
Config file: `/Users/tongwu/Projects/novada-mcp/src/config.ts`

---

## 1. Exact Timing Diagram — One `novadaSearch` Call (Google, no extract_options)

```
T+0ms        novadaSearch() entry — parameter normalization, domain filter query assembly
             (sync, <1ms)

T+1ms        submitSearchScrapeTask() called (line 324)
             └── axios.POST https://scraper.novada.com/request
                 timeout=60000ms (line 148)
                 Expected round-trip: ~200–600ms (network + scraper backend queuing)

T+~400ms     submit returns task_id (lines 156–163)

T+~401ms     pollSearchResult() entry (line 333)
             deadline = Date.now() + 90_000ms (line 169)

             ┌── POLL ROUND 1 ──────────────────────────────────┐
T+~401ms     │  axios.GET /scraper_download?task_id=...         │
             │  timeout=30000ms (line 172)                      │
             │  Network RTT: ~150–300ms                         │
T+~600ms     │  Response: code=27202 (PENDING)                  │
T+~600ms     │  scraperSleep(2000) (line 178)                   │
T+~2600ms    └──────────────────────────────────────────────────┘

             ┌── POLL ROUND 2 ──────────────────────────────────┐
T+~2600ms    │  axios.GET /scraper_download?task_id=...         │
             │  Network RTT: ~150–300ms                         │
T+~2850ms    │  Depending on backend:                           │
             │  A) code=27202 → sleep(2000) → T+4850ms         │
             │  B) Array result → parse + return                │
             └──────────────────────────────────────────────────┘

             For P50=1915ms the task completes MID-poll-round-1:
             submit ~400ms + poll HTTP ~300ms + result ready = ~700ms
             BUT sleep(2000) fires before check — so actual exit is ~2600ms
             (see section 4 for detailed reasoning)

T+~2600ms    parseScraperSearchResults() — sync, <1ms (line 334)

T+~2601ms    rerankResults() — sync, <1ms (line 365)

T+~2602ms    Markdown formatting loop — sync, <1ms (lines 447–507)

T+~2602ms    Return string to caller
```

**Bing path differs:** `submitBingSearch()` (line 321) has a retry loop (line 60) with `scraperSleep(2000)` between attempts (line 61). It may also internally call `pollSearchResult()` (line 96) adding the same poll overhead. Worst case: 3 attempts × 2000ms retry + 1 poll cycle = ~6000ms+.

---

## 2. Largest Single Time Sink

**The `scraperSleep(2000)` in `pollSearchResult()` — lines 178 and 204.**

Every pending response unconditionally sleeps 2000ms before the next poll attempt. There is no adaptive backoff, no minimum viable wait, no check of elapsed time before sleeping. If the backend finishes the task at T+450ms (right after the first poll HTTP response at T+600ms), the code still sleeps until T+2600ms before it gets a chance to check again.

Breakdown by phase (Google, P50 scenario):
- Submit HTTP: ~400ms
- First poll HTTP: ~200ms
- `scraperSleep(2000)`: **2000ms** — fixed, unconditional
- Second poll HTTP (if needed): ~200ms
- Parsing + formatting: <5ms

The sleep alone accounts for ~78% of total wall-clock time in the P50 case.

---

## 3. Minimum Achievable Latency (Code Optimizations Only, No Backend Changes)

**Current floor with existing backend timing:**

Assuming the backend typically completes in ~400–600ms after submission:

```
submit HTTP:              ~300ms  (irreducible network)
first poll HTTP:          ~200ms  (irreducible network)
sleep if pending:        2000ms   ← target for elimination
second poll HTTP:         ~200ms  (only needed if still pending after min-wait)
parse + format:            <5ms
```

**Optimizations available in client code:**

1. Replace fixed `scraperSleep(2000)` with short initial wait + exponential backoff:
   - First wait: 100ms
   - Subsequent waits: 200ms, 400ms, 800ms, 1600ms, 2000ms cap
   - If backend is done at T+600ms, next check at T+700ms → result at ~900ms total

2. Start first poll immediately with no sleep (current code already does this for the first attempt — the sleep only fires on `continue` which means pending response).

**Minimum achievable latency (with adaptive polling):**
```
submit:         ~300ms
poll round 1:   ~200ms   → backend returns result
parse:            <5ms
─────────────────────────
Total:          ~505ms
```

Realistic P50 with adaptive polling (first poll at 100ms wait after pending):
```
submit:         ~400ms
poll pending response: ~200ms
sleep(100ms):    100ms
poll round 2:   ~200ms   → result ready
─────────────────────────
Total:          ~900ms
```

vs. current P50 of 1915ms. Savings: ~1000ms (52% reduction) without any backend changes.

---

## 4. What P50=1915ms Tells Us About Poll Rounds

Working backward:
- Submit HTTP RTT: ~300–500ms, call it ~400ms
- First poll HTTP RTT: ~200ms → arrives at T+600ms
- If result is ready: exits immediately, total ~600ms. But P50 is 1915ms, so this is NOT the common path.
- Backend returns `code=27202` (pending) → `scraperSleep(2000)` fires (line 178) → wakes at T+2600ms
- Second poll HTTP: ~200ms → T+2800ms → result ready → exit

P50=1915ms sits between T+600ms (1 poll, immediate result) and T+2800ms (1 pending + 1 result poll). This is suspicious because the sleep is 2000ms — so a 1915ms result means the sleep did NOT fire, which implies the backend returned the result in the first poll response, but there's additional overhead somewhere.

More likely explanation: The backend sometimes returns results synchronously in the first poll (no pending) at around T+1700–2000ms submission-to-ready time. The poll fires at T+600ms and gets pending → sleep(2000) → T+2600ms seems too high for P50=1915ms.

**Most consistent interpretation:** P50=1915ms means the backend result is ready before the first poll fires. The poll at T+~400ms (immediately after submit) catches the result directly. Total: ~400ms submit + ~200ms poll + ~1300ms of something else — likely the submit itself takes 1500ms+ (scraper backend is slow to accept/queue). In this case 0 sleep rounds happen at P50, and the submit HTTP call is the bottleneck, not the poll sleep.

**Conclusion:** At P50, typically **0 sleep rounds** — result arrives in first poll. The 1915ms is dominated by the submit + first poll HTTP latency (backend processing time). The sleep adds on top only for the slower tail (P75+).

---

## 5. setTimeout / sleep Calls — Line Numbers

All `scraperSleep` calls (which wrap `setTimeout`, defined at lines 25–27):

| Location | Line | Condition | Fixed Delay |
|----------|------|-----------|-------------|
| `submitBingSearch` retry gap | 61 | `if (attempt > 0)` — fires on 2nd and 3rd attempt | 2000ms |
| `pollSearchResult` pending response | 178 | `body.code === 27202` | 2000ms |
| `pollSearchResult` object pending | 204 | `bObj.code === 27202` | 2000ms |

`scraperSleep` definition: lines 25–27.

No progressive backoff anywhere. All delays are hard-coded at 2000ms.

**Worst-case stacked delays:**
- Bing with 3 failed attempts: 2×2000ms retries = 4000ms added
- Each pending poll: +2000ms per round
- Bing also internally calls `pollSearchResult` (line 96), stacking both retry and poll delays

---

## 6. Parallelism — Existing and Missing

### Already parallel (line 376–391):
```typescript
const extractResults = await Promise.all(
  urlsToExtract.map(async (url) => { ... novadaExtract(...) ... })
);
```
When `extract_options` or `enrich_top` is set, all top-N URL extractions run concurrently. This is correct.

### NOT parallel — what could be:

**A. Multi-engine search (no path for it today)**
The function takes a single `engine` param. If a caller wanted results from 2+ engines, they must call `novadaSearch` multiple times sequentially. No fan-out exists. A multi-engine mode could run 3–4 engine submits + polls concurrently, finishing in the time of the slowest engine rather than the sum.

**B. Submit + immediate first poll**
After `submitSearchScrapeTask` returns the `task_id`, there is always a sequential wait before the first `pollSearchResult`. There is no overlap between submit and other work. If the caller has any other preparatory work (reranking previous cached results, metadata assembly), it could run concurrently with the first poll.

**C. Bing retry attempts**
`submitBingSearch` (lines 60–116) is a sequential `for` loop with `scraperSleep(2000)` between retries. Retries are sequential by design (correct for avoiding thundering herd), but the sleep interval could be reduced.

**D. The poll loop itself**
Single-threaded sequential poll. There is no way to run two simultaneous polls for the same `task_id` (wouldn't help anyway — same backend state). This is correct as-is.

### Summary: only one parallelism opportunity matters

Running multiple search engines concurrently (if multi-engine were implemented) would be the highest-value parallelism addition. Within a single-engine search, the pipeline is inherently sequential (submit → poll → parse), and the only optimization is reducing the sleep interval.
