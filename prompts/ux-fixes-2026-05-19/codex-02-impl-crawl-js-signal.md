# CODEX-02-IMPL — crawl: js_content_missing signal

## Role
Codex implementer. Shell + file access. Work in the repo.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## Problem
`novada_crawl` fetches pages statically. JS-heavy pages return skeleton HTML.
Agent gets confident-looking but empty crawl results. No signal that content is missing.

## Task

### Step 1 — Export detectJsHeavyContent from src/tools/extract.ts
Find the `detectJsHeavyContent` function. Add `export` keyword if not already exported.

### Step 2 — Import in src/tools/crawl.ts
```typescript
import { detectJsHeavyContent } from "./extract.js";
```

### Step 3 — Per-page JS detection
After fetching each page's HTML (wherever `html` variable is set for a crawled page):
```typescript
const jsHeavy = detectJsHeavyContent(html);
const jsRendered = /* true if this page was rendered, false if static */;
const jsMissing = jsHeavy && !jsRendered;
```
Add to per-page output block:
```
js_content_missing: true   // only when jsMissing
```
Omit the line entirely when false (keep output clean).

### Step 4 — Summary counter
Count pages where `jsMissing === true`. Add to crawl summary:
```
js_pages_missing_render: N
```

### Step 5 — Agent Hint (conditional)
If `js_pages_missing_render > 0`, append to ## Agent Hints:
```
- {N} page(s) are JS-heavy but were crawled in static mode — content may be incomplete.
  Re-crawl with render="render" for full content (3–5s/page vs 0.5s/page).
```

## Build & verify
```bash
cd /Users/tongwu/Projects/novada-mcp
npm run build
```
Must exit 0.

## Constraints
- Do NOT trigger automatic render escalation — detection only, no behavior change
- Only touch: src/tools/crawl.ts and src/tools/extract.ts (export only)
- No new npm packages
