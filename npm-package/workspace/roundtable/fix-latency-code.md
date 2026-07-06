# Latency Roundtable — Code Fixes Applied

Date: 2026-06-22

---

## Fix 1: Exponential Backoff in pollSearchResult

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
**Lines changed:** 171 (added `let pollAttempt = 0;`), 179 and 206 (both `scraperSleep` calls in pending branches)

**What changed:**
- Added `pollAttempt` counter initialized to 0 before the poll loop
- Replaced both `await scraperSleep(2000)` at code-27202 pending branches with:
  `await scraperSleep(Math.min(100 * Math.pow(2, pollAttempt), 2000))`
- `pollAttempt++` after each sleep so backoff progresses: 100ms → 200ms → 400ms → 800ms → 1600ms → 2000ms (capped)

**Expected impact:**
- First poll fires after 100ms instead of 2000ms. For tasks completing in <200ms (fast scraper hits), this cuts first-result latency by ~1900ms.
- P50 improvement: ~1–2s for typical fast completions. No regression on slow tasks (cap stays at 2000ms).

---

## Fix 2: https.Agent keepAlive

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
**Lines changed:** 3 (import), 10 (agent instantiation), 80 (Bing POST), 148 (submit POST), 180 (poll GET)

**What changed:**
- Added `import https from "https";` after existing imports
- Added `const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });` at module level
- Added `httpsAgent: keepAliveAgent` to all three axios calls:
  - `submitBingSearch` POST to `/request`
  - `submitSearchScrapeTask` POST to `/request`
  - `pollSearchResult` GET to `scraper_download`

**Expected impact:**
- Eliminates TCP handshake overhead on repeated requests to the same host (~50–150ms per connection).
- Multi-poll sequences (submit + 3–5 polls) save 150–750ms in connection setup.
- `maxSockets: 10` prevents connection exhaustion under parallel search calls.

---

## Fix 3: Snippet Cap 200 → 400 chars

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
**Line changed:** ~479 (inside result formatting loop)

**What changed:**
- `fullSnippet.length > 200` → `fullSnippet.length > 400`
- `fullSnippet.slice(0, 197)` → `fullSnippet.slice(0, 397)`

**Expected impact:**
- Agents receive up to 400 chars of snippet context per result instead of 200.
- Reduces need for follow-up `novada_extract` calls when the answer is in the snippet.
- No latency impact on the search itself; small output size increase (~200 chars × N results).

---

## Fix 4: DuckDuckGo Description Accuracy

**File:** `/Users/tongwu/Projects/novada-mcp/src/index.ts`
**Line changed:** 154

**What changed:**
- Before: `engine='duckduckgo' is 3x faster than Google and works for most queries.`
- After: `engine='duckduckgo' is similar speed to google (both use async scraper API), good for privacy-conscious queries.`

**Expected impact:**
- Prevents agents from incorrectly routing to DuckDuckGo expecting a speed advantage that does not exist (both engines use the async scraper API with comparable latency).
- Reduces misrouted requests where agents sacrificed result quality for a phantom speed gain.

---

## tsc Result

**PASS** — `npx tsc --noEmit` completed with zero errors and zero warnings.

---

## Combined Expected P50 Improvement

| Fix | Estimated P50 saving |
|-----|---------------------|
| Exponential backoff (first poll at 100ms vs 2000ms) | ~1500–1900ms |
| keepAlive (eliminates TCP handshake per request) | ~100–300ms |
| Snippet cap (fewer follow-up extract calls) | indirect, ~0–500ms per session |
| DDG description fix | prevents quality degradation, no direct latency |

**Total direct P50 improvement: ~1600–2200ms** on typical searches that complete in 1–3 scraper polls.
