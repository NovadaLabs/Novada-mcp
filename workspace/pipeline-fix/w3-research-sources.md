# W3 Status: research sources table

**Status**: DONE
**File**: src/tools/research.ts

## Changes Made

### 1. Sources: bullet list → indexed markdown table
- Replaced `sourceLines: string[]` with `sourceRows: { label: string; url: string; note: string }[]`
- Table format:
  ```
  | # | Title | URL | Notes |
  |---|-------|-----|-------|
  | 1 | [Title](url) | url | full content extracted |
  | 2 | [Title2](url2) | url2 | snippet only |
  ```
- Agents can now cite by index: Source[1], Source[3]
- Pipe chars in titles/notes are escaped to prevent table breakage

### 2. Header now includes source count
```
**Query**: novada mcp benefits | **sources**: 5 | **depth**: quick
```

## Verification
- `npx tsc --noEmit`: clean (no output)
- `npm run build`: clean
- Live run confirmed table output with 5 sources and correct header format
