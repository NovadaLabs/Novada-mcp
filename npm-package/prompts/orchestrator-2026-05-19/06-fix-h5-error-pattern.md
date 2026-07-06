# Fix H5: Replace String-Matching Error Detection with Typed NovadaError

## Problem
In `/Users/tongwu/Projects/novada-mcp/src/tools/scrape.ts` lines 360-393, error detection uses brittle string matching:
```typescript
const is11006 = message.includes('code 11006') || message.includes('(code 11006)') || ...
```
But the error code is already numeric at the throw site in `submitScrapeTask`. This should use the typed `NovadaError` class from `_core/errors.ts`.

Also the double try/catch pattern (inner catches re-throw, outer catches intercept 11006/11008) is confusing.

## Fix
1. Read `src/tools/scrape.ts` — understand the current error flow
2. Read `src/_core/errors.ts` — understand `NovadaError` class and `NovadaErrorCode` enum
3. In `submitScrapeTask`, when `body.code !== 0`, throw a `NovadaError` with the proper code instead of a plain `Error`:
   ```typescript
   throw new NovadaError(NovadaErrorCode.PRODUCT_UNAVAILABLE, msg, { httpStatus: body.code });
   ```
4. In the outer catch of `novadaScrape`, check:
   ```typescript
   if (err instanceof NovadaError && err.code === NovadaErrorCode.PRODUCT_UNAVAILABLE) { ... }
   ```
5. Remove the brittle string-matching logic
6. Simplify the double try/catch if possible — the inner catches that just re-throw can be removed
7. Run `npm run build`

## Verification
- No `message.includes('code 11006')` or similar string matching in scrape.ts
- Build passes
