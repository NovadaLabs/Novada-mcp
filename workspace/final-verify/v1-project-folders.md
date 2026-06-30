# v1 Project Folders — Cross-Verification Report

**Date:** 2026-06-26
**Scope:** `project` parameter across extract, search, scrape, research tools
**Method:** 13 tests — 10 unit tests (saveOutput direct), 1 integration (cache), 2 schema validation

## Summary

**12/13 PASS, 1 FAIL (cache bug)**

The `project` folder feature works correctly at the storage layer (`saveOutput`). All sanitization, path traversal protection, edge cases, and cross-tool grouping behave as designed. One bug found: extract's session cache key does not include `project`, causing cached results to leak across projects.

## Test Results

| # | Test | Result | Detail |
|---|------|--------|--------|
| UT1 | Project creates subfolder | PASS | `~/Downloads/novada-mcp/2026-06-26/ut-project-1/ut-domain-com/...` |
| UT2 | No project = no subfolder | PASS | `~/Downloads/novada-mcp/2026-06-26/ut-domain-com/...` |
| UT3 | Special chars sanitized | PASS | `"my project / with spaces!"` -> `my-project-with-spaces` |
| UT4 | Empty string = no subfolder | PASS | Empty project treated as absent, topic is first segment after date |
| UT5 | Path traversal blocked | PASS | `"../../../etc/passwd"` -> `etc-passwd` (sanitize strips dots and slashes) |
| UT6 | All-special-chars fallback | PASS | `"!@#$%^&*()"` -> `output` (sanitize fallback) |
| UT7 | Long project truncated | PASS | 34-char input -> 30-char segment (`abcdefghijklmnopqrstuvwxyz1234`) |
| UT8 | Multi-tool same project dir | PASS | extract + search both land under `multi-tool-test/` |
| UT9 | Undefined project = no subfolder | PASS | Same behavior as omitted parameter |
| UT10 | Disk layout verified | PASS | `ut-project-1/` exists with `ut-domain-com/` subfolder |
| IT1 | Cache key includes project | **FAIL** | Extract cache ignores `project` — see bug below |
| ZV1 | Zod rejects >30 chars | PASS | `z.string().max(30)` correctly rejects 31-char input |
| ZV2 | Zod accepts valid project | PASS | `"my-project"` accepted |

## Bug: Extract Session Cache Ignores `project`

**Severity:** MEDIUM
**File:** `src/_core/session-cache.ts`

The extract tool's session cache keys on `url::renderMode::format[::fields]` but does NOT include `project`. When an agent extracts the same URL with `project: "A"` then `project: "B"`, the second call returns the cached result pointing to project A's file path.

**Search is NOT affected** — its cache key already includes project:
```js
// search.js line 282 — correct
const cacheKey = `${engine}:${params.query}:${params.num ?? 10}:${params.project ?? ""}`;

// session-cache.js line 14 — missing project
function cacheKey(url, renderMode, format, fields) {
    const base = `${url}::${renderMode}::${format}`;
    return fields?.length ? `${base}::fields:${[...fields].sort().join(",")}` : base;
}
```

**Fix:** Add `project` to the session cache key function in `src/_core/session-cache.ts`:
```ts
function cacheKey(url: string, renderMode: string, format: string, fields?: string[], project?: string): string {
    let key = `${url}::${renderMode}::${format}`;
    if (fields?.length) key += `::fields:${[...fields].sort().join(",")}`;
    if (project) key += `::project:${project}`;
    return key;
}
```
And update `getCached`/`setCached` signatures + all call sites in `extract.ts` to pass `params.project`.

**Impact:** Low in practice — agents rarely extract the same URL into two different projects within a 5-minute cache window. But it violates the principle that `project` groups outputs, and the leaked path is misleading.

## Architecture Notes

### Directory structure
```
~/Downloads/novada-mcp/
  2026-06-26/
    {project}/          <-- optional, from project param
      {topic}/          <-- from URL domain or query slug
        {timestamp}_{source}.{ext}
```

### Tools supporting `project`
- `novada_extract` (types.ts line 107)
- `novada_search` (types.ts line 59)
- `novada_research` (types.ts line 139)
- `novada_scrape` (types.ts line 266)

### Sanitization (`sanitize()` in `output.ts`)
- Strips `http(s)://` prefix
- Replaces non-alphanumeric chars (except `_-`) with `-`
- Collapses consecutive dashes
- Strips leading/trailing dashes
- Truncates to 30 chars (for project) or 40 chars (general)
- Falls back to `"output"` if everything is stripped

### Security
- Path traversal: `../` sequences are sanitized to `--` then collapsed, preventing escape
- Special chars: All non-`[a-zA-Z0-9_-]` replaced, no injection possible
- The file always lands under `~/Downloads/novada-mcp/{date}/` regardless of input
