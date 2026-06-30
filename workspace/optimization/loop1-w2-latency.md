# Loop 1 — Worker 2: Browser Latency Optimization

**File:** `src/utils/browser.ts`
**Status:** DONE
**tsc:** Clean (no errors)

## Changes Applied

### Fix 1: Replace networkidle with domcontentloaded + fixed wait
- **Before:** `waitForLoadState('networkidle', { timeout: 12000 })` with domcontentloaded fallback
- **After:** `waitForLoadState('domcontentloaded', { timeout: 10000 })` + `waitForTimeout(2000)`
- **Impact:** Eliminates ~5s hang on SPAs where networkidle never fires. Fixed 2s is sufficient for initial JS render.

### Fix 2: Smart Cloudflare wait (replace blind 6s)
- **Before:** Blind `waitForTimeout(6000)` + redundant `waitForLoadState('domcontentloaded')`
- **After:** `waitForFunction()` polling for CF challenge resolution with 8s max, 3s fallback
- **Impact:** CF challenges typically resolve in 2-3s. Saves 3-4s on CF-protected pages; non-CF pages unaffected.

### Fix 3: Session reuse hint in JSDoc
- Added performance note in function JSDoc: callers should pass `sessionId` for repeated domain calls (~1.5s warm vs ~8s cold).
- No signature change; existing `getSession()` already handles reuse correctly.

## Expected Latency Reduction
- Non-CF JS pages: ~7.1s -> ~3s (networkidle 5s eliminated, replaced with fixed 2s)
- CF-protected pages: ~7.1s + 6s -> ~3s + 2-3s (smart polling vs blind wait)
- Session-reused calls: ~1.5s (no connection overhead)
