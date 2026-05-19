# Fix H1: Align ScrapeParams Type with Zod Schema

## Problem
In `/Users/tongwu/Projects/novada-mcp/src/tools/types.ts`:
- `ScrapeParams` type is inferred from `ScrapeParamsFullSchema` (allows csv/html/xlsx)
- But `validateScrapeParams()` uses `ScrapeParamsSchema` (only allows markdown/json/toon)
- This means TypeScript says csv/html/xlsx are valid but Zod rejects them at runtime
- The `case "csv":` and `case "html":` branches in scrape.ts are unreachable via MCP

## Fix
1. Read `src/tools/types.ts` — find both schemas and the type definition
2. Change `ScrapeParams` to: `export type ScrapeParams = z.infer<typeof ScrapeParamsSchema>;` (the MCP-restricted one)
3. If there's a CLI or SDK path that needs the full schema, create a separate `ScrapeParamsFullType` for that
4. In `src/tools/scrape.ts`, remove or gate the unreachable `case "csv":` and `case "html":` and `case "xlsx":` branches behind a check
5. Run `npm run build`

## Verification
- Build passes with no type errors
- No unreachable code warnings
