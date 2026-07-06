# Round 5 — Final Synthesis

**Date:** 2026-06-22
**Loop:** 5 rounds complete (OSS analysis → gap analysis → code → review → synthesis)

---

## Baseline Benchmark (Pre-Loop)

| Provider | Success | P50 Latency | Amazon | Anti-Bot | JS SPA | Static |
|----------|---------|-------------|--------|----------|--------|--------|
| **Novada** | 70% | 8,053ms | 40% | 60% | 80% | 100% |
| Firecrawl | 100% | 1,631ms | 100% | 100% | 100% | 100% |
| Tavily | 80% | 481ms | 40% | 80% | 100% | 100% |

Source: `benchmark/results/2026-06-22-benchmark-report.md` — 60 requests, 30s timeout per request, 5 URLs × 4 categories × 3 providers.

**Cost context:** Novada at $1.00/1k requests is 4× cheaper than Firecrawl ($4.00) and 5× cheaper than Tavily ($5.00). Even closing a 30-point success-rate gap leaves Novada as the cost-dominant option for high-volume agent workloads.

---

## What We Learned (Competitive Intelligence)

### Firecrawl

1. **Quality-score waterfall with 9 engines** — Firecrawl uses a feature-flag scoring system where each engine gets a quality score (positive = preferred, negative = stealth fallback only). Auto-escalation on empty content or 4xx is explicit and deterministic. Novada's escalation is simpler but covers the same logic surface.

2. **TLS fingerprint impersonation via `tlsclient`** — The closed-source `fire-engine` impersonates browser TLS handshakes without a real browser. This lets Firecrawl bypass TLS-based bot detection at much lower latency than CDP. Novada's Web Unblocker may implement this internally, but it is not exposed as a distinct rendering mode.

3. **`mobileProxy` flag for IP tier selection** — A single boolean in the `stealthProxy` feature flag routes requests through mobile residential IPs instead of datacenter IPs. This is the primary mechanism behind Firecrawl's Amazon success. The open-source code has no domain-specific routing — IP tier is entirely determined by the `stealthProxy` flag (set on 401/403/429 auto-escalation or `proxy: "stealth"` param).

4. **Per-domain ML engine optimizer (`engpicker`)** — Background GPT-4o-mini job samples domains, evaluates 4 engine × proxy combinations, stores verdicts (`TlsClientOk` / `ChromeCdpRequired` / `Uncertain`), and boosts the winning engine's quality score by +50 at request time. This is Firecrawl's long-term moat for the long tail of unknown domains.

5. **CSS selector wait in playwright** — `check_selector` parameter in their playwright microservice waits for a DOM element before capturing content. Combined with `waitAfterLoad` (fixed-ms timeout), this handles both time-based and element-based SPA rendering. The `waitFor` param is capped at 30s in fire-engine, 60s at the API level.

### Tavily

1. **Three-tier caching architecture explains latency** — Tavily's fast numbers (90–210ms for search) come from Redis (top 1% of URLs = 30% of requests) + S3 Express One Zone co-located with compute. The Extract API is always a live fetch (10–30s timeout). The 126ms P50 we see in benchmarks for static pages is index/cache hits, not universal.

2. **No independent web crawl index** — Tavily aggregates third-party search engines with a relevance reranking and caching layer. This means coverage is bounded by third-party indexing depth. Amazon ASIN-level pages, newly-published content, and private pages are structural blind spots.

3. **Amazon failure is IP-reputation structural** — Tavily's datacenter IPs are well-known to Amazon's WAF Bot Control. Without residential proxy rotation, basic HTTP fetches are blocked at the TLS handshake level on first contact. Even their advanced (headless browser) mode faces behavioral analysis that rejects high-volume datacenter ranges. Residential proxies are not part of Tavily's architecture.

4. **No domain-specific extraction logic** — Tavily returns generic markdown. No product-schema extraction, no Amazon ASIN parsing, no structured JSON output. This is a fundamental gap vs. dedicated scrapers (Oxylabs, Bright Data, Zyte) that achieve 97-98%+ on Amazon via platform-specific bypass.

5. **Chunk-based relevance reranking** — With `chunks_per_source` (1–5), Tavily returns only the top N 500-char chunks ranked by query relevance. This makes their output compact and query-relevant for agent consumption — a UX advantage Novada does not currently match for the search/extract hybrid use case.

---

## Gaps Found & Fixed (6 gaps across 8 files)

| Gap ID | Severity | Root Cause | Fix Applied | Files Changed |
|--------|----------|------------|-------------|---------------|
| QW-1 | P0 | `wait_for` CSS selector param existed in UnblockParamsSchema but was never passed through extractSingle's 6 fetchViaBrowser call sites | Added `wait_for` to ExtractParamsSchema; wired to all 6 fetchViaBrowser call sites | types.ts, extract.ts |
| QW-2 | P1 | `detectBotChallenge` missing DataDome and Amazon WAF challenge page strings; silent wrong-content "successes" | Added 5 new strings: "robot check", "enter the characters you see below", "sorry, we just need to make sure", "to discuss automated access to amazon data", "apologies, but we're having trouble saving your cookie" | http.ts |
| QW-3 | P1 | `waitForSelector` hardcoded at 5000ms in fetchViaBrowser — too short for SPAs where target elements appear at 6–15s | Changed to `Math.min(options.timeout ?? 15000, 15000)` at both session paths (lines 115, 155) | browser.ts |
| QW-4 | P1 | Render-mode results returned as-is even when HTML is suspiciously short (bot challenge pages often 800–1200 chars) | Added content-length floor check: if `html.length < 2000 && detectBotChallenge(html) && isBrowserConfigured()`, escalate to browser | extract.ts |
| MT-1 | P1 | All extract path proxy calls used a single datacenter IP tier regardless of domain — Amazon/Walmart/Target blocked at IP-reputation layer before content served | Added `proxyTier` field to DomainEntry; tagged 19 domains (all DataDome/PerimeterX/Akamai/Kasada providers) as `"residential"`; `fetchViaProxy` selects `getResidentialProxyCredentials()` when tier is residential | domains.ts, credentials.ts, http.ts, extract.ts |
| MT-2 | P1 | `wait_ms` param in UnblockParamsSchema was explicitly voided (line 15 `void wait_ms`); not wired through router.ts or browser.ts | Removed void no-op; added `wait_ms` to fetchViaBrowser options; threaded through router.ts (4 call sites) and unblock.ts | types.ts, browser.ts, router.ts, unblock.ts |

**Total: 6 gaps implemented across 8 source files.** All P0 and P1 items from the Round 2 ranking were addressed in this sprint.

---

## Round 4 Review + HIGH Fixes

The Round 4 code review found 0 CRITICAL, **2 HIGH**, 3 MEDIUM issues. Both HIGH issues were patched before synthesis:

### HIGH #1 — `waitForSelector` timeout coupling (browser.ts lines 115, 155)

**Problem:** `Math.min(options.timeout ?? 15000, 15000)` couples the selector wait to the page navigation timeout. When a caller passes a small page timeout (e.g., 5000ms), the selector wait is also capped at 5000ms — defeating the intended 15s selector cap.

**Fix applied (Round 5):** Changed both call sites to a fixed `15000` constant, decoupling selector wait from page navigation timeout entirely.

### HIGH #2 — QW-4 fires on short but legitimate render responses (extract.ts line 232)

**Problem:** The `html.length < 2000` check escalated to browser for any short render response — including legitimate short XML/HTML API responses — because there was no `detectBotChallenge()` guard.

**Fix applied (Round 5):** Condition updated to `html.length < 2000 && detectBotChallenge(html) && isBrowserConfigured()`. Browser escalation now only fires when the short response also contains known challenge page signals.

### MEDIUM issues (not addressed in this sprint)

1. `getResidentialProxyCredentials()` does not check AsyncLocalStorage for SDK multi-tenant credential injection. Datacenter tier works; residential tier is env-var only. Document limitation.
2. `domainProxyTier` is not forwarded to `fetchWithRender` (Web Unblocker call) in the render escalation path. Web Unblocker has its own proxy pool — intentional but undocumented.
3. `wait_ms` guard `&& options.wait_ms > 0` is redundant. Schema description should note the 30s vs 100s max difference between ExtractParamsSchema and UnblockParamsSchema.

---

## Expected Impact

| Fix | Category | Mechanism | Expected Impact |
|-----|----------|-----------|----------------|
| MT-1 (residential proxy tier) | Amazon (D), Anti-Bot (C) | 19 high-risk domains now route through residential IPs — bypasses IP-reputation blocks before any content is served | Amazon: 40% → ~70%; Anti-Bot: 60% → ~75% |
| QW-1 (wait_for wired) | JS SPA (B), Amazon (D) | Agents can now specify CSS selector to wait for before capture; prices/dynamic content load after initial DOM | JS SPA: 80% → ~95%; Amazon partial improvement |
| QW-2 (detectBotChallenge strings) | Amazon (D), Anti-Bot (C) | Silent wrong-content returns converted to detectable failures that trigger further escalation | Reduces false-positive successes; improves actual success rate indirectly |
| QW-3 (waitForSelector fixed timeout) | JS SPA (B) | Elements appearing at 6–15s no longer silently missed | JS SPA: further 3–5% improvement on slow SPAs |
| QW-4 + HIGH #2 fix (bot challenge guard) | All | Eliminates spurious browser escalations on short legitimate render responses | Cost reduction + latency improvement; no false escalations |
| MT-2 (wait_ms wired) | All browser-mode | Fixed-ms wait now actually forwarded to browser and Web Unblocker | Parity with Firecrawl's `waitAfterLoad`; usable for pages with no stable CSS selector |

**Aggregate expected outcome (post-loop baseline, before re-benchmark):**

| Category | Current Success | Expected Post-Fix | Primary Driver |
|----------|----------------|-------------------|----------------|
| Amazon (D) | 40% | ~65–70% | MT-1 residential proxy |
| Anti-Bot (C) | 60% | ~70–75% | MT-1 + QW-2 |
| JS SPA (B) | 80% | ~92–95% | QW-1 + QW-3 |
| Static (A) | 100% | 100% | No change |
| **Overall** | **70%** | **~82–85%** | All fixes combined |

---

## Remaining Gaps (Not In This Sprint)

| Gap | Round 2 Priority | Reason Deferred |
|-----|-----------------|-----------------|
| Persistent warm browser profiles (Gap #5) | P2 | Requires durable session store outside in-process memory; security review needed for cookie serialization |
| Amazon URL normalization via /dp/ canonical (Gap #7) | P2 | Estimated 5–10% improvement; low enough ROI to defer until residential proxy impact is measured |
| ML-based per-domain engine optimizer (Gap #8, analog to Firecrawl engpicker) | P3 | Requires background daemon + LLM calls + results store; out of scope for MCP client-side sprint |
| `fastMode` skip-render hint for known static domains (Gap #9) | P3 | Already largely handled by DOMAIN_REGISTRY static entries; marginal gap |
| SDK credential injection for residential proxy tier (Round 4 MEDIUM #1) | — | Design decision: document env-var-only limitation; add SDK field in next API surface revision |
| `domainProxyTier` forwarded to Web Unblocker path (Round 4 MEDIUM #2) | — | Web Unblocker has own proxy pool; may already handle this internally; needs empirical verification |

---

## Recommended Next Steps (Prioritized)

1. **Re-run the benchmark** with all 6 fixes applied to measure actual vs. estimated impact. Target: Amazon success ≥ 65%, overall success ≥ 80%. This closes KR-2 tracking for M-2.3 milestone. Run `benchmark/run-benchmark.ts` with `--limit 5` after setting `NOVADA_RESIDENTIAL_PROXY_*` env vars.

2. **Validate residential proxy credentials are configured in production** — MT-1 is a no-op if `NOVADA_RESIDENTIAL_PROXY_USER/PASS/ENDPOINT` are not set. `getResidentialProxyCredentials()` silently falls back to datacenter credentials. Verify env vars are present in the deployed MCP server environment before shipping.

3. **Document `wait_ms` schema difference** — `ExtractParamsSchema.wait_ms` caps at 30000ms while `UnblockParamsSchema.wait_ms` caps at 100000ms. Add a JSDoc comment to both explaining the intentional asymmetry. Prevents future agent confusion.

4. **Address Round 4 MEDIUM #1 (SDK residential credential injection)** — Current design means SDK multi-tenant users cannot inject residential credentials programmatically. Add `residentialProxyUser/Pass/Endpoint` fields to `ToolCredentials` in the next API surface revision.

5. **Plan for P2 gaps (persistent browser profiles + Amazon URL normalization)** as next sprint after benchmark re-run confirms P0/P1 improvements landed. Persistent profiles would address Akamai-protected domains (bestbuy.com, homedepot.com) which are in the DOMAIN_REGISTRY but not fully covered by residential IP alone.

---

## Loop Metadata

| Round | Agent Role | Files Changed | Issues Found |
|-------|-----------|--------------|-------------|
| 1 | OSS Analyst ×2 (Firecrawl + Tavily) | analysis only | 10 gaps identified across both competitors |
| 2 | Gap Analyst | round2-gap-analysis.md | Ranked 10 gaps P0–P3; produced QW/MT/S implementation specs |
| 3 | Code Implementation Worker | 8 source files (types.ts, extract.ts, browser.ts, http.ts, domains.ts, credentials.ts, router.ts, unblock.ts) | 6 gaps implemented; 4 issues encountered and resolved inline |
| 4 | Code Reviewer (fresh eyes) | review only (round4-code-review.md) | 0 CRITICAL, 2 HIGH, 3 MEDIUM; verdict: PASS WITH ISSUES |
| 5 | Synthesizer | round5-final-synthesis.md + Linear INC-65 | 2 HIGH fixes applied; synthesis written; comment posted |

**Total files modified across the loop:** 9 (8 source + 1 synthesis report)
**Total issues surfaced:** 10 gaps → 6 implemented → 2 HIGH review findings → both patched
**Loop duration:** Single session, 2026-06-22
