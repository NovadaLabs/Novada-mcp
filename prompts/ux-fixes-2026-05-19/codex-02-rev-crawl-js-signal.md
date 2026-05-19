# CODEX-02-REV — review: crawl js_content_missing

## Role
Codex reviewer. Read + build. Do NOT modify files.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## Checks

### Build
```bash
npm run build
```
Must exit 0.

### Import check
```bash
grep -n "detectJsHeavyContent" src/tools/crawl.ts src/tools/extract.ts
```
- extract.ts must have `export` on the function
- crawl.ts must import from `"./extract.js"` (ESM extension)
- No import from `"./extract"` (missing .js would break at runtime in ESM)

### Logic check — read src/tools/crawl.ts
- Detection runs on fetched HTML string, not URL
- `js_content_missing: true` only appears in output when detection returns true AND page was not rendered
- Counter `js_pages_missing_render` in summary equals actual count of flagged pages

### Output format check
- Per-page flag appears inside the page block (not in summary area)
- Summary `js_pages_missing_render:` is near other summary stat lines
- Agent hint is only emitted when count > 0

### TypeScript
```bash
npx tsc --noEmit 2>&1 | head -20
```

## Output
PASS or FAIL with file:line specifics.
