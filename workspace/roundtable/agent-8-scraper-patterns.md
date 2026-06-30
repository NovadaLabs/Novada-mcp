# Agent 8 — Scraper Architecture Patterns Research

**Role:** Scraper Architecture Patterns Researcher
**Sources:** Crawlee (JS + Python), Scrapy 2.16, puppeteer-cluster, Bright Data / Zyte competitive analysis, Novada MCP source

---

## 1. The Request Router Pattern (Crawlee/Apify) vs. Novada's Current Approach

Crawlee's Request Router decouples *what URL to fetch* from *how to handle the response*. Every crawled URL carries a label (`product`, `listing`, `pagination`). The router dispatches each response to the registered handler for that label — a typed, named function with a defined contract. The URL queue, the fetch mechanism, and the parse logic are three separate, independently swappable concerns.

Novada's `extractSingle()` in `src/tools/extract.ts` fuses all three. A 784-line function ingests a URL, decides fetch strategy inline via a long if/else chain, executes the fetch, and then parses and formats the result in the same call stack. The `routeFetch()` function in `src/utils/router.ts` is a partial extraction of the strategy concern, but it is still called directly inside `extractSingle()` — the pipeline is not composed, it is nested.

The practical gap: when you add a new extraction type (e.g., audio extraction, structured JSON scraping), you must modify `extractSingle()`. In Crawlee, you add a new handler. The router pattern makes extension additive; Novada's current design makes it surgical.

---

## 2. The Middleware Stack Pattern (Scrapy) and Novada's Escalation Chain

Scrapy's architecture is the canonical middleware stack for scrapers. The Engine dispatches Requests through a chain of Downloader Middlewares (proxy injection, cookie management, retry logic, cache check) before reaching the Downloader. Responses pass back through the same chain (decompression, charset normalization, bot-challenge detection) before reaching the Spider. Each middleware has a single, composable responsibility and can short-circuit the chain by returning a Response directly.

Novada's static → render → browser escalation in `routeFetch()` is already structured as a chain, but the decision logic is embedded in try/catch blocks rather than middleware functions. The key difference: in Scrapy, adding a new middleware (e.g., a Wayback fallback) is a one-file change with a priority integer to set its position. In Novada, the Wayback fallback in `extractSingle()` (lines 487-514) is a hardcoded block after the escalation chain — written separately from the `routeFetch()` router, with duplicated detection logic.

The middleware pattern would let the escalation chain read: `[StaticFetch, RenderFetch, BrowserFetch, WaybackFallback]` — each as a discrete class with a `canHandle(url)` and `execute(url)` interface — composable and testable in isolation.

---

## 3. The Four-Concern Separation: Does `extractSingle()` Violate It?

Enterprise scrapers separate: (a) URL queue, (b) fetch strategy, (c) content extraction, (d) storage. Crawlee's architecture enforces this with four distinct component types: `RequestQueue`, `Crawler` (fetch strategy), `Spider handler` (parse/extract), and `Dataset`/`KeyValueStore` (storage).

`extractSingle()` violates this: it owns (b) fetch strategy selection, (c) content extraction (markdown formatting, field extraction, structured data parsing, PDF handling), and implicitly (d) by building and returning the full formatted output in one return value. The URL queue concern is absent because Novada is a synchronous MCP tool, not a crawler — that is architecturally valid for the use case. But the merger of (b) and (c) is a genuine violation.

Evidence: the `routeFetch()` refactor in `router.ts` was an attempt to carve out concern (b), but `extractSingle()` still contains a second, parallel escalation chain (lines 289-335 and 417-483) that bypasses `routeFetch()` entirely. Two escalation implementations now co-exist: the one in `router.ts` and the one inline in `extractSingle()`. This is the signature of an incomplete separation — the cut was started but not finished.

---

## 4. Per-Domain Strategy Selection: Registry vs. ML vs. Trial-and-Error

Three patterns exist in the industry:

**Hardcoded Registry (Novada current):** `DOMAIN_REGISTRY` in `src/utils/domains.ts` maps 80+ known domains to `{ method, provider, proxyTier }`. Fast, zero runtime cost, predictable. Bright Data uses an equivalent internal model — they call it "automatic parameter selection" and it is the core of their Web Unlocker. ScrapingDog's dedicated endpoints (`/amazon/product`, `/google/search`) are the public-facing manifestation of the same idea: a curated domain-strategy map maintained by engineers.

**Trial-and-error with learning (Apify Actor pattern):** The Adaptive Playwright Crawler in Crawlee attempts HTTP first, measures success, escalates to browser if needed, and can persist which strategy worked per domain across sessions. This is trial-and-error with memory. Bright Data's description of their system ("automatically selects proxy type, browser fingerprint, retry strategy based on target domain") implies a learned registry that is updated from aggregated success signals.

**ML-based selection:** Not publicly documented by any major provider. Zyte (formerly Scrapinghub) has published research on AutoExtract, but strategy selection remains heuristic/registry-based in all published architectures.

Novada's registry is the right pattern for a synchronous MCP tool. The gap is that the registry only covers ~80 known domains; unknown domains fall through to the auto-detection chain. The registry should also track per-domain quality signal over time (even in-process) to improve routing on unknown domains across a session.

---

## 5. Bright Data / Zyte Architecture: What Is Published

Bright Data's Web Scraper API architecture (per competitive analysis data): a unified endpoint routes each request through a domain-strategy selector, which chooses proxy type (residential/datacenter/ISP), sets browser fingerprint profile, and configures retry policy. The result is delivered as clean HTML, JSON, or markdown. The selector is a maintained internal registry, not ML inference — their published claim is "automatically selects," but the mechanism is a curated rule set updated by their engineering team based on aggregated success rates.

Zyte's SmartProxy (formerly Crawlera) uses a tiered model: HTTP → JS rendering → browser, with proxy pool selection per domain. Their public documentation describes a "fingerprint rotation" layer that sits between the proxy and the target, generating browser-like TLS signatures even for static HTTP requests. This is the curl-impersonate equivalent at enterprise scale.

The key architectural insight from both: **the proxy layer and the rendering layer are orthogonal.** Bright Data explicitly decouples "which IP to use" from "how to render." Novada's `proxyTier` field in `DomainEntry` handles this correctly at the data model level, but the rendering-proxy separation is not reflected in the tool API surface — `novada_extract` exposes `render` but not `proxy_tier`.

---

## 6. Top 3 Patterns Novada MCP Should Adopt, Ranked by ROI

### 1. Complete the Concern Separation: Merge the Two Escalation Chains (High ROI, Low Effort)

`extractSingle()` contains an escalation chain that duplicates `routeFetch()`. The immediate action is to make `extractSingle()` exclusively delegate to `routeFetch()` for all fetch/escalation decisions, then use the returned `RouteResult.html` for parsing. The Wayback fallback becomes a post-fetch middleware, not a hardcoded block. This eliminates a class of divergence bugs where escalation behavior differs between the two code paths.

ROI: Fixes a latent correctness bug with ~1 day of refactoring. No API changes required.

### 2. Middleware-Composable Escalation Chain (Medium ROI, Medium Effort)

Replace the try/catch escalation ladder in `routeFetch()` with a `FetchMiddleware[]` array. Each middleware implements `canHandle(url, prevResult?)` and `execute(url, options)`. The router iterates: try middleware[0], on failure or bot-challenge, try middleware[1], and so on. New strategies (Wayback, cached archive services, domain-specific headers) become additive — no changes to the core loop.

ROI: Enables future extension without touching escalation logic. ~2-3 days. Makes per-domain strategy pluggable via config rather than code.

### 3. Session-Level Domain Learning (Medium ROI, Low Effort)

The domain registry is static. Add a lightweight in-memory map (already partially started with `session-cache.ts`) that records which mode succeeded for unknown domains during a session. On the second request to the same unknown domain, skip the auto-detection chain and use the cached mode. This is the Adaptive Playwright Crawler pattern applied to Novada's synchronous context — no ML, just trial-and-error memory within a session.

ROI: Eliminates redundant escalation cost for repeated domain hits in the same session (common in research workflows). ~0.5 days. No external dependencies.

---

## Summary Assessment

Novada MCP's `routeFetch()` function demonstrates correct architectural instinct — the escalation chain is already closer to a middleware stack than most scraper implementations at this size. The critical gap is that `extractSingle()` has grown a parallel, more complex version of the same logic without being refactored to use `routeFetch()` as its sole fetch delegation point. The domain registry is industry-standard and correctly structured. The two highest-leverage moves are: (1) complete the router/extractor separation that was already started, and (2) make the middleware chain composable so new escalation strategies do not require touching the core loop.
