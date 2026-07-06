# worker-html.md — INC-172 Fix Status

**File:** src/utils/html.ts
**tsc result:** PASS (0 errors)
**Date:** 2026-06-23

## Fixes Applied

### Fix 1 — BOILERPLATE_SELECTORS inside semantic selectors (DONE)
Added nav/sidebar removal inside `$content` immediately after each semantic selector match.
Uses `$el.find('nav, [class*="sidebar"], [class*="nav"], [role="navigation"], [class*="menu"]').remove()`
plus conditional header removal for headers containing nav/logo.

### Fix 2 — Conditional form removal (DONE)
Removed `"form"` from `REMOVE_TAGS`. Added loop after REMOVE_TAGS block:
only removes forms where link density > 0.3 or text length < 50.

### Fix 3 — Ordered list numbering (DONE)
`li` branch now checks `$el.parent().is('ol')`. If ordered, prefix is `${index}. ` (1-based); otherwise `- `.

### Fix 4 — Code block language hints (DONE)
`pre` branch now finds the first `<code>` child, extracts language from `class` via
`/(?:language|lang)-(\w+)/` regex. Falls back to empty string if no match.

### Fix 5 — Conditional header removal (DONE)
Removed `"header"` from `REMOVE_TAGS`. Added loop that only removes `<header>` elements
containing `<nav>` or `[class*="logo"]` / `[class*="brand"]` children.

### Fix 6 — img → markdown (DONE)
Added `img` tag handling in `inlineMarkdown()`. Renders `![alt](src)` for non-data-URI images.
Base64 `data:` images are silently skipped.

### Fix 7 — Markdown escaping for text nodes (DONE)
Added `escapeMarkdown()` helper (escapes `\`, `*`, `_`). Applied to plain text nodes in
`inlineMarkdown()`. Not applied to code blocks, URLs, or existing markdown syntax.

## Verify
```
npx tsc --noEmit  → no output (0 errors)
```
