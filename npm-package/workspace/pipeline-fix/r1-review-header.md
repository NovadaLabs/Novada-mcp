# R1 Review — Output Header Placement Change
**Reviewer:** R1 (fresh eyes)
**Files:** `src/tools/extract.ts`, `src/tools/search.ts`
**Change:** File save path moved from tail to header of markdown responses

---

## Verdict: REQUEST_CHANGES

Two CRITICAL bugs confirmed by live test. The markdown prefix change is correct; the JSON handling is broken in both files.

---

## Issues

### [CRITICAL] search.ts JSON format: `// 📁 …` prepended to JSON — invalid output

**File:** `src/tools/search.ts:557-559`

```typescript
// CURRENT (broken)
savePrefix = `// 📁 ${outputResult.filePath}\n`;
finalResult = savePrefix + finalResult;
```

Live test confirmed:
```
Search JSON first line: // 📁 /Users/tongwu/Downloads/novada-mcp/2026-06-26/search_test_format_json_...json
Search JSON is valid: false :: Unexpected token '/', "// 📁 /Use"... is not valid JSON
```

`//` is a JS comment, not valid JSON. Any downstream parser calling `JSON.parse()` on this response will throw. Contrast with `extract.ts` JSON format which correctly injects `output_saved` as a field inside the JSON object (line 677) before serialising — that approach works and should be replicated here.

**Fix:** Mirror the extract.ts pattern: add `output_saved` as a field on `jsonResult` before `JSON.stringify`, do not prepend a string prefix.

---

### [CRITICAL] extract.ts markdown format: `savePrefix` is added AFTER `setCached`

**File:** `src/tools/extract.ts:864-881`

```typescript
let mdOutput = lines.join("\n");
setCached(params.url, cacheRenderMode, mdOutput, params.fields);   // ← cached WITHOUT prefix

let savePrefix = "";
try { … savePrefix = `📁 ${outputResult.filePath}\n\n`; } catch { }

return savePrefix + mdOutput;   // ← returned WITH prefix
```

The value stored in the session cache does NOT have the `📁` header. On a cache hit (same URL + render mode within the session TTL), the returned string will start with `## Extracted Content` instead of the file path. The live test showed the header on a fresh call; a repeated call within the same session TTL would silently lose it.

Severity is CRITICAL because the caching logic is opaque to callers — behaviour differs between first call and subsequent calls with no visible signal.

**Fix:** Build `finalOutput = savePrefix + mdOutput` first, then pass `finalOutput` to `setCached`.

---

### [HIGH] search.ts `enrich_top` / `extract_options`: prefix embedded in `extracted_content` field

**File:** `src/tools/search.ts:492-515` (the `extract_options` / `enrich_top` block)

When `novadaSearch` calls `novadaExtract` for top-N enrichment, the returned markdown string already has the `📁 /path/…\n\n` prefix prepended (from the extract.ts change). That full string — including the path line — is then stored as `extracted_content` on the result object and embedded verbatim into the search output (both markdown at line 612 and JSON at line 539).

Downstream agents consuming the JSON `results[N].extracted_content` field will see the file path as the first line of the content, which is noise and may confuse structured parsing.

This is a latent issue that only surfaces when `extract_options` or `enrich_top` is used; it wasn't tested in the W1 verification.

**Fix:** After calling `novadaExtract`, strip a leading `📁 …\n\n` prefix from the returned string before storing it as `extracted_content`.

---

### [LOW] extract.ts `format:"json"` — inconsistent save format argument

**File:** `src/tools/extract.ts:671-678`

The JSON format block calls `saveOutput` with `format: "json"` and passes `jsonResult` (the raw object). This is correct — `saveOutput` serialises it via `JSON.stringify`. No bug here. Noted only because the comment on line 668 ("Add save path INTO the JSON object") documents the intent clearly; the same rationale should appear on the search.ts fix for the reviewer chain.

---

## Checklist Answers

| # | Question | Finding |
|---|----------|---------|
| 1 | Is `📁` prefix correct format for markdown? | Yes — clean for markdown MCP clients. One blank line separator is present (`\n\n`). |
| 2 | Does it break JSON format? | YES in `search.ts`. `// 📁 …` prepended to JSON string → `JSON.parse` throws. `extract.ts` JSON is clean (injects `output_saved` field). |
| 3 | Edge case: `saveOutput` fails? | Handled correctly. Both `extract.ts` and `search.ts` wrap in `try/catch { /* best-effort */ }`. On failure `savePrefix` stays `""` and the response is returned unchanged. |
| 4 | Path shown correctly (absolute, not `~/…`)? | Yes. `saveOutput` uses `join(homedir(), "Downloads", …)` which resolves to an absolute path. Live test confirmed `/Users/tongwu/Downloads/novada-mcp/…`. |
| 5 | `// 📁 comment` in JSON — are JSON comments valid? | NO. Confirmed broken by live test. |
| 6 | Risk of prefix breaking downstream parsers? | HIGH for search JSON consumers. Medium for `extracted_content` in enriched results. |

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 2     | block  |
| HIGH     | 1     | warn   |
| MEDIUM   | 0     | —      |
| LOW      | 1     | note   |

**Verdict: REQUEST_CHANGES — 2 CRITICAL issues must be fixed before merge.**

The markdown-format header placement is functionally correct and the rationale (agents that truncate long responses still see the file path) is sound. The two CRITICALs are both in the JSON handling paths and are straightforward to fix. The HIGH is a latent enrichment-path contamination that should be addressed in the same PR.
