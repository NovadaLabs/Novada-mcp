# Novada MCP — Changelog

All notable changes are recorded here in reverse chronological order.

---

## [0.9.28] — 2026-07-14

Behavior telemetry with radical transparency: the hosted gateway now records usage metadata — and discloses exactly what, in-band.

### Added
- **Usage telemetry (hosted gateway only).** One event per tool call: tool name, parameter NAMES (never values), outcome code, latency, plan, quota state, client info from the handshake, serving region. For URL-taking tools, the target HOSTNAME only — never the path, query string, port, credentials, or fragment. Search queries are not collected at all. Emitted after the response (zero added latency), fail-open (telemetry can never fail a request), and disabled entirely unless configured.
- **`novada://privacy` resource** — the full field-by-field disclosure of what is and is not logged, readable in-band by any agent. `novada_setup` now points to it. The local npm server (`npx novada-mcp`) sends no telemetry; the disclosure says so.
- Aggregated, k-anonymized (≥3 distinct customers) weekly domain-demand statistics power tool/parser prioritization — individual customer targets are never identifiable.

## [0.9.27] — 2026-07-14

Truthfulness release: every state the server reports about itself now equals reality — or says `unknown`. No interface changes; no new required parameters.

### Fixed
- **`server_version` frozen at 0.9.3.** `novada_setup`/`novada_discover` reported a stale constant while the real server ran 0.9.26. All version surfaces now read ONE canonical source and always equal `serverInfo.version` — enforced by a deploy-gate contract test, so it can never silently drift again.
- **Lying-zero prices (`novada_scrape`).** `initial_price: 0` / `buybox_prices.final_price: 0` / `unit_price: ""` while a real price existed in the same record → unknown values are now `null`, and buybox `final_price` is reconciled from the record's trustworthy price when derivable. Genuine prices are untouched.
- **Error 11006 disambiguated.** One upstream code meant both "unknown operation id" and "product not activated". Now: `unknown_operation` (rejected before dispatch, free, valid operations listed) vs `not_activated` (points to dashboard activation).
- **Ghost resource.** Tool descriptions told agents to read `novada://scraper-platforms`, but hosted `resources/read` returned -32601. The hosted server now implements the full MCP resources capability (5 resources); unknown URIs return proper JSON-RPC errors.

### Added
- **A truthful status line on every hosted response:** free plan "N/1000 free calls remaining", paid accounts "uncapped (paid account)", meta tools "free call — no quota consumed". Cost is reported as explicitly `unknown` (no per-call billing signal exists upstream) — never a fabricated number.
- **`novada_health` `probe:true`** — performs ONE real minimal render through your key (billed, and disclosed as such) and reports the observed result. Default health output now states clearly it reflects entitlement status only, not live render capability.
- **Response-level warnings for silent no-ops:** `country` on `novada_browser` and `novada_proxy type=isp` is accepted but not applied — responses now say so instead of letting agents assume geo-routing happened.
- **Deploy-gate contract test** (`hosted-server/scripts/contract/`): 6 report-vs-reality invariants (version agreement, no silent no-op, no lying zero, advertised capability resolves, cost visibility, health truth) run on every deploy; drift fails the deploy before customers see it.

---

## [0.9.26] — 2026-07-13

Hosted gateway: paying accounts are no longer blocked by the free monthly cap (P0), and meta tools now work in every state.

### Fixed
- **Paid-tier cap exemption (P0, hosted).** The hosted gateway's 1000 calls/month free cap blocked every caller once exhausted — including paying customers whose calls bill their own Novada balance. The gateway now resolves account standing lazily at the cap boundary: accounts with real payment history (any successful order where `pay_money − coupon_money > 0`) or a positive balance pass beyond the cap; trial/coupon-only accounts remain capped. Zero checks and zero added latency below the cap; plan cached in KV (pro 30d / free 6h), dual-keyed by token hash and account uid so multi-key accounts share one resolution; fail-safe defaults to prior behavior if the upstream lookup is unavailable.
- **Meta tools never blocked (hosted).** `novada_discover`, `novada_account` (and its aliases), and `novada_setup` no longer consume quota and keep working even when a key is over the cap — a blocked user can always self-diagnose. Previously even `novada_discover` returned the cap error.
- **Cap error message tells the truth.** It now states the actual block condition (no payment history and no remaining balance) and the fastest unblock path: a top-up takes effect on the next call (live balance check); purchase-history classification applies within ~6 hours. Previously it claimed the cap was "independent of your Novada balance," which is no longer true.
- Stale "5000 calls/month free" copy corrected to 1000 in `DIRECTORIES.md` (both occurrences).

### Changed
- Hosted cap enforcement extracted to a pure, unit-testable module (`_plan.ts`: `classifyPlanFromUsageRecord`, `enforceGatewayCap`); 42 new tests (hosted suite now 52). npm package tool code unchanged — this release aligns versions with the hosted deploy.

---

## [0.9.25] — 2026-07-13

Scraper catalog rebuilt from a single verified source (16 platforms / 88 operations, each live-tested), a scrape format-routing bug fixed, geo-targeted extraction, and sharper agent guidance for depth and cost.

### Added
- **`novada_extract` `country` parameter.** Pass `country="de"` (ISO 3166-1 alpha-2) to route a render/unblocker fetch through an exit IP in that country — for localized pricing, geo-restricted content, and per-country monitoring (e.g. comparing a product price across European countries). Live-verified: `de` → German exit IP, `us` → US exit IP. Render-only (no effect on a pure static fetch); in batch mode the same country applies to all URLs.
- **`novada_discover` `platform` parameter.** A free call — `novada_discover({platform:"amazon.com"})` returns that platform's operations, required params, format, and status, so an agent can find the exact `scraper_id` without guessing (a wrong guess is a billed failure).
- **Single-source scraper catalog** (`src/data/scraper_catalog.ts`): 16 platforms / 88 operations, each with slug, param schema, wire format, and live-verified status — the authoritative source the tool descriptions, resource, and preflight all derive from.

### Fixed
- **`novada_scrape` format routing (bug).** Format (flat params vs `scraper_params` JSON) is now decided per-operation, not per-platform. This fixes 6 Google operations (Maps details ×4, comment, shopping) that previously failed through the MCP because they were sent flat params but require the JSON format.
- **Known-broken operations are now flagged on every failure path**, not only on success — 8 operations with confirmed backend issues (3 Amazon global-product, 3 SHEIN products, 2 ChatGPT) surface a clear "known backend issue (verified 2026-07-13)" note instead of a bare timeout.
- **`novada_extract` no longer suggests a backend-broken scrape operation** in its upgrade hints.

### Changed
- **Honest platform accounting:** the tool surface now states 16 implemented platforms / 88 operations (the dashboard lists ~107, but 91 are pre-registered shells with no backend and return 11006 — documented in the `novada://scraper-platforms` resource).
- **Agent guidance (skills):** `novada_search` returns snippets only — the skill now requires escalating to `novada_extract` (read the page) or `novada_research` (reads full sources) before answering an accuracy- or recency-sensitive question, with an explicit `search → extract → research` ladder. Cost guidance added: one `novada_research` call beats N manual search+extract; transient errors are auto-retried server-side, so do not manually re-fire (avoids double-charging).
- New `novada-proxy` and `novada-site-copy` skills; `novada-agent` skill corrected (23 tools; `bing` removed from the advertised search engines — it is not in the supported set).

### Known issues (backend — reported to Novada)
- 8 operations fail backend-side (see above); the download endpoint rate-limits (429) under rapid polling; `novada_browser`'s `country` param is accepted but not yet geo-routed (honest warning shown).

---

## [0.9.24] — 2026-07-10

`mcp.novada.com` is now a bare API endpoint (matching Bright Data / Firecrawl / Tavily), plus a quota-fairness fix and clearer price-field documentation.

### Changed
- **`mcp.novada.com` stripped to a pure MCP endpoint.** Removed the marketing mini-site (index/faq/pricing/tools/playground/chat/configure pages) that previously lived alongside the API — every path other than `/mcp` and `/:key/mcp` now returns a bare JSON pointer (`{name, endpoint, documentation_url}`) or a clean 404, matching how comparable MCP/API providers structure their endpoint subdomain. The marketing content's future home is `novada.com` (tracked separately — out of scope for this repo).

### Fixed
- **Hosted free-gateway quota is no longer charged on a degraded `novada_account` response.** When `novada_account` (and its composed sub-tools: wallet balance, usage, plans, traffic, capture logs, summary, health) gracefully degrades due to an upstream Novada API hiccup, the call is now refunded instead of silently consuming the customer's monthly quota for a response that didn't contain real data.
- **`novada_scrape` price-field reliability documented.** The tool description and `novada://scraper-platforms` resource now explain which Amazon price fields are trustworthy (`final_price`/`price`, check `_price_source`) versus frequently-zero-by-design (`initial_price`, `buybox_prices.final_price`) versus raw/unreliable upstream data (`buybox_prices.unit_price`) — previously this precedence only existed in code comments, invisible to callers.

---

## [0.9.23] — 2026-07-10

Static-ISP account reporting fixed to match how the product is actually billed, plus real upstream token verification on the hosted endpoint (with a KV cache to keep it fast).

### Fixed
- **Static-ISP no longer reports a bare 404.** `novada_account section="plans"` and `section="traffic"` were calling the flow-metered balance/traffic endpoints (`static_flow/balance`, `static_flow/consume_log`) for the static-ISP product — endpoints that structurally do not apply, since static-ISP is billed per-IP (open/renew/list), not by traffic volume. `plans` now reports static via `static_house/list` (active IP count, region breakdown); `traffic` now returns `applicable: false` with an explanation instead of a raw 404.
- **`traffic_daily` all-failed false positive:** requesting `products:["static"]` alone previously reported `all_failed: true` even though nothing failed, because the selected-product count was miscounted after static was removed from the flow fan-out. Fixed.

### Security (hosted)
- **`validateToken` now performs real upstream verification** against Novada's API instead of a format-only check (≥16 alphanumeric chars). Root cause: a misconfigured MCP connector was accepted with a token belonging to a different Novada account, and nothing flagged it because the server never confirmed the key was real. An explicit upstream rejection now returns 401 immediately, before any tool dispatch. A timeout or network error does not reject (fails open to the prior behavior) so hosted availability isn't coupled to upstream latency.
- **Verification result is cached (Vercel KV, 90s TTL, hashed key)** so this adds a real network call only on a token's first use per cache window — not on every single tool call. Failure/timeout outcomes are never cached.

---

## [0.9.22] — 2026-07-09

Caller-key billing fix (P0) — customers now consume against their own Novada API key on the hosted endpoint, never a fallback server key — plus an extract confidence-gate fix and a hosted timeout increase.

### Fixed
- **Caller-key billing (P0):** the hosted endpoint no longer falls back to a server-side `NOVADA_API_KEY` when a caller's token is absent — `stripServerConsumptionCreds()` deletes all server consumption credentials from the process environment at cold start, so there is no fallback target. A missing or invalid token now returns 401 and points to novada.com; every billable call is charged against the caller's own key.
- **`novada_extract` `fields` confidence gate:** the proximity-based field extractor could return a low-confidence value (e.g. picking a stray number out of unrelated prose) without flagging it. Extraction now applies a confidence floor — sub-floor values are returned as `value: null` with `low_confidence: true` and the original guess preserved as `low_confidence_value`, and are excluded from the extraction-quality count.
- **`novada_ip_whitelist` apiKey forwarding:** the tool now forwards the caller's own API key to the whitelist dispatch instead of relying on server defaults.
- **Hosted 56s wall-clock cap raised to 300s** (Vercel `maxDuration` 60→300) to reduce timeouts on slower operations; scrape tool guidance updated to recommend narrower params / `render=static` / the local server for still-slow jobs.

---

## [0.9.21] — 2026-07-08

Agent-first simplification: the visible tool surface was reduced from 33 to 23 tools derived from a single registry source, with all hidden tools still dispatchable. Accompanied by a honesty pass across engine lists, account card content, and param docs, plus live-caught card field fixes (TOW2-256).

### Changed
- **Surface consolidation (33 → 23 tools):** visible tools now derive from a single registry; 6 proxy variant tools and 4 scraper stub tools are hidden from the default surface but remain fully dispatchable via `NOVADA_TOOLS`. Eliminates routing confusion and duplicate discovery entries.
- **`novada_verify` restored to visible set:** owner decision — kept accessible on the default surface.
- **`agent_instruction` scope tightened:** only the 5 universal API-key errors carry `agent_instruction`; business-logic errors no longer emit it.

### Fixed
- **Account card live-caught:** usage card date/amount fields corrected to match the real API response shape; `plans[].expires_at` now populated instead of "—".
- **Bing removed from search engines:** `novada_search` no longer advertises Bing as an option; removed from every surface that still listed it (degraded backend, returns zero results).
- **`novada_account` honesty:** no invented currency in the account card; dead `mode` param removed.
- **`task_id` resume + browser snapshot documented:** `task_id` resume path and browser aria_snapshot usage documented in tool descriptions.
- **Date-param aliases:** `start_time`/`end_time` aliased consistently across account tools.
- **Dead `unblock.ts` removed** (had been accidentally resurrected; deleted again alongside its test).

### Docs
- Customer-facing README updated to reflect 23-tool surface; `novada_verify` re-added to catalog.

---

## [0.9.20] — 2026-07-07

Proxy account list clean-up and account identity line (TOW2-251, TOW2-252).

### Fixed
- **`novada_proxy_account_list` pure projection:** response no longer includes a lying `*_balance:0` blob from the raw API; only the intended fields are surfaced.
- **Account identity line:** the account card now shows which API key is in use (masked `...last4`) and the as-of timestamp, so agents can confirm they are operating under the right credential.
- **`apiKey` forwarding aligned:** `proxy_account_list` and `proxy_account_create` now forward the caller's `apiKey` to the developer API, consistent with all sibling tools.

---

## [0.9.19] — 2026-07-07

One-time first-run notice (TOW2-242).

### Added
- **First-run notice:** new users see a one-time message on first tool invocation — "$10 free credits at novada.com" — shown exactly once per install, then suppressed.

---

## [0.9.18] — 2026-07-07

Diagnostic fix campaign across scrape, account, and search tools (TOW2-236~241).

### Fixed
- **`novada_scrape` Amazon price:** real listing price now surfaced from product variations (was returning 0 when the main price field was absent); `unit_price` is no longer promoted to listing price.
- **`novada_scrape` availability:** `is_available` and `availability` fields reconciled — previously inconsistent across response shapes; negative availability strings handled correctly.
- **`novada_scrape` subcategory rank pollution:** `subcategory_rank` entries that leaked ASIN or BSR data into the field are filtered out; product `description` cleaned of trailing noise.
- **`novada_account` polymorphic balance:** the account card no longer renders "—" for plan balances on mobile or other non-standard balance shapes; balance field is resolved across all polymorphic response variants.
- **`novada_search` dangling feedback instruction:** `novada_search` no longer emits a trailing `novada_search_feedback` `agent_instruction` when the feedback tool is unreachable, preventing phantom tool calls.
- **Yahoo removed:** Yahoo is unsupported — removed from engine enum, schemas, docs, and all surfaces that still listed it.
- **P3 polish:** snippet whitespace and deduplication, extract Chrome UA, field separator consistency.

---

## [0.9.17] — 2026-07-05

Purity/consistency release: a 3-round "claim vs reality" audit (~20 review agents) aligned every agent-facing description, count, and example with what the code actually does. No behavior change except two additive group-key aliases.

### Fixed
- **`?groups=` portability:** the scrape tool-group key was `scraper` on npm but `scrape` on hosted — an agent carrying its `NOVADA_GROUPS` config across surfaces silently got zero scrape tools. Both keys now work on both surfaces.
- **Platform truth:** `novada_scrape` claims corrected from "129 platforms" to the real **13 platforms (~78 operations)**; removed phantom platforms (Reddit/Glassdoor/Zillow/Airbnb) from server.json, manifests, README, and the hosted playground preset (which errored 11006 on click).
- **Engine truth:** Yahoo is not supported — removed from every surface that still advertised it (registry/discover, hosted tools/list, resources, prompts, website EN+中文); `novada_search` = 4 engines (Google, Bing, DuckDuckGo, Yandex).
- **README/SKILL examples:** fabricated scrape operation-ids replaced with real `PLATFORM_OPERATIONS` keys (each verified); `select_paths` examples fixed to glob arrays (were regex strings that fail).
- **Error-path honesty:** dead `novada_health_all()` recovery hints → `novada_account(section="summary")`; transient failures no longer misreported as permanent "not activated"; proxy success-path no longer echoes real username bytes; scrape 401/403 split.
- **Description sync:** research returns extractive cited source material (not a synthesized report); extract `format=html` cap documented as 100K (was "10K"); scrape lists all 6 accepted formats and notes json is wrapper-fenced; `novada_monitor` on hosted carries a session-scoped caveat; browser/proxy `country` documented as accepted-but-not-applied.
- **Site/billing copy:** removed fictional pricing claims; quota message now points to balance top-up; tool counts unified (hosted 15 / npm 22).

> Note: 0.9.4–0.9.16 entries are being backfilled; see git history in the interim.

---

## [0.9.3] — 2026-07-03

P0 "one API key, everywhere" + agent-first correctness pass (Loop 1→2→3: audit → adversarial test → fix → review), shipped to npm + hosted. A single `NOVADA_API_KEY` now unlocks Search, Scraper, Extract, Web Unblocker, and (locally) Browser — including on the hosted `mcp.novada.com` endpoint, where the caller's key is now threaded to every product instead of falling back to the server account.

### Fixed
- **Health probe false-negative (P0):** the Web Unblocker health probe sent `js_render:false`, which the backend answers with `code=5001` ("Internal Server Error"), mislabeling an *active* Web Unblocker as "not_activated". Proven by isolation test: same key, `js_render:false`→`5001`, `js_render:true`→`code=0` with data (encoding irrelevant). Probe now sends `js_render:true`, and only `code=5001` maps to "not_activated" (any other non-zero code surfaces as a real error). Fixes `novada_health` + `novada_health_all` (both the Extract/Web-Unblocker and Unblock rows); the proxy probe uses the auto-fetch-aware resolver.
- **Unified key on the hosted endpoint (P0):** Web Unblocker / Proxy / Browser now use the caller's per-request `NOVADA_API_KEY` (threaded via `getWebUnblockerKey`→`store.apiKey`, `resolveProxyCredentials(apiKey)`, `resolveBrowserWs(apiKey)`) instead of falling back to the server's env key; hosted dispatch is wrapped in `withCredentials({apiKey})` so store-reading resolvers see the caller key. Credential caches are now keyed by an API-key fingerprint (tenant-safe). Reconciled the duplicate `getWebUnblockerKey`. **Breaking:** a non-real / format-only token no longer silently rides the server credential — pass a real Novada API key.
- **Browser mode on serverless (P0):** `render="browser"` (and `auto` escalation) now fails fast with a clear, actionable error on the hosted (Vercel) endpoint instead of a raw Playwright `connectOverCDP` `AuthorizationError`; `auto` falls back to the Web Unblocker tier.
- **Stale-version shadow (P0):** all documented client configs now pin `novada-mcp@latest`, so a globally-installed old build can no longer silently shadow `npx`. Added a "staying on the latest version" troubleshooting note + a no-global-install convention.
- **Dead scraper-status route:** removed the `api-m.novada.com/v1/scraper/{task_id}` GET fallback (returned HTTP 404) and the now-orphaned `SCRAPER_STATUS_BASE` / `SCRAPERAPI_BASE` constants. A `not_found` for a just-submitted task now carries a propagation-aware retry hint instead of a definitive give-up.
- **Structured errors:** `novada_setup` / `novada_session_stats` no longer dump raw ZodError JSON on invalid params.

### Changed
- **Tool descriptions & routing (agent-first "right prompt → right tool"):** corrected `novada_scrape` formats (dropped `csv`/`html`/`xlsx` the schema rejects; documented `toon`); `novada_scraper_submit` no longer claims "any URL" (it is platform + operation only); `novada_ai_monitor` clarified as a domain-filtered web search (not a direct model query); `novada_discover` category legend corrected; `novada_verify` wording aligned. Sharpened "Best for / Not for" to disambiguate `extract` vs `unblock` vs `scrape` and `search` vs `research` vs `map` vs `crawl` vs `site_copy`.
- **Three previously-unwired tools are now usable:** `novada_scraper_task_mgmt`, `novada_static_ip_mgmt`, `novada_capture_apikey` were implemented but never registered — now wired into the tool surface (account group). `novada_capture_apikey` masks the returned key (`****last4`); the two management tools gate writes behind `confirm:true`.
- `novada_setup` env table now lists `NOVADA_WEB_UNBLOCKER_KEY` and notes a single `NOVADA_API_KEY` already covers it.

### Security
- Input hardening on the newly-wired management tools: regex/length constraints on task ids, region, IP list, and keyword params (untrusted-input rule).

---

## [0.9.2] — 2026-07-03

Round 3 Fix & Verify revamp — **shipped to npm + hosted on 2026-07-03**. Also: NOV-682 — over-long search queries are now truncated at a word boundary (with a `query_truncated` marker in all response paths) instead of throwing.

### Fixed
- **36 defects** across `crawl` (glob + dedup), `discover` (category gating), `extract` (credential redaction + `urls` alias + block-page detection), `fields` (description quality), `map` (sitemap honesty), `research` (synthesis), `search` (sentinel + time_range + JSON), `verify` (stance mitigation) — each independently verified and reviewed. Detail: Linear NOV-680.
- `monitor` improvements shipped as **preview** — deepest stable-hash layer pending an architecture decision (hash extract's structured `content`, not a parsed markdown blob).

### Process
- Internal test workflow: test repo reduced to `main` + `staging`; auto-mirror hook scoped; gated `promote-to-public.sh` release script. Detail: Linear NOV-684 / NOV-688.

---

## [0.9.1] — 2026-07-02

Availability, config-accuracy, and safety fixes (NOV-673/674 follow-up), plus a customer-docs consistency pass.

### Fixed
- **`novada_search` default-engine `-32001`**: two submit timeouts hard-coded to `60000` now use `TIMEOUTS.SEARCH_TOTAL_CEILING`, so the default engine no longer times out under the transport ceiling.
- **`novada_search` cache correctness**: cache key now includes `country` + `language` — geo/locale variants no longer collide on a shared cached result.
- **`novada_search` no-task_id path**: a raw `throw new Error(rawJSON)` is now `makeNovadaError(API_DOWN, …)`, so failures surface as a classified error carrying `agent_instruction`.
- **`novada_browser_flow` SSRF guard**: replaced a hand-rolled host regex with the shared `isBlockedHost` allowlist used elsewhere, closing a bypass gap.

### Changed
- **Error / health / setup wording**: dashboard link `dashboard.novada.com/overview/` (403) → `/api-key/` (200); `novada_health` not-activated line reworded with a real activation URL; `novada_setup` "Status: Ready" softened to avoid over-claiming.

### Docs
- Removed the non-existent `/sse` hosted route from every client guide (it 404s) — hosted auth is a **Bearer header or `?token=` on the same `/mcp` endpoint**.
- Version pins aligned to the published release; tool count corrected to **38** across all pages; `novada_unblock` documented as ungrouped (select via `NOVADA_TOOLS`).

---

## [0.9.0] — 2026-07-01

Consolidation release. Merges the red-team hardening campaign into a single version and supersedes the 0.8.5–0.8.10 line (NOV-578 series), which shipped to npm without individual changelog entries.

### Security / data-leak (Taxonomy B — NOV-674)
- **Path + PII redaction**: `/Users/…` and `/home/…` in any error/output → `[local-path]` (single-boundary `redactSecrets`).
- **Proxy username masking**: masked across url/env/curl formats × `novada_proxy` / `novada_proxy_static` / `novada_proxy_dedicated`; zone-suffixed usernames in error text → `[proxy-username]`; usage examples use a `<PROXY_USER>` placeholder.
- **Auth classification**: developer-API codes 401 / 11000 / 10002 → `INVALID_API_KEY` (failure_class=auth, retry_recommended=false) instead of a misleading not_found / invalid_params.
- **Input caps at the schema boundary**: query ≤ 500 chars, research question ≤ 2000, scraper payload ≤ 60 KB — rejected synchronously before any HTTP call.
- **`novada_unblock` timeout ceiling**: `Math.min(timeout, 120_000)` + `Promise.race` guard — no more transport `-32001`.
- **`novada_verify` injection rejection**: CRLF / null-byte / `javascript:` claims rejected; HTML sanitized so no false `supported` verdict.

### Schema-contract integrity (Taxonomy A — NOV-673)
- **`required[]` correctness**: defaulted params no longer appear in JSON-Schema `required[]` across ~25 tools (root-caused to Zod v4 `toJSONSchema()` verbatim passthrough).
- Removed false `additionalProperties:false`; removed `outputSchema` where no `structuredContent` was returned (fixes `-32600`); `idempotentHint:false` on `novada_monitor` / `novada_verify`.
- Global ZodError handler now emits `agent_instruction`.
- Deleted dead `mode` / `limit` crawl aliases (undocumented, no backend support).

### Fixed (NOV-662–666)
- outputSchema/structuredContent contract on search/extract/map/verify.
- `novada_scraper_status` / `novada_scraper_result`: propagation-aware `not_found` (checks task existence on the primary `!downloadUrl` branch + code 10000).

### Improved (NOV-668–672)
- **Kufer/webbasys availability**: detects CSS-sprite course status (skips `<a>` link text; keys on a recognized status keyword) — no more false "available" on `ausgebucht` courses.
- **German label-value tables**: 50-entry `GERMAN_LABEL_MAP` wired into infobox + label-value row extraction (Beginn/Status/Anmeldeschluss/…); table cell cap 200, `<dl>` cap 80.
- Batch `novada_extract` returns a compact inline summary; `truncatePreservingTable` keeps bottom-of-page tables intact; contextual `agent_instruction`.

### Fixed (FIX-5)
- `novada_health` / `novada_health_all`: env vars set-but-unprobed now render **"configured (not verified)"** (`configured_unverified` status) instead of a misleading **"active"**. Env-absent still shows "not configured".

### Process
- Fix / verify / orchestrator separation (never self-verify); 50 Sonnet-4.6 red-team agents → 165 findings → 2 taxonomies; 3 fix groups × 3 independent live-verify groups with real credentials.

---

## [0.8.4] — 2026-04-25 (pending review)

### Added
- **`novada://scraper-platforms` MCP resource**: Full catalog of 129 supported scraper platforms with operation IDs and required params. Agents can now discover which platform/operation to use without reading external docs. Covers 10 categories: e-commerce, search engines, social media, jobs, real estate, finance, reviews, tech, travel, news.
- **Browser action `aria_snapshot`**: Returns Playwright's accessibility tree as YAML — semantic role+name refs, ~70% smaller than raw HTML, stable selectors. Uses `page.ariaSnapshot()` (Playwright v1.46+ API). Better than `snapshot` for element discovery.
- **MCP Prompt `scrape_platform_data`**: Slash command guiding agents through platform/operation discovery → novada_scrape call → Error 11006 fallback workflow.
- **MCP Prompt `browser_stateful_workflow`**: Slash command guiding agents through aria_snapshot-first browser automation with session_id state management.

### Improved
- **`novada_browser` description**: Removed stale "no state persists" text (wrong since v0.8.2 added sessions). Now documents `session_id` usage, session TTL, and all available actions.
- **`novada_scrape` description**: References `novada://scraper-platforms` resource instead of external docs URL.
- **`novada_unblock` description**: Clarified distinction from `novada_extract(render="render")` — unblock returns raw HTML, extract returns cleaned text.
- **`novada://guide` resource**: Added Failure Recovery Patterns (4 scenarios with exact next steps) and Token Efficiency Tips (5 patterns for reducing token usage).
- **`operation` field in ScrapeParamsSchema**: Expanded from 3 to 8 example operation IDs, references `novada://scraper-platforms` resource.
- **`snapshot` action**: Added tip comment pointing to `aria_snapshot` as the preferred alternative.

### Tests
- 439 passing (was 366 in v0.8.3, +73 new tests)
- New: 2 aria_snapshot tests (`tests/tools/browser.test.ts`)
- New: 40 prompt tests (`tests/prompts/index.test.ts`) — all 5 prompts, optional args, error handling
- New: 31 resource tests (`tests/resources/index.test.ts`) — all 4 resources, content verification

---

## [0.8.3] — 2026-04-24

### Added
- **`novada_health` tool** (11th tool): instantly shows which Novada products are active on your API key. Runs parallel probes for Search, Web Unblocker, Scraper API, Proxy, and Browser API. Returns a markdown status table with activation links for anything not yet enabled — great for first-time setup and debugging.
- **Browser action `hover`**: hover over a CSS selector (triggers CSS hover states, dropdown menus, tooltips).
- **Browser action `press_key`**: press a keyboard key (Enter, Tab, Escape, ArrowDown, Space, etc.). Optional `selector` focuses an element first.
- **Browser action `select`**: select a value from a `<select>` dropdown by value or label text.

### Fixed
- **Scraper API error 11006 message**: replaced dead-end "Contact support@novada.com" with a direct self-serve activation link — `dashboard.novada.com/overview/scraper/` — so users can unblock themselves without waiting for support.

### Tests
- 366 passing (was 351 in v0.8.2, +15 new tests)
- New: 11 health tool tests (`tests/tools/health.test.ts`) — probes, masking, Next Steps section
- New: 4 browser action tests for hover, press\_key (with/without selector), select

---

## [0.8.2] — 2026-04-24

### Added
- **PDF extraction**: `novada_extract` now handles PDF URLs transparently — detects `Content-Type: application/pdf` and `.pdf` extension, extracts plain text + page count via pdf-parse. No new tool needed; works the same as HTML extraction.
- **Persistent browser sessions**: `novada_browser` now accepts a `session_id` parameter — reuse the same browser page (cookies, localStorage, login state) across multiple calls.
- **New browser actions**: `close_session` (explicitly release a named session) and `list_sessions` (see all active session IDs).
- **Session TTL**: Browser sessions expire after 10 minutes of inactivity with automatic cleanup on next access.
- **Claude plugin manifest**: `claude-plugin.json` created (local only, in .gitignore).
- **Token efficiency documentation**: `docs/TOKEN_EFFICIENCY.md` with benchmark table vs Bright Data (local only).
- **Quick Install section**: README.md now includes a Quick Install section for Claude Code.
- **PDF size cap**: PDFs larger than 10 MB are rejected with a helpful error message.

### Fixed
- **PDF detection in all fetch modes**: `extractSingle` previously only detected PDFs via `routeFetch`. Now also detects PDFs directly when `render="render"` or `render="static"` modes call `fetchWithRender`/`fetchViaProxy` directly.
- **PDF escalation guard**: Added `!html.startsWith("pdf_pages:")` guard to prevent unnecessary JS rendering escalation when PDF content is already extracted.
- **Browser mock missing `close` method**: `tests/tools/browser.test.ts` mock page now includes `close: vi.fn()` required by session cleanup.

### Tests
- 351 passing (was 326 in v0.8.1, +25 new tests)
- New: `tests/utils/pdf.test.ts` (13 tests — `isPdfResponse`, `extractPdf` size guard, mock-based text/metadata extraction)
- New: 8 session management tests in `tests/utils/browser.test.ts`
- New: 4 session tool tests in `tests/tools/browser.test.ts`

---

## [0.8.0] 2026-04-23

**10-tool MCP — full capability release.** Upgrades v0.6.7 (5 tools) to v0.8.0 (10 tools + smart routing + quality extraction).

### New Tools
- `novada_scrape` — structured data from 129 platforms via Scraper API
- `novada_proxy` — proxy connection strings (url/env/curl)
- `novada_verify` — fact-checking via multi-source search + evidence synthesis
- `novada_unblock` — forced JS render via Web Unblocker or Browser API CDP
- `novada_browser` — cloud browser automation via CDP (up to 20 chained actions)

### Smart Routing & Performance
- **Auto-escalation chain** — static → render → browser, with bot-challenge detection at each step
- **Race fetch** — Scraper API and direct fetch race in parallel; 866ms → 108ms latency
- **Domain registry** — 70-entry pre-routing table; known JS-heavy sites skip the static probe entirely
- **Session circuit breaker** — proxy availability cached per session

### Content Quality
- Content limit raised 8,000 → 25,000 chars with paragraph-boundary truncation
- Inline links (`[text](url)`), bold/italic/code preserved in markdown output
- Density scoring (simplified Mozilla Readability) for main content selection
- JSON-LD / schema.org structured data extraction (Product, Article, Event, Person, etc.)
- Bot challenge detection — Cloudflare, Akamai, Imperva signal coverage
- Extraction quality score 0–100 exposed as `quality:N` in metadata

### Field-Targeted Extraction
- `fields` param on `novada_extract` — `["price", "author", "rating"]` → `## Requested Fields` block
- Source priority: JSON-LD → regex patterns → key:value scan → not_found

### Tests
- 258 passing (was 66 in v0.5.0). Full unit coverage across all 10 tools + utilities.

### Known Blockers (account-level)
- `novada_search`, `novada_research`, `novada_verify`: SERP backend needs activation
- `novada_scrape`: Error 11006 — Scraper API product not yet activated on this account

---

## [1.1.0] 2026-04-23

### Added
- **Domain registry** (`src/utils/domains.ts`) — 70-entry lookup table mapping known domains to optimal fetch method (static/render/browser). Eliminates auto-detection probe for known sites. `lookupDomain(url)` checks exact match → www-stripped → subdomain fallback.
  - Static: github.com, wikipedia.org, stackoverflow.com, news.ycombinator.com, docs.python.org, npmjs.com, arxiv.org, 20+ news/blog domains
  - Render: amazon.* (all regions), twitter/x.com, youtube.com, linkedin.com, tiktok.com, walmart.com, bestbuy.com, airbnb.com, imdb.com, 20+ e-commerce domains
  - Browser: booking.com, glassdoor.com, ticketmaster.com, stubhub.com (fingerprinting-heavy)
- **Integrated into `novada_extract`** — when `render: "auto"`, registry entry is used as `effectiveMode`. Known render/browser domains skip the static probe entirely.
- **Field-targeted extraction** (`src/utils/fields.ts`) — `fields` param on `novada_extract`. Pass `["price", "author", "rating"]`, get `## Requested Fields` block in output.
  - Source priority: JSON-LD structured data → regex pattern matching → generic `key: value` scan → not_found
  - Built-in patterns: price (5 currency formats), date, author ("By X"), rating (X/5, X stars), availability (in/out of stock)
  - Each result tagged with source: `*(from schema)*`, `*(pattern)*`, or `—` for not found
- **`fields` added to `ExtractParamsSchema`** (`src/tools/types.ts`) — optional, max 20 fields

### Tests
- 258 passing (was 240). +18: domains (10), fields (8).

---

## [1.0.1] 2026-04-23

### Performance
- **Race proxy+direct** (`src/utils/http.ts`) — `fetchViaProxy` now starts Scraper API and direct fetch simultaneously. Saves ~400ms per call when Scraper API returns 404. Session circuit breaker caches result. Benchmark: 866ms → 108ms.

### Content Quality
- **Content limit** — `extractMainContent` raised from 8,000 → 25,000 chars. Paragraph-boundary truncation replaces mid-sentence cut.
- **Inline links** — `<a href>` now rendered as `[text](url)` in markdown body. Wikipedia: 0 → 165 inline links.
- **Bold/italic** — `<strong>/<b>` → `**text**`, `<em>/<i>` → `*italic*`, `<code>` → backtick inline.
- **Boilerplate removal** — table-layout nav selectors + `td[bgcolor]` cell removal. HN nav leak fixed.
- **`extractMainContent` accepts `baseUrl`** — inline links resolve to absolute URLs.

### Added — Content Intelligence
- **Density scoring** (`scoreCandidateElement`) — simplified Mozilla Readability algorithm in Cheerio. Scores `div/section/article/main` by `text_len × (1 - link_density) + heading_bonus + para_bonus`. Used as fallback when CSS selectors miss.
- **JSON-LD extraction** (`extractStructuredData`) — parses `<script type="application/ld+json">`. Supports Product (price, brand, rating, availability), Article/NewsArticle (headline, author, datePublished), Event, Person, Organization, WebPage. Priority-ordered by schema type.
- **Bot challenge detection** (`detectBotChallenge`) — Cloudflare (just a moment, cf-browser-verification, __cf_chl_opt), Akamai (_abck, bm_sz), Imperva (incap_ses), heuristic signals (tiny body + blank title). Auto-escalates to browser in `novada_extract`.
- **Extraction quality score** (`scoreExtraction`) — 0–100 per extraction. Factors: structured data (+30), content length, link density, headings, code blocks, render mode, bot challenge penalty. Exposed as `quality:N` in metadata line.
- **Structured data block** — `## Structured Data` section prepended to extract output when JSON-LD found.

### Tests
- 240 passing (was 222). +18 new: JSON-LD (7), density scoring (2), bot challenge (6), quality score (3).

---

## [1.0.0] 2026-04-23

### Added — Full 10-tool MCP
Merged `feature/full-capability-sdk`. Upgraded from v0.7.0 (5 tools) to v1.0.0 (10 tools).

**New tools:**
- `novada_scrape` — structured data from 129 platforms via Scraper API. Outputs: markdown/json/csv/html/xlsx.
- `novada_proxy` — proxy connection strings in url/env/curl format. Country, city, session_id targeting.
- `novada_verify` — fact-checking via multi-source search + evidence synthesis.
- `novada_unblock` — forced JS render via Web Unblocker or Browser API CDP. 50K char truncation.
- `novada_browser` — cloud browser automation via CDP (Playwright). Up to 20 chained actions: navigate, click, type, screenshot, snapshot, evaluate, wait, scroll.

**Smart routing** (`src/utils/router.ts`): static → render → browser auto-escalation. Cost metadata: low/medium/high per call.

**SDK export** (`src/sdk/index.ts`): `NovadaClient` class with typed methods for all 10 tools.

### Known Blockers (account-level, not code bugs)
- `novada_search`, `novada_research`, `novada_verify`: `scraper.novada.com/search` returns 404 — backend needs sync search endpoint.
- `novada_scrape`: Error 11006 — Scraper API product not activated on this account.

### Functional Test Results (47 real API calls, 2026-04-23)
| Tool | Pass Rate | Notes |
|------|-----------|-------|
| novada_extract | 4/5 (80%) | JSON rejection correct |
| novada_crawl | 4/4 (100%) | |
| novada_map | 5/5 (100%) | |
| novada_proxy | 6/6 (100%) | |
| novada_unblock | 4/4 (100%) | Steam+Amazon bypassed; Booking.com needs browser |
| novada_browser | 4/4 (100%) | CDP healthy, 5.6–9.2s/session |
| novada_search | 0/5 | SERP backend blocked |
| novada_research | 0/4 | Depends on search |
| novada_verify | 0/5 | Depends on search |
| novada_scrape | 0/4 | Account activation needed |

---

## [0.6.7] — 2026-04-20

### Added
- **Smart routing** in `novada_extract` and `novada_crawl`: auto-escalates from static → render (Web Unblocker) → Browser API when JS-heavy content detected
- **`novada_proxy` tool** (6th tool): returns proxy credentials in `url`, `env`, or `curl` format for use in HTTP clients
- **Browser API** via `playwright-core`: set `NOVADA_BROWSER_WS=wss://...` to enable full CDP-controlled browser rendering
- **Research source extraction**: `novada_research` now fetches top 3 sources in full — not just snippets
- **TypeScript SDK**: `NovadaClient` class exported from `novada-search/sdk` with typed methods
- **`render` param** on `novada_extract` and `novada_crawl`: `auto` (default), `static`, `render`, `browser`
- **Multi-credential support**: `NOVADA_BROWSER_WS`, `NOVADA_PROXY_USER/PASS/ENDPOINT` env vars
- **nova CLI**: `proxy` subcommand + `--render` flag on extract/crawl

### Fixed
- `novada_extract` / `novada_crawl` now detect and handle JS-heavy sites (Cloudflare, SPAs, React apps) instead of silently returning empty shells
- `novada_research` now returns actual source content, not just URL snippets

### Changed
- All tool descriptions updated for agent-optimal clarity (problem-first, not product-first)

## [0.6.0] - 2026-04-10

### Added
- **novada_map** tool — fast URL discovery via BFS crawl without content extraction. Filter results by search term.
- **Zod validation** — all tool parameters validated with Zod schemas. Clear error messages for invalid inputs.
- **cheerio HTML parsing** — replaced regex-based HTML extraction with cheerio for reliable content extraction from complex pages.
- **Structured error classification** — errors categorized as INVALID_API_KEY, RATE_LIMITED, URL_UNREACHABLE, API_DOWN with retry guidance.
- **Rich tool descriptions** — each tool now includes "Best for", "Not recommended for", "Common mistakes", usage examples, and return descriptions.
- **cleanParams utility** — removes empty values before API calls.
- **extractLinks function** — cheerio-based link extraction with deduplication and relative URL resolution.
- **CHANGELOG.md** and **.env.example** files.
- 51 new tests (117 total, up from 66).
- **Tool function tests** — mocked axios tests for novadaSearch, novadaExtract, novadaResearch covering success, error, and edge case paths.
- **URL scheme validation** — only HTTP/HTTPS URLs accepted. Blocks file://, ftp://, localhost, and RFC 1918 private IP ranges (SSRF protection).
- **Input schemas generated from Zod** — tool inputSchema now auto-generated via zod-to-json-schema, eliminating schema drift.
- **Failure reporting** — research tool now reports failed search count in output.

### Changed
- Tool descriptions rewritten to follow Firecrawl pattern with agent guidance.
- Validation errors now return Zod's structured error messages instead of generic strings.
- HTML content extraction now handles tables, blockquotes, and code blocks correctly.
- Error responses include error code, retry guidance, and documentation URL.
- SIGINT handler for graceful shutdown.
- Proxy fallback now logs a warning when falling back to direct fetch.
- HTML content selector threshold raised from 100 to 200 chars (reduces false matches).
- HTML truncation for `format: "html"` now cuts at tag boundaries instead of mid-tag.
- Relative URL resolution now uses `new URL(href, base)` for all path types.

### Fixed
- **SECURITY**: Upgraded axios to >= 1.15.0 to patch critical SSRF vulnerability (GHSA-3p68-rc4w-qgx5).
- **SECURITY**: API keys stripped from all error messages via `sanitizeMessage()` — prevents credential leaks in error responses.
- **SECURITY**: Proxy 401/403 errors no longer silently swallowed — auth failures are now re-thrown instead of falling back to direct fetch.
- HTML parser no longer fails on deeply nested divs or encoded entities.
- Link extraction now handles relative URLs and protocol-relative URLs (`//`) correctly.
- Table cell content no longer duplicated in markdown output.
- Map tool seed URL now normalized in dedup set (prevents duplicate seed in output).
- Map and crawl tools now filter discovered links through `isContentLink` (skip assets, auth pages).
- cleanParams utility now actually wired into search tool (was previously dead code).

## [0.5.0] - 2026-03-29

### Added
- Initial release with novada_search, novada_extract, novada_crawl, novada_research tools.
- Proxy infrastructure integration (100M+ IPs, 195 countries).
- Multi-engine search (Google, Bing, DuckDuckGo, Yahoo, Yandex).
- BFS/DFS crawling with concurrent page fetching.
- Exponential backoff retry logic.
- 66 unit tests.
