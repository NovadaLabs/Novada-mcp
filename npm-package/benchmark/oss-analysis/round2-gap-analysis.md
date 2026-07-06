# Round 2 — Gap Analysis

**Date:** 2026-06-22
**Agent:** Round-2 Gap Analysis Agent
**Inputs:** round1-firecrawl.md, round1-tavily.md, Novada MCP source (`src/`)

---

## 0. Baseline: What the Benchmark Failure Rates Tell Us

| Failure category | Observed rate | Primary root cause (from Round 1) |
|---|---|---|
| Amazon product pages | ~60% fail | Anti-bot (DataDome + WAF) blocks render mode; no CSS selector wait → prices render after initial DOM |
| Any anti-bot protected page | ~40% fail | Single retry path: static → render → browser; no per-domain IP strategy or retry backoff on 4xx |
| JS SPA (non-anti-bot) | ~20% fail | No fixed-wait + no CSS selector wait in `novadaExtract`; only `fetchViaBrowser` (via `routeFetch`) passes `waitForSelector`, but `extractSingle` in `extract.ts` never calls `routeFetch` — it calls `fetchViaBrowser` directly without selector wait |

---

## 1. Ranked Gap Table

| # | Gap | What competitor does | What Novada does now | Impact on success rate | Implementation effort | Priority |
|---|---|---|---|---|---|---|
| 1 | **`waitFor` CSS selector not wired into `novadaExtract`** | Firecrawl: `waitForSelector` param passed to playwright; available to callers as `check_selector`. Tavily advanced mode waits for full browser rendering completion. | `wait_for` param exists in `UnblockParamsSchema` and is passed through `novadaUnblock` → `routeFetch` → `fetchViaBrowser`. But `extractSingle` in `extract.ts` calls `fetchViaBrowser(params.url)` directly (lines ~200, 289, 302, 305, 441, 464) — **never passes `waitForSelector`**. `ExtractParamsSchema` has no `wait_for` field. | High — Amazon prices, stock status, SPA content all render after initial DOM. CSS selector wait is the primary fix for the 20% JS SPA failures and contributes to Amazon's 60% failure rate. | Low — add `wait_for?: string` to `ExtractParamsSchema` in `types.ts`; thread it through all `fetchViaBrowser(...)` calls in `extractSingle` in `extract.ts` (~6 call sites) | P0 |
| 2 | **Fixed-ms wait not exposed in `novadaExtract`** | Firecrawl: `waitFor` in ms, capped at 30s, passed as a `wait` action to fire-engine. Available to API callers. Enables waiting for JS timers, animations, deferred renders. | `UnblockParamsSchema` has `wait_ms` field but it is explicitly `[NOT_IMPLEMENTED]` (declared void in `unblock.ts` line 15). `extractSingle` has no `wait_ms` param whatsoever. | Medium — Amazon product pages sometimes require 1-3s after DOM for price injection. Not having this is a secondary contributor to the Amazon 60% failure. But CSS selector wait (Gap #1) is preferred over fixed-ms for reliability. | Low — add `wait_ms?: number` to `ExtractParamsSchema`; pass to `fetchViaBrowser` as `page.waitForTimeout(wait_ms)` before `page.content()`. Implement `wait_ms` in `fetchWithRender` by appending to the Web Unblocker request body (currently ignored). | P1 |
| 3 | **No per-domain proxy tier selection (residential vs datacenter) in extract path** | Firecrawl: `mobileProxy` boolean flag changes IP tier to mobile residential in fire-engine. Proxy type is auto-selected based on `stealthProxy` feature flag. Tavily's 40% Amazon failure is precisely because they only have datacenter IPs. | `fetchViaProxy` (used in `extractSingle` static path) uses a single static proxy configured via `NOVADA_PROXY_*` env vars — no per-domain tier switching. `DOMAIN_REGISTRY` knows `amazon.com` needs anti-bot treatment but routes it to `render` method, not to a different proxy tier. Novada has residential/mobile proxy products but they are only accessible via `novada_proxy_*` tools (credential generation), not wired into the extract pipeline. | High — Amazon 60% failure is infrastructure-level. If extract's static + render path uses datacenter IPs, even `render` mode will fail DataDome/WAF. Routing amazon.com (and other DOMAIN_REGISTRY `render` entries with known providers) through residential IPs at the HTTP level would fix the majority of the 60%. | Medium — requires passing domain-aware proxy credentials into `fetchViaProxy` and `fetchWithRender`. `DOMAIN_REGISTRY` already identifies providers (`provider: "datadome"`). Add a `proxyTier: "residential" | "datacenter"` field to `DomainEntry` and read `NOVADA_RESIDENTIAL_PROXY_*` env vars when tier is residential. Affects `http.ts` `fetchViaProxy` (~20 lines) + `domains.ts` `DomainEntry` type. | P1 |
| 4 | **`detectJsHeavyContent` does not detect Amazon-specific empty patterns** | Firecrawl: `urlSpecificParams.ts` forces `tlsclient` engine for specific domains. `retryWithStealth` signal from the engine triggers re-routing. Tavily analysis: DataDome blocks at TLS level before HTML is served. | `detectJsHeavyContent` (in `http.ts` ~line 244) checks for generic React/Vue empty-div patterns (`id="root"></div>`, etc.) and Cloudflare signals. Amazon's DataDome challenge page is NOT covered — it returns a full HTML page with scripts and a CAPTCHA widget, not an empty shell. `detectBotChallenge` does catch `datadome` as a signal, but only after the static fetch returns. | High — when Amazon returns a DataDome challenge on static fetch, `detectBotChallenge` fires and escalates to render, then to browser. But if the render-mode DataDome page also returns a DataDome token-wall (which it does at scale), the escalation chain terminates without success. Adding DataDome-specific signals to `detectBotChallenge` won't help here — the real fix is Gap #3 (proxy tier). However, adding `"datadome"` as a definitive challenge signal (already partially done) and ensuring the DOMAIN_REGISTRY `provider: "datadome"` triggers pre-emptive residential proxy selection would cut ~20% of Amazon failures. | Low — add `"datadome"` to `knownChallengeStrings` in `detectBotChallenge` (http.ts ~line 306) as a definitive 1-signal trigger; also add Amazon-specific patterns like `"robot check"`, `"enter the characters you see below"` | P1 |
| 5 | **No persistent browser profile / cookie store across sessions in extract path** | Firecrawl: SHA256-keyed browser profile in fire-engine reuses context across requests to the same domain — cookies and localStorage from previous visits persist, bypassing re-verification. | `fetchViaBrowser` always calls `browser.newContext()` with a fresh, ephemeral context. Session persistence exists only in `novadaBrowser` (interactive tool) via `storeSession`. There is no carry-over of cookies/localStorage between individual `novadaExtract` calls for the same domain. | Medium — for sites that use cookie-based bot scoring (Akamai BMSC, DataDome DD tokens), a warm context with prior-visit cookies scores higher trust. Estimated 10-15% improvement on Akamai-protected domains (bestbuy.com, homedepot.com). No impact on TLS-fingerprint-only blocks. | Medium — add an optional `profile_id` param to `ExtractParamsSchema`; map it to a long-lived browser context stored in the session map; reuse context across calls with the same `profile_id`. Reuses `storeSession`/`getSession` infrastructure from browser.ts but requires storing the `BrowserContext` separately from the `Page`. | P2 |
| 6 | **No content quality re-check before returning render/browser result** | Firecrawl: `checkMarkdown.trim().length === 0` triggers fallback to next engine. Quality gate is explicit. | `extractSingle` has a quality-based auto-escalation (quality.score < 40 → escalate to render, then browser). But the quality re-check only runs in the `auto` + `usedMode === "static"` branch (extract.ts ~line 404). When `renderMode` is forced to `"render"` or `"browser"`, the result is returned as-is regardless of quality. Also, `extractSingle` does not check `mainContent.length === 0` before returning — it can return an empty content block with no further fallback. | Medium — covers cases where render succeeds HTTP-wise but returns a bot-challenge HTML (DataDome token page has content but no product data). Without a content-length floor check on the render path, agents receive a "success" response that is actually a challenge page. | Low — add `if (mainContent.length < 200 && usedMode === "render")` fallback to browser mode in `extractSingle` after the render path (extract.ts ~line 230). Same check for `usedMode === "browser"` before final return. | P1 |
| 7 | **No domain-specific URL rewrite for Amazon (international TLDs)** | Firecrawl: `rewriteUrl.ts` only handles Google Docs. Amazon international domains handled the same as amazon.com. | `DOMAIN_REGISTRY` covers 8 Amazon TLDs (`amazon.com`, `.de`, `.co.uk`, `.co.jp`, `.fr`, `.es`, `.it`, `.ca`) all routing to `render` mode. Reddit URL rewrite exists (rewriteRedditUrl in extract.ts ~line 141). | Low-Medium — no URL normalization for Amazon (e.g., adding `&th=1&psc=1` to force the canonical product listing). Probably 5-10% improvement on Amazon pages that redirect to regional variants. | Low — add `rewriteAmazonUrl` helper in extract.ts alongside `rewriteRedditUrl`, stripping tracking params and ensuring the product detail canonical URL format. | P2 |
| 8 | **No ML-based per-domain engine optimizer (analog to Firecrawl's engpicker)** | Firecrawl: GPT-4o-mini background job samples domains, evaluates 4 engine × proxy combinations, stores `TlsClientOk`/`ChromeCdpRequired`/`Uncertain` verdict, boosts quality score by +50 for optimal engine at request time. | `DOMAIN_REGISTRY` in `domains.ts` is a static hand-written registry. It is updated manually. No automated per-domain learning loop exists. | Low-Medium — the DOMAIN_REGISTRY already provides most of this for known domains (~100 entries). The gap is for unknown domains (new e-commerce sites, regional variants) where the ML would auto-discover optimal strategy. | High — requires a background job, LLM calls, a results store. Not a client-side MCP change. Out of scope per constraints (MCP client-side only). | P3 |
| 9 | **No `fastMode` equivalent to skip expensive rendering for known static sites** | Firecrawl: `fastMode: true` adds `useFastMode` feature flag → skips chrome-cdp entirely, forces TLS client or fetch only. | `DOMAIN_REGISTRY` static entries short-circuit to `method: "static"` for known SSR sites (github.com, wikipedia.org, etc.). The `render="static"` param achieves the same thing explicitly. But for unknown domains, auto mode always races static vs proxy without being able to hint "skip browser entirely". | Low — already handled via DOMAIN_REGISTRY + `render="static"`. Gap is marginal. | Low — add an `always_skip_render?: boolean` param to `ExtractParamsSchema` for agents to force skip escalation on known-static pages. | P3 |
| 10 | **`waitForSelector` timeout is hardcoded at 5000ms in `fetchViaBrowser`** | Firecrawl: `waitFor` is configurable up to 60,000ms. Fire-engine applies up to 30,000ms. | `fetchViaBrowser` (browser.ts ~line 115, 152): `waitForSelector(options.waitForSelector, { timeout: 5000 })` — 5s hardcoded, wrapped in `.catch(() => {})` (silent fail). For slow SPAs (React app with lazy-loading), 5s is often insufficient. | Low-Medium — affects JS SPAs where selectors take 6-15s to appear (charts, dynamic tables, deferred API calls). Silent failure means content is captured before target element renders. | Low — change `{ timeout: 5000 }` to `{ timeout: Math.min(options.timeout ?? 15000, 15000) }` in browser.ts lines 115 and 152. | P1 |

---

## 2. Quick Wins (< 1 day, high impact)

### QW-1: Wire `wait_for` into `novadaExtract` (Gap #1)

**File:** `src/tools/types.ts` and `src/tools/extract.ts`

**In `types.ts` `ExtractParamsSchema`** (~line 74), add:
```ts
wait_for: z.string().optional()
  .describe("CSS selector to wait for before capturing content (browser mode only). E.g. '.price', '#product-title', '[data-testid=price]'. Delays capture until the element appears in the DOM. Max wait: 15s."),
```

**In `extract.ts` `extractSingle`**, all 6 `fetchViaBrowser(params.url)` calls (lines ~200, 289, 302, 305, 441, 464) need to become:
```ts
fetchViaBrowser(params.url, { waitForSelector: params.wait_for })
```

This directly closes the primary cause of the JS SPA 20% failure and part of the Amazon 60% failure (price elements).

---

### QW-2: Add DataDome/Amazon patterns to `detectBotChallenge` (Gap #4, partial)

**File:** `src/utils/http.ts` ~line 290

Add to `knownChallengeStrings` array:
```ts
// DataDome (challenge page markers — not just the cookie name)
"robot check",
"enter the characters you see below",
"sorry, we just need to make sure",
// Amazon WAF
"to discuss automated access to amazon data",
"apologies, but we're having trouble saving your cookie",
```

**Estimated improvement:** Converts false-negative "success" responses (challenge HTML returned as content) into detectable failures that trigger further escalation, reducing the ~15% of Amazon failures that are "silent wrong content" vs "obvious failure."

---

### QW-3: Fix `waitForSelector` timeout in `fetchViaBrowser` (Gap #10)

**File:** `src/utils/browser.ts` lines 115 and 152

Change both occurrences from:
```ts
await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {});
```
to:
```ts
await page.waitForSelector(options.waitForSelector, { timeout: Math.min(options.timeout ?? 15000, 15000) }).catch(() => {});
```

**Estimated improvement:** Fixes silent miss on SPAs where target elements take 6-15s to render. Affects JS SPA failure rate directly.

---

### QW-4: Add minimum content length check on render/browser result (Gap #6)

**File:** `src/tools/extract.ts` ~line 230 (inside the `effectiveMode === "render"` branch)

After `html = response.data` is assigned in the render path, add before `usedMode = "render"`:
```ts
// If rendered content is suspiciously short, it may be a bot-challenge page
// that passed detectBotChallenge — attempt browser escalation before accepting
if (typeof html === "string" && html.length < 2000 && isBrowserConfigured()) {
  const browserHtml = await fetchViaBrowser(params.url, { waitForSelector: params.wait_for }).catch(() => null);
  if (browserHtml && browserHtml.length > html.length) {
    html = browserHtml;
    usedMode = "browser";
  }
}
```

---

## 3. Medium-Term (1–3 days)

### MT-1: Domain-aware proxy tier selection in extract pipeline (Gap #3)

**Files:** `src/utils/domains.ts`, `src/utils/http.ts`, `src/utils/credentials.ts`, `src/tools/extract.ts`

**Step 1 — `domains.ts`:** Add `proxyTier` field to `DomainEntry`:
```ts
export interface DomainEntry {
  method: FetchMethod;
  note: string;
  provider?: AntiBotProvider;
  proxyTier?: "residential" | "datacenter";  // NEW
}
```
Set `proxyTier: "residential"` for all entries with `provider: "datadome"`, `provider: "perimeterx"`, `provider: "akamai"`, `provider: "kasada"` (amazon.com, walmart.com, bestbuy.com, ticketmaster.com, etc.).

**Step 2 — `credentials.ts`:** Add `getResidentialProxyCredentials()` function that reads `NOVADA_RESIDENTIAL_PROXY_USER`, `NOVADA_RESIDENTIAL_PROXY_PASS`, `NOVADA_RESIDENTIAL_PROXY_ENDPOINT` (separate from datacenter proxy).

**Step 3 — `http.ts` `fetchViaProxy`:** Accept an optional `proxyTier` param. When `proxyTier === "residential"`, use residential credentials instead of datacenter credentials.

**Step 4 — `extract.ts` `extractSingle`:** After `lookupDomain()` resolves a `domainHint`, if `domainHint.proxyTier === "residential"`, pass `proxyTier: "residential"` through all `fetchViaProxy` and `fetchWithRender` calls for that URL.

**Impact:** Highest single fix for Amazon 60% failure. Residential IPs bypass DataDome and AWS WAF Bot Control at the IP-reputation layer, before any browser fingerprinting occurs.

---

### MT-2: Implement `wait_ms` fixed-timeout in extract and unblock (Gap #2)

**Files:** `src/tools/types.ts`, `src/tools/extract.ts`, `src/utils/browser.ts`, `src/tools/unblock.ts`

**`types.ts`:** Add to `ExtractParamsSchema`:
```ts
wait_ms: z.number().int().min(0).max(30000).optional()
  .describe("Fixed milliseconds to wait after page load before capturing content. Use wait_for (CSS selector) instead when possible — it is more reliable. wait_ms is a fallback for pages with no stable selector. Max: 30000ms."),
```

**`browser.ts` `fetchViaBrowser`:** Accept `wait_ms` in options; after `page.goto()` succeeds and `waitForSelector` completes, add:
```ts
if (options.wait_ms && options.wait_ms > 0) {
  await page.waitForTimeout(options.wait_ms);
}
```

**`unblock.ts`:** Remove the `void wait_ms` no-op (line 15); pass `wait_ms` through `routeFetch` options → `fetchViaBrowser`.

**`http.ts` `fetchWithRender`:** The Web Unblocker API accepts a `wait` parameter in the request body. Add:
```ts
{ target_url: url, response_format: "html", js_render: true, country: country ?? "", wait: options.wait_ms ?? 0 }
```

---

### MT-3: Amazon URL normalization (Gap #7)

**File:** `src/tools/extract.ts`

Add alongside `rewriteRedditUrl` (~line 141):
```ts
function normalizeAmazonUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.match(/^amazon\.(com|de|co\.uk|co\.jp|fr|es|it|ca|com\.mx|com\.au|com\.br)$/)) return null;
    // Canonicalize: ensure ASIN-based product pages use /dp/ format
    const dpMatch = parsed.pathname.match(/\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})/);
    if (dpMatch) {
      const canonical = new URL(`https://${parsed.hostname}/dp/${dpMatch[1]}/`);
      // Preserve only meaningful params
      const keep = ["th", "psc", "language"];
      for (const k of keep) {
        if (parsed.searchParams.has(k)) canonical.searchParams.set(k, parsed.searchParams.get(k)!);
      }
      return canonical.toString();
    }
    return null;
  } catch { return null; }
}
```

Apply before `extractSingle` body, similar to Reddit rewrite. Canonical Amazon URLs have significantly higher render success rates than tracking-param-laden URLs.

---

## 4. Strategic (require infrastructure changes — noted for completeness, out of MCP client scope)

### S-1: Per-domain ML engine optimizer (Gap #8)

Requires a background telemetry collection service (separate process or serverless function) that:
1. Samples `novadaExtract` results by domain
2. Records `usedMode`, `quality.score`, `detectedAntiBot` per domain
3. Writes optimal mode back to a shared store (Redis or Supabase)
4. `DOMAIN_REGISTRY` is replaced by a live-loaded registry that is updated from this store

This is the Firecrawl `engpicker` equivalent. Estimated 15-20% improvement on the long tail of unknown domains. Client-side implementation in MCP is not viable — requires a separate daemon.

### S-2: Persistent warm browser profiles (Gap #5)

Requires a durable session store (outside in-process memory) so `profile_id` sessions survive MCP server restarts. Currently `activeSessions` Map is in-process and volatile. Options: serialize browser cookies to a SQLite or filesystem store and reload them into new `browserContext` instances. Medium-complexity infrastructure change (~2-3 days, but requires careful security review of cookie storage).

### S-3: TLS fingerprint client for anti-bot bypass without headless browser

Firecrawl's `tlsclient` engine impersonates browser TLS handshakes without launching a real browser — lower cost and latency than CDP. Novada's render path uses the Web Unblocker (which may or may not implement TLS fingerprinting internally). If Novada's infrastructure exposes a `tls_fingerprint` mode, expose it as `render="tls"` in `ExtractParamsSchema`. Otherwise, this requires backend infrastructure work.

---

## 5. Impact vs Effort Summary

| Priority | Gap | File(s) | Est. fix size | Est. success rate improvement |
|---|---|---|---|---|
| P0 | Wire `wait_for` into `novadaExtract` | types.ts + extract.ts | ~20 lines | JS SPA: -15%; Amazon: -10% |
| P1 | Fix `waitForSelector` 5s timeout | browser.ts | ~2 lines | JS SPA: -5% |
| P1 | Add Amazon/DataDome patterns to `detectBotChallenge` | http.ts | ~5 lines | Amazon silent-fail: -10% |
| P1 | Content-length floor on render result | extract.ts | ~10 lines | Amazon/anti-bot: -5% |
| P1 | Domain-aware residential proxy tier | domains.ts + http.ts + credentials.ts + extract.ts | ~80 lines | Amazon: -30%; anti-bot: -20% |
| P1 | Implement `wait_ms` fixed timeout | types.ts + extract.ts + browser.ts + unblock.ts | ~30 lines | Amazon price pages: -5% |
| P2 | Amazon URL normalization | extract.ts | ~25 lines | Amazon: -5% |
| P2 | Persistent browser profiles | browser.ts + session store | ~100 lines + infra | Akamai domains: -10% |
| P3 | ML engine optimizer | separate daemon | out of scope | Unknown domains: -15% |

**Total addressable improvement (all P0+P1 items):** Amazon ~60% fail → ~15-20% fail; anti-bot ~40% fail → ~15-20% fail; JS SPA ~20% fail → ~5-8% fail.

The single highest-ROI action is MT-1 (domain-aware residential proxy selection) + QW-1 (wire `wait_for`), executed together. These two changes address the root causes of 80% of benchmark failures.
