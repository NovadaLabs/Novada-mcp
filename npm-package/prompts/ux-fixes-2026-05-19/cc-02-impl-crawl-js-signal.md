# CC-02-IMPL — crawl: js_content_missing signal

## Role
Claude Code implementer. TypeScript only. No new deps, no new tools.

## Repo
/Users/tongwu/Projects/novada-mcp

## Problem
`novada_crawl` fetches pages in static mode by default. When a page is JS-heavy (React SPA,
Next.js, etc.), the fetched HTML is a skeleton — no real content. The crawl output looks complete
(it found 8 URLs, returned 8 pages), but most pages have empty content bodies. The calling agent
has no signal that the data is unreliable. It confidently reports wrong data.

## Required Change — src/tools/crawl.ts

### Import detectJsHeavyContent
This function already exists in src/tools/extract.ts. Import it:
```typescript
import { detectJsHeavyContent } from "./extract.js";
```

### Per-page flag
For each crawled page result, after fetching the HTML, run `detectJsHeavyContent(html)`.
If true AND the page was NOT rendered (i.e., render mode was not used for this page), add to the
per-page output block:
```
js_rendered: false
js_content_missing: true
```
If false or if rendered, emit:
```
js_rendered: false
js_content_missing: false
```
(Or omit the line entirely when false — either is fine, but be consistent.)

### Summary-level count
In the crawl summary section (where `pages: N` is reported), add:
```
js_pages_missing_render: N
```
where N = count of pages where `js_content_missing: true`.

If N > 0, also add to `## Agent Hints`:
```
- {N} page(s) were detected as JS-heavy but crawled in static mode — content may be incomplete.
  Re-crawl with render="render" to get full content (slower, ~3–5s per page vs ~0.5s).
```

### Where detectJsHeavyContent is defined
src/tools/extract.ts — it is NOT currently exported. You will need to:
1. Add `export` keyword to the function declaration in extract.ts
2. Import it in crawl.ts

## Constraints
- Do NOT change crawl behavior (no automatic retry/render escalation)
- Do NOT add new fields to the Zod schema
- Build must pass: `npm run build`
- Only touch: src/tools/crawl.ts and src/tools/extract.ts (export only)

## Verify
`npm run build` — report result + which lines changed.
