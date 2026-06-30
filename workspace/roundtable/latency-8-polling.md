# Agent 8 — Polling Architecture Specialist

## 1. Current Polling State Machine

```
submit task (POST /request)
    |
    v
[SUBMIT]  → axios.post, timeout=60s
    |
    v
[POLL LOOP]  deadline = now + 90_000ms
    |
    +--> GET /scraper_download?task_id=...
    |        timeout=30s per request
    |
    +--> body.code === 27202 (pending)?
    |        YES → sleep(2000ms) → loop
    |        NO  → return result or throw
    |
    v
[TIMEOUT]  Date.now() >= deadline → throw "timed out after 90s"
```

Exact values extracted from `pollSearchResult` (lines 167–214):

| Parameter | Value | Source |
|-----------|-------|--------|
| Deadline | 90,000 ms | `Date.now() + 90_000` |
| Poll interval (fixed) | 2,000 ms | `scraperSleep(2000)` |
| Initial delay | 0 ms | no sleep before first poll |
| Per-poll HTTP timeout | 30,000 ms | `{ timeout: 30000 }` |
| Max polls (theoretical) | 45 | `90000 / 2000` |

There is no `maxPolls` counter. The only exit conditions are: result received, or deadline exceeded.

---

## 2. Expected Polls for P50 Successful Search

Based on typical scraper API behavior for Google/DuckDuckGo SERP tasks:

- Submit latency: ~200–400ms (network + server queuing)
- Task processing time at Novada backend: ~1.5–3s (P50), ~4–6s (P90)

With fixed 2000ms poll interval and no initial delay:

```
t=0ms        submit fires
t=~300ms     task_id received
t=~300ms     first poll fires (no initial delay)
t=~2300ms    second poll fires (2000ms sleep after pending)
t=~4300ms    third poll fires  (2000ms sleep after pending)
```

P50 task completes ~2–3s after submit. Second poll lands at ~2300ms, third at ~4300ms.

**Expected polls for P50 case: 2–3 polls.**

The first poll at ~300ms will almost always be pending. The second poll at ~2300ms catches roughly 50% of tasks. The third poll at ~4300ms catches the remainder of P50–P75.

---

## 3. Adaptive Polling: Exponential Backoff with Jitter

Current waste: if the task completes at t=600ms, we wait until the second poll at t=2300ms — wasting 1700ms unnecessarily.

Proposed schedule:
- First poll: 100ms after task_id received
- Second: +200ms (300ms total)
- Third: +400ms (700ms total)
- Fourth: +800ms (1500ms total) — by here P50 is done
- Cap at 3000ms per interval to avoid runaway waits

**Concrete diff against `pollSearchResult`:**

```typescript
// BEFORE (lines 167–214 in search.ts):
export async function pollSearchResult(apiKey: string, taskId: string): Promise<Record<string, unknown>> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const resp = await axios.get(url, { timeout: 30000 });
    const body = resp.data;

    if (body !== null && typeof body === "object" && !Array.isArray(body) &&
        (body as Record<string, unknown>).code === 27202) {
      await scraperSleep(2000);  // <-- fixed 2s every time
      continue;
    }
    // ... result handling
  }
  throw new Error(`Scraper search task ${taskId} timed out after 90s.`);
}
```

```typescript
// AFTER — exponential backoff with full jitter:
export async function pollSearchResult(apiKey: string, taskId: string): Promise<Record<string, unknown>> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  const deadline = Date.now() + 90_000;

  const BASE_DELAY = 100;   // ms — first poll fires fast
  const MAX_DELAY = 3_000;  // ms — cap per-interval
  let attempt = 0;

  while (Date.now() < deadline) {
    const resp = await axios.get(url, { timeout: 30000 });
    const body = resp.data;

    if (body !== null && typeof body === "object" && !Array.isArray(body) &&
        (body as Record<string, unknown>).code === 27202) {
      // Exponential backoff: 100 * 2^attempt, capped at MAX_DELAY, with ±25% jitter
      const exp = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
      const jitter = exp * 0.25 * (Math.random() * 2 - 1); // ±25%
      const delay = Math.round(exp + jitter);
      attempt++;
      await scraperSleep(delay);
      continue;
    }
    // ... result handling unchanged
  }
  throw new Error(`Scraper search task ${taskId} timed out after 90s.`);
}
```

Resulting poll schedule (deterministic midpoint without jitter):

| attempt | sleep before next poll | cumulative time from task_id |
|---------|------------------------|------------------------------|
| 0       | 100ms                  | ~100ms                        |
| 1       | 200ms                  | ~300ms                        |
| 2       | 400ms                  | ~700ms                        |
| 3       | 800ms                  | ~1500ms                       |
| 4       | 1600ms                 | ~3100ms                       |
| 5+      | 3000ms (capped)        | ~6100ms, ~9100ms, ...         |

P50 tasks completing at ~2s are caught by attempt 3 (cumulative ~1500ms) instead of wasting 2000ms per cycle. **Expected savings: ~500–1000ms on P50.**

---

## 4. Long Polling / Webhooks

**Could the Scraper API support a callback URL?**

The current API only supports pull-based polling. There is no `callback_url` parameter in the submit form (lines 129–148). The API would need Novada backend changes to support push callbacks.

**Hypothetical webhook receiver on the MCP server:**

```
MCP server starts  →  registers webhook endpoint (e.g. POST /webhook/scraper)
submit task        →  include callback_url=https://mcp-host/webhook/scraper
task completes     →  Novada backend POSTs result to callback_url
MCP awaits Promise →  resolves when webhook fires
```

This would eliminate polling entirely. Latency becomes:
```
submit (~200ms) + task processing (~2s) + webhook delivery (~50ms) = ~2.25s
vs current:
submit (~200ms) + task processing (~2s) + poll overhead (~600ms) = ~2.8s
```

**Feasibility blockers:**
1. Requires Novada backend to implement callback_url support — API change.
2. MCP server runs as a CLI process, not a persistent HTTP server. There is no built-in listener.
3. Running an HTTP listener inside an MCP process adds complexity and requires a stable public URL (ngrok/tunnel in dev, fixed URL in prod).
4. For local Claude Code usage, the MCP server is ephemeral per session — no guaranteed URL.

**Verdict:** Webhooks are architecturally superior but require (a) Novada API change and (b) MCP running as a persistent HTTP service. Not practical for the current single-binary MCP deployment model. Long polling remains the correct approach here.

---

## 5. Speculative Fetch Pattern

**Could partial/cached results be returned while polling?**

The download endpoint response format (line 172–213) is binary: it returns either:
- `{code: 27202}` — pending, no partial data
- Array of result objects — complete

There is no streaming or partial result format in the Scraper API response. The endpoint does not send incremental records.

**What "speculative" could mean here:**

1. **Cache hit path**: The `no_cache` parameter is set to `"false"` (line 136), meaning the API *may* return a cached result synchronously in the submit response. If `body.data.organic_results` is present in the submit response, we could return immediately without polling. Looking at `submitSearchScrapeTask` (lines 120–164): it only extracts `task_id` and discards any inline results. This is a real missed optimization — if the submit response already contains results (cache hit), we poll unnecessarily.

2. **Returning stale results while fresh task runs**: Not currently structured for this — the function is synchronous to the caller and blocks until polling completes.

**Practical speculative optimization** (within current API constraints):

```typescript
// In submitSearchScrapeTask: check for inline results before returning task_id
const inner = body.data as Record<string, unknown> | null;

// Cache hit: API returned results directly in submit response
if (inner && ("organic_results" in inner || "organic" in inner)) {
  return { taskId: null, inlineResult: inner };
}
// Normal async path
const taskId = inner?.task_id ?? (inner?.data as Record<string, unknown>)?.task_id;
return { taskId, inlineResult: null };
```

This would eliminate the full polling cycle for cached queries — potentially cutting latency from ~2.5s to ~300ms on repeat searches.

---

## 6. Theoretical Minimum Latency with Polling

Given:
- Network RTT per poll: ~100ms
- Submit RTT: ~200ms (larger payload)
- Task processing: 1500ms (P50 assumption)
- Minimum polls needed: 1 (if first poll fires after task completes)

```
Theoretical minimum:
  submit RTT:          200ms
  task processing:    1500ms  (irreducible — backend work)
  first poll delay:   100ms   (proposed minimum)
  poll RTT:           100ms
  ---------------------------------
  Total:             1900ms

Current P50 actual:
  submit RTT:          300ms
  task processing:    2000ms  (real-world median)
  first poll delay:      0ms  (no initial sleep, but first poll is pending)
  poll 1 sleep:       2000ms  (fixed interval)
  poll 2 RTT:          100ms
  ---------------------------------
  Total:             ~4400ms
```

The 2000ms fixed sleep is the dominant waste term — it alone accounts for ~45% of total latency on P50 cases. Eliminating or reducing it is the highest-leverage change.

---

## 7. Recommendation: Highest-Impact Polling Change

**The one change that delivers the most reduction: replace the fixed 2000ms sleep with exponential backoff starting at 100ms.**

Implementation time: < 30 minutes. Diff is 6 lines (shown in section 3).

Expected impact:
- P50 latency: ~4400ms → ~2600ms (saves ~1800ms, ~40% reduction)
- P25 fast tasks: ~2400ms → ~700ms (saves ~1700ms, ~70% reduction)
- P90 slow tasks: ~8000ms → ~7000ms (modest improvement — already in higher intervals)
- No API changes required
- No new dependencies
- Backward compatible — behavior is identical when tasks are slow

Secondary recommendation (1h additional work): audit the submit response for inline results (cache hit path). If the scraper returns `organic_results` synchronously in the POST /request response, skip polling entirely. This is a free win for repeat queries.

**Do not pursue webhooks or speculative fetch** — both require either Novada API changes or architectural changes to the MCP server that exceed 2h and deliver marginal benefit over the polling fix.
