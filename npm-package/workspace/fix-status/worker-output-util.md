# Worker: Output Pipeline Utility

## Status: DONE

## Files
- **Created:** `src/utils/output.ts`
- **Modified:** `src/utils/index.ts` (added export line)

## What was built
- `saveOutput(options)` -- saves data to `~/Downloads/novada-mcp/YYYY-MM-DD/{tool}_{hint}_{HHmmss}.{format}`
- `toCsv(records)` -- converts array of objects to CSV with proper escaping
- Supports json, csv, md formats
- Returns `OutputResult` with filePath, recordCount, cosUrl, summary

## Verification
- `npx tsc --noEmit` -- **0 errors**
