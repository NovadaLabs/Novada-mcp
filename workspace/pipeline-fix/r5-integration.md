# R5 Integration Review — Dual Output Sprint

**Date:** 2026-06-26
**Reviewer:** R5 (end-to-end integration)
**Test node version:** $(node --version 2>/dev/null)

---

## Test Results

| Check | Result | Notes |
|-------|--------|-------|
| W1: 📁 path at response header | PASS | First line is `📁 <abs-path>` for markdown format |
| W2: CRITICAL format section in description | PASS | `src/index.ts` contains `CRITICAL` + `format=` strings |
| W3: research sources as markdown table | PASS | `\| # \|` and `\| Title \|` present in output |
| W4: setup shows Output Pipeline section | PASS | Section renders with NOVADA_OUTPUT_DIR/NOVADA_NO_SAVE docs |
| W5: HTML format saves .html file | **FAIL** | Cache collision — see CRITICAL bug below |

---

## CRITICAL — BUG-1: Session cache does not key on `format` param

**Severity: CRITICAL (W5 fails 100% of the time in the same process session)**

**File:** `src/_core/session-cache.ts` lines 20–25  
**Manifests in:** `src/tools/extract.ts` lines 167–172 (cache lookup) and lines 681, 865 (cache write)

**Root cause:** The cache key is `url::renderMode[::fields]`. The `format` parameter (`markdown`, `json`, `html`, `text`) is not part of the key.

Sequence that breaks W5:
1. Any call to `novadaExtract(url, format="markdown")` → fetches, writes markdown string to cache under key `url::auto`
2. Subsequent call in the same process with `novadaExtract(url, format="html")` → cache hits → returns the cached **markdown** string, not HTML

The integration test runs W1 (`format="markdown"`) then W5 (`format="html"`) on the same URL (`https://example.com`). W5 always receives the W1 markdown result from cache, causing the test to fail. Validated in isolation: fresh-process `format="html"` call works correctly.

**Impact beyond the test:** Any agent that calls `novadaExtract(url, format="json")` after a prior `novadaExtract(url, format="markdown")` in the same session will silently receive markdown back and attempt to JSON.parse it, causing downstream failures.

**The fix required:** Add `format` to the cache key in `session-cache.ts`:
```ts
// session-cache.ts — cacheKey() must include format
function cacheKey(url: string, renderMode: string, fields?: string[], format?: string): string {
  const fieldsSuffix = fields && fields.length > 0
    ? `::fields:${[...fields].sort().join(",")}`
    : "";
  const formatSuffix = format ? `::format:${format}` : "";
  return `${url}::${renderMode}${fieldsSuffix}${formatSuffix}`;
}
```
And `getCached`/`setCached` signatures must also accept and pass through `format`.
The call sites in `extract.ts` must pass `params.format` to both `getCached` and `setCached`.

---

## HIGH — BUG-2: `📁` file path prefix leaks into research synthesis

**Severity: HIGH (corrupts synthesized research output)**

**File:** `src/tools/research.ts` lines 165–170  
**Root cause:** W1 prepends `📁 <filePath>\n\n` to the returned string from `novadaExtract`. Research's internal extraction pipeline strips only the `## Agent Hints` section:

```ts
const cleanContent = content.split("## Agent Hints")[0].trim();
```

When `content` starts with `📁 /Users/.../extract_xyz.md\n\n## Extracted Content...`, the `cleanContent` variable still begins with `📁 /path...`. This file-path line gets passed into `synthesizeAnswer()` as body text, and appears verbatim in:
- The `findingBullets` array (source snippet lines)
- The `## Summary` synthesis block
- Potentially in the `## Key Findings` section

Confirmed live: the integration test output shows multiple `📁` paths embedded mid-sentence in research results.

**Impact:** Research reports now have raw filesystem paths in the synthesis. Agents consuming the output may mistake a file path for a URL. The finding bullets show paths like `📁 /path/to/file.md url: https://...` which breaks structured parsing.

**The fix required:** In `research.ts` line 165, add a guard to strip the `📁` prefix line before assigning `cleanContent`. One clean approach:

```ts
// Strip the 📁 header line that W1 prepends (file path, not content)
const strippedContent = content.replace(/^📁[^\n]*\n\n/, "");
if (strippedContent.startsWith("## Extract Failed")) {
  return { ok: false, ... };
}
const cleanContent = strippedContent.split("## Agent Hints")[0].trim();
```

---

## LOW — NOTE-1: `saveOutput` in research appends path as footer, not header

**File:** `src/tools/research.ts` lines 265–274  
Research uses `finalReport += \`\n\n---\nResearch saved: ${outputResult.filePath}\`` (tail append). This is inconsistent with W1's header-prepend pattern for extract. For research this is acceptable because the path is metadata, not critical to the agent's workflow — but note the inconsistency exists.

---

## LOW — NOTE-2: W5 HTML response contains `<!-- Output saved: /path -->` comment

The W5 HTML save path is embedded as an HTML comment at the tail of the response, not as a `📁` header line. This is **intentional and correct** for HTML format — a `📁` prefix would break HTML validity. However, it means the agent cannot find the path from the first line (unlike markdown/json formats). If consistent first-line path discovery is needed across all formats, this requires a different approach.

---

## Integration Verdict

**BLOCKED — 2 bugs require fixes before this sprint is shippable.**

| Bug | Severity | Blocks |
|-----|----------|--------|
| BUG-1: Cache key missing `format` | CRITICAL | W5 (HTML extract), any mixed-format session |
| BUG-2: `📁` prefix leaks into research synthesis | HIGH | W3 output quality, all research reports |

### What passed cleanly
- W1 header prepend: correct, first line is `📁 <path>`, clean content written to disk (path not in file)
- W2 CRITICAL description: present in `src/index.ts`
- W4 Output Pipeline section in setup: renders correctly
- W5 HTML save: works correctly in a fresh process (no prior markdown cache for same URL)
- Output directory creation and file writing: working (50 .md, 4 .html, 44 .json files written today)

### Fix owners
- BUG-1: Fix `src/_core/session-cache.ts` (cacheKey + getCached + setCached signatures) + update call sites in `src/tools/extract.ts`
- BUG-2: Fix `src/tools/research.ts` line ~165 (strip `📁` prefix before assigning `cleanContent`)

Both fixes are 5–10 line changes. After applying, re-run the integration test in a single process call with W1 and W5 hitting the same URL to confirm cache isolation.
