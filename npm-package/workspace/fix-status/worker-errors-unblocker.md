# Fix Status: Error Codes + Web Unblocker Content-Type

**Status: DONE**
**tsc: clean (exit 0)**

## Fix 1 — Error codes 50001/50002/50003

### src/tools/scrape.ts
Added before the existing `body.code !== 0` check in the scrape submit function:
- `50001 | 50002 | 50003` → throws `makeNovadaError(INVALID_API_KEY, ...)`
- `500` → throws `makeNovadaError(API_DOWN, ...)`

### src/tools/search.ts
Same handling added in `submitSearchScrapeTask` after body is parsed.
Also fixed the `sanitizeServerMsg` bypass: `body.msg` on the generic error throw now passes through `sanitizeServerMsg`.
Import updated to include `sanitizeServerMsg`.

## Fix 2 — Web Unblocker Content-Type

### src/utils/http.ts — `fetchWithRender`
Changed request body from JSON object `{ target_url, response_format, js_render, country }` to `URLSearchParams.toString()` with `Content-Type: application/x-www-form-urlencoded`.
Response parsing logic is unchanged.
