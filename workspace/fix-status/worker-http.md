# worker-http fix status

Date: 2026-06-23
Worker: worker-http (owns src/utils/http.ts, src/tools/account_summary.ts, src/config.ts)

## Fixes Applied

### Fix 1 — Full jitter in retry backoff (INC-175)
- `fetchWithRetry`: replaced `RETRY_BASE_DELAY_MS * Math.pow(2, attempt)` with full jitter pattern
- `fetchWithRender`: replaced both `1000 * (attempt + 1)` linear sleeps (inner code path + HTTP error path) with full jitter using `Math.pow(2, attempt) * 1000` base, capped at 30_000ms

### Fix 2 — HTTP connection pooling (INC-175)
- Added `const _sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })` at top of http.ts (after imports)
- Added `httpsAgent: _sharedHttpsAgent` to:
  - `axios.get` in `fetchWithRetry` (main request)
  - `axios.post` in `fetchWithRender` (web unblocker request)
- SSL retry path creates its own fresh agent with `rejectUnauthorized: false` (intentional — cannot share pooled agent for that case)

### Fix 3 — tryParse latent bug (INC-175)
- In `account_summary.ts`, `runSection` now checks parsed result for `_parse_error` sentinel before returning
- If detected, throws `Error('Failed to parse API response — raw: ...')` which is caught by the outer try/catch and surfaced as `Section<T>` with `ok: false`

### Fix 4 — Search timeout constants (INC-174)
- Added to `TIMEOUTS` in `src/config.ts`:
  - `SEARCH_SUBMIT_TIMEOUT: 30_000`
  - `SEARCH_POLL_TIMEOUT: 60_000`
  - `SEARCH_TOTAL_CEILING: 90_000`

## Verify

```
npx tsc --noEmit
```
Result: 0 errors, 0 warnings. Clean.
