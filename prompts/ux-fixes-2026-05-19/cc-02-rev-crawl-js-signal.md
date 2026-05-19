# CC-02-REV — review: crawl js_content_missing signal

## Role
Claude Code reviewer. Read only. Fresh eyes.

## Repo
/Users/tongwu/Projects/novada-mcp

## What to review
Read src/tools/crawl.ts and src/tools/extract.ts after cc-02-impl has run.

## Review checklist

### Import correctness
- [ ] `detectJsHeavyContent` is exported from extract.ts (has `export` keyword)
- [ ] Import in crawl.ts uses `.js` extension (ESM): `from "./extract.js"`
- [ ] No circular import created (crawl → extract is fine, but check extract doesn't import crawl)

### Logic correctness
- [ ] Detection runs on the actual fetched HTML, not on the URL or metadata
- [ ] Flag is only `true` when JS-heavy AND NOT rendered — not triggered when render was used
- [ ] `js_pages_missing_render` count matches actual count of flagged pages

### Output format
- [ ] Per-page flags appear within the page content block (not floating outside)
- [ ] Summary line `js_pages_missing_render:` is near other summary stats (`pages:`, `urls_found:`)
- [ ] Agent Hints section includes the re-crawl suggestion when count > 0

### No regressions
- [ ] Non-JS pages still work without any new fields in output
- [ ] `detectJsHeavyContent` export in extract.ts doesn't change the function signature or behavior
- [ ] `npm run build` passes

## Output
PASS or FAIL with specific issues.
