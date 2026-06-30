# Firecrawl OSS Analysis — Round 1

**Date:** 2026-06-22
**Repo:** mendableai/firecrawl (main branch)
**Analyst:** Round-1 Research Agent A

---

## 1. Stealth / Anti-Detection Techniques

**Summary:** Firecrawl does NOT implement classic stealth plugins (no `puppeteer-extra-plugin-stealth`, no `playwright-stealth`) in its open-source code. Instead it relies on a closed-source internal service called **fire-engine** for all anti-detection work, with the playwright microservice acting as a simple fallback.

**Evidence:**

- `apps/playwright-service-ts/package.json`: dependencies are only `playwright`, `user-agents`, `dotenv`, `express`, `ipaddr.js`. Zero stealth plugins.
- `apps/playwright-service-ts/api.ts` lines ~150-170: Browser launched with standard flags (`--no-sandbox`, `--disable-dev-shm-usage`, etc.). User-agent is randomized per request via the `user-agents` npm package:
  ```ts
  const userAgent = userAgentOverride || new UserAgent().toString();
  ```
  This is a basic UA rotation — no canvas fingerprinting, WebGL spoofing, or navigator overrides.
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/scrape.ts`: The closed-source **fire-engine** service supports two engine types: `chrome-cdp` (full Chrome browser via CDP) and `tlsclient` (TLS fingerprint impersonation). The `tlsclient` engine is the actual stealth primitive — it impersonates browser TLS handshakes rather than using a real browser.
- `apps/api/src/scraper/scrapeURL/engines/index.ts`: Engine `fire-engine;tlsclient;stealth` has quality=-15 (negative = only used as fallback). `fire-engine;chrome-cdp;stealth` has quality=-2.

**Key mechanic — stealthProxy flag:**
When a scrape returns 401/403/429, the system auto-escalates by throwing `AddFeatureError(["stealthProxy"])`, which re-selects only stealth-capable engines:

```ts
// apps/api/src/scraper/scrapeURL/index.ts ~line 596-611
if (isLikelyProxyError && meta.options.proxy === "auto" && !meta.featureFlags.has("stealthProxy")) {
  throw new AddFeatureError(["stealthProxy"]);
}
```

The `mobileProxy` flag is sent to fire-engine for both `chrome-cdp` and `tlsclient` when `stealthProxy` is active:
```ts
// fire-engine/index.ts
mobileProxy: meta.featureFlags.has("stealthProxy"),
```

**User-facing proxy option:** `proxy: "basic" | "stealth" | "enhanced" | "auto"`. With `stealth`/`enhanced`, timeout is auto-bumped to 120s and stealthProxy feature flag is added.

---

## 2. CAPTCHA Handling

**Summary:** No CAPTCHA solver (2captcha, anti-captcha, CapSolver, human relay) exists anywhere in the open-source Firecrawl repo. CAPTCHA bypassing is entirely delegated to fire-engine (closed-source).

**Evidence:**

- Searched `package.json` files for: `2captcha`, `anticaptcha`, `capsolver`, `captcha`. Zero matches.
- `apps/api/src/scraper/scrapeURL/engines/utils/specialtyHandler.ts`: Only handles content-type routing (PDF, DOCX, binary). No CAPTCHA logic.
- `apps/api/src/scraper/scrapeURL/retryTracker.ts`: Retry reasons are `feature_toggle`, `feature_removal`, `pdf_antibot`, `document_antibot`. No `captcha` category exists.
- Error types in `error.ts` include `PDFAntibotError`, `DocumentAntibotError` — these are for when a PDF or document returns a bot-detection page. The word "captcha" does not appear in the type system.
- `apps/api/src/lib/engpicker.ts`: Uses GPT-4o-mini to evaluate whether a scrape result was blocked by "Antibot/captcha challenges (e.g., Cloudflare, reCAPTCHA, hCaptcha)" — but this is for per-domain engine selection optimization, not live CAPTCHA solving.

**Conclusion:** Firecrawl's CAPTCHA "bypass" is purely IP-reputation + TLS fingerprinting via fire-engine. If fire-engine's stealth proxy fails, the request fails. There is no human-in-the-loop or ML solver.

---

## 3. `waitFor` Implementation — JS-Heavy SPAs

**Summary:** Firecrawl uses a **fixed timeout** approach for `waitFor`, not DOM mutation observers or network idle detection. There is no "smart wait" in the open-source playwright microservice, though the fire-engine (closed-source) has a `disableSmartWaitCache` parameter suggesting fire-engine does implement some form of smart wait internally.

**Evidence — Playwright microservice (`apps/playwright-service-ts/api.ts`):**

```ts
// scrapePage function, ~line 260
response = await page.goto(url, { waitUntil: 'load', timeout });

if (waitAfterLoad > 0) {
  await page.waitForTimeout(waitAfterLoad);  // pure fixed timeout
}

if (checkSelector) {
  await page.waitForSelector(checkSelector, { timeout }); // selector-based wait (optional)
}
```

- `waitUntil: 'load'` is hardcoded — no `networkidle`.
- `waitAfterLoad` = user-supplied `waitFor` value (ms), applied as a fixed `setTimeout`.
- Optional `check_selector` parameter allows waiting for a CSS selector.

**Evidence — Fire-engine (closed-source) path (`apps/api/src/scraper/scrapeURL/engines/fire-engine/index.ts`):**

```ts
// waitFor is transformed into an action:
...(effectiveWait > 0 ? [{ type: "wait" as const, milliseconds: effectiveWait > 30000 ? 30000 : effectiveWait }] : [])
```

`waitFor` is capped at 30,000ms and converted to a `wait` action passed to fire-engine. Max total `waitFor` via API is 60,000ms (v1 types constraint).

The internal option `disableSmartWaitCache` is passed to fire-engine, implying fire-engine has its own "smart wait" that can be disabled, but this is opaque — no source available.

---

## 4. Amazon Product Pages

**Summary:** Firecrawl has **no Amazon-specific logic** in its open-source code. Amazon is not in `urlSpecificParams`, not in any blocklist or engine-forcing config, and there are no product-structured extractors.

**Evidence:**

- `apps/api/src/scraper/scrapeURL/lib/urlSpecificParams.ts`: Only two domains forced to `fire-engine;tlsclient`: `digikey.com` and `lorealparis.hu`. Amazon is absent.
- `apps/api/src/scraper/WebScraper/utils/engine-forcing.ts`: Domain forcing is runtime-configured via `FORCED_ENGINE_DOMAINS` env var. No hardcoded Amazon rules.
- `apps/api/src/scraper/scrapeURL/lib/rewriteUrl.ts`: Only Google Docs/Drive URL rewrites. No Amazon rewriting.
- `apps/api/src/scraper/WebScraper/utils/blocklist.ts`: Blocklist is database-driven, not hardcoded. No visible Amazon entry.
- The `ad-serving domain` blocklist in playwright service (`api.ts` line ~130) includes `amazon-adsystem.com` for ad-blocking only.

**What happens with Amazon in practice:** Amazon returns 503 or bot-detection HTML with `fetch` or `playwright`. The system auto-escalates to `stealthProxy` on 401/403/429 responses, which routes through fire-engine's TLS client + mobile proxy. Whether that successfully scrapes amazon.com product pages is not deterministic from the code.

---

## 5. Proxy / IP Rotation Strategy

**Summary:** Two-tier proxy system. The playwright microservice uses a **single static proxy** (configured via env vars). Fire-engine manages its own proxy pool internally (closed-source). The `mobileProxy` flag in fire-engine requests selects a "stealth" mobile IP vs. "basic" datacenter IP.

**Evidence:**

**Playwright microservice (`apps/playwright-service-ts/api.ts`):**
```ts
// Single proxy server configured at startup, never rotated per-request
if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
  contextOptions.proxy = { server: PROXY_SERVER, username: PROXY_USERNAME, password: PROXY_PASSWORD };
}
```

**Fetch engine (`apps/api/src/scraper/scrapeURL/engines/utils/safeFetch.ts`):**
```ts
// Single proxy via PROXY_SERVER env var
const baseAgent = config.PROXY_SERVER
  ? new undici.ProxyAgent({ uri: ..., token: ... })
  : new undici.Agent({});
```

**Fire-engine path:**
- `mobileProxy: meta.featureFlags.has("stealthProxy")` — boolean flag, fire-engine selects the IP type
- `geolocation: meta.options.location` — country/language targeting passed through
- `proxyUsed` field in response is either `"basic"` or `"stealth"`, indicating which IP tier was used
- No per-request rotation in open-source code; rotation is managed by fire-engine internally

**User-facing geolocation:** `location: { country, languages }` is passed directly to fire-engine and playwright. No city-level granularity in the API.

---

## 6. Static Fetch vs. Headless Browser Decision

**Summary:** Firecrawl uses a **quality-score waterfall** system to select engines, ordered by quality. The default engine order (high→low quality) is:

```
index (cache) → x-twitter → wikipedia → fire-engine;chrome-cdp (q=50) → playwright (q=20) → fire-engine;tlsclient (q=10) → fetch (q=5) → fire-engine;chrome-cdp;stealth (q=-2) → fire-engine(retry);chrome-cdp;stealth (q=-5) → fire-engine;tlsclient;stealth (q=-15) → pdf → document
```

**Decision mechanism (`apps/api/src/scraper/scrapeURL/engines/index.ts`):**

1. **Feature flag scoring:** Each feature flag has a priority score. Engines that support more high-priority features are preferred.
2. **Quality gate:** If any positive-quality engine qualifies, negative-quality engines are filtered out.
3. **Stealth gate:** When `stealthProxy` feature is active, non-stealth engines are filtered out.
4. **ML engine picker (`engpicker`):** An experimental background service samples domains, evaluates them with 4 engine combinations (cdp/tls × basic/stealth), uses GPT-4o-mini to judge success, computes Levenshtein similarity, and stores a verdict (`TlsClientOk` / `ChromeCdpRequired` / `Uncertain`). If `TlsClientOk`, the `tlsclient` engine is boosted by +50 quality at request time.

**Key decision rule:**
- `waitFor > 0` → adds `waitFor` feature flag → forces chrome-cdp or playwright (tlsclient doesn't support waitFor)
- `actions` specified → forces chrome-cdp (only engine that supports browser actions)
- URL returns 401/403/429 with `proxy: "auto"` → auto-upgrades to stealth path
- fire-engine signals `retryWithStealth: true` → `AddFeatureError(["stealthProxy"])` thrown → re-selects stealth engines

**Static vs. headless decision trigger:**
- No pre-check of JS-rendering need (no Readability score, no link-density check)
- First attempt is always the highest-quality engine that satisfies feature requirements
- If result is empty (`checkMarkdown.trim().length === 0`) → falls to next engine in list
- If result is 401/403/429 with `proxy: "auto"` → switches to stealth proxy
- `fastMode: true` → adds `useFastMode` feature flag → skips chrome-cdp (not supported), forces tlsclient or fetch

---

## Techniques Not in Novada (Gap Analysis)

| Technique | Firecrawl Has | Novada Status |
|---|---|---|
| TLS fingerprint client (`tlsclient` engine) | Yes — bypasses TLS-based bot detection without a browser | Unknown |
| Per-domain ML engine optimizer (engpicker) | Yes — background GPT-4o-mini + Levenshtein similarity scoring per domain | No |
| Engine quality waterfall with auto-escalation | Yes — 9 engines, automatic fallback on empty content or 4xx | Partial (has render escalation) |
| `mobileProxy` flag (mobile IP vs. datacenter IP) | Yes — single boolean, fire-engine selects tier | Yes (novada has mobile proxy type) |
| `check_selector` CSS wait in playwright | Yes — waits for specific DOM element before extracting | Unknown |
| Content-type based engine routing (PDF, DOCX, JSON) | Yes — `specialtyHandler.ts` + `AddFeatureError` | Unknown |
| `disableSmartWaitCache` parameter | Implied — fire-engine has internal smart wait with cache | Unknown |
| `persistent storage` / browser profile persistence | Yes — SHA256 team+profile hash, reuses browser session | No |
| Ad-blocking in playwright (hardcoded domain list) | Yes — 11 ad-serving domains aborted | Unknown |
| CAPTCHA solver (any type) | No — purely IP reputation based | Novada also doesn't appear to have one |
| `user-agents` npm rotation (playwright) | Yes — random UA per context | Unknown |
| Amazon-specific scraping logic | No — no special handling | No |

---

## Key Code Files Examined

- `apps/playwright-service-ts/api.ts` — playwright microservice, waitFor implementation, UA rotation, proxy config
- `apps/api/src/scraper/scrapeURL/engines/index.ts` — engine quality/feature scoring, buildFallbackList, shouldUseIndex
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/index.ts` — stealthProxy, waitFor→action transform, mobileProxy flag
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/scrape.ts` — FireEngineScrapeRequest types, retryWithStealth signal
- `apps/api/src/scraper/scrapeURL/engines/fetch/index.ts` — fetch engine, single static proxy via undici
- `apps/api/src/scraper/scrapeURL/index.ts` — main orchestration loop, stealthProxy auto-escalation on 4xx
- `apps/api/src/scraper/scrapeURL/lib/urlSpecificParams.ts` — per-domain engine overrides (only digikey, lorealparis)
- `apps/api/src/scraper/WebScraper/utils/engine-forcing.ts` — runtime FORCED_ENGINE_DOMAINS config
- `apps/api/src/scraper/scrapeURL/lib/rewriteUrl.ts` — Google Docs URL rewrites only
- `apps/api/src/lib/engpicker.ts` — ML-based per-domain engine selection (background job)
- `apps/api/src/controllers/v1/types.ts` — proxy enum (`basic|stealth|enhanced|auto`), waitFor max 60s
