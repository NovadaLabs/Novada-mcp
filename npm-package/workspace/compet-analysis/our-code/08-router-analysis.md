# Router & Escalation Logic Analysis

Sources read: `src/utils/router.ts`, `src/utils/domains.ts`, `src/tools/extract.ts` (full), `src/utils/http.ts`, `src/config.ts`.

---

## 1. Decision Tree

Two entry paths exist: `routeFetch()` (used by `novada_unblock` and `novada_crawl`) and `extractSingleInner()` (used by `novada_extract`). They share the same escalation philosophy but differ in domain-registry awareness.

```
ENTRY: routeFetch(url, render=?)
│
├─ render="browser"  ──────────────────────────────► fetchViaBrowser()  [cost: high]
│
├─ render="render"
│   ├─ unblockerKey present ───────────────────────► fetchWithRender()  [cost: medium]
│   └─ unblockerKey absent  ───────────────────────► fetchViaProxy()    [cost: low, mode=render-failed]
│
├─ render="static"  ───────────────────────────────► fetchViaProxy()    [cost: low]
│
└─ render="auto"  (default path)
    │
    ├─ Step 1: fetchViaProxy()  ──► static HTML
    │   │
    │   ├─ isPdfResponse?  ───────────────────────────► extractPdf()    [done, cost: low]
    │   │
    │   ├─ !detectJsHeavy && !detectBotChallenge  ───► return static   [done, cost: low]
    │   │
    │   └─ JS-heavy OR bot-challenge detected
    │       │
    │       ├─ Step 2: fetchWithRender() ─► rendered HTML
    │       │   │
    │       │   ├─ detectBotChallenge(renderHtml)?
    │       │   │   ├─ isBrowserConfigured?  ────────► fetchViaBrowser() [cost: high]
    │       │   │   └─ else  ───────────────────────► return static html [mode=render-failed]
    │       │   │
    │       │   ├─ !detectJsHeavy(renderHtml)  ─────► return renderHtml  [cost: medium]
    │       │   │
    │       │   └─ still JS-heavy after render
    │       │       ├─ isBrowserConfigured?  ────────► fetchViaBrowser() [cost: high]
    │       │       └─ else  ───────────────────────► return renderHtml  [cost: medium, best available]
    │       │
    │       └─ fetchWithRender() threw exception
    │           ├─ isBrowserConfigured?  ────────────► fetchViaBrowser() [cost: high]
    │           └─ else  ─────────────────────────────► return static html [mode=render-failed]


ENTRY: extractSingleInner(params)  [novada_extract path]
│
├─ Reddit URL?  ────────────────────────────────────► rewrite to old.reddit.com, force static
│
├─ Session cache hit?  ─────────────────────────────► return cached result immediately
│
├─ render != "auto"  ───────────────────────────────► skip domain registry, go to routeFetch logic
│
└─ render="auto" (default)
    │
    ├─ lookupDomain(url) hits DOMAIN_REGISTRY?
    │   ├─ entry.method = "static"  ────────────────► direct proxy fetch, no escalation
    │   ├─ entry.method = "render"  ────────────────► fetchWithRender() (proxyTier from registry)
    │   │   └─ html < 2000 && detectBotChallenge && browser configured?
    │   │       └─ opportunistic browser escalation (QW-4 guard)
    │   └─ entry.method = "browser"  ──────────────► fetchViaBrowser() immediately
    │
    └─ domain NOT in registry (auto-detect probe)
        │
        ├─ Promise.any([
        │   direct GET (3s timeout) — only wins if no bot/JS-heavy
        │   fetchViaProxy()
        │  ])
        │
        └─ JS-heavy OR bot-challenge on result?
            └─ same escalation chain as routeFetch auto mode (render → browser)
```

---

## 2. Escalation Conditions

| Escalation Step | Trigger Condition | Code Location |
|---|---|---|
| static → render | `detectJsHeavyContent(html)` OR `detectBotChallenge(html)` returns true | `router.ts:146`, `extract.ts:293` |
| render → browser (challenge) | `detectBotChallenge(renderHtml)` returns true after render step | `router.ts:155`, `extract.ts:301` |
| render → browser (still JS-heavy) | `detectJsHeavyContent(renderHtml)` still true after render | `router.ts:171`, `extract.ts:318` |
| render → browser (render threw) | `fetchWithRender()` throws any exception | `router.ts:184`, `extract.ts:329` |
| render skip (opportunistic) | Known-domain entry `.method="browser"` in registry | `extract.ts:201` |
| QW-4 opportunistic escalation | render result: `html.length < 2000 && detectBotChallenge(html)` | `extract.ts:236` |

**Quality threshold for escalation (JS detection):**
- `JS_DETECTION_THRESHOLD = 200` chars — any response shorter than 200 chars triggers escalation regardless of content (`http.ts:280`).
- String pattern matching on ~14 signals (empty SPA shells, CF challenge markers, etc.) (`http.ts:283-305`).

**Quality threshold for bot-challenge detection:**
- Single known challenge string → immediate `true` (17 definitive strings in `knownChallengeStrings`).
- Heuristic mode: 2+ of 6 signals → `true` (Kasada scripts, PerimeterX tokens, short body text <1500 chars, blank title, near-empty DOM).

---

## 3. Routing Issues Found

### Issue A: `routeFetch()` ignores DOMAIN_REGISTRY

**Severity: Medium.**

`routeFetch()` (used by `novada_unblock`, `novada_crawl`) runs the full auto-detect probe for every known domain, including ones already catalogued in `DOMAIN_REGISTRY` with a known optimal method. `extractSingleInner()` correctly consults the registry first. The two code paths diverge here.

- For `booking.com` (registry: `browser`), `routeFetch` will probe static first, pay a failed proxy request, then escalate to render, then browser — three round-trips instead of one.
- For `github.com` (registry: `static`), `routeFetch` could skip the full auto-detect if the static result passes, but it doesn't benefit from the 3s direct-GET race that `extractSingleInner` runs.

**Before:**
```typescript
// routeFetch auto mode — no domain registry consultation
const response = await fetchViaProxy(url, options.apiKey);
```

**After:**
```typescript
// routeFetch auto mode — consult domain registry first (same as extractSingleInner)
const domainHint = lookupDomain(url);
if (domainHint?.method === "browser") {
  const html = await fetchViaBrowser(url, { timeout, waitForSelector: options.waitForSelector, wait_ms: options.wait_ms });
  return { html, mode: "browser", cost: "high" };
}
const response = domainHint?.method === "render"
  ? await fetchWithRender(url, options.apiKey, { country })
  : await fetchViaProxy(url, options.apiKey);
```

---

### Issue B: render→browser escalation ignores render-failed mode

**Severity: Low-Medium.**

When `unblockerKey` is absent and render mode is forced, the router returns `mode: "render-failed"`. But in the auto escalation path (`router.ts:182`), if `fetchWithRender()` throws AND browser is not configured, the code returns `{ html, mode: "render-failed" }` where `html` is the **original static HTML** — not an empty string. This is correct behavior, but callers that check `mode === "render-failed"` have no way to distinguish "render failed, static content returned" from "render not configured, static content returned". The distinction matters for agents deciding whether to retry.

**Before:** Single `render-failed` mode for both cases.

**After:** Consider `mode: "render-not-configured"` vs `mode: "render-error"` to give callers richer context.

---

### Issue C: QW-4 threshold (2000 chars) may be too aggressive

**Severity: Low.**

The QW-4 guard at `extract.ts:236` checks `html.length < 2000` to decide whether a rendered response might still be a bot challenge. Some legitimate minimal pages (API docs, simple redirects, single-card micro-sites) return under 2000 chars and will incorrectly trigger a browser escalation attempt. The 2000-char threshold has no relation to the `JS_DETECTION_THRESHOLD` constant (200 chars) in `config.ts` — two separate thresholds with no naming connection.

**Before:**
```typescript
if (typeof html === "string" && html.length < 2000 && detectBotChallenge(html) && isBrowserConfigured()) {
```

**After:**
```typescript
// 2000 chars is already filtered by detectBotChallenge's bodyTextLen < 1500 heuristic.
// The outer length check is redundant AND too aggressive. Remove it.
if (typeof html === "string" && detectBotChallenge(html) && isBrowserConfigured()) {
```

---

### Issue D: `detectBotChallenge` not called on render result in `renderMode === "render"` forced path

**Severity: Medium.**

When the user explicitly sets `render="render"` in `routeFetch`, the code returns the render result directly (line 108) without checking `detectBotChallenge(renderHtml)`. In `extractSingleInner`, the forced `render` path DOES do the QW-4 check. The two paths are inconsistent — an agent hitting a CF challenge via `routeFetch` with `render="render"` gets the raw challenge page silently, while the same call via `novada_extract` gets the opportunistic browser escalation.

---

### Issue E: `detectJsHeavyContent` checks only 14 patterns — misses Vite/Svelte/Astro hydration targets

The SPA detection list covers React/Vue/Next/Angular empty shells but is missing:

- `id="svelte"` (Svelte app root)
- `id="__astro"` / `<astro-island` (Astro islands)
- `id="nuxt"` / `id="__nuxt"` (Nuxt.js)
- `x-data` attribute heavy pages (Alpine.js)
- `ng-version=` attribute (Angular, alternative detection)

These frameworks are increasingly common in docs sites (Astro) and dev tools (Nuxt). Missing them causes static returns for what are actually JS-shell pages.

---

## 4. Domain Pattern → Routing Tier Table

| Domain Pattern | Registry Tier | Anti-Bot Provider | Est. Success Rate (render tier) |
|---|---|---|---|
| `github.com`, `wikipedia.org`, `stackoverflow.com` | static | none | ~99% |
| `reddit.com` (via `www.`) | static (+ URL rewrite to old.reddit.com) | none | ~95% (new reddit blocks bots) |
| `medium.com`, `reuters.com` | render + residential | Cloudflare | ~80% (metered paywall still blocks) |
| `amazon.com` / regional | render + residential | DataDome | ~70% (high detection rate) |
| `twitter.com`, `x.com` | render | none (auth wall) | ~20% (always 403 after auth check) |
| `youtube.com`, `instagram.com`, `tiktok.com` | render | Google/Meta/TikTok | ~40% (auth-gated content fails) |
| `linkedin.com` | render | LinkedIn | ~30% (login wall) |
| `booking.com`, `glassdoor.com`, `g2.com` | browser | Perimeter/CF/Kasada | ~60–75% (fingerprinting still defeats some runs) |
| `ticketmaster.com`, `stubhub.com` | browser + residential | DataDome | ~50% (aggressive fingerprinting) |
| `discord.com` | browser | Cloudflare | ~65% |
| Unknown domains (auto-detect) | auto-probe | unknown | ~85% static, escalates as needed |

---

## 5. Missing Domain Entries (should be added to DOMAIN_REGISTRY)

### Missing — should be `static`

| Domain | Reason |
|---|---|
| `docs.openai.com` | Currently only `openai.com` (render). Docs subdomain is NextJS SSR, much lighter. |
| `huggingface.co` | SSR, widely used for ML model pages. No anti-bot. |
| `en.m.wikipedia.org` | Mobile Wikipedia — same SSR as desktop, but mobile subdomain misses subdomain fallback because `wikipedia.org` parent match skips `en.m`. |
| `jstor.org` | Academic research, SSR. Frequently accessed in research tasks. |
| `scholar.google.com` | Google Scholar is SSR-accessible (different from google.com search). |
| `docs.stripe.com` | Stripe docs are SSR. Currently falls through to auto-detect. |
| `docs.aws.amazon.com` | AWS docs are SSR. Without an entry, the `amazon.com` render entry matches via subdomain fallback — wrong tier, wastes render credits. |
| `news.google.com` | Google News is SSR-accessible without auth. Same issue as AWS — `google.com` render entry matches via subdomain fallback. |

### Missing — should be `render`

| Domain | Anti-Bot | Reason |
|---|---|---|
| `shopify.com` | Cloudflare | JS SPA storefront. |
| `canva.com` | Cloudflare | JS SPA design tool. |
| `notion.com` | — | Alias of `notion.so` — currently only `.so` is registered. |
| `producthunt.com` | Cloudflare | JS SPA. |
| `hacker-news.firebaseapp.com` | — | Non-standard HN frontend, JS-rendered. |
| `npmjs.com` subdomains | — | `docs.npmjs.com`, `blog.npmjs.com` — same React SPA. |
| `stripe.com` (main site) | Cloudflare | Marketing/pricing pages are JS-heavy. Distinct from `docs.stripe.com`. |
| `anthropic.com` | Cloudflare | Marketing site, JS-heavy. |

### Missing — should be `browser`

| Domain | Anti-Bot | Reason |
|---|---|---|
| `capterra.com` | DataDome | Similar profile to `g2.com` (review platform, Kasada). |
| `trustpilot.com` | Cloudflare | Review platform, heavy fingerprinting. |
| `seek.com.au` | Akamai | Job board, aggressive anti-bot. |
| `hinge.co` / `match.com` | PerimeterX | Dating apps with heavy fingerprinting. |

### Subdomain fallback gap

The `lookupDomain` function walks `parts.slice(i)` which means `docs.aws.amazon.com` will match `amazon.com` (render+residential) after stripping `docs.aws.`. This is **wrong** — AWS docs are static and the fallback silently wastes render credits. No fix exists for this in the current architecture beyond adding explicit entries for each problematic subdomain.

---

## 6. Cost of Each Escalation Tier

| Tier | Latency (p50) | Latency (p99) | Cost per Request | Notes |
|---|---|---|---|---|
| static (fetchViaProxy) | ~300ms–3s | ~15s | ~$0.0001 (proxy bandwidth) | 3 retries × exp backoff. STATIC_FETCH timeout = 15s. |
| render (Web Unblocker) | ~3–8s | ~60s | ~$0.001 | 2 retries built in. RENDER timeout = 60s. |
| browser (CDP) | ~5–15s | ~30s | ~$3/GB transferred | BROWSER_CONNECT=10s, BROWSER_PAGE=30s. Data-heavy pages (video sites) expensive. |
| auto-probe (extra static) | +300ms–3s | +15s | ~$0.0001 | Paid even on failures — wasted on known-browser domains. |

**Worst-case auto-mode wall time:** static (15s) + render (60s) + browser (30s) = 105s. The `TOTAL_REQUEST_CEILING = 90s` enforced in `extractSingle` caps this, so in practice the chain is killed at 90s.

**The most expensive scenario:** A domain in the `browser` registry tier hit via `routeFetch` (which ignores the registry) — pays for static probe + render + browser = ~$0.001 + $3/GB, and adds 75–120s latency before the browser result arrives.

---

## 7. Unnecessary Browser Escalation Scenarios

**Scenario 1: render result is JS-heavy but usable.**

`router.ts:166-168` correctly returns render result if `!detectJsHeavyContent(renderHtml)`. But at `router.ts:170-178`: if render HTML still has JS-heavy signals AND browser is configured, it escalates to browser. Some render results are "JS-heavy by signal" but actually contain sufficient content for extraction (e.g. a Next.js page that hydrates in browser but was SSR'd to partial HTML with an empty `#__next`). The current check fires on any JS-heavy signal regardless of whether extracted content would be adequate.

**Scenario 2: Sites returning auth walls at the render tier get escalated to browser unnecessarily.**

`twitter.com`, `x.com`, `linkedin.com`, `instagram.com` — the registry correctly marks them `render`, but after `fetchWithRender()` returns a 403 or an auth-wall page, `detectBotChallenge` may return false (the page is real HTML, not a challenge), so the router returns the auth-wall page as if successful. The browser escalation is never triggered — so browser isn't wasted. But the render cost is paid with zero chance of success for unauthenticated requests.

**Scenario 3: `render="render"` forced mode + CF-protected domain + no unblocker key.**

`routeFetch` falls back to `fetchViaProxy` with `mode=render-failed`. The caller gets static HTML but `mode` says `render-failed`. If that caller then checks `mode === "render"` to decide whether content is trustworthy, it correctly rejects — no escalation waste, but the failure mode is silent.

**Scenario 4: Double-escalation via QW-4 on already-known render-tier domains.**

When `extractSingleInner` resolves a domain to `render` via registry and the rendered HTML is 1800 chars, the QW-4 guard (`html.length < 2000`) fires an opportunistic browser fetch even if `detectBotChallenge` is debatable. For sites like `martinfowler.com` (minimal pages are real), this wastes a browser credit.

---

## 8. `detectBotChallenge` Pattern Coverage Assessment

### Well-covered
- Cloudflare: 7 patterns including challenge JS markers, Ray ID, `__cf_bm` cookie — comprehensive.
- Akamai: 3 specific bot-management cookies (`_abck`, `bm_sz`, `ak_bmsc`) — good, avoids `akamaized` CDN false positives.
- Imperva/Incapsula: 3 session/visitor cookie patterns — good.
- DataDome: catches the cookie/script name — but `datadome` is a very broad match (any page mentioning DataDome in any context, including news articles about DataDome, would match).
- Amazon WAF: 2 specific error strings — adequate.

### Gaps

| Provider | Gap | Risk |
|---|---|---|
| **Kasada** | Only detected via `ips.js` / `cd.js` script names. Kasada v2+ uses randomized script names. Pattern will miss. | Medium — g2.com, ticketmaster now use v2. |
| **hCaptcha** | Not in `knownChallengeStrings`. Pages serving hCaptcha (many Cloudflare alternatives) only hit heuristic path. | Low-Medium — growing adoption. |
| **reCAPTCHA v3** | No detection for `grecaptcha` or `www.google.com/recaptcha`. Silent page returns pass as good content. | Low — v3 is invisible, page content still loads. |
| **AWS WAF CAPTCHA** | Only 2 Amazon-specific strings. AWS WAF can also serve a generic JS challenge page not matching these. | Low. |
| **Arkose Labs / FunCaptcha** | Not covered at all. Used by Microsoft, Roblox, some booking platforms. | Low — limited use in content scraping targets. |
| **TikTok CAPTCHA** | The registry marks `tiktok.com` as render+tiktok provider, but `identifyAntiBot` has no TikTok entry and `detectBotChallenge` has no TikTok-specific strings. | Medium — silent failure on TikTok content. |
| **Short body heuristic** | `bodyTextLen < 1500` uses regex stripping of `<script>` and `<style>` blocks. A page that inlines all JS in `<script type="module">` or uses data URIs won't be stripped correctly, biasing the length count. | Low. |

---

## 9. Smart Routing Layer Proposal

The current router is stateless — it re-probes the same domain every time unless it's in `DOMAIN_REGISTRY`. A learning layer could:

**What to track per domain (session or persistent):**
```
{
  domain: string,
  lastMethod: "static" | "render" | "browser",
  lastSuccess: boolean,
  escalationHistory: Array<{ from: string, to: string, reason: string, ts: number }>,
  avgLatencyMs: number,
  failureCount: number
}
```

**Routing logic change:**
```
for each unknown domain in auto mode:
  IF domain in session-success-cache AND lastMethod = "static" AND lastSuccess = true:
    → skip probe, go straight to static
  IF domain in session-failure-cache AND lastMethod = "static" AND lastSuccess = false:
    → skip static, go straight to render
  IF domain in session-failure-cache AND lastMethod = "render" AND lastSuccess = false:
    → skip static+render, go straight to browser
```

**Persistent registry feedback:**
If in auto mode, after successful escalation, emit a warning to stderr with the domain + resolved method — operator can copy-paste into `DOMAIN_REGISTRY` for future sessions. Currently this data is silently discarded.

**Cost of not having this:**
Every new domain encountered in auto mode pays for the full probe chain on first contact (worst case: all three tiers). A second request for the same domain in the same session pays again (no session memory of escalation outcomes).

---

## Summary of Actionable Issues (Priority Order)

| # | Issue | Severity | Fix Complexity |
|---|---|---|---|
| 1 | `routeFetch` ignores `DOMAIN_REGISTRY` — browser-tier domains pay 3 round-trips | Medium | Low — 10 lines |
| 2 | `detectJsHeavyContent` missing Svelte/Astro/Nuxt/Alpine patterns | Low-Medium | Low — add 4 strings |
| 3 | `docs.aws.amazon.com` subdomain hits `amazon.com` render entry — wrong tier | Medium | Low — add explicit entry |
| 4 | QW-4 `html.length < 2000` redundant AND over-triggers on minimal legit pages | Low | Low — remove outer length check |
| 5 | `render="render"` forced path in `routeFetch` skips `detectBotChallenge` on result | Medium | Low — add post-render check |
| 6 | Kasada v2 uses randomized script names — detection will miss | Medium | Medium — needs Kasada-specific heuristic |
| 7 | `render-failed` mode is ambiguous — two distinct failure causes share one status | Low | Medium — add new mode variant |
| 8 | No session-level routing memory — same domain probed every call | Medium | High — new caching layer |
| 9 | Missing ~15 domain entries (see Section 5) | Low-Medium | Low — registry additions only |
| 10 | `news.google.com` / `docs.aws.amazon.com` subdomain fallback hits wrong parent entry | Medium | Low — explicit entries |
