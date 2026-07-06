# CODEX-01-REV — review: extract diagnostics

## Role
Codex reviewer. Read the code, run the build, report findings. Do NOT modify files.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## What to check

### 1. Build
```bash
npm run build
```
Must exit 0. If it fails, report errors.

### 2. Code review — src/tools/extract.ts
- Does `extraction_quality` value match actual field results? (count nulls vs total)
- Is the Diagnostics section placed BEFORE ## Agent Hints?
- Does matched ✓ / null split correctly reflect actual results?

### 3. Code review — src/utils/fields.ts
- Is the new reason-returning function exported?
- Is the original `matchHeadingSection` signature unchanged?
- No callers of the old function broken?

### 4. TypeScript
```bash
npx tsc --noEmit 2>&1 | head -30
```
Report any type errors.

### 5. Spot test (read-only, no actual API call)
Find any existing test file or read the output format documentation to confirm the
new sections would appear in the right order.

## Output
PASS or FAIL. List specific file:line issues if FAIL.
