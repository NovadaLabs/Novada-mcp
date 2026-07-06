# Verification Round 4 — Cache Key Includes Format Param

**Date:** 2026-06-26
**Build:** ~/Projects/novada-mcp/build/
**Test URL:** https://example.com (httpbin.org/html returned 503 — down during run)

## Result: PASS

All three assertions confirmed.

---

## Test Execution

### URL Note
`https://httpbin.org/html` returned HTTP 503 during this run. Switched to `https://example.com` which is stable and produces both a markdown and HTML response.

### Call 1 — format="markdown"
- Time: ~3600ms (live fetch)
- Output starts with: `📁 /Users/tongwu/Downloads/novada-mcp/2026-06-26/example-com/...`
- Content: `## Extracted Content` markdown block
- Source: `live`

### Call 2 — format="html" (same URL, different format — must NOT return cached markdown)
- Time: ~200ms (live fetch, separate cache key)
- Output starts with: `<!doctype html><html lang="en">...`
- Contains `<html`: YES
- Contains `## Extracted`: NO
- Verdict: HTML is returned, not cached markdown — format isolation works

### Call 3 — format="markdown" again (must return from cache — near 0ms)
- Time: **0ms**
- Source line: `source: cache`
- Output starts with: `📁 ...` (preserved)
- Verdict: CACHE HIT confirmed

---

## Pass/Fail Summary

| Check | Result |
|---|---|
| format isolation: html returns HTML, not cached markdown | PASS |
| cache hit preserves 📁 header | PASS |
| markdown cache hit on 3rd call (0ms) | PASS |

---

## Root Cause of Initial Script Failure (httpbin.org 503)

The verification script failed on the first run because `https://httpbin.org/html` was returning 503. Both `novadaExtract` calls failed identically, producing `## Extract Failed` blocks. Since errors are returned as strings (not thrown), both calls produced the same error string — causing false negative on format isolation.

Error path does NOT write to cache (correct — `setCached` is only called on success paths in `extractSingleInner`). The 503 error exits via `novadaExtract`'s outer catch block, which returns a static error string directly — never reaching `setCached`.

---

## Cache Implementation Verified

File: `src/_core/session-cache.ts`

Cache key format: `${url}::${renderMode}::${format}[::fields:f1,f2]`

Format param IS part of the cache key. Calls with `format="markdown"` and `format="html"` on the same URL produce different keys and are cached independently. Confirmed by the 0ms call 3 (markdown cache hit) while call 2 (html) was a live fetch.
