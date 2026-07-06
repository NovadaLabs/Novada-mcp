# INC-173 Fix Status — browser.ts

**Worker:** worker-browser
**File:** src/utils/browser.ts
**Date:** 2026-06-23
**Status:** DONE

## Fix 1 — navigator.webdriver override
Inserted `context.addInitScript(...)` immediately after `browser.newContext(...)` (line ~138).
Overrides: `navigator.webdriver`, `window.chrome`, `navigator.plugins`.

## Fix 2 — waitUntil fix for Cloudflare challenge
After the `page.goto(url, { waitUntil: "domcontentloaded" })` call, added:
- networkidle wait with 12s timeout, falling back to domcontentloaded
- CF challenge detection (cf-challenge, cf-turnstile, Just a moment, cf_chl_opt)
- 6s wait + domcontentloaded re-wait when challenge detected

## Verify
`npx tsc --noEmit` — exit 0, no type errors.
