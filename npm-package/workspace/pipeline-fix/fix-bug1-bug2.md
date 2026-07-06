# BUG-1 + BUG-2 Fix Status

Date: 2026-06-25

## BUG-1: Cache key missing format — FIXED

File: `src/_core/session-cache.ts`

- Added `format: string` parameter to `cacheKey()`, `getCached()`, and `setCached()`.
- Key is now `url::renderMode::format[::fields:f1,f2]`.

Updated 3 call sites in `src/tools/extract.ts`:
- `getCached(params.url, cacheRenderMode, cacheFormat, params.fields)` — line ~170
- `setCached(params.url, cacheRenderMode, "json", jsonOutput, params.fields)` — JSON path
- `setCached(params.url, cacheRenderMode, cacheFormat, finalOutput, params.fields)` — markdown path

`cacheFormat` is derived from `params.format ?? "markdown"` near the top of `extractSingleInner`.

## BUG-2: JSON prefix broken in search.ts — FIXED

File: `src/tools/search.ts`

Removed the `// 📁 ${filePath}\n` comment prefix from JSON output (invalid JSON).
Now injects `output_saved` as a field on the `jsonResult` object before `JSON.stringify`, matching the pattern already used in `extract.ts`'s JSON path.

## Verification

```
npx tsc --noEmit  →  exit 0 (clean)
npm run build     →  success

Runtime test (example.com, format=markdown then format=html):
  md starts with 📁: true
  html has <html:   true
  different content: true   ← cache miss on format change, correct result returned
```
