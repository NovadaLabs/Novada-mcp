# Novada MCP — Changelog

All notable changes are recorded here in reverse chronological order.

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
- **TypeScript SDK**: `NovadaClient` class exported from `novada-mcp/sdk` with typed methods
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
