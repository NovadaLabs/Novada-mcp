# Agent 2 — OSS Researcher: Scraper Framework Architecture Patterns

*Roundtable: Novada MCP Code Architecture Review*
*Sources: Scrapy 2.16 docs, Crawlee Python docs, Anthropic Engineering blog (Sep 2025), AWS Prescriptive Guidance on MCP*

---

## 1. What Architecture Patterns Do Successful Scraper Frameworks Use?

Three frameworks, one shared skeleton:

**Scrapy** (Python, ~50k GitHub stars) builds around a named-stage pipeline: `Engine → Scheduler → Downloader → [Downloader Middlewares] → Spider → [Spider Middlewares] → Item Pipeline`. Every stage is a discrete, swappable component. Crucially, there are *two* middleware chains: one around the downloader (handles request/response at the HTTP layer) and one around the spider (handles parsed output). The Engine is pure orchestration — it holds no business logic. Source: [docs.scrapy.org/en/latest/topics/architecture.html](https://docs.scrapy.org/en/latest/topics/architecture.html)

**Crawlee** (TypeScript + Python, Apify) offers a tiered crawler hierarchy: `BasicCrawler → AbstractHttpCrawler → {BeautifulSoupCrawler, ParselCrawler, HttpCrawler}` and a separate `PlaywrightCrawler`, with `AdaptivePlaywrightCrawler` bridging the two tiers. The `Router` class is the user-facing dispatch mechanism — URL labels map to typed handler functions. Each handler receives a strongly-typed `CrawlingContext` object that exposes only the methods relevant to that crawler tier. Source: [crawlee.dev/python/docs/guides/architecture-overview](https://crawlee.dev/python/docs/guides/architecture-overview)

**Playwright** (Microsoft) structures its API around `Browser → BrowserContext → Page`, each level adding isolated state. Test fixtures compose additional behavior at each scope level.

**The common thread:** every successful scraper framework converges on *context objects* + *handler dispatch*. A rich context object carries the request, response, helper methods, and storage access. A dispatch layer (router/middleware) routes execution to the right handler for the current content type or page type. Business logic never touches transport. Transport never touches business logic.

---

## 2. The Handler Chain / Middleware Pipeline Pattern

The middleware pipeline is the "chain of responsibility" design pattern applied to HTTP request/response flow. Each middleware in the chain:

1. Receives the request (or response)
2. Optionally transforms it
3. Either passes it to the next middleware **or** short-circuits the chain

In Scrapy, each `DownloaderMiddleware` implements `process_request(request, spider)` and `process_response(response, request, spider)`. The framework iterates the middleware stack in order on the way down and in reverse order on the way up — exactly like HTTP middleware in Express or Koa. A middleware can return a `Response` directly to skip the actual network fetch (used for caching, mocking, proxy injection).

**Why scrapers converge on it:** Web scraping has a clear sequential structure — you must fetch before you parse, parse before you extract, extract before you store. But each step has cross-cutting concerns (retries, proxy rotation, deduplication, rate limiting) that would pollute business logic if inlined. Middleware externalizes these concerns. Each middleware is independently testable, independently replaceable. Scrapy ships 16 built-in downloader middlewares (retry, redirect, cookies, robots.txt, user-agent rotation) that compose without touching the spider.

The pattern also enables progressive enhancement: a `static → render → browser` escalation is just a middleware that intercepts failed responses and retries with a different fetcher. The spider sees only a clean `Response` and never knows which layer handled it.

---

## 3. How Crawlee Handles the static → render → browser Escalation

Crawlee's answer is `AdaptivePlaywrightCrawler`. It composes two sub-crawlers (an HTTP crawler + `PlaywrightCrawler`) and delegates to a `RenderingTypePredictor` interface to decide which sub-crawler runs for each URL.

The predictor implements:
- `predict(request) → RenderingTypePrediction` — returns `"static"` or `"client only"` plus a `detection_probability_recommendation` (0–1). When this probability is high, Crawlee runs *both* sub-crawlers and compares their output to train the predictor.
- `store_result(request, rendering_type)` — updates internal learning data after each crawl.

The context helpers (`wait_for_selector`, `query_selector_one`) are designed to be rendering-mode-agnostic: they work on static HTML in HTTP mode, and wait for the DOM in Playwright mode — the same handler code runs in both paths. Only when a static selector miss occurs does the adaptive crawler escalate to Playwright.

**What this tells us:** escalation decisions belong in infrastructure (the predictor/router), not in tool handler code. Handler code should declare what it *needs* (e.g., a certain selector present), not *how* to get it.

Source: [crawlee.dev/python/docs/guides/adaptive-playwright-crawler](https://crawlee.dev/python/docs/guides/adaptive-playwright-crawler)

---

## 4. MCP Tool Function Size and Responsibility

Anthropic's own engineering blog ("Writing effective tools for agents," Sep 11 2025) is the most authoritative source here. Key findings from their internal evaluation work:

**On tool granularity:** "More tools don't always lead to better outcomes. A common error we've observed is tools that merely wrap existing software functionality or API endpoints — whether or not the tools are appropriate for agents." An agent's context window is limited; too many granular tools dilutes attention and causes incorrect tool selection. Too few forces agents to guess.

**On namespacing:** Tools should be grouped with a clear prefix that defines the boundary of functionality (e.g., `novada_extract`, `novada_search`, `novada_scrape`). The namespace is the signal — the agent uses the prefix to reason about which family of tools applies before reading individual descriptions.

**On tool response design:** "Every tool response is an opportunity to prompt the model." Tool responses should include `agent_instruction` fields with next-step guidance. The model has no persistent memory of API flow; each response must re-orient it. This is not nice-to-have — it measurably improves multi-step task completion.

**On token efficiency:** Large responses that agents cannot use degrade performance. Truncation with explicit guidance ("pass max_chars=16000 to get more") is better than silent truncation. The Anthropic team found that adding `agent_instruction` fields to responses reduced redundant tool calls.

**On single responsibility:** One tool should solve one *agent task*, not one *API endpoint*. A `novada_extract` that handles single URL, batch URL, PDF, JSON, and escalation modes is correct by this standard — because from the agent's perspective it answers one question: "get me content from this URL."

Source: [anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

AWS Prescriptive Guidance on MCP (2025) states: "The granularity of your tools, whether they map to individual API calls or complete workflows, directly impacts the total number of tools that agents need... Strike a balance: too few tools → agent guesses; too many tools → agent confuses tool selection."

---

## 5. The #1 Lesson OSS Scraper Frameworks Offer Novada MCP

**Infrastructure owns escalation. Tool code must not.**

In every mature scraper framework, the decision of *how* to fetch a page — static HTTP, rendered JS, full browser CDP — is made by infrastructure, not by the handler. The Scrapy downloader middleware intercepts and retries. The Crawlee `AdaptivePlaywrightCrawler` predicts and routes. The handler receives a clean, ready-to-use context regardless of which layer fetched it.

Novada MCP's `novada_extract` (`src/tools/extract.ts`, lines 289–319) already implements this correctly in its internal escalation ladder: `auto → static race → render → browser`. The current implementation detects `detectJsHeavyContent()`, `detectBotChallenge()`, queries `isBrowserConfigured()`, and escalates across three tiers before the result surfaces. This logic lives inside the tool function — not in a separate middleware layer — which means it is not reusable across `novada_unblock`, `novada_crawl`, or `novada_scrape`.

**The OSS lesson:** extract the escalation decision into a shared `FetchPipeline` or `AdaptiveFetcher` class, with the same `predict → execute → store_result` pattern Crawlee uses. Any tool that needs "give me content from a URL" calls the pipeline. The pipeline decides tier. No tool reimplements escalation.

This is the single change that would bring Novada MCP's architecture closest to Scrapy/Crawlee maturity: a named, testable, composable fetch pipeline that all content tools delegate to — not inlined `if/else` escalation chains duplicated per tool.

---

## Source Index

1. Scrapy 2.16.0 Architecture Overview — https://docs.scrapy.org/en/latest/topics/architecture.html
2. Crawlee Python Architecture Overview — https://crawlee.dev/python/docs/guides/architecture-overview
3. Crawlee Python Request Router — https://crawlee.dev/python/docs/guides/request-router
4. Crawlee Python Adaptive Playwright Crawler — https://crawlee.dev/python/docs/guides/adaptive-playwright-crawler
5. Anthropic Engineering: "Writing effective tools for agents" (Sep 11, 2025) — https://www.anthropic.com/engineering/writing-tools-for-agents
6. AWS Prescriptive Guidance: MCP Tool Design Strategy — https://docs.aws.amazon.com/prescriptive-guidance/latest/mcp-strategies/mcp-tool-strategy.html
7. Novada MCP source — `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` (lines 155–319, escalation implementation)
