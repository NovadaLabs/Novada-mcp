# Code Review: Output Pipeline

**Reviewer**: code-reviewer (Sonnet 4.6)
**Date**: 2026-06-23
**Scope**: `src/utils/output.ts` (new), `saveOutput` wiring in `scrape.ts`, `extract.ts`, `search.ts`, `research.ts`, `scraper_result.ts`

---

## Findings

---

### [HIGH] Filename collision window: second-granularity timestamp is insufficient

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:51-56`

`generateFileName` uses `HHmmss` (6-digit, second precision). Two calls within the same second for the same tool+hint produce identical filenames, and `writeFileSync` will silently overwrite the earlier file with no error. This is a real risk for `novada_research` which calls `saveOutput` at the end of a function that can complete in under one second, and for batch extract flows where multiple URLs could trigger saves in rapid succession.

```typescript
// Current: second-granularity — collides within the same second
const time = now.toTimeString().slice(0, 8).replace(/:/g, ""); // HHmmss → e.g. "143022"

// Fix: millisecond precision eliminates the window
const time = [
  now.toTimeString().slice(0, 8).replace(/:/g, ""),
  String(now.getMilliseconds()).padStart(3, "0"),
].join(""); // HHmmssSSS → e.g. "143022047"
```

---

### [HIGH] `sanitizeHint` accepts a dot-only or slash-only input and produces an empty string resolved to `"output"`, but does not defend against null-byte injection

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:24-32`

The `hint` parameter flows from user-controlled content: search queries, domain names from URLs, and `task_id` prefixes. The regex `[^a-zA-Z0-9_-]` correctly strips most dangerous characters, including `/`, `..`, and `~`. Null bytes (`\0`) are also eliminated by the replacement, so the path is safe. This is a clean implementation — no traversal risk is present.

However, one edge is worth noting: a `hint` that is purely numeric (e.g. `"12345"`) passes through unchanged and is valid. Separately, the dot-stripping from the `https?://` removal in a URL like `example.com/path` produces `example_com_path`, which is correct.

**Assessment**: No path traversal risk. Sanitization is sound. No action required on security grounds.

---

### [HIGH] `writeFileSync` inside an `async` function — sync I/O on the event loop

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:125`

`saveOutput` is declared `async` but calls `writeFileSync`, which blocks the Node.js event loop for the entire file write duration. For small files (< ~10KB) this is practically invisible. For large scrape results serialized to JSON — which can be several hundred KB to over 1MB for platforms that return large product arrays — this can cause measurable latency spikes and will delay any concurrent tool calls sharing the same process.

The surrounding tools all `await saveOutput(...)`, so switching to the async `writeFile` is straightforward.

```typescript
// Current — blocks event loop
import { writeFileSync, mkdirSync, existsSync } from "fs";
writeFileSync(filePath, content, "utf-8");

// Fix — non-blocking
import { writeFile, mkdirSync, existsSync } from "fs";
import { writeFile } from "fs/promises";
await writeFile(filePath, content, "utf-8");
```

Note: `mkdirSync` with `recursive: true` on line 42 has the same concern but runs only once per day-boundary, making it less impactful. Still worth migrating to `mkdir` from `fs/promises` for consistency.

---

### [MEDIUM] `toCsv` does not escape carriage returns (`\r`) — breaks CSV row boundaries on Windows consumers

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:76`

The `escapeField` function wraps and escapes fields containing `,`, `"`, and `\n`. Carriage return (`\r`) is not handled. A field value containing `\r\n` (Windows-style line ending) will cause the field to span multiple rows when opened in Excel or any RFC 4180-strict parser. Scraper results from APIs that return Windows-line-ending content (product descriptions, news snippets) are affected.

```typescript
// Current
if (str.includes(",") || str.includes('"') || str.includes("\n")) {

// Fix: add \r to the trigger condition
if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
```

---

### [MEDIUM] `toCsv` header row applies `escapeField` to column names — headers containing commas or quotes (unlikely but possible from flattened object keys) will be silently quoted, making them harder to consume

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:82`

`flattenRecord` produces keys like `organic_results.0.source.link`. None of these would normally contain commas or quotes. This is a low-probability issue but the escaping behavior on header keys is inconsistent with common CSV conventions where headers are unquoted unless necessary. Current behavior is technically correct per RFC 4180 so this is informational only.

---

### [MEDIUM] `getOutputDir` uses `existsSync` + `mkdirSync` — TOCTOU race condition

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:41-44`

```typescript
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}
```

`mkdirSync({ recursive: true })` is idempotent — it does not throw if the directory already exists. The `existsSync` check is therefore redundant and introduces a tiny TOCTOU window (two concurrent first-of-day calls could both pass `existsSync` before either creates the directory). The fix is to drop the guard entirely.

```typescript
// Fix: mkdirSync with recursive:true is safe to call unconditionally
mkdirSync(dir, { recursive: true });
```

---

### [MEDIUM] `saveOutput` is called with `data: rawRecords` in `scrape.ts` after `rawRecords.slice(0, limit)` — but the limit is applied again inside `saveOutput` via the slice at the call site, meaning the intent is clear. However, `scrape.ts` passes `format: format === "json" ? "json" : "csv"` which maps `"toon"` and `"html"` to `"csv"`. Saving toon-format output as CSV is semantically incorrect

**File**: `/Users/tongwu/Projects/novada-mcp/src/tools/scrape.ts:407-413`

When `format === "toon"`, the in-memory `output` string contains the TOON-formatted text, but the saved file is the raw `rawRecords` array serialized as CSV, not the TOON output. This means the saved file's content does not match the format the agent actually received. For `format === "html"` and `format === "xlsx"`, the same mismatch occurs.

```typescript
// Current
format: format === "json" ? "json" : "csv",
data: rawRecords.slice(0, limit),

// Fix: save what was actually rendered
format: format === "json" ? "json" : "md",
data: output,   // the already-rendered string, not raw records
```

---

### [MEDIUM] `scraper_result.ts` always passes `cosUrl: undefined` — the `cosUrl` field in `OutputOptions` is dead code for this caller

**File**: `/Users/tongwu/Projects/novada-mcp/src/tools/scraper_result.ts:276-277`

```typescript
cosUrl: fetchedFromEndpoint === "task_download" ? undefined : undefined,
```

Both branches of the ternary produce `undefined`. Either the actual pre-signed download URL should be threaded through from `downloadUrl` (captured in the outer scope), or the ternary should be removed. As-is, this is dead code and the `cosUrl` summary field in the output will never appear.

---

### [LOW] `saveOutput` in `extract.ts` is called twice per single-URL request — once for JSON format and once for markdown format

**File**: `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts:629-640`, `820-829`

Both the JSON branch (line 629) and the markdown branch (line 820) call `saveOutput`. For a single `novadaExtract` call that produces JSON output, only the JSON save fires. For markdown, only the markdown save fires. These two code paths are mutually exclusive via the early `return` at line 643. No duplicate saves occur — this is correct behavior. Noting it to confirm there is no bug here.

---

### [LOW] `hint` slice in `search.ts` does not account for multi-byte characters

**File**: `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts:496`, `589`

```typescript
hint: params.query?.slice(0, 30) || "search",
```

`String.slice` operates on UTF-16 code units. A query like `"人工智能发展趋势分析"` (9 CJK characters = 9 code units) is safe. A query containing surrogate pairs (emoji) could theoretically split at a surrogate boundary if the emoji lands exactly at position 30. This is extremely unlikely in practice and `sanitizeHint` will safely stringify any malformed result. Low priority, informational only.

---

### [LOW] Empty `catch {}` blocks suppress all file-write errors silently — no diagnostic path

**File**: `scrape.ts:413`, `extract.ts:640`, `extract.ts:829`, `search.ts:501`, `search.ts:594`, `research.ts:279`, `scraper_result.ts:279`

The "best-effort" pattern is intentional and correct — file save failure must not break the tool. However, all seven sites use bare `catch { /* ... */ }` with no logging mechanism. If `mkdirSync` fails due to a permissions error (e.g. `~/Downloads` is read-only in a sandboxed MCP environment), every single tool invocation will silently fail to save. There is no way for a user or developer to discover this without manually inspecting the output for the missing "Output saved:" line.

A debug-level logger call inside the catch would allow diagnosing this class of failure without changing the best-effort semantics.

---

### [LOW] `data: null` not explicitly handled in `saveOutput`

**File**: `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts:103-123`

When `data` is `null` and `format` is `"json"`, `JSON.stringify(null, null, 2)` returns the string `"null"`, which is valid JSON. When `format` is `"csv"`, `Array.isArray(null)` is false, so it takes the else branch: `typeof null === "object" && null !== null` is false (the `!== null` check saves it), falling to `{ value: null }`, producing a one-row CSV with header `value` and cell `""`. This is technically safe but semantically odd. The callers always pass non-null data in practice, so no action required — just documenting the behavior.

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 3     | warn   |
| MEDIUM   | 4     | info   |
| LOW      | 4     | note   |

**Verdict: WARNING — 3 HIGH issues should be resolved before shipping.**

### Priority order

1. **Filename collision** (`output.ts:53`) — switch `HHmmss` to `HHmmssSSS`. Two-line fix, eliminates silent data loss on rapid consecutive calls.
2. **`writeFileSync` blocking** (`output.ts:125`) — replace with `fs/promises.writeFile`. Affects latency under load; clean async migration.
3. **`scrape.ts` saves raw records instead of rendered output** (`scrape.ts:407-413`) — the saved CSV does not match what the agent received. Fix the `data:` and `format:` args to save `output` as `"md"`.

### Non-blocking before ship
- MEDIUM: Drop the `existsSync` guard in `getOutputDir` — `mkdirSync({recursive:true})` is idempotent.
- MEDIUM: Add `\r` to the `escapeField` trigger condition in `toCsv`.
- MEDIUM: Fix the `cosUrl: undefined : undefined` dead ternary in `scraper_result.ts`.
