# HTML Extraction & Quality Scoring — Code Analysis

**Analyzed files:** `src/utils/html.ts`, `src/utils/format.ts`, `src/utils/fields.ts`
**Date:** 2026-06-23

---

## 1. Content Extraction Library / Algorithm

`html.ts` does **not** use the actual `@mozilla/readability` npm package or Turndown. It is a **custom cheerio-based pipeline** described in a comment as "a simplified version of Mozilla Readability's scoring algorithm." The actual Mozilla Readability JS library (readability.js) is not a dependency.

Extraction proceeds in three stages:

1. **Semantic selector pass** — tries `main`, `article`, `[role='main']`, `[class*='content']`, etc. in priority order; picks the first match with >200 chars of text.
2. **Density scoring pass** (when stage 1 fails) — iterates `div, section, article, main`, scores each with `scoreCandidateElement()`, picks the highest-scoring element with score > 100.
3. **Body fallback** — if both above fail, strips boilerplate via `BOILERPLATE_SELECTORS` and uses `<body>`.

The Markdown conversion is also **custom** — a recursive `inlineMarkdown()` walker built directly in `html.ts`. Turndown (the standard HTML-to-Markdown library with 11k GitHub stars) is not used.

---

## 2. Quality Score Calculation (0–100 scale)

`scoreExtraction()` is an **additive signal accumulator** clamped to [0, 100]. Signals:

| Signal | Delta | Condition |
|---|---|---|
| `structured_data` | +20 | JSON-LD found |
| `content_long` | +20 | markdown length >= 5000 chars |
| `content_medium` | +10 | markdown length >= 1000 chars |
| `content_tiny` | -20 | markdown length < 200 chars |
| `has_list_items` | +10 | >= 10 list items (`^- ` lines) |
| `content_lines` | +5 | >= 20 non-empty lines |
| `link_density_ok` | +10 | link density 0.05–0.60 |
| `has_headings` | +10 | markdown contains `## ` or `### ` |
| `has_code_block` | +5 | markdown contains triple backtick |
| `mode_static` | +10 | fetch mode was static |
| `mode_render` | +5 | fetch mode was render |
| `mode_render_failed` | -15 | render attempt failed |
| `bot_challenge` | -40 | `detectJsHeavyContent()` returns true |
| `truncated` | -5 | markdown >= 25000 chars (hit limit) |

**Maximum achievable score without structured data:** 80 (static + long content + lists + headings + lines + link density + code block). With JSON-LD: 100.

**Key weakness:** Score reflects structural signals (headings, lists, length) but not semantic accuracy. A page that extracts navigation text as body content could score 75/100 while Firecrawl's output of the same URL scores 30/100 but is actually correct.

---

## 3. Elements Stripped — Can It Strip Too Much?

### Hard-removed tags (before any content analysis):
`script`, `style`, `noscript`, `svg`, `iframe`, **`nav`**, **`footer`**, **`header`**, **`aside`**, **`form`**

### Boilerplate selectors (removed only in fallback path):
`[class*='sidebar']`, `[class*='menu']`, `[class*='cookie']`, `[class*='banner']`, `[class*='popup']`, `[class*='modal']`, `[class*='ad-']`, `[class*='header']`, `[class*='footer']`, `[role='navigation']`, `[role='banner']`, `[role='contentinfo']`, nav-like tables, `td[bgcolor]`, topbar/toolbar/breadcrumb selectors.

**Risk of over-stripping:**

1. **`header` is hard-removed unconditionally.** Many article pages put the article title inside `<header>` (Medium, Substack, some CMSes). If the H1 sits inside `<header>`, it is gone before any candidate scoring runs.

2. **`[class*='header']` in BOILERPLATE_SELECTORS** would also catch `div.article-header` or `section.post-header` — legitimate content wrappers.

3. **`nav` hard-removal** silently deletes navigation breadcrumbs that are semantically part of some documentation pages (e.g. MDN, ReadTheDocs have nav as the doc structure).

4. **`td[bgcolor]`** removes any table cell with a bgcolor attribute. This was added for Hacker News but could false-positive on legitimate tables in old-school sites that use inline coloring for styling.

5. **`[class*='menu']`** is a substring match — will hit `div.context-menu` inside article bodies, dropdown-menu inside app UI documentation, etc.

6. **`form` hard-removal** erases comment forms but also search-results forms on sites that render result sets as form elements.

---

## 4. Markdown Conversion — Library or Custom?

**Custom.** The `inlineMarkdown()` function is a recursive Cheerio node walker written inline in `html.ts`. It handles:
- `a` → `[text](href)` (with `resolveHref` for relative URLs)
- `strong/b` → `**text**`
- `em/i` → `*text*`
- `code` → `` `text` ``
- `h1–h6` → `# text` (heading prefix by level)
- `li` → `- text`
- `blockquote` → `> text`
- `pre` → ` ``` \ntext\n ``` `
- `p, dt, dd` → inline-rendered text

**What Turndown would add but this custom walker does not:**
- `del/strike` support
- `sup/sub` support
- Proper escaping of Markdown special characters inside text (asterisks, underscores, brackets in plain text content are not escaped and will corrupt output)
- GFM strikethrough, task lists via plugin system
- Rule-based extensibility

---

## 5. Specific Element Handling

### Code blocks (`<pre>`)
Handled — `pre` outputs a fenced code block. However **language detection is absent**: all code blocks emit ` ``` ` with no language hint. A `<pre><code class="language-python">` will lose the language specifier. Firecrawl and Tavily both preserve the `class` attribute to infer the language tag.

### Tables
Handled with notable sophistication. The table renderer:
- Distinguishes **data tables** (has `<th>`) from **layout tables** (no `<th>`)
- Data tables → GFM `| header | … |` format
- Layout tables → plain text, cells joined with ` — `
- Handles nested tables (layout-in-layout, data-in-layout, data-in-data cases)
- HN-style nested row expansion

**Gap:** Table cells call `$cell.text()` (plain text), not `inlineMarkdown()`. Links inside table cells are lost.

### Images
**Not handled at all.** No `<img>` → `![alt](src)` conversion anywhere in the walker. Image alt text is silently discarded. This is a meaningful gap for pages where figures with captions carry semantic information.

### Lists
`<li>` renders as `- text` (unordered). **Ordered lists (`<ol>`) are not handled** — `<li>` inside `<ol>` gets the same `- ` prefix as unordered. The numbered sequence is lost.

---

## 6. No-Content / Login Wall Handling

`detectJsHeavyContent(html)` (imported from `./http.ts`) applies a -40 penalty when called from `scoreExtraction`. This is the primary defense.

However, `extractMainContent()` itself has no explicit login-wall detection. It will attempt to extract content from a 401-redirect HTML page, a Cloudflare challenge page, or a "please sign in" wall. The result will be short, which triggers the `-20 content_tiny` penalty and typically produces a score of 0–20. The extraction returns whatever text is there — it does not return a structured signal like `{blocked: true}`.

**No explicit empty-result handling:** `extractMainContent` returns `""` only if the html is empty or body is missing. A page with 300 chars of "Please log in to continue" returns that string with a low but nonzero score.

---

## 7. Boilerplate Detection Algorithm

Two layers:

**Layer 1 — Tag-level removal (REMOVE_TAGS):** Hard-coded list of 10 HTML tags removed before any content selection. This is pre-filtering, not detection.

**Layer 2 — CSS selector removal (BOILERPLATE_SELECTORS):** 30+ substring/prefix CSS selectors targeting common class/id name patterns. Applied **only in the fallback path** (when both semantic selector and density scoring fail). The selector list covers sidebar, menu, cookie, banner, popup, modal, ad, footer, header, navigation roles, table-layout navigation, topbar, toolbar, breadcrumb.

There is **no statistical boilerplate detection** (no block-level text density scoring, no n-gram repetition detection). Trafilatura uses a machine-learned classifier; Mozilla Readability uses a multi-pass scoring with link density + content scoring per candidate node. The current implementation is purely rule-based on class/id names.

**Key limitation:** Class-name patterns are fragile for sites that use hashed CSS class names (Next.js CSS Modules, Tailwind with arbitrary values) or BEM naming that doesn't contain the pattern words.

---

## 8. Content Structure Preservation (Heading Hierarchy)

Heading hierarchy (`h1`–`h6`) is preserved — each heading gets the correct number of `#` prefixes. The walker iterates `h1, h2, h3, h4, h5, h6` as part of the selector list in `$content.find(...)`, so relative depth is maintained.

**Gap:** The walker does not emit blank-line separators before headings consistently — it does emit `\n` prefix and suffix for headings, but the final cleanup `replace(/\n{3,}/g, "\n\n")` normalizes spacing. This is fine for LLM consumption but loses tight heading clustering signals for structure analysis.

---

## 9. Specific Issue Analysis

### Shadow DOM
**Not handled.** Cheerio is a static HTML parser. Content rendered into Shadow DOM roots by Web Components is not accessible in the serialized HTML string unless the renderer has already expanded the shadow tree. Sites using LitElement, Shoelace, or custom elements with shadow roots will silently lose content. There is no workaround at the HTML parsing level — this requires the browser/renderer to serialize shadow roots (via `getInnerHTML({includeShadowRoots: true})`).

### Lazy-loaded images
**Not handled.** Images using `loading="lazy"` or `data-src` patterns (Intersection Observer-based lazy loading) are present in the HTML but `extractMainContent` doesn't emit `<img>` elements at all. Even if it did, `data-src` would be ignored unless specifically resolved. The broader issue is that lazy images may not have been loaded when the static HTML was fetched — the render path would be needed, and even then, image URLs in markdown output are absent.

### Content deduplication
**No deduplication.** If a `<section class="content">` is both matched by the semantic selector pass AND contains elements that also appear in another matched region (e.g., a sticky summary duplicated in mobile layout), both instances will appear in the output. The duplicate-table-content guard (filtering elements inside `<table>` from the main pass) is the only deduplication logic present.

---

## 10. Quality Improvement — Top 5 Changes to Move 7.5 → 8.5+

### Change 1: Add image extraction to markdown walker
**Current state:** `<img>` is completely ignored.
**Fix:** In the element walker, add `img` handling:
```
![${$el.attr('alt') || ''}](${resolveHref($el.attr('src') || $el.attr('data-src') || '', baseUrl) || ''})
```
Also resolve `data-src` for lazy-loaded images.
**Impact:** Documentation pages, product pages, articles with inline figures currently emit no image references. This is a reliable signal discriminator between our output and Firecrawl/Tavily, which both preserve image markdown.

### Change 2: Fix ordered list handling
**Current state:** `<ol><li>` items render as `- ` (unordered bullet), losing numbering.
**Fix:** Check if the `li`'s parent is an `ol`, and if so use `{n}. ` with an incrementing counter. This requires tracking the parent element, which cheerio supports via `$(el).parent().get(0).tagName`.
**Impact:** Step-by-step instructions, numbered procedures, ordered rankings — a common content pattern — become semantically correct.

### Change 3: Preserve code block language hints
**Current state:** `<pre><code class="language-python">` → ` ```\n...\n``` ` (no language).
**Fix:** When processing `pre`, check for a child `code` element and extract its class for a language hint:
```
const lang = $el.find('code').first().attr('class')?.match(/language-(\w+)/)?.[1] || '';
lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
```
**Impact:** Developer documentation (GitHub READMEs, MDN, docs sites) is a primary use case. Syntax-highlighted code blocks without language tags are less useful in LLM pipelines.

### Change 4: Escape Markdown special characters in plain text
**Current state:** Text nodes containing `*`, `_`, `[`, `]`, `\` are emitted verbatim, which corrupts Markdown rendering.
**Fix:** Add a `escapeMarkdown(text: string)` utility that escapes `\`, `` ` ``, `*`, `_`, `{`, `}`, `[`, `]`, `(`, `)`, `#`, `+`, `-`, `.`, `!` per CommonMark spec. Apply it to all text node output in `inlineMarkdown()`.
**Impact:** Articles about regex, mathematical notation, code-heavy content, or financial data (e.g., "Return of -15%" or "Score: 5/10 (not 6*2)") currently generate broken Markdown.

### Change 5: Replace class-name boilerplate detection with content-density scoring at every stage
**Current state:** Boilerplate selectors are only applied in the fallback path and rely entirely on class/id name patterns. Sites using CSS Modules (hashed class names like `_header_abc123`) bypass all removal.
**Fix:** Apply `scoreCandidateElement()` scoring to all top-level children of `<body>` before the semantic selector pass, and remove any child with a score < 10% of the highest-scoring child. This is closer to what Mozilla Readability actually does (multi-pass with parent scoring). Specifically:
- Score all direct children of `<body>`
- The highest-scoring child is the content candidate
- Mark children scoring < 15% of max as likely boilerplate
- Do not remove them outright — exclude from line emission but retain in fallback
**Impact:** Framework-generated class names (Next.js, Remix, SvelteKit apps) currently bypass the entire boilerplate removal layer. This change is structure-based, not name-based.

---

## 11. Comparison to Firecrawl / Tavily Approach

### How Firecrawl likely works
Firecrawl uses `@mozilla/readability` (the real JS library from Firefox Reader View) for content extraction, with Turndown for HTML→Markdown conversion. Mozilla Readability scores every paragraph/div candidate using a multi-dimensional scoring function (text length, link density, punctuation density, class name bonuses/penalties) with recursive parent scoring and a two-pass cleanup. Turndown handles code fences, image links, ordered/unordered lists, table formatting, and Markdown escaping via a rule-based plugin system.

The key differences vs. our implementation:

| Feature | Novada (`html.ts`) | Firecrawl (Readability + Turndown) |
|---|---|---|
| Extraction algorithm | Custom Cheerio, simplified scoring | Full Mozilla Readability (Firefox Reader View) |
| Markdown conversion | Custom walker (no escaping, no OL) | Turndown + GFM plugin (full spec coverage) |
| Image handling | None | `![alt](src)` output |
| Ordered lists | Broken (uses `- ` for `<ol>`) | `1.`, `2.`, `3.` correct |
| Code block language | Lost | Preserved from class attribute |
| Markdown escaping | None | Full CommonMark escaping |
| Boilerplate detection | Class name regex only | Multi-pass content scoring |
| Shadow DOM | Not handled | Not handled (same limitation) |
| Lazy images | Not handled | Partially (render mode only) |

### How Tavily likely works
Tavily's extraction pipeline is proprietary but based on public documentation it uses a combination of Readability-style extraction with custom post-processing for news articles and academic content. They apply LLM-based quality validation as a final pass (unique to Tavily). Their quality scoring integrates semantic coherence, not just structural signals.

### Benchmark context
From the Bevendorff et al. SIGIR 2023 study: Trafilatura mean F1 = 0.883, readability.js median F1 = 0.970 on 8 evaluation datasets. Our custom simplified implementation would score meaningfully below both — likely in the 0.80–0.85 F1 range on clean article pages, and lower on apps/SPAs/documentation sites.

---

## Summary of Gaps

| Priority | Gap | Effort | Impact |
|---|---|---|---|
| P0 | Images not extracted | Low | High — missing from all page outputs |
| P0 | Ordered lists use wrong prefix | Low | Medium — broken for step-by-step content |
| P1 | Code block language lost | Low | Medium — documentation sites |
| P1 | No Markdown escaping | Medium | Medium — corrupts output on code/math content |
| P1 | Boilerplate detection bypassed by hashed classes | High | High — affects all modern framework sites |
| P2 | `<header>` hard-removed pre-analysis | Low | Medium — loses article titles on some CMSes |
| P2 | Table cells lose links | Low | Low-Medium |
| P3 | No shadow DOM support | High | Low (requires browser, not HTML parsing) |
| P3 | No lazy image resolution | Medium | Low-Medium (requires render pass) |
| P3 | No content deduplication | Medium | Low |
