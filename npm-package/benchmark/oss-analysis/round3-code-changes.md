# Round 3 — Code Changes

**Date:** 2026-06-22
**Agent:** Code Implementation Worker
**Input:** round2-gap-analysis.md + src/ source files
**Status:** 6/6 gaps implemented

---

## QW-1 (P0): Wire `wait_for` into `novadaExtract`

**Files changed:**
- `src/tools/types.ts` — lines 94-100: Added `wait_for` and `wait_ms` fields to `ExtractParamsSchema`
- `src/tools/extract.ts` — 6 call sites updated

### types.ts change
Added after `max_chars`:
```ts
wait_for: z.string().optional()
  .describe("CSS selector to wait for before capturing content (browser mode only)..."),
wait_ms: z.number().int().min(0).max(30000).optional()
  .describe("Fixed milliseconds to wait after page load before capturing content..."),
```

### extract.ts changes
All `fetchViaBrowser(params.url)` calls updated to `fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms })` at:
- Line ~200: effectiveMode === "browser" branch
- Line ~289: render bot-challenge escalation to browser
- Line ~302: render JS-heavy escalation to browser
- Line ~315: render threw, escalation to browser
- Line ~233: QW-4 content-length floor browser fallback (new code)
- Line ~441: auto-escalation quality browser fallback

---

## QW-3 (P1): Fix `waitForSelector` 5s timeout in `fetchViaBrowser`

**File:** `src/utils/browser.ts`

**Lines changed:** 115, 155 (two `waitForSelector` call sites)

Changed `{ timeout: 5000 }` to `{ timeout: Math.min(options.timeout ?? 15000, 15000) }` at both occurrences:
- Line ~115: existing-session path (`existingPage.waitForSelector`)
- Line ~155: new-session path (`page.waitForSelector`)

Also added `wait_ms?: number` to the options type signature (line 98) and `page.waitForTimeout(options.wait_ms)` calls after each `waitForSelector` block (MT-2 co-implemented here).

---

## QW-2 (P1): Add Amazon/DataDome patterns to `detectBotChallenge`

**File:** `src/utils/http.ts` — `knownChallengeStrings` array (lines ~308-312)

Added 5 new strings after existing generic entries:
```ts
// DataDome challenge page markers (not just the cookie name)
"robot check",
"enter the characters you see below",
"sorry, we just need to make sure",
// Amazon WAF
"to discuss automated access to amazon data",
"apologies, but we're having trouble saving your cookie",
```

---

## QW-4 (P1): Content-length floor on render/browser result

**File:** `src/tools/extract.ts` — after the `effectiveMode === "render"` branch assigns `html`

Inserted after `html = response.data` and before `usedMode = "render"` (lines ~230-242):
```ts
// QW-4: If rendered content is suspiciously short, it may be a bot-challenge page
if (typeof html === "string" && html.length < 2000 && isBrowserConfigured()) {
  const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for, wait_ms: params.wait_ms }).catch(() => null);
  if (browserHtml && browserHtml.length > html.length) {
    html = browserHtml;
    usedMode = "browser";
  } else {
    usedMode = "render";
  }
} else {
  usedMode = "render";
}
```

Note: The original `usedMode = "render"` was a single line; this replaces it with the conditional block. The `else { usedMode = "render"; }` path covers normal render results.

---

## MT-1 (P1): Domain-aware residential proxy tier

**Files changed:**

### `src/utils/domains.ts`
- Added `proxyTier?: "residential" | "datacenter"` field to `DomainEntry` interface (line ~13)
- Set `proxyTier: "residential"` on all entries with provider `"datadome"`, `"perimeterx"`, `"akamai"`, `"kasada"`:
  - All 8 amazon.* entries (datadome)
  - steampowered.com, store.steampowered.com (akamai)
  - walmart.com (perimeterx)
  - target.com, bestbuy.com, homedepot.com, lowes.com, nike.com (akamai)
  - airbnb.com, tripadvisor.com, wayfair.com (perimeterx)
  - shein.com (datadome)
  - booking.com (perimeterx)
  - g2.com (kasada)
  - ticketmaster.com, stubhub.com (datadome)

### `src/utils/credentials.ts`
Added `getResidentialProxyCredentials()` function (after `getProxyCredentials`):
```ts
export function getResidentialProxyCredentials(): { user: string; pass: string; endpoint: string } | null {
  const user = process.env.NOVADA_RESIDENTIAL_PROXY_USER;
  const pass = process.env.NOVADA_RESIDENTIAL_PROXY_PASS;
  const endpoint = process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
  if (user && pass && endpoint) return { user, pass, endpoint };
  return getProxyCredentials(); // fallback
}
```

### `src/utils/http.ts`
- Import: added `getResidentialProxyCredentials` to import line
- `fetchViaProxy` signature: added `proxyTier?: "residential" | "datacenter"` to options type
- Destructured `proxyTier` from options, renamed remaining spread to `axiosOptions`
- Credential selection: `proxyTier === "residential" ? getResidentialProxyCredentials() : getProxyCredentials()`
- All internal `options` references replaced with `axiosOptions`

### `src/tools/extract.ts`
- Derived `domainProxyTier` from `domainHint?.proxyTier` before the static/auto fetch branch
- Passed `{ proxyTier: domainProxyTier }` to both `fetchViaProxy` calls in the static/auto branch when `domainProxyTier` is set

---

## MT-2 (P1): Implement `wait_ms` fixed timeout

**Files changed:**

### `src/tools/types.ts`
Added `wait_ms` to `ExtractParamsSchema` (co-implemented with QW-1 above).

### `src/utils/browser.ts`
- Added `wait_ms?: number` to `fetchViaBrowser` options type
- Added `page.waitForTimeout(options.wait_ms)` after each `waitForSelector` block (both session-reuse and new-session paths)

### `src/utils/router.ts`
- Added `wait_ms?: number` to `routeFetch` options type
- Passed `wait_ms: options.wait_ms` through to all `fetchViaBrowser` calls (3 call sites in auto-mode escalation chain)

### `src/tools/unblock.ts`
- Removed `void wait_ms` no-op from line 15
- Added `wait_ms: wait_ms` to `routeFetch` options object

---

## Issues Encountered

1. **`router.ts` not at `src/utils/router.ts` initially** — Glob returned no results; confirmed file exists via `ls`. Not a blocking issue; file was found and edited correctly.

2. **`fetchViaProxy` options type conflict** — The original `options: Partial<AxiosRequestConfig>` had to be extended with the custom `proxyTier` field. Resolved by adding `& { proxyTier?: ... }` to the type and destructuring `proxyTier` out before spreading the rest as `axiosOptions`. This prevents passing the non-Axios `proxyTier` field to `fetchWithRetry`.

3. **QW-4 `usedMode` assignment** — The original code had `usedMode = "render"` as a single line after the render html assignment. The QW-4 content-length check replaces this with a conditional block that sets `usedMode` in both branches. The PDF and JSON early-return paths above it are unaffected (they return before reaching this point).

4. **`wait_ms` range mismatch** — `UnblockParamsSchema` had `wait_ms` max at 100000ms while the new `ExtractParamsSchema` entry caps at 30000ms per spec. This is intentional: extract's `wait_ms` is tighter (30s max) to prevent runaway browser holds during batch extraction.

---

## Summary

| Gap | Priority | Status | Files Modified |
|-----|----------|--------|----------------|
| QW-1: Wire `wait_for` into `novadaExtract` | P0 | Done | types.ts, extract.ts |
| QW-3: Fix `waitForSelector` 5s timeout | P1 | Done | browser.ts |
| QW-2: Add Amazon/DataDome patterns to `detectBotChallenge` | P1 | Done | http.ts |
| QW-4: Content-length floor on render result | P1 | Done | extract.ts |
| MT-1: Domain-aware residential proxy tier | P1 | Done | domains.ts, credentials.ts, http.ts, extract.ts |
| MT-2: Implement `wait_ms` fixed timeout | P1 | Done | types.ts, browser.ts, router.ts, unblock.ts |

**Total: 6/6 gaps implemented.**
