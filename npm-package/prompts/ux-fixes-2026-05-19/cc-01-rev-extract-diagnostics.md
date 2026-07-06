# CC-01-REV — review: extract diagnostics

## Role
Claude Code reviewer. You read code, you do NOT write it. Fresh eyes — no prior context.

## Repo
/Users/tongwu/Projects/novada-mcp

## What to review
Read src/tools/extract.ts and src/utils/fields.ts after the implementer (cc-01-impl) has made changes.

## Review checklist

### Correctness
- [ ] `extraction_quality` value is computed correctly (high/partial/low/none)
- [ ] Diagnostics section only emits when at least one field is null
- [ ] `matched ✓` line only appears for fields that actually have non-null values
- [ ] Reason codes are accurate — `no_heading_match` vs `section_empty` are distinct cases

### TypeScript safety
- [ ] No `any` casts introduced without comment explaining why
- [ ] `matchHeadingSection` return type change (if any) doesn't break other callers
- [ ] No TypeScript errors (`npm run build` clean)

### Agent UX
- [ ] The new section comes BEFORE `## Agent Hints` (so agent reads diagnostic before action hints)
- [ ] Human explanation in parentheses is actionable ("no ## License heading found" > "no match")
- [ ] `extraction_quality: n/a` when no fields param (free extraction mode)

### No regressions
- [ ] Existing output sections still present: `## Content`, `## Agent Hints`, `## Agent Notice`
- [ ] Schema / Zod types unchanged
- [ ] No new npm packages in package.json

## Output format
Report: PASS or FAIL. If FAIL, list specific line numbers and what's wrong.
