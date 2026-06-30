# INC-205 — 0-byte output files

## Status
FIXED — `src/utils/output.ts`

## Root Cause

Two distinct code paths in `saveOutput` can produce an empty string that gets
written to disk as a 0-byte file:

### Path 1 — CSV format + empty records array (primary cause)

`toCsv([])` explicitly short-circuits with `return ""` when the input array is
empty (output.ts line 60). When a scrape or scraper_result call returns 0
records, the CSV branch writes an empty string:

```
// output.ts (before fix)
case "csv": {
  content = toCsv(records);   // "" when records.length === 0
  ...
}
await writeFile(filePath, content, "utf-8");  // writes 0 bytes
```

Affected callers:
- `scrape.ts:430` — `format: format === "json" ? "json" : "csv"` and
  `data: rawRecords.slice(0, limit)` — if `rawRecords` is empty, CSV = 0 bytes.
- `scraper_result.ts:271` — same pattern, `data: records`.

### Path 2 — JSON format + `data = undefined`

`JSON.stringify(undefined, null, 2)` returns JS `undefined` (not the string
`"undefined"`). Writing `undefined` to `fs.writeFile` throws:

> The "data" argument must be of type string or an instance of Buffer...

This never actually produces a 0-byte file (it throws instead), but the `catch {
/* best-effort */ }` wrapper at every call site silently swallows it. Not a
0-byte issue but was a silent data-loss path worth noting.

### Path 3 — MD format + empty string data

If `data` is already an empty string, `content = data` passes through
and writes 0 bytes. Less likely but structurally identical to Path 1.

## Why No 0KB Files Appear Right Now

The current `~/Downloads/novada-mcp/2026-06-26/` directory shows no 0-byte
files — all files are at least 200 bytes. The live search path always passes
`data: { query, engine, results: reranked }` which serializes to a non-empty
JSON object even when `results` is an empty array (`"[]"` = 2 bytes minimum).

The vulnerability is latent: it manifests whenever a scrape/scraper_result
call returns 0 records and the format is CSV.

## Fix Applied

`src/utils/output.ts` — `saveOutput()`:

1. Guard `JSON.stringify(undefined)` returning JS `undefined` with a nullish
   coalesce: `const serialized = JSON.stringify(data, null, 2); content = serialized ?? "";`

2. Added a pre-write empty-content guard that throws before calling `writeFile`:

```typescript
if (content.trim().length === 0) {
  throw new Error(`saveOutput: refusing to write empty file (tool=${tool}, format=${format})`);
}
```

Because every call site wraps `saveOutput` in `try/catch { /* best-effort */ }`,
throwing is safe — the save is silently skipped, no 0-byte file is created, and
the tool still returns its result to the caller normally.

## Files Changed

- `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts` — `saveOutput()`

## Not Changed

- `search.ts` — both `saveOutput` call sites pass a non-empty object; no fix needed.
- `extract.ts`, `research.ts` — pass strings/objects that are always non-empty at
  call time; guard in `output.ts` provides defence-in-depth anyway.
- `toCsv()` — left unchanged; the empty-string return is correct behaviour for
  an empty records array. The guard in `saveOutput` is the right place to intercept.
