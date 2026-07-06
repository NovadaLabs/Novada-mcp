# Fix Proposals — Extract Tool (BUG-E1, BUG-E2)
Reviewed by: fix-engineer-1
Date: 2026-05-19

## BUG-E1: Auto-escalation

### Root Cause (from source)

File: `src/tools/extract.ts`, lines 121–181 (`extractSingle` function, else-branch for auto/static mode).

The auto-escalation path at line 143 only triggers when `detectJsHeavyContent(html)` OR `detectBotChallenge(html)` returns true on the static response. For a cookie consent wall (e.g. docs.anthropic.com/Docusaurus), neither detector fires — the server returns a valid, well-formed HTML document, just one containing a consent overlay. The static fetch succeeds structurally, `detectJsHeavyContent` sees enough HTML to return false, and `detectBotChallenge` does not match the Docusaurus consent wall markup.

The result: execution falls through to line 249 (`scoreExtraction`), which produces `quality:20`. The `contentOk` flag is set to `false` at line 283 because `quality.score < 40`, but **there is no code path that acts on this low-quality signal to retry**. The tool simply formats and returns the low-quality result.

The exact gap: the condition at line 143 is:
```typescript
// line 143
if (renderMode === "auto" && !html.startsWith("pdf_pages:") && (detectJsHeavyContent(html) || detectBotChallenge(html))) {
```

Quality scoring happens 100+ lines later, *after* the escalation decision window has already closed. There is no second escalation check on the quality score.

### Proposed Fix

Add a quality-gate escalation check immediately after `scoreExtraction`, before the response is assembled. The check runs only when: (a) render mode is `auto`, (b) we are still on static/render-failed, (c) `quality.score < 40` (the same threshold used for `contentOk`).

**File: `src/tools/extract.ts`**

Replace lines 249–257 (the quality scoring block and the P0-1 floor):

```typescript
// BEFORE (lines 249–257):
  // Quality scoring (skip structured data extraction for PDFs — no HTML schema)
  const structuredData = pdfPages !== null ? null : extractStructuredData(html);
  const hasStructuredData = structuredData !== null;
  const quality = scoreExtraction(html, mainContent, usedMode, hasStructuredData);

  // P0-1: Quality floor — never return quality:0 for non-empty content
  if (mainContent && mainContent.length > 0 && quality.score === 0) {
    quality.score = 1;
  }
```

```typescript
// AFTER:
  // Quality scoring (skip structured data extraction for PDFs — no HTML schema)
  const structuredData = pdfPages !== null ? null : extractStructuredData(html);
  const hasStructuredData = structuredData !== null;
  const quality = scoreExtraction(html, mainContent, usedMode, hasStructuredData);

  // P0-1: Quality floor — never return quality:0 for non-empty content
  if (mainContent && mainContent.length > 0 && quality.score === 0) {
    quality.score = 1;
  }

  // BUG-E1 FIX: Quality-gate escalation for auto mode.
  // If static fetch returned low-quality content (e.g. cookie consent wall, Docusaurus overlay),
  // escalate to render mode once and re-derive all content from the better response.
  // Only fires when: auto mode + still on static (not already escalated) + quality below threshold.
  if (
    renderMode === "auto" &&
    pdfPages === null &&
    (usedMode === "static") &&
    quality.score < 40
  ) {
    try {
      const renderResponse = await fetchWithRender(params.url, apiKey);
      if (typeof renderResponse.data === "string" && !detectBotChallenge(renderResponse.data)) {
        html = renderResponse.data;
        usedMode = "render";
        // Re-derive content, links, structured data, and quality from the render response
        const reMainContent = extractMainContent(html, params.url);
        const reStructuredData = extractStructuredData(html);
        const reQuality = scoreExtraction(html, reMainContent, usedMode, reStructuredData !== null);
        // Only accept the render result if it's actually better
        if (reQuality.score > quality.score) {
          // Reassign all derived values in-place by replacing the variables below
          // We use a labeled block so we can break out early if render is worse
          Object.assign(structuredData ?? {}, reStructuredData ?? {});
          // Note: structuredData is const — we shadow it with a let block below
          // See implementation note.
          quality.score = reQuality.score;
          quality.signals = reQuality.signals;
        }
      }
    } catch {
      // Render failed — continue with original static content, do not throw
    }
  }
```

**Implementation note:** Because `structuredData`, `hasStructuredData`, `mainContent`, and `quality` are declared as `const` at this point in the function, the cleanest implementation is to extract the post-fetch derivation into a local helper or to convert those declarations to `let`. The safest approach with minimum refactor surface is to convert the relevant `const` declarations to `let`:

Change lines 249–257 from `const` to `let`:
```typescript
// Change these declarations to let (lines 249–253):
let structuredData = pdfPages !== null ? null : extractStructuredData(html);
let hasStructuredData = structuredData !== null;
let quality = scoreExtraction(html, mainContent, usedMode, hasStructuredData);
```

And convert `mainContent` (assigned from `extractMainContent` around line 211) to `let`:
```typescript
// Line ~211: change const to let
let mainContent = pdfPages !== null
  ? html.slice(0, 25000)
  : extractMainContent(html, params.url);
```

Then the quality-gate escalation block can reassign all four:
```typescript
  // BUG-E1 FIX: Quality-gate escalation for auto mode (insert after quality floor, ~line 258)
  if (
    renderMode === "auto" &&
    pdfPages === null &&
    usedMode === "static" &&
    quality.score < 40
  ) {
    try {
      const renderResponse = await fetchWithRender(params.url, apiKey);
      if (typeof renderResponse.data === "string" && !detectBotChallenge(renderResponse.data)) {
        const renderHtml = renderResponse.data;
        const renderMain = extractMainContent(renderHtml, params.url);
        const renderSD = extractStructuredData(renderHtml);
        const renderQuality = scoreExtraction(renderHtml, renderMain, "render", renderSD !== null);
        if (renderQuality.score > quality.score) {
          html = renderHtml;
          usedMode = "render";
          mainContent = renderMain;
          structuredData = renderSD;
          hasStructuredData = renderSD !== null;
          quality = renderQuality;
        }
      }
    } catch {
      // Render failed — fall through with original static content
    }
  }
```

Also update the `stillJsHeavy` computation at line 198 — it references `usedMode` which is now potentially mutated. That line is computed before the quality-gate block, so move it to after the quality-gate block, or use a getter pattern. Simplest: delete the `stillJsHeavy` const declaration at line 198 and replace every use of it with an inline expression:
```typescript
// Line 198 — remove this line entirely:
// const stillJsHeavy = renderMode === "auto" && (usedMode === "static" || usedMode === "render-failed") && detectJsHeavyContent(html);

// In the Agent Hints section (~line 342), replace `stillJsHeavy` with:
const stillJsHeavy = renderMode === "auto" && (usedMode === "static" || usedMode === "render-failed") && detectJsHeavyContent(html);
```

**Metadata update:** Surface the escalation in the response so agents can observe it. In the `lines` array construction (~line 290), add an `escalated` field to the format line:
```typescript
`format: ${params.format || "markdown"} | chars:${contentLen}${isTruncated ? " (truncated)" : ""} | links:${allLinks.length} | mode:${usedMode}${usedMode === "render" && /* was originally static */ renderMode === "auto" ? " (auto-escalated)" : ""} | quality:${quality.score} | content_ok:${contentOk}...`
```

A cleaner approach: track whether escalation happened with a boolean `autoEscalated` set to `true` inside the quality-gate block, then emit `| escalated:true` in the format line when true.

### Risk Assessment

**Regression risk: LOW.** The quality-gate fires only when `usedMode === "static"` AND `quality.score < 40` AND `renderMode === "auto"`. Sites that already pass quality (score >= 40) are unaffected. Sites already escalated to render via `detectJsHeavyContent` are excluded (`usedMode` would be `"render"` by that point).

**Latency risk: MEDIUM.** For every low-quality static fetch, a second round-trip to the render API is added. This is a deliberate trade-off. The only mitigation needed is to cap the retry to one attempt (already the case — no retry loop).

**Edge cases:**
- If the render API key is missing/invalid, `fetchWithRender` throws; the `catch {}` swallows it and returns the original static content. Behavior degrades gracefully.
- If render also returns low-quality content (score <= static score), the `if (renderQuality.score > quality.score)` guard keeps the static result. No silent downgrade.
- Batch mode: each URL goes through `extractSingle` independently, so the fix applies per-URL with no interaction between parallel fetches.
- PDF paths: guarded by `pdfPages === null`.

---

## BUG-E2: Fields Extractor

### Root Cause (from source)

File: `src/utils/fields.ts`, lines 53–116.

The `PATTERN_MAP` object (line 53) covers 9 generic field categories (title, description, price, date, author, rating, availability, stock, written by). It has **no entries for "programming language", "license", "stars", or "description" in the GitHub-specific sense**.

When `extractFields` is called with `["programming language", "license", "stars", "description"]`:

1. Structured data check (line 91): GitHub pages typically have no JSON-LD schema for these fields, so this returns null.
2. `PATTERN_MAP` lookup (line 101): `"programming language"` → no entry. `"license"` → no entry. `"stars"` → no entry. `"description"` → hits `DESCRIPTION_PATTERNS`, but those patterns look for `description:` key-value pairs or standalone sentences — neither matches GitHub's repo description format.
3. Generic inline pattern (line 108): Generates regex `(?:^|\n)(?:\*\*)?programming language(?:\*\*)?[:\s]+([^\n]{3,100})`. This fails because GitHub's language stat in markdown appears as e.g. `Python 99.8%` (space-separated, no colon) or as a percentage bar rendered as a heading-less line. Stars appear as `[Star 3.5k]` (link text wrapping the count). License appears as `MIT License` inside a "License" section heading, not as `License: MIT` key-value.

The three specific structural mismatches:

**a) Stars — link-wrapped count:**
GitHub markdown renders star counts as link text: `[Star 3.5k](https://github.com/...)` or plain `Star 3.5k` after markdown-to-text. The generic pattern requires a `:` or whitespace after the field name as a delimiter, which is absent.

**b) Language — percentage-suffixed, no delimiter:**
Language stats appear as `Python 99.8%` on a line. The generic pattern fires on `programming language: X` format, not on `Python 99.8%` bare format.

**c) License — prose-embedded in section:**
License appears under a `## License` heading followed by `MIT License` or `Apache 2.0` on the next line. The generic pattern requires `license: value` inline, not a heading-then-content structure.

### Proposed Fix

Two-layer fix: (1) add GitHub-specific patterns to `PATTERN_MAP`, and (2) add a heading-then-content extractor for section-based fields.

**File: `src/utils/fields.ts`**

Add GitHub-specific patterns after line 38 (after `AVAILABILITY_PATTERNS`):

```typescript
/** Stars/forks patterns: "Star 3.5k", "3,542 stars", "★ 12.4k" */
const STARS_PATTERNS = [
  /\bStar\s+([\d.,]+[kKmM]?)\b/i,
  /([\d.,]+[kKmM]?)\s+stars?\b/i,
  /★\s*([\d.,]+[kKmM]?)/,
  /\bstargazers[:\s]+([\d.,]+[kKmM]?)/i,
];

/** Programming language patterns: "Python 99.8%", "JavaScript · 78%", "Language: TypeScript" */
const LANGUAGE_PATTERNS = [
  /\blanguage[:\s]+([\w+#.-]+)/i,
  /^([\w+#.-]{2,20})\s+\d{1,3}(?:\.\d+)?%/m,
  /^\*\*([\w+#.-]{2,20})\*\*\s+\d{1,3}(?:\.\d+)?%/m,
  /([\w+#.-]{2,20})\s*·\s*\d{1,3}(?:\.\d+)?%/,
];

/** License patterns: "MIT License", "Apache 2.0", "License\nMIT" */
const LICENSE_PATTERNS = [
  /\blicense[:\s]+(MIT|Apache[\s\-][\d.]+|GPL[\s\-][\d.]+|BSD[\s\-][\d\w\-]+|ISC|MPL[\s\-][\d.]+|AGPL[\s\-][\d.]+|LGPL[\s\-][\d.]+|CC[\s\-][\w\-]+|Unlicense|WTFPL)/i,
  /^#+\s+license\s*\n+\s*(MIT|Apache[\s\-][\d.]+|GPL[\s\-][\d.]+|BSD[\s\-][\d\w\-]+|ISC|MPL[\s\-][\d.]+|AGPL[\s\-][\d.]+|LGPL[\s\-][\d.]+|CC[\s\-][\w\-]+|Unlicense|WTFPL)/im,
  /\b(MIT|Apache 2\.0|Apache-2\.0|GPL-[23]\.0|BSD-[23]-[Cc]lause|ISC|MPL-2\.0|AGPL-3\.0|LGPL-[23]\.0|Unlicense)\b/,
];
```

Update `PATTERN_MAP` (lines 53–69) to add the new entries:

```typescript
const PATTERN_MAP: Record<string, RegExp[]> = {
  title: TITLE_PATTERNS,
  description: DESCRIPTION_PATTERNS,
  "meta description": DESCRIPTION_PATTERNS,
  price: PRICE_PATTERNS,
  cost: PRICE_PATTERNS,
  date: DATE_PATTERNS,
  published: DATE_PATTERNS,
  "published date": DATE_PATTERNS,
  updated: DATE_PATTERNS,
  author: AUTHOR_PATTERNS,
  "written by": AUTHOR_PATTERNS,
  rating: RATING_PATTERNS,
  score: RATING_PATTERNS,
  availability: AVAILABILITY_PATTERNS,
  stock: AVAILABILITY_PATTERNS,
  // GitHub / repository fields
  stars: STARS_PATTERNS,
  "star count": STARS_PATTERNS,
  "github stars": STARS_PATTERNS,
  stargazers: STARS_PATTERNS,
  language: LANGUAGE_PATTERNS,
  "programming language": LANGUAGE_PATTERNS,
  license: LICENSE_PATTERNS,
  "open source license": LICENSE_PATTERNS,
};
```

**Add heading-then-content extractor** (insert after `matchPatterns` function, before `extractFields`):

```typescript
/**
 * Attempt to extract a value that follows a section heading in markdown.
 * Handles patterns like:
 *   ## License
 *   MIT License
 *
 *   ## Stars
 *   Star 3.5k
 */
function matchHeadingSection(text: string, fieldName: string): string | null {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match "## field\n<optional blank>\nvalue on next non-empty line"
  const headingPattern = new RegExp(
    `^#{1,4}\\s+${escapedField}\\s*\\n(?:\\n)*((?!#)[^\\n]{1,120})`,
    "im"
  );
  const m = text.match(headingPattern);
  if (m?.[1]) return m[1].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // strip markdown links
  return null;
}
```

Update `extractFields` to call `matchHeadingSection` as a fourth fallback (after the generic pattern, before `not_found`):

```typescript
// In extractFields, replace the final return (line 115):
//   return { field, value: "", source: "not_found" };
// With:

    // 4. Heading-then-content pattern (e.g. "## License\nMIT License")
    const headingValue = matchHeadingSection(markdown, field);
    if (headingValue) return { field, value: headingValue, source: "pattern" };

    return { field, value: "", source: "not_found" };
```

**Full updated `extractFields` function tail (lines 107–117):**

```typescript
    // 3. Generic: look for "field: value" or "**field**: value" in markdown
    const genericPattern = new RegExp(
      `(?:^|\\n)(?:\\*\\*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?[:\\s]+([^\\n]{3,100})`,
      "im"
    );
    const gm = markdown.match(genericPattern);
    if (gm?.[1]) return { field, value: gm[1].trim().replace(/\*\*/g, ""), source: "pattern" };

    // 4. Heading-then-content pattern
    const headingValue = matchHeadingSection(markdown, field);
    if (headingValue) return { field, value: headingValue, source: "pattern" };

    return { field, value: "", source: "not_found" };
```

**Also fix the "description" field for GitHub repos.** The existing `DESCRIPTION_PATTERNS` requires either a `description:` key or a standalone sentence — GitHub repo descriptions appear on the first non-heading line of the extracted markdown, often just a plain sentence. The existing `DESCRIPTION_PATTERNS[1]` (`/^(?!#)([A-Z][^.!?\n]{30,250}[.!?])\s*$/m`) should catch this if the description ends with punctuation. If it doesn't (many short descriptions don't), add a looser pattern:

```typescript
// Add to DESCRIPTION_PATTERNS (after line 50):
const DESCRIPTION_PATTERNS = [
  /(?:description|summary)[:\s]+(.{10,300}?)(?:\n|$)/i,
  /^(?!#)([A-Z][^.!?\n]{30,250}[.!?])\s*$/m,
  /^(?!#|\s*[-*])([A-Za-z][^.\n]{15,200})(?:\n|$)/m,  // short descriptions without trailing punctuation
];
```

### Risk Assessment

**Regression risk: LOW.** All changes are additive. New patterns are only consulted when existing patterns return null. The heading-then-content extractor only fires as a final fallback.

**False positive risk: MEDIUM for language detection.** The `LANGUAGE_PATTERNS[1]` (`/^([\w+#.-]{2,20})\s+\d{1,3}%/m`) could match percentage statistics on non-GitHub pages (e.g. "Chrome 78%", "Desktop 65%"). Mitigation: this pattern fires only when the field name exactly matches `"language"` or `"programming language"` — generic pages won't request those specific field names.

**False positive risk: LOW for stars.** `\bStar\s+3.5k\b` is specific enough to avoid accidental matches on non-GitHub content.

**Regex edge cases:**
- Languages with symbols: `C++`, `C#`, `F#` — covered by `[\w+#.-]` character class.
- License variants like `Apache License 2.0` vs `Apache-2.0` — covered by the third LICENSE pattern (identifier form).
- Star counts > 1M (e.g. `1.2M`) — the `[kKmM]` suffix class covers this.

**Missing case — stars buried in prose:** Some GitHub markdown extraction yields "3,542 stars and 421 forks". The `STARS_PATTERNS[1]` (`/([\d.,]+[kKmM]?)\s+stars?\b/i`) handles this.

**Recommended test cases to add in `tests/` before merging:**
```
extractFields(["stars"], null, "Star 3.5k")          // → "3.5k"
extractFields(["stars"], null, "[Star 3.5k](url)")   // → "3.5k" (link stripped)
extractFields(["programming language"], null, "Python 99.8%")  // → "Python"
extractFields(["license"], null, "## License\nMIT License\n") // → "MIT License"
extractFields(["license"], null, "licensed under MIT")         // → "MIT"
```

---

## Bonus: Session Persistence Docs

The 5x warm session speedup (1,455ms vs 7,880ms cold, confirmed in test 6a/6b) should appear in **two places**:

1. **Tool description for `novada_browser`** (`src/tools/browser.ts`, in the `description` field of the tool registration): Add a sentence after the existing description: `"Session persistence: pass the same session_id across calls to reuse an existing browser page — cookies, localStorage, and login state are preserved. Warm sessions are typically 5x faster than cold starts (measured: 1.5s warm vs 7.9s cold). Sessions expire after 10 minutes of inactivity."`

2. **`agent_instruction` in the session-related response path**: When `novada_browser` completes an action on a `session_id`, include in the Agent Hints block: `"- Session '${session_id}' is warm. Reuse this session_id in follow-up calls for ~5x faster response and preserved login state (cookies/localStorage intact)."` This appears only when `session_id` is present in the params and the call was successful — it directly tells the agent to reuse the session rather than requiring the agent to infer this from docs.

These two placements ensure the differentiator is visible both at tool-selection time (description) and at runtime decision time (agent_instruction in output).
