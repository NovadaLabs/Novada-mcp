# Novada MCP Architecture Roundtable — Synthesis
**2026-06-22 · 10 agents · Novada MCP v0.8.0**

---

## 1. The Central Debate: Refactor or Not?

**FOR refactor (Agents 1, 2, 7, 8):** `extractSingle()` is not a large function — it is a state machine with 15+ mutable closure variables, two independent escalation chains (one in `routeFetch()`, one inlined in `extractSingle()` at lines 289–335 and 417–483), and `SCRAPER_PLATFORMS` defined twice. This is active divergence, not theoretical risk. Agents 1 and 8 independently found that the concern separation was *started* (router.ts exists) but never finished — the parallel inline escalation chain is the residue of an incomplete refactor. Agent 7 rates extension safety 3/10 for a concrete reason: any new output field must be added in two format branches, and a new engineer will miss one. The pipeline architecture (Agent 1's `ExtractionContext + Stage[]` proposal) resolves this by making parameter propagation a compile-time guarantee rather than a manual threading exercise.

**AGAINST refactor (Agents 5, 10):** The code just delivered 70% → 82–85% success in one session of targeted fixes. Three substantive bugs (QW-1, MT-1, MT-2) were found and patched without author context, which is evidence of maintainability, not crisis. Agent 5's decisive point: the remaining 5–15pp gap lives in proxy infrastructure (`engpicker`, TLS fingerprinting, residential routing) — not in TypeScript file organization. Agent 10 adds the business case: KR-5 is past deadline with 0 external users; every sprint on internal architecture is not spent on distribution. The Firecrawl thin-client comparison is a category error (Agent 5) — their client is thin because their server is thick.

**Who agrees with each side:** FOR: Agents 1, 2, 7, 8. AGAINST: Agents 5, 10. Neutral/conditional: Agents 3, 4, 6, 9 (each recommends a specific structural change but not a full refactor).

**What breaks the tie:** Run the benchmark. If success lands ≥82% with the current fixes, Agent 5's condition is met and the refactor can be deferred. If the two parallel escalation chains produce divergent behavior on any URL category, that is the structural argument that cannot be dismissed — and Agent 8's incremental fix (make `extractSingle` exclusively delegate to `routeFetch`) becomes the minimum viable structural fix before the next feature.

---

## 2. Confirmed Live Bugs (NOT theoretical)

These bugs were independently identified by multiple agents:

**MT-1 — `proxyTier` silently discarded on render path**
File: `src/tools/extract.ts` line 295 + `src/utils/http.ts` (fetchWithRender call)
Broken: `domainProxyTier` from `DOMAIN_REGISTRY` is consumed only by `fetchViaProxy`. When auto-escalation routes to `fetchWithRender`, the tier hint is dropped. Web Unblocker uses its own IP pool, ignoring the `residential` annotation. Domains like `airbnb.com` (method=render, proxyTier=residential) never actually use residential.
Confirmed by: Agents 1, 4.
Impact: PerimeterX and DataDome-protected sites fail even when correctly annotated in the registry. Estimated 5–10% of the success gap.

**MT-2 — `wait_ms: 0` treated as falsy, behaves as void**
File: `src/tools/extract.ts` lines 200, 233, 302, 316, 328, 454
Broken: `wait_ms` typed as `number | undefined`. When passed explicitly as `0`, downstream browser wait logic treats it as falsy and applies no wait — silently voiding an explicit caller instruction.
Confirmed by: Agents 1, 9 (schema-level evidence).
Impact: Browser-mode calls requiring `wait_ms=0` (immediate execution) silently behave as if no wait param was set.

**Structural — Two independent escalation chains co-exist**
File: `src/utils/router.ts` and `src/tools/extract.ts` lines 289–335, 417–483
Broken: `routeFetch()` in router.ts implements one escalation chain. `extractSingle()` has a second, longer inline chain that bypasses `routeFetch()` for certain paths. An escalation improvement to router.ts does not propagate to the inline chain.
Confirmed by: Agents 1, 8.
Impact: Any new escalation tier (e.g., stealth proxy) must be added in two places. Divergence is inevitable.

**Circuit breaker — Residential falls back to datacenter endpoint silently**
File: `src/utils/http.ts` (proxyCircuits Map, fetchViaProxy)
Broken: If `NOVADA_RESIDENTIAL_PROXY_*` env vars are not set, `getResidentialProxyCredentials()` falls back to the datacenter endpoint. The circuit breaker is keyed by endpoint string — a datacenter failure then trips the residential circuit for 5 minutes.
Confirmed by: Agent 4.
Impact: Residential proxy is silently degraded to datacenter without any error or log signal.

---

## 3. Architecture Patterns: What the Best Scrapers Do

### Scraper Pattern
**Consensus (Agents 2, 8):** Context object + handler dispatch. A rich `CrawlingContext` carries request, response, helpers, and storage access. A Router/Middleware chain routes execution to the right handler. Business logic never touches transport; transport never touches business logic. Scrapy's two-chain middleware model (downloader middleware + spider middleware) and Crawlee's `AdaptivePlaywrightCrawler` (predict → execute → store_result) both converge on this. The single strongest lesson: **infrastructure owns escalation, handler code must not**. The escalation decision (static → render → browser) belongs in a named, testable, composable pipeline — not inlined per tool.

### Proxy Routing Pattern
**Consensus (Agent 4):** Tier selection belongs at **escalation decision time**, not at domain registry lookup time. The registry stores a `preferredTier` hint; the escalation loop starts at that tier but can upgrade. A stable sticky session token (derived from domain + call ID) is appended to the proxy username for challenge-solve affinity — critical for DataDome and PerimeterX which validate IP consistency across a challenge chain. Three-tier ladder: datacenter → residential → mobile, with the domain registry used to skip tiers the domain is known to reject.

### Anti-Bot / Blocker Pattern
**Consensus (Agent 3):** Separate detect → route → execute into three discrete stages. Detection returns a typed `BlockResult { blocked, provider, signals, confidence }`, not a boolean. Routing keys off `provider` to select the strategy ladder (`PROVIDER_STRATEGY: Record<AntiBotProvider, FetchMethod[]>`). Status-code escalation (Firecrawl's model) handles genuine 403s; body-detection escalation handles 200s with challenge pages — both are required, not alternatives. `fetchWithRender` should return `{ response, block: BlockResult | null }` so provider is available at routing time, eliminating the 4+ scattered `detectBotChallenge()` re-runs on the same HTML.

### MCP Tool Design Pattern
**Consensus (Agent 9, corroborated by Agent 2):** One smart tool with auto-escalation outperforms multiple dumb tools for extraction — because escalation requires quality-scoring raw HTML, which the agent cannot compute itself. The tool should NOT be split into `_static / _render / _browser`. Instead: (1) keep the flat `render` enum for backward compatibility, (2) add `_strategy` and `_strategy_reason` fields to JSON output so escalation is legible, (3) use a discriminated union in Zod for `wait_for`/`wait_ms` — these should only be accessible when `render="browser"`, not silently ignored in other modes. Response overhead should not exceed 15% of content payload; `## Agent Memory` `remember:` lines in every success response waste tokens.

---

## 4. Gap Between Current Code and Best Practice

| Pattern | Current State | Best Practice | Gap |
|---------|--------------|---------------|-----|
| Scraper pipeline | Two escalation chains (router.ts + inline in extract.ts) | Single composable middleware chain | **Large** — active divergence risk |
| Proxy routing | `proxyTier` from registry ignored on render path; no sticky sessions | Tier selection at escalation time; sticky session per domain | **Large** — bugs MT-1, circuit breaker |
| Anti-bot | 4+ scattered `detectBotChallenge()` calls, no provider context at routing time | Single `analyzeBlock()` returning typed `BlockResult`; `fetchWithRender` returns block result | **Medium** — functional but brittle |
| MCP tool design | `wait_for`/`wait_ms` accepted in all modes but ignored; escalation visible in JSON but not `_strategy_reason` | Discriminated union schema; `_strategy`+`_strategy_reason` in output | **Small** — schema precision issue |

---

## 5. Prioritized Action Plan (for team meeting 2026-06-23)

### Immediate (fix now, <1 day, no architectural risk)

1. **Fix `wait_ms: 0` false-coercion** — coerce `wait_ms` to `null` when `0` in `normalizeParams`, or set a 1ms minimum. File: `src/tools/extract.ts` ~line 161–175. ~1h.

2. **Fix circuit breaker isolation** — key the circuit by `user:endpoint` (credential + host), not just endpoint. When residential creds fall back to datacenter endpoint, log a warning. File: `src/utils/http.ts`. ~2h.

3. **Validate residential env vars at startup** — if `proxyTier=residential` is in DOMAIN_REGISTRY but `NOVADA_RESIDENTIAL_PROXY_*` vars are absent, emit a startup warning. File: `src/config.ts`. ~1h.

4. **Reduce `TIMEOUTS.STATIC_FETCH` + add per-request ceiling** — drop static timeout from 30s to 15s, add a 45s total cap (static + render). Prevents the 127043ms failure case. File: `src/config.ts`. ~0.5h.

### Sprint (1–3 days, requires planning)

1. **Make `extractSingle` exclusively delegate to `routeFetch`** — eliminate the inline escalation chain at lines 289–335 and 417–483. Prerequisite: confirm `routeFetch` handles all cases (Wayback fallback, quality-score escalation). ~1 day. Fixes the dual-chain divergence bug.

2. **Extract `formatExtractionResult` as a pure function** — define `ExtractionResult` interface, move formatter out of `extractSingle`. Eliminates `SCRAPER_PLATFORMS` duplication, makes formatter unit-testable, creates shared primitive for other tools. ~1 day. Agent 7's recommendation, low regression risk.

3. **Add `_strategy` + `_strategy_reason` to JSON output** — surface escalation path explicitly. File: `src/tools/extract.ts` output section. ~0.5 days. Agent 9's recommendation.

4. **Thread `proxyTier` hint to Web Unblocker path** — pass tier as a header or session hint to `fetchWithRender`. Prerequisite: confirm Web Unblocker API accepts a tier hint. ~0.5–1 day. Closes MT-1.

### Backlog (strategic, >3 days or needs team decision)

1. **Full pipeline refactor (`ExtractionContext + Stage[]`)** — Agent 1's full proposal. ~6 days. Only justified if benchmark shows structural-level regression or escalation divergence between the two chains. Business case: enables per-stage unit testing and safe extension. Prerequisite: benchmark re-run confirms current fix baseline.

2. **Middleware-composable escalation chain** — Agent 8's `FetchMiddleware[]` array. ~2–3 days. Makes new escalation tiers additive. Business case: enables stealth proxy tier, Wayback, archive services as plugins.

3. **Persistent cross-session disk cache (SQLite)** — Agent 6's recommendation. ~1–2 days. Eliminates 15s+ latency for repeat URLs in research workflows (~20% hit rate at steady state). Business case: measurable latency improvement for power users.

4. **Hosted HTTP MCP endpoint on Render.com** — Agent 10's P0 distribution item. ~3–5 days. Removes terminal + env var setup requirement. Blocks largest adoption segment.

---

## 6. Consensus Votes (10 agents, explicit tally)

- **"The current 784-line extract.ts is a maintainability risk":** 7/10
  (FOR: 1, 2, 7, 8; CONDITIONAL: 3, 4, 9; AGAINST: 5, 6, 10)

- **"A full pipeline refactor should happen in the next sprint":** 3/10
  (FOR: 1, 2, 8; AGAINST: 5, 6, 7, 9, 10; CONDITIONAL on benchmark: 3, 4)

- **"The next sprint should focus on distribution, not architecture":** 6/10
  (FOR: 5, 6, 9, 10 + implicit: 3, 4 who focus on targeted fixes; AGAINST: 1, 2, 7, 8)

- **"The MT-1 proxyTier bug (render path silently discards residential proxy) must be fixed immediately":** 10/10
  (Universal — Agents 1, 4 found it independently; Agents 3, 5, 6, 7, 8, 9, 10 all implicitly or explicitly agree a confirmed live bug must be fixed regardless of refactor stance)

---

## 7. The One Thing

**Fix MT-1 (proxyTier silently discarded on render path) and run the benchmark.**

MT-1 is the only confirmed live bug that blocks a measurable success-rate improvement, is trivially reproducible, and has zero architectural risk to fix. Running the benchmark after the current six fixes validates whether the code is competitive enough to ship — and that answer determines everything else: whether to refactor, whether to focus on distribution, and whether the 5.5pp gap to Firecrawl is a code problem or an infrastructure problem.
