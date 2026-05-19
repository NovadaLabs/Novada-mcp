# CC-04-REV — review: research structured output

## Role
Claude Code reviewer. Read only.

## Repo
/Users/tongwu/Projects/novada-mcp

## What to review
Read src/tools/research.ts after cc-04-impl has run.

## Review checklist

### Section order and completeness
- [ ] Output always starts with `## Research: <topic>`
- [ ] Header block has: Query, depth, sources_searched, timestamp
- [ ] `---` divider after header block
- [ ] `## Summary` always present (never empty or missing)
- [ ] `## Key Findings` always present with at least 1 bullet
- [ ] `## Sources` always present with at least 1 entry or explicit "none" message
- [ ] `## Agent Hints` always present with at least 1 hint
- [ ] `## Agent Notice — Coverage` at end

### Edge cases
- [ ] What happens if research returns empty results? Sections still present with fallback text
- [ ] What if topic is a very long string? Header line doesn't wrap or break output parser
- [ ] Synthesis failure case handled — "Synthesis unavailable" text

### No regressions
- [ ] Research logic (API calls, depth) unchanged — only output assembly changed
- [ ] `npm run build` passes

## Output
PASS or FAIL with specific issues.
