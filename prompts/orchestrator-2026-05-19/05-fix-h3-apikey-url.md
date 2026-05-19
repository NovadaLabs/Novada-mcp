# Fix H3: Remove API Key from Polling URL

## Problem
In `/Users/tongwu/Projects/novada-mcp/src/tools/scrape.ts` line 104:
```typescript
const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${taskId}&file_type=json&apikey=${apiKey}`;
```
The API key is in the URL query string. If this URL appears in any error message or stack trace, the key is exposed. The `sanitizeMessage` in `_core/errors.ts` tries to strip it but only at the final output layer.

## Fix
1. Read `src/tools/scrape.ts` — find the `pollForResult` function
2. Move `apikey` from URL to a custom header, or strip the URL from all error messages in this function
3. The download endpoint at `api.novada.com/g/api/proxy/scraper_download` accepts `apikey` as query param — check if it also accepts it as a header (`Authorization: Bearer ...` or `X-Api-Key: ...`)
4. If the endpoint ONLY accepts query param: keep it in URL but ensure ALL error messages in `pollForResult` strip the URL before throwing. Use a helper: `const safeUrl = url.replace(/apikey=[^&]+/, 'apikey=***');`
5. Run `npm run build`

## Verification
- `grep -n "apikey=\${" src/tools/scrape.ts` should be 0 OR the URL is never included in error messages
- Build passes
