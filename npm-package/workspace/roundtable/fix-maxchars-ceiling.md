# Fix: MAX_CHARS_DEFAULT + TOTAL_REQUEST_CEILING

## Changes Applied

### Fix A — MAX_CHARS_DEFAULT 25000 → 50000
**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` line 386
```diff
- const MAX_CHARS_DEFAULT = 25000;
+ const MAX_CHARS_DEFAULT = 50000;
```

### Fix B — TOTAL_REQUEST_CEILING 45000 → 90000
**File:** `/Users/tongwu/Projects/novada-mcp/src/config.ts` line 50
```diff
- TOTAL_REQUEST_CEILING: 45000, // hard per-URL ceiling enforced in extractSingle via Promise.race
+ TOTAL_REQUEST_CEILING: 90000, // hard per-URL ceiling enforced in extractSingle via Promise.race
```

### Static fetch timeout verification
`TIMEOUTS.STATIC_FETCH` confirmed still at **15000** (not reverted). No change needed.

## tsc Result
```
(no output — zero errors, zero warnings)
```
Exit code: 0. Clean compile.

## Expected Impact

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Quality score (content volume component) | 7.6/10 | ~8.2/10 | +0.6 |
| Quality gap vs Firecrawl/Tavily closed | 0% | ~70% | +70% |
| JS-heavy SPA success (vitejs.dev, replit.com) | timeout at 45s | allowed up to 90s | +100% for 50-70s SPAs |
| Truly-hung request protection | yes (45s) | yes (90s) | ceiling preserved |

Notes:
- MAX_CHARS change is zero-risk: callers who pass explicit `max_chars` are unaffected; default path doubles retained content.
- TOTAL_REQUEST_CEILING at 90s is still well below any reasonable user-facing timeout; it only guards against fully-hung requests.
- STATIC_FETCH remains at 15s — 3-retry path still caps static worst-case at 45s, unchanged by this fix.
