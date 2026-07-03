# Novada MCP — Changelog

All notable changes are recorded here in reverse chronological order.

---

## [Unreleased] — in testing on staging

P0 unified-key + agent-first correctness pass (Loop 1→2→3: audit → adversarial test → fix → review). Destined for **0.9.3**. Code on the `staging` branch of the internal test repo; **not yet released**. The unified-key credential-threading fix (one `NOVADA_API_KEY` unlocks Web Unblocker / Proxy / Browser on the hosted endpoint too) is held on a separate GATED branch pending a deploy decision.

### Fixed
- **Health probe false-negative (P0):** the Web Unblocker health probe sent `js_render:false`, which the backend answers with `code=5001`, mislabeling an *active* Web Unblocker as "not_activated". Probe now sends `js_render:true`, and only `code=5001` maps to "not_activated" (any other non-zero code surfaces as a real error). Fixes `novada_health` + `novada_health_all`; the proxy probe now uses the auto-fetch-aware resolver.
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
