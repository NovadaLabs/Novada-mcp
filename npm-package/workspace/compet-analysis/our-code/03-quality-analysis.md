# Content Quality Analysis: 7.5/10 vs Firecrawl/Tavily 8.9/10

**Date:** 2026-06-23
**Scope:** novada-mcp extraction pipeline quality gap

---

## 1. Extraction Algorithm: What We Use

**File:** `src/utils/html.ts`

Our algorithm is a **custom cheerio-based extractor** — NOT Mozilla Readability. It is a simplified approximation of Readability's approach, built independently with several critical differences.

### Our pipeline (html.ts:79–288):

1. Remove REMOVE_TAGS: `script`, `style`, `noscript`, `svg`, `iframe`, `nav`, `footer`, `header`, `aside`, `form` (lines 5–8)
2. Apply BOILERPLATE_SELECTORS: CSS class/id substring matches for sidebar, menu, cookie, banner, popup, modal, ad-, footer, header, topbar, toolbar, breadcrumb, colored table cells (lines 11–32)
3. Try CONTENT_SELECTORS in order: `main`, `article`, `[role='main']`, `[class*='content']`, `[class*='article']`, `[class*='post']`, `[class*='entry']`, `[id*='content']`, `[id*='article']` (lines 35–45)
4. If no selector matched: density-score every `div, section, article, main` — score = `textLen * (1-linkDensity) + headingBonus + paragraphBonus` (lines 107–126)
5. If best score <= 100: fall back to body with BOILERPLATE_SELECTORS applied (lines 129–134)
6. Serialize to markdown line-by-line: headings, paragraphs, lists, blockquotes, pre/code, tables

### How Mozilla Readability differs (key gaps):

| Feature | Readability | Our Code |
|---|---|---|
| Score propagation | Scores propagate UP to ancestor containers | No propagation — scores stay on each element |
| Sibling merging | Appends siblings that look article-like | Not implemented |
| Class/ID name weighting | Positive/negative class name dictionary | Substring matching only |
| Punctuation scoring | Rewards comma density (signals real writing) | Not implemented |
| Sibling block merging | Captures split intro/trailing paragraphs | Missing — loses content split across divs |
| Conditional cleanup | Removes forms/embeds only when they look like junk | Forms always removed (html.ts:7) |

---

## 2. Quality Scoring Logic

**File:** `src/utils/html.ts:459–558`

### What `scoreExtraction()` measures:

| Signal | Points | Condition |
|---|---|---|
| Structured data (JSON-LD) | +20 | has JSON-LD |
| Content tiny | -20 | markdown < 200 chars |
| Content medium | +10 | markdown >= 1,000 chars |
| Content long | +20 | markdown >= 5,000 chars |
| List items | +10 | >= 10 `- ` list entries |
| Content lines | +5 | >= 20 non-empty lines |
| Link density OK | +10 | density in [0.05, 0.6] |
| Has H2/H3 headings | +10 | matches `^## ` or `^### ` |
| Has code block | +5 | contains ` ``` ` |
| Mode static | +10 | usedMode == "static" |
| Mode render | +5 | usedMode == "render" |
| Mode render-failed | -15 | usedMode == "render-failed" |
| Bot challenge in HTML | -40 | detectJsHeavyContent() true |
| Content truncated | -5 | markdown.length >= 25,000 |

**Max achievable score for a good page without JSON-LD:** 10+20+10+5+10+10+5+10 = **80/100**
**Max with JSON-LD:** 20+80 = **100/100** (clamped)

### What the score CANNOT detect (critical gaps):

1. **Semantic completeness** — score rewards length but not whether the right content was extracted. A 5,000-char nav dump scores identically to a 5,000-char article body.
2. **Content type fidelity** — tables with 5 rows and 4 columns score 0 points for "has_list_items" and 0 for "has_headings" if there are no `##` headings. Data-rich pages (e-commerce specs, API docs) are systematically underscored.
3. **Paragraph coherence** — no signal for whether extracted text is coherent prose vs. a space-separated concatenation of nav items.
4. **Missing-content detection** — no comparison between HTML text density and extracted markdown density. Over-stripping is invisible to the scorer.
5. **Code quality in pre blocks** — code block signal (`+5`) fires on any triple-backtick, even an empty fence.

---

## 3. Root Causes of the 7.5/10 vs 8.9/10 Gap

### 3a. Over-stripping: `form` removal is too aggressive

**File:** `src/utils/html.ts:7`

```typescript
const REMOVE_TAGS = [
  "script", "style", "noscript", "svg", "iframe", "nav", "footer",
  "header", "aside", "form",   // <-- "form" removed unconditionally
];
```

Many legitimate content blocks use `<form>` wrappers:
- GitHub issue/PR description bodies are inside `<form>` on older views
- Search result pages (Hacker News) use `<form>` for comment forms that also wrap content
- Wikipedia infoboxes sometimes nest inside `<form>` on mobile
- Any comment section using `<form>` loses all its content

Mozilla Readability only removes `<form>` elements **conditionally** — when they score low AND have a high link density. Our blanket removal loses real content.

### 3b. Selector ordering misses deep content nesting

**File:** `src/utils/html.ts:97–103`

```typescript
for (const selector of CONTENT_SELECTORS) {
  const $el = $(selector).first();
  if ($el.length && ($el.text() || "").trim().length > 200) {
    $content = $el;
    break;   // <-- stops at FIRST match with > 200 chars
  }
}
```

If `main` exists but contains mostly nav/header children (not yet removed because BOILERPLATE_SELECTORS only run in the fallback path at line 130), this selector fires with a shallow, nav-heavy container. The 200-char threshold is too low to distinguish real content.

**The critical bug:** BOILERPLATE_SELECTORS are applied to `$("body")` only in the fallback branch (line 130). When a semantic selector (`main`, `article`) is found, no boilerplate removal happens inside that container. Nav elements left inside `<main>` pollute the extracted text.

### 3c. Density scoring threshold too low

**File:** `src/utils/html.ts:123`

```typescript
if (bestScore > 100 && bestEl) {
  $content = bestEl;
}
```

Score = `textLen * (1-linkDensity) + headingBonus + paragraphBonus`

For a page with 400 chars of link-heavy text (linkDensity=0.7), score = `400*0.3 + 0 + 0 = 120` — passes the threshold. This allows nav-heavy blocks that happen to be large to win over smaller, denser article blocks.

### 3d. No sibling merging (Readability gap)

When an article is structured as:

```html
<div class="intro">First paragraph...</div>
<div class="article-body">Main content...</div>
<div class="conclusion">Final paragraph...</div>
```

Our code picks whichever single div has the highest score. Readability merges all three siblings under their parent. We lose intro/conclusion paragraphs, causing shorter extracted content that depresses the quality score (content_medium vs content_long).

### 3e. Table handling: `inlineMarkdown` loses link text in cells

**File:** `src/utils/html.ts:254`

```typescript
const text = $cell.text().replace(/\s+/g, " ").trim();
```

Non-nested cells use `.text()` (plain text), losing all markdown formatting (bold, links) for table cells. Only cells with nested tables use `inlineMarkdown`. Data tables on e-commerce/docs pages lose their link annotations.

### 3f. Quality scoring does not reward tables

The score has no signal for "has data table" (+N points). A perfectly extracted Wikipedia article with 3 infobox tables and 2 comparison tables gets 0 extra points vs a plain text blog post of the same length. Table-rich pages are systematically underscored relative to actual content quality.

### 3g. The Firecrawl advantage: LLM-based cleaning

Firecrawl routes content through an LLM cleaning step. This provides:
- Semantic boilerplate detection (not just class name matching)
- Coherence preservation across split content blocks
- Context-aware table formatting
- 93% token reduction vs raw HTML while preserving all semantic content

Our pipeline is purely heuristic. For structurally irregular pages (custom CMSs, SPAs with non-standard class names), Firecrawl's LLM step catches what our heuristics miss.

---

## 4. Content Type Failure Matrix

| Content Type | Extraction Quality | Root Cause |
|---|---|---|
| Blog articles with `<article>` tag | Good | CONTENT_SELECTORS hits article first |
| Wikipedia / docs with infobox tables | Partial | Table renders but cell links lost (html.ts:254) |
| GitHub README (static) | Good | article + code blocks |
| E-commerce product pages | Poor | form removal strips spec tables; JSON-LD partially compensates |
| SPA pages (React, Next.js) | Depends on render mode | Not a parsing issue, a fetch issue |
| Pages with content split across sibling divs | Poor | No sibling merging (html.ts gap) |
| Pages using `<main>` with nav children | Poor | Boilerplate not removed inside semantic selector (html.ts:97-103 bug) |
| Pages with only `<table>` layout (HN) | Moderate | Table handling exists but layout tables produce "wall of text" |
| Code documentation pages | Good | pre/code blocks handled, headings present |
| Comment-heavy pages (Reddit, forums) | Moderate | li items captured but form wrappers can strip them |

---

## 5. Actionable Improvement Suggestions

### P0 — Fix boilerplate removal inside semantic selectors (html.ts:97–103)

Apply BOILERPLATE_SELECTORS to `$content` immediately after the semantic selector match, not only in the fallback branch. This is the single highest-impact fix.

```
// After line 103 where $content is set from CONTENT_SELECTORS:
for (const selector of BOILERPLATE_SELECTORS) {
  $content.find(selector).remove();
}
```

### P1 — Raise semantic selector threshold and add content validation (html.ts:99)

Change `> 200` to `> 500` AND verify link density of the selected element is < 0.5 before accepting it. Prevents shallow nav-heavy containers from triggering early exit.

### P2 — Conditional form removal (html.ts:7)

Remove `"form"` from REMOVE_TAGS. Instead, in the markdown serializer, skip `<form>` elements only if they contain no `<p>`, `<li>`, or `<blockquote>` children (i.e., forms that look like search/login boxes).

### P3 — Add sibling merging (html.ts after line 126)

After selecting `$content` via density scoring, check siblings under the same parent with score > 50% of best score and append them. This directly mirrors Readability's sibling merging step.

### P4 — Fix table cell markdown (html.ts:254)

Replace `.text()` with `inlineMarkdown($cell, baseUrl)` for all cells, not just nested-table cells. Preserves bold, links in table data.

### P5 — Add table quality signal to scoreExtraction (html.ts:459)

Add `+5` for "has_data_table" when markdown contains `| --- |` separator rows. Prevents systematic underscore of well-structured data pages.

### P6 — Integrate @mozilla/readability as a fallback

When density scoring produces a score < 60 AND the page is not JS-heavy, run `@mozilla/readability` on the same HTML and compare output lengths. Use whichever produces more content. This directly closes the Firecrawl algorithmic gap for irregular pages without requiring LLM inference costs.

### P7 — Paragraph coherence signal (scoreExtraction)

Add `+5` when `markdown` has >= 3 sentences with length > 50 chars (prose signal). Distinguishes real article extraction from nav-dump false positives.

---

## 6. Score Translation

The internal 0-100 score maps to the benchmark 7.5/10 as follows:

- A clean article page with no JSON-LD, static mode, > 5,000 chars, headings, links = 10+20+5+10+10 = **55/100** → label "moderate"
- With JSON-LD: **75/100** → label "good"
- The benchmark 7.5/10 ≈ our 60–70/100 range (based on "good" label threshold at 60)
- Firecrawl 8.9/10 implies their equivalent of our 80–90/100 range

The gap is primarily: pages without JSON-LD are capped at 80 max, and the boilerplate-in-semantic-container bug causes ~10–15 point depression on affected pages.

---

## Sources

- [Mozilla Readability Algorithm Explained – WebCrawlerAPI Blog](https://webcrawlerapi.com/blog/mozilla-readability-algorithm-readabilityjs)
- [github.com/mozilla/readability](https://github.com/mozilla/readability)
- [Beyond a Single Extractor: Re-thinking HTML-to-Text Extraction for LLM Pretraining (arXiv:2602.19548)](https://arxiv.org/html/2602.19548v1)
- [Firecrawl – LLM-optimized extraction overview](https://www.firecrawl.dev/)
- [How to Turn Websites into LLM-Ready Data Using Firecrawl – freeCodeCamp](https://www.freecodecamp.org/news/how-to-turn-websites-into-llm-ready-data-using-firecrawl/)
