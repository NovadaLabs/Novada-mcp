# CODEX-04-REV — review: research structured output

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

### Section order — read src/tools/research.ts
Find the return statement that assembles the output string. Verify:
- [ ] Starts with `## Research: {topic}`
- [ ] Header block (Query/depth/sources_searched/timestamp) present before `---`
- [ ] `---` divider separates metadata from content
- [ ] `## Summary` always populated (never empty, has fallback)
- [ ] `## Key Findings` always present with ≥ 1 bullet
- [ ] `## Sources` always present with ≥ 1 entry or explicit fallback
- [ ] `## Agent Hints` always present with ≥ 1 hint
- [ ] `## Agent Notice — Coverage` at end

### Edge cases — look for these branches in the code
- [ ] Empty result path: what happens if research finds nothing? Sections still present?
- [ ] Synthesis failure path: fallback text used?
- [ ] Very long topic string: no truncation that breaks header line?

### TypeScript
```bash
npx tsc --noEmit 2>&1 | head -20
```

## Output
PASS or FAIL.
