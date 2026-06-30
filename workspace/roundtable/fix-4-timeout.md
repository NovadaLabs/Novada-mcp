# Fix 4 — Total Request Timeout Ceiling

## Current Timeout Values Found

From `src/config.ts`:
```
STATIC_FETCH: 30000   (30s)
PROXY_FETCH:  45000   (45s)
RENDER:       60000   (60s)
```

From `src/utils/http.ts`:
- `fetchWithRetry` had a **hardcoded** `timeout: 30000` (not using the config constant)
- `MAX_RETRIES = 3` → worst-case static time: 30s × 4 attempts + backoff ≈ 127s+

No `TOTAL_REQUEST_CEILING` existed. In "auto" mode, static (up to 127s) then render escalation
(up to 45-60s) could compound with no ceiling at all.

## Changes Made

### 1. `src/config.ts`
- `STATIC_FETCH`: 30000 → **15000** (halved; 3 retries now max ~60s vs ~127s)
- Added: `TOTAL_REQUEST_CEILING: 45000` — new per-URL hard ceiling

### 2. `src/utils/http.ts`
- `fetchWithRetry`: replaced hardcoded `timeout: 30000` with `TIMEOUTS.STATIC_FETCH`
  — the static fetch timeout now tracks the config constant instead of being silently decoupled

### 3. `src/tools/extract.ts`
- Added `import { TIMEOUTS } from "../config.js"` at top
- Renamed existing `extractSingle` → `extractSingleInner` (all internal logic untouched)
- Added new `extractSingle` wrapper that runs `Promise.race([extractSingleInner(...), ceiling])`
  - Ceiling is a per-URL `setTimeout(TIMEOUTS.TOTAL_REQUEST_CEILING)` — each URL in a batch
    gets its own independent 45s timer
  - On ceiling hit: returns a structured error string matching novada's standard format
    (not a thrown exception — batch callers get usable output for the failed URL)
  - `finally{}` clears the timer to prevent leaks

## TypeScript Check

```
npx tsc --noEmit
(no output — zero errors)
```

## Estimated Impact

### Before (netflixtechblog.com case)
- Static fetch: 3 retries × 30s = 90s
- + render escalation: up to 45s
- Total observed: **127,043ms** — burned entire MCP tool budget

### After
| Scenario | Before | After |
|---|---|---|
| Fast site (Wikipedia, HN) | ~300ms | ~300ms (unchanged) |
| Slow static site, 1 timeout | 30s | 15s |
| Slow static site, 3 retries | 90s | 45s |
| auto + render escalation | 127s+ | **≤45s** (ceiling fires) |
| render= mode (JS sites) | 45-60s | 45-60s (unchanged — render timeout not touched) |

netflixtechblog.com-style cases (slow static → render escalation chain):
- Previously: 127s, no result, MCP budget exhausted
- Now: 45s, structured error with `agent_instruction` to try `render="static"` or `novada_scrape`
  — agent can retry with the right mode instead of timing out silently

The render timeout (`RENDER: 60000`, `PROXY_FETCH: 45000`) was **not changed** — JS-heavy sites
intentionally get more time; the ceiling only kills the unbounded auto-escalation chain.
