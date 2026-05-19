# CODEX-01-IMPL — extract: add extraction diagnostics

## Role
Codex implementer. You have shell access and can read/write files. Work in the repo, build, verify.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## Problem
`novada_extract` returns null for fields silently. No reason code, no quality signal.
Agent callers can't diagnose why fields fail or know how to recover.

## Task
Implement two additions to the extract tool output:

### 1. extraction_quality line
Add to the output header (after `url:` / `mode:` lines):
```
extraction_quality: high | partial | low | none
```
- high = all fields matched
- partial = some matched
- low = 1 matched
- none = 0 matched
- n/a = no fields param given

### 2. ## Extraction Diagnostics section
Insert before ## Agent Hints. Only when ≥ 1 field is null.
```
## Extraction Diagnostics
- <field>: matched ✓ (via heading-match)
- <field>: null — reason: no_heading_match (no "## <field>" heading in page)
- <field>: null — reason: section_empty (heading found, content was empty/fenced)
- <field>: null — reason: no_pattern_match (fallback regex found no match)
```

### Files to modify
- src/tools/extract.ts — output assembly
- src/utils/fields.ts — make matchHeadingSection return reason alongside value

### Reason to export from fields.ts
`matchHeadingSection` currently returns `string | null`. You need it to return reason.
Options:
a) Return `{ value: string | null; reason: string }` — update all callers
b) Add a separate `matchHeadingSectionWithReason` function — zero impact on existing callers

Option (b) is safer. Add a new exported function that wraps (a).

## Build & verify
```bash
cd /Users/tongwu/Projects/novada-mcp
npm run build
```
Must exit 0. Report: build status + diff summary.

## Constraints
- TypeScript strict — no untyped `any`
- No new npm packages
- Only touch extract.ts and fields.ts
