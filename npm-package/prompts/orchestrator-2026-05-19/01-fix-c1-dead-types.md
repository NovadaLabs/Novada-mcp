# Fix C1: Remove Duplicate Error Types from types.ts

## Problem
`/Users/tongwu/Projects/novada-mcp/src/tools/types.ts` lines 204-218 contain a DEAD duplicate of `NovadaErrorCode` enum and `NovadaError` interface. The REAL versions live in `src/_core/errors.ts`.

The `types.ts` also has a duplicate `classifyError` function (lines 417-464) that is LESS complete than the one in `_core/errors.ts`.

If anyone imports from `./tools/types.js` instead of `./_core/errors.js`, they get different behavior silently.

## Fix
1. Read `src/tools/types.ts` — find and DELETE the duplicate `NovadaErrorCode`, `NovadaError`, and `classifyError` 
2. Read `src/_core/errors.ts` to confirm it has the canonical versions
3. Grep the entire `src/` directory for any imports of `NovadaErrorCode` or `classifyError` from `types` — redirect them to `_core/errors`
4. Run `npm run build` to confirm no broken imports

## Verification
- `grep -rn "NovadaErrorCode\|classifyError" src/` should show ONLY `_core/errors.ts` as the definition source
- Build must pass
