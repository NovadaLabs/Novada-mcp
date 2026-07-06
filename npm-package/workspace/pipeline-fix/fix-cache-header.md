# fix-cache-header — DONE

## Status: PASS

## Bug
`setCached` was called with `mdOutput` (no prefix) before `saveOutput` computed `savePrefix`.
Cache stored the version without `📁 <path>`. Cache hits returned output missing the file path header.

## Fix Applied
`/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` lines ~864-884:

Reordered:
1. Build `mdOutput` from lines
2. Call `saveOutput` → compute `savePrefix`
3. `finalOutput = savePrefix + mdOutput`
4. `setCached(url, renderMode, format, finalOutput, fields)` — stores WITH prefix
5. `return finalOutput`

## Verification
- `npx tsc --noEmit`: exit 0
- `npm run build`: exit 0
- Cache hit test:
  - First call starts with 📁: **true**
  - Cache hit starts with 📁: **true**
  - Both return `📁 /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_new...`
