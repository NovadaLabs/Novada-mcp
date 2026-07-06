# Anti-Bot Analysis: Why We Succeed Only 80% vs Firecrawl's 100%

**Date:** 2026-06-24
**Scope:** `novada-mcp` anti-bot detection, escalation logic, and gap analysis vs Firecrawl
**Files analyzed:**
- `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts` — `detectBotChallenge`, `detectJsHeavyContent`, `fetchWithRender`
- `/Users/tongwu/Projects/novada-mcp/src/utils/router.ts` — escalation chain
- `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` — full extraction pipeline
- `/Users/tongwu/Projects/novada-mcp/src/utils/browser.ts` — CDP browser integration
- `/Users/tongwu/Projects/novada-mcp/src/utils/domains.ts` — domain registry
- `/Users/tongwu/Projects/novada-mcp/src/config.ts` — thresholds and timeouts

---

## 1. How `detectBotChallenge` Works (and Where It Fails)

**Location:** `src/utils/http.ts:313-393`

The function uses two tiers:

### Tier 1 — Definitive strings (any single match = bot challenge):
```
"just a moment", "cf-browser-verification", "__cf_chl_opt", "cf_chl_",
"__cf_bm", "ray id", "checking your browser",
"_abck", "bm_sz", "ak_bmsc",          // Akamai
"incap_ses_", "visid_incap_", "_incap_",  // Imperva
"datadome",                            // DataDome
"please wait while we verify", "human verification", "human-challenge",
"robot check", "enter the characters you see below",
"to discuss automated access to amazon data",
```

### Tier 2 — Heuristic signals (need 2+ to trigger):
- Kasada scripts (`ips.js`, `cd.js` by regex at line 366)
- PerimeterX (`_px2`–`_px9` at line 367)
- "press & hold" text (line 369)
- akamaized script src context (line 372)
- Stripped body text < 1500 chars (line 381)
- Blank or missing `<title>` (line 386)
- `<div>` count < 3 AND zero `<p>` tags (line 391)

### Critical Gap 1: Kasada bare-429 is invisible

Kasada returns a minimal HTTP 429 with **no body** — there is no HTML to pattern-match. The current logic never sees text like `ips.js` or `_px`. The response is a near-empty string, so `detectBotChallenge("")` returns `false` at line 314. The caller in `router.ts:146` then concludes "no bot challenge" and returns static mode with empty content.

Scrapfly confirms: *"A bare 429 with no copy, no logo, and no interstitial"* is Kasada's signature. Our detection is HTML-content-based, not HTTP-status-based.

### Critical Gap 2: Cloudflare Turnstile / Interactive Challenge

Cloudflare's modern bot protection operates in two modes:
- **5-second JS challenge** (rendered in-page, solves itself in a headless browser)
- **Turnstile** (interactive CAPTCHA requiring mouse movement / click)

For the JS challenge, `detectBotChallenge` correctly catches it via `"just a moment"` or `"__cf_chl_opt"` in tier 1. But for Turnstile, the challenge page may contain minimal markers. More importantly, even after render-mode escalation, the Web Unblocker may pass the JS challenge but still get served Turnstile. At that point, `detectBotChallenge(renderHtml)` may return `false` (no tier-1 strings, heuristics insufficient) → the escalation chain stops at render, thinking it succeeded.

**File:line:** `src/utils/router.ts:155` — if `detectBotChallenge(renderHtml)` is false but content is Turnstile HTML, we return it as good content.

### Critical Gap 3: DataDome ML Scoring — No Content Signal

DataDome uses **real-time ML scoring per request** (source: Scrapfly guide). When it blocks a request it does not always return a `datadome` cookie or `tags.js` in the response — sometimes it returns a clean 200 with a bot-detection interstitial that uses none of the known cookie names in the HTML. The `datadome` string check (tier 1, line 342) only works when DataDome's challenge page directly contains the word "datadome" in the markup. A styled challenge page served via their CDN may not.

### Critical Gap 4: PerimeterX `px.js`/`d.js` Naming Collision

`src/utils/http.ts:367`: the heuristic checks for `/_px[2-9]\b/` which correctly avoids bare `_px`. But PerimeterX also serves `px.js` and `d.js` (documented in Scrapfly's identification table). The current Kasada regex at line 366 checks for `ips.js` and `cd.js` but not `px.js`. So a PerimeterX-protected site that loads `px.js` only (no `_px2`/`_px3` cookies in HTML) will not be detected by either tier.

### Critical Gap 5: AWS WAF and F5/Shape Completely Missing

`detectBotChallenge` has zero patterns for:
- **AWS WAF**: `aws-waf-token` cookie, `/challenge.js` telemetry endpoint
- **F5/Shape**: `TS*`-prefixed cookies (`TS01a2b3c4`), bare 403 with no vendor signature

These two vendors have no representation in either `detectBotChallenge` or `DOMAIN_REGISTRY`.

### Critical Gap 6: Missing `Kasada` cookie pattern

Kasada sets `KP_UIDz` cookie and uses headers `x-kpsdk-ct` / `x-kpsdk-cd`. Neither appears anywhere in `http.ts`. These are present in HTML source of Kasada-protected pages but are entirely absent from detection logic.

---

## 2. Router Escalation Logic — When Does Browser CDP Fire?

**Location:** `src/utils/router.ts:129-195`

### Auto-mode chain (lines 129–195):
```
static fetch
  → if detectJsHeavyContent OR detectBotChallenge → fetchWithRender
    → if detectBotChallenge(renderHtml) AND isBrowserConfigured → fetchViaBrowser  ✓
    → if detectBotChallenge(renderHtml) AND !isBrowserConfigured → return render-failed  ✗
    → if !detectJsHeavyContent(renderHtml) → return render (success)
    → if detectJsHeavyContent(renderHtml) AND isBrowserConfigured → fetchViaBrowser  ✓
```

### Problem: The Kasada/bare-403 short-circuit

When a protected site returns a clean 403 (no HTML body, or tiny HTML that does not match any tier-1/tier-2 patterns):
1. `detectBotChallenge(html)` → `false`
2. `detectJsHeavyContent(html)` → `html.length < 200` (threshold from `config.ts:38`) → `true`
3. Router escalates to render
4. Render also gets 403 or tiny empty response
5. `detectBotChallenge(renderHtml)` → `false` again (no patterns)
6. `detectJsHeavyContent(renderHtml)` — if renderHtml is tiny, yes, but the logic at line 166 is `if (!detectJsHeavyContent(renderHtml)) return render` — so JS-heavy render falls through to check isBrowserConfigured
7. If browser configured → CDP attempt

This means in the best case we *do* reach browser CDP via the JS-heavy path. The problem is step 6: the condition at `router.ts:166` is "not JS-heavy → return render as success." If the render response is 200 chars of a block page, `detectJsHeavyContent` says true (< 200 threshold), so we proceed to browser. This is coincidentally correct but relies on the wrong signal (page-too-small rather than "this is a block page").

### Problem: render-failed silently returned when browser not configured

`router.ts:164`: when render returns a bot challenge AND browser is not configured, we return `html` (the original *static* HTML) with `mode: render-failed`. This returns a bot challenge page as the extraction result with no error surfaced to the caller. The caller in extract.ts at line 293 will then try the escalation again, but since `render-failed` mode came from router.ts (not extract.ts's own escalation), there is no double-escalation protection — extract.ts's `if (renderMode === "auto" && ...)` path at line 293 fired the render call directly via `fetchWithRender`, not via `routeFetch`. So render-failed from `routeFetch` is only hit when `novadaUnblock` (the MCP tool) uses the router directly.

### Extract.ts has its own parallel escalation (lines 293–338)

Extract.ts does NOT use `routeFetch` for auto-mode. It has its own inline escalation chain at lines 293–338. This chain has an important additional check at lines 318–320: if render returns JS-heavy content AND browser is configured, it tries browser. But it has the same Kasada gap: a Kasada bare-429 produces `html = ""`, `detectBotChallenge("") = false`, `detectJsHeavyContent("") = true` (length < 200). So escalation fires because the page is "empty/JS-heavy", not because it's identified as a bot challenge. This is accidentally correct but not robust.

---

## 3. The Web Unblocker — What It Does vs What Firecrawl Does

**Our render layer:** `src/utils/http.ts:204-276`

The Web Unblocker is a POST to `webunlocker.novada.com/request` with `js_render: true`. It handles JS execution and some anti-bot bypass, but critically:

1. **It uses Node's `axios` under the hood** — which means the initial TLS ClientHello comes from Node's `tls` module, NOT from a real Chrome browser. The JA3 fingerprint is that of Node.js, which every major WAF has in its bot database.

2. **No TLS fingerprint impersonation** — unlike `tls-client` (Go library with Chrome JA3 profiles), our unblocker sends a Node-native TLS handshake. For DataDome, Akamai, and Cloudflare this is a first-layer block signal.

3. **Retry logic is 2 retries with 1s/2s backoff** (`http.ts:215, 244`) — when the unblocker itself fails with 403/502, we retry but there is no IP rotation or session cycling between retries. We hit the same blocked IP or session context.

### What Firecrawl's `fire-engine` Likely Does (closed-source inference)

Based on the GitHub issue #2257 and industry analysis:

- **Browser fingerprint impersonation** via `puppeteer-extra-stealth` or equivalent: patches `navigator.webdriver`, hides automation flags, spoofs WebGL, canvas, audio fingerprint.
- **TLS fingerprint impersonation** (JA3/JA4): uses a Go-based `tls-client` or Chrome's BoringSSL directly. Our Web Unblocker does not do this.
- **Cloudflare-aware session management**: waits for `cf_clearance` cookie to be set before returning HTML.
- **Multiple engine fallback**: Firecrawl has `playwright`, `fetch`, and proprietary engines — its error `SCRAPE_ALL_ENGINES_FAILED` shows it tries several before giving up.

The Firecrawl self-host issue #2257 confirms: even with Playwright, Firecrawl's self-hosted version fails on fingerprint-checked sites. The managed Firecrawl cloud succeeds because fire-engine runs additional stealth layers not available in self-hosted. This means the gap is in our **render tier** — specifically TLS fingerprint impersonation and browser anti-detection — not in the detection logic per se.

---

## 4. `detectBotChallenge` — Missing Patterns

Consolidating gaps as specific additions needed:

### Missing tier-1 patterns:

```typescript
// Kasada
"kp_uidz",        // Kasada session cookie
"x-kpsdk-ct",     // Kasada challenge token header
// AWS WAF
"aws-waf-token",
// F5 / Shape Security
// (no HTML strings — must rely on HTTP status + empty body heuristic)
// PerimeterX variant
"pxchk",          // PerimeterX challenge page marker
// Cloudflare Turnstile
"cf-turnstile",   // Turnstile widget class name
// Akamai Bot Manager (modern)
"akamai-bm-telemetry",
```

### Missing tier-2 heuristics:

```typescript
// PerimeterX px.js (not just _px2 cookies)
if (/["'/]px\.js(\?|"|'|$)/i.test(html) || /["'/]d\.js(\?|"|'|$)/i.test(html)) signals++;
// AWS WAF challenge endpoint in script src
if (/\/challenge\.js/i.test(html)) signals++;
// HTTP 429 with tiny body (Kasada signature) — must be checked at HTTP layer, not HTML layer
```

### HTTP-layer check missing entirely:

`detectBotChallenge` is an HTML-content function. It cannot see HTTP status codes. The circuit breaker in `fetchViaProxy` at `http.ts:156-171` catches 407 and 401/403 specifically, but does NOT identify these as anti-bot responses — it throws or falls back to direct fetch, losing the bot-challenge signal entirely.

**Recommended:** Pass the HTTP status code into `detectBotChallenge` or add a separate `detectBotByStatus(status, html)` function that catches:
- Status 429 with body < 500 chars → Kasada
- Status 403 with `CF-RAY` header → Cloudflare
- Status 403 with `X-DataDome-*` headers → DataDome

---

## 5. Domain Registry — Missing Anti-Bot Entries

**Location:** `src/utils/domains.ts:21-144`

### Missing critical domains (should be `method: "browser"` or `method: "render"` with `proxyTier: "residential"`):

| Domain | Anti-bot Provider | Current Registry Status |
|---|---|---|
| `sneakers.com` | Kasada | Not listed |
| `supreme.com` | Kasada | Not listed |
| `footlocker.com` | DataDome | Not listed |
| `fandango.com` | DataDome | Not listed |
| `united.com` | Akamai | Not listed |
| `aa.com` | Akamai | Not listed |
| `shopify.com` | Cloudflare | Not listed |
| `hotels.com` | PerimeterX | Not listed |
| `expedia.com` | PerimeterX | Not listed |
| `priceline.com` | PerimeterX | Not listed |

The registry only covers 50–60 well-known domains. Any unknown domain goes through auto-detection which, as described above, has the Kasada/AWS WAF blind spots.

### Misclassified entries:

- `amazon.com` at line 60 is labeled `provider: "datadome"` — Amazon actually uses its own WAF, not DataDome. The `identifyAntiBot` function in `http.ts:402` would return `"datadome"` for Amazon pages that contain "datadome" text, but the underlying provider is Amazon's own system.

- `glassdoor.com` at line 137: `method: "browser"` is correct but `proxyTier` is absent. Glassdoor's Cloudflare protection is aggressive enough that even browser CDP without residential proxies fails.

---

## 6. Browser CDP (`browser.ts`) — Anti-Detection Gaps

**Location:** `src/utils/browser.ts:96-177`

### Gap: No stealth patching

`browser.ts:138-141` creates a new browser context with only a User-Agent header:
```typescript
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...",
});
```

There is no:
- `navigator.webdriver = false` override
- Canvas fingerprint noise injection
- WebGL vendor/renderer spoofing
- Plugin/MIME type spoofing
- `chrome.runtime` stub (removed in headless)
- `window.Notification.permission` spoofing

Standard Playwright headless is detectable by Cloudflare, Kasada, DataDome, and PerimeterX via `navigator.webdriver === true` alone. The Firecrawl issue #2257 confirms: Browserless (which applies stealth patches) succeeds; stock Playwright (which doesn't) fails — **on the same IP**.

### Gap: `waitUntil: "domcontentloaded"` — too early for challenge resolution

`browser.ts:149-152`:
```typescript
await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout,
});
```

Cloudflare's 5-second JS challenge fires on `domcontentloaded` and requires waiting for `networkidle` or for `cf_clearance` cookie to appear. We return HTML immediately after DOM loads, which is during the challenge — not after it resolves.

**Fix needed:** Wait for either `networkidle` OR wait until `detectBotChallenge(html) === false` with a retry loop, up to 10s.

### Gap: No cookie persistence between requests

Each `fetchViaBrowser` call at line 96 creates a fresh context (`browser.newContext`). For sites that require warm session state (DataDome, PerimeterX — which score sessions over time), starting fresh every time signals bot behavior. Firecrawl's managed engine maintains session pools.

---

## 7. `fetchWithRender` — Web Unblocker Retry Logic Gap

**Location:** `src/utils/http.ts:212-271`

The retry loop retries on 403, 429, 500, 502, 503 with 1s/2s delays. Two problems:

1. **No country rotation between retries** (line 220): the same `country` parameter is sent on each retry. If the unblocker's IP is blocked, rotating country would switch IP pools.

2. **30% internal failure rate acknowledged in code comment** (`http.ts:213`): *"Web Unblocker API is intermittently flaky — inner data.code returns 403/502 on ~30% of requests."* This alone accounts for a significant fraction of the 20% failure gap. We retry 2× but the 30% failure rate means P(all 3 fail) = 0.027 = 2.7% background noise from the unblocker itself.

---

## 8. Root Causes of the 20% Failure Gap

Ranked by estimated impact:

| # | Root Cause | Mechanism | Estimated Impact |
|---|---|---|---|
| 1 | TLS fingerprint not impersonated | Node.js TLS JA3 != Chrome JA3; WAFs block at handshake layer | ~8% |
| 2 | Browser CDP has no stealth patching (`navigator.webdriver`) | Headless Chromium detected by CF/Kasada/DataDome/PerimeterX | ~5% |
| 3 | `waitUntil: "domcontentloaded"` exits during CF challenge | Returns challenge HTML not final content | ~3% |
| 4 | Kasada bare-429 and AWS WAF not detected | detectBotChallenge sees empty HTML as JS-heavy not bot-blocked | ~2% |
| 5 | Web Unblocker 30% internal flakiness (no country rotation on retry) | Retries hit same blocked IP/session | ~2% (base noise) |

---

## 9. Actionable Improvements

### P0 — Browser CDP stealth patching (`browser.ts:138`)

Add Playwright stealth via `playwright-extra` + `puppeteer-extra-plugin-stealth`, or manually:
```typescript
// Before page.goto():
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  // @ts-ignore
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
});
```

### P0 — Fix `waitUntil` for CF challenge resolution (`browser.ts:149`)

```typescript
await page.goto(url, { waitUntil: "networkidle", timeout });
// OR: poll until challenge clears
let html = await page.content();
let attempts = 0;
while (detectBotChallenge(html) && attempts++ < 3) {
  await page.waitForTimeout(3000);
  html = await page.content();
}
```

### P1 — Add HTTP-layer bot detection to `fetchViaProxy` result

In `fetchViaProxy`, expose the HTTP status code alongside the response so the router can call `detectBotByStatus(status, responseBody)`. A status-403 + body < 200 chars → escalate immediately to render.

### P1 — Add missing patterns to `detectBotChallenge` tier-1 (`http.ts:323`)

```typescript
"cf-turnstile",      // Cloudflare Turnstile widget
"kp_uidz",           // Kasada session cookie in HTML
"aws-waf-token",     // AWS WAF
"pxchk",             // PerimeterX challenge marker
```

### P1 — Add missing tier-2 heuristics for PerimeterX `px.js` (`http.ts:362`)

```typescript
if (/["'/]px\.js(\?|"|'|$)/i.test(html)) signals++;
if (/\/challenge\.js/i.test(html) && !lower.includes("cloudflare")) signals++; // AWS WAF
```

### P2 — Country rotation on Web Unblocker retry (`http.ts:220`)

```typescript
const countries = ["", "us", "gb", "de"];
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const country = countries[attempt % countries.length];
  const resp = await axios.post(WEB_UNBLOCKER_BASE + "/request",
    { target_url: url, response_format: "html", js_render: true, country },
    ...
  );
```

### P2 — TLS fingerprint impersonation for the static/render proxy tier

The Web Unblocker endpoint should (or a new endpoint should) use `tls-client` (Go, bogdanfinn) with a `chrome_133` profile instead of Node's native TLS. This is an infrastructure change on the Novada Web Unblocker side, not purely in this MCP codebase. File a product request against `novada-web`/Unblocker service to add `tls_impersonation: "chrome_133"` as a request parameter.

### P2 — Add Kasada/AWS WAF/F5 to `DOMAIN_REGISTRY` (`domains.ts:135`)

```typescript
// Browser-required — Kasada (active environment interrogation, DIY not viable)
"g2.com":           { method: "browser", note: "Kasada", provider: "kasada", proxyTier: "residential" },
// Add missing travel/e-commerce
"expedia.com":      { method: "browser", note: "PerimeterX", provider: "perimeterx", proxyTier: "residential" },
"hotels.com":       { method: "browser", note: "PerimeterX", provider: "perimeterx", proxyTier: "residential" },
```

(Note: `g2.com` is already in the registry at line 138 as `kasada`. The pattern needs expanding for other Kasada sites.)

### P3 — Glassdoor missing `proxyTier: "residential"` (`domains.ts:137`)

```typescript
"glassdoor.com": { method: "browser", note: "Aggressive anti-bot", provider: "cloudflare", proxyTier: "residential" },
```

---

## 10. Summary Table

| File | Line(s) | Issue | Severity |
|---|---|---|---|
| `src/utils/http.ts` | 313-393 | `detectBotChallenge` missing Kasada bare-429, AWS WAF, CF Turnstile, F5 patterns | HIGH |
| `src/utils/browser.ts` | 138-141 | No stealth patching — `navigator.webdriver` detected | HIGH |
| `src/utils/browser.ts` | 149-152 | `waitUntil: "domcontentloaded"` exits during CF 5s challenge | HIGH |
| `src/utils/http.ts` | 212-220 | No country rotation on Web Unblocker retry | MEDIUM |
| `src/utils/domains.ts` | 60 | Amazon labeled `datadome` — wrong provider | MEDIUM |
| `src/utils/domains.ts` | 137 | Glassdoor missing `proxyTier: "residential"` | MEDIUM |
| `src/utils/http.ts` | 362-372 | Missing `px.js`, `challenge.js` heuristic signals | MEDIUM |
| `src/utils/domains.ts` | 135+ | Kasada sites (supreme, sneakers, etc.) not in registry | LOW |
| `src/config.ts` | 38 | `JS_DETECTION_THRESHOLD = 200` — accidentally handles Kasada but by wrong signal | LOW |
