# Worker: User-Agent Rotation — DONE

## Status: COMPLETE

## Changes made to src/utils/http.ts

### Added at module level (after existing USER_AGENT constant)
- `BROWSER_USER_AGENTS` array with 3 Chrome 120 UAs (Windows/macOS/Linux)
- `getRandomUA()` helper that picks randomly from the array
- Kept `USER_AGENT` export for interface compatibility (marked @deprecated)

### Updated fetch sites (content-fetching only, not management API calls)

1. **fetchWithRetry** — main `axios.get` call: replaced static UA with `getRandomUA()` + added Accept/Accept-Language/Accept-Encoding/Connection headers
2. **fetchWithRetry** — SSL fallback `axios.get` in catch block: same UA rotation + browser headers
3. **fetchViaProxy** — known-good proxy path (`fetchWithRetry` with explicit headers): rotated UA
4. **fetchViaProxy** — probe path (`proxyProbeOptions`): rotated UA

### Left untouched (correct)
- `fetchWithRender` Web Unblocker `axios.post` to `WEB_UNBLOCKER_BASE/request` — management API call, not a target URL; has its own UA handling via the unblocker service

## TypeScript verification
- `npx tsc --noEmit` — zero errors in http.ts
- Pre-existing errors in 5 other files (sdk/index.ts, ai_monitor.ts, monitor.ts, research.ts, search.ts) are unrelated `clean` property type mismatches, not introduced by this change
