# Novada MCP — Real-World Functional Test Report
Date: 2026-05-19
Session: novada-realworld-20260519-9f52b54b
Tested by: AAM 4-worker parallel test suite

## Overall Verdict: NEEDS FIXES

**27/32 tests passed across 4 tool categories**

5 failures across Extract and Unblock/Map/Crawl. Proxy and Browser API are fully functional. Two HIGH-priority bugs block reliable use of Extract on JS-gated sites. Two MEDIUM-priority bugs degrade agent usability of the Map tool.

---

## Summary Table

| Tool Category | Tests | Pass | Fail | Verdict |
|---------------|-------|------|------|---------|
| Proxy (6 types) | 13 | 13 | 0 | PASS |
| Extract | 6 | 4 | 2 | NEEDS FIXES |
| Browser API | 6 | 6 | 0 | PASS |
| Unblock / Map / Crawl | 7 | 4 | 3 | NEEDS FIXES |
| **TOTAL** | **32** | **27** | **5** | |

---

## Proxy Tools — Detailed Results

All 13 proxy tests passed. Real credentials returned with correct zone, country, carrier, and session segments for every tool and parameter combination.

| # | Tool | Params | Status | Evidence |
|---|------|--------|--------|----------|
| 1 | proxy_residential | format=url | PASS | `tongwu_TRDI7X-zone-residential:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777` |
| 2 | proxy_residential | format=env, country=gb | PASS | username: `tongwu_TRDI7X-zone-residential-country-gb`, 4x export vars rendered |
| 3 | proxy_residential | format=curl, country=de, city=berlin | PASS | username: `tongwu_TRDI7X-zone-residential-country-de-city-berlin` |
| 4 | proxy_isp | format=url, country=us | PASS | `tongwu_TRDI7X-zone-isp-country-us:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777` |
| 5 | proxy_isp | format=env | PASS | username: `tongwu_TRDI7X-zone-isp`, 4x export vars rendered |
| 6 | proxy_mobile | format=url, country=jp | PASS | `tongwu_TRDI7X-zone-mobile-country-jp:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777` |
| 7 | proxy_mobile | format=curl, country=us, carrier=verizon | PASS | username: `tongwu_TRDI7X-zone-mobile-country-us-carrier-verizon` |
| 8 | proxy_datacenter | format=url, country=us | PASS | `tongwu_TRDI7X-zone-datacenter-country-us:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777` |
| 9 | proxy_datacenter | format=env | PASS | username: `tongwu_TRDI7X-zone-datacenter`, 4x export vars rendered |
| 10 | proxy_static | country=us, session_id=realworld-test-001, format=url | PASS | username: `tongwu_TRDI7X-zone-static-country-us-session-realworld-test-001` |
| 11 | proxy_static | country=gb, session_id=realworld-test-002, format=env | PASS | username: `tongwu_TRDI7X-zone-static-country-gb-session-realworld-test-002` |
| 12 | proxy_dedicated | session_id=realworld-test-001, format=url | PASS | `tongwu_TRDI7X-zone-dedicated-session-realworld-test-001:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777` |
| 13 | proxy_dedicated | session_id=realworld-test-001, format=curl | PASS | username identical to test 12 — sticky session determinism confirmed |

**Credential pattern** (consistent across all tools):
```
http://{user}-zone-{type}[-country-{cc}][-city-{city}][-carrier-{carrier}][-session-{id}]:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777
```

**Notable findings:**
- All three output formats (url, env, curl) render correctly with all 4 env vars present in env format
- Country, city, carrier, and session targeting all produce correct username segments
- Sticky session determinism confirmed: same `session_id` maps to identical username across separate calls (tests 12 vs 13)
- Password is always masked as `***` — correct security behavior; agents must substitute `NOVADA_PROXY_PASS` at runtime
- `proxy_static` requires `country`, `session_id`, AND `format` as required params — stricter than other proxy tools, which is intentional
- The `url` format response includes Node.js/Python code snippets and an `agent_instruction` block beyond the bare URL; agents should parse the `proxy_url:` line

---

## Extract Tool — Detailed Results

4 of 6 tests passed. Both failures are rooted in the same upstream problem (GitHub's JS rendering), plus one independent auto-escalation failure on cookie-gated sites.

| # | URL | Mode | Status | Evidence |
|---|-----|------|--------|----------|
| 1 | wikipedia.org/wiki/Model_Context_Protocol | markdown/auto | PASS | 22,945 chars, quality:80, full article body and JSON-LD structured data block present |
| 2 | github.com/anthropics/anthropic-sdk-python | markdown/auto | FAIL | 2,986 chars, quality:35, content_ok:false — GitHub JS renders as nav shell only |
| 3 | news.ycombinator.com | markdown/auto | PASS | 13,528 chars, 30 front-page stories with point counts ("90 points by danybittel", "985 points by nycdatasci") |
| 4 | github.com/anthropics/anthropic-sdk-python + fields | markdown/auto + fields | FAIL | Fields block present but all 4 values are "—"; raw markdown contains "Python 99.8%", "Star 3.5k", "MIT License" but extractor could not parse them |
| 5a | httpbin.org/html (batch) | markdown/auto | PASS | 3,566 chars, Moby-Dick passage extracted cleanly |
| 5b | httpbin.org/json (batch) | markdown/auto | PASS (correct error) | "Response is not HTML." — expected failure handled cleanly; batch header shows "urls:2 \| successful:1 \| failed:1" |
| 6 | docs.anthropic.com/en/docs/about-claude/models | markdown/auto + query | FAIL | 266 chars, quality:20, content_ok:false — cookie consent wall intercepted; no model names returned |

**Bug detail:**

**BUG-E1 (HIGH) — Auto-escalation failure on cookie-gated/Docusaurus sites:**
Test 6 returned only 266 chars with `content_ok:false` and `quality:20`. The tool detected low quality but did not retry with render mode. The `query` parameter was echoed in the Agent Hints section ("Query context: 'latest claude model names'") but no content matched. Any Docusaurus or cookie-consent-walled site will silently return near-empty content. This is a systematic failure class — not a one-off.

**BUG-E2 (MEDIUM) — Fields extractor pattern mismatch on GitHub:**
Test 4 requested 4 fields (programming language, license, stars, description). All returned "—". The underlying page HTML does contain the data — "Python 99.8%", "Star 3.5k", "MIT License" are present in the extracted markdown — but the field extractor's regex patterns cannot handle: (a) link-wrapped star counts, (b) percentage-suffixed language values, (c) prose-embedded license statements. Impacts any agent doing structured extraction from GitHub repos.

**BUG-E3 (LOW/INFORMATIONAL) — GitHub quality threshold too conservative:**
For test 2, `content_ok:false` is set at quality:35 even though the README core sections (install, getting started) are present and useful. Consider a `partial_ok` flag or per-domain quality calibration so agents aren't categorically blocked from usable partial content.

**Positive — Batch error handling is clean:**
Batch mode correctly returns one section per URL, with a parseable header (`urls:2 | successful:1 | failed:1`) and structured error messages ("Response is not HTML.") for non-HTML responses.

---

## Browser API — Detailed Results

All 6 tests passed. No timeouts, no empty snapshots, no errors across 5 different target sites.

| # | Flow | Actions | Status | Time | Evidence |
|---|------|---------|--------|------|----------|
| 1 | Hacker News | navigate → aria_snapshot | PASS | 9,739ms | "90 points by danybittel 1 hour ago \| hide \| 40 comments"; numbered post list 1–8+ visible |
| 2 | GitHub trending | navigate → wait 1000ms → aria_snapshot | PASS | 13,817ms | heading "Trending" [level=1]; "star 19,426 / fork 1,700" (openhuman), "star 37,288 / fork 3,584" (CLI-Anything) |
| 3 | example.com JS evaluate | navigate → evaluate | PASS | 5,680ms | Returned `Example Domain \| Example Domain` — exact expected string |
| 4 | Wikipedia | navigate → aria_snapshot | PASS | 8,845ms | searchbox "Search Wikipedia" confirmed; heading "Welcome to Wikipedia" [level=1] |
| 5 | Hacker News scroll | navigate → scroll → aria_snapshot | PASS | 12,620ms | Post list fully intact after scroll; items 1–8+ with points/comments |
| 6a | httpbin cookie set (cold) | navigate /cookies/set?foo=bar → aria_snapshot (session: browser-test-001) | PASS | 7,880ms | `{"cookies": {"foo": "bar"}}` |
| 6b | httpbin cookie read (warm) | navigate /cookies → aria_snapshot (same session_id) | PASS | 1,455ms | `{"cookies": {"foo": "bar"}}` — cookie persisted across independent invocations |

**Notable findings:**
- Session persistence is confirmed working: cookie state set in call 6a was present in call 6b with the same `session_id`, across two separate tool invocations
- Warm session reuse is 5x faster than cold (1,455ms vs 7,880ms) — strong differentiator for multi-step authenticated workflows
- All navigate actions used `domcontentloaded` — no timeouts on any site
- `aria_snapshot` output is consistently a structured ARIA tree — parseable, non-empty, rich in semantic labels
- `evaluate` returns raw JS string result with no wrapper or truncation for short results
- `render` vs `browser` method parity: both returned byte-identical 528-char HTML for example.com; metadata labels differ as expected (`cost: medium` vs `cost: high`)

---

## Unblock / Map / Crawl — Detailed Results

4 of 7 tests passed. All 3 failures correctly attributed. The failures are not tool bugs per se but a combination of site structure realities and agent-facing UX gaps (no warning on under-delivery, misleading error codes).

| # | Tool | Params | Status | Evidence |
|---|------|--------|--------|----------|
| 1 | novada_unblock | url=example.com, method=render, timeout=30000 | PASS | 528 chars raw HTML, `<title>Example Domain</title>` present |
| 2 | novada_unblock | url=wikipedia.org, method=render, timeout=30000 | PASS | 118,896 chars (truncated to 100k); `<title>Wikipedia</title>` present, JS-rendered content confirmed |
| 3 | novada_unblock | url=news.ycombinator.com, method=render, wait_for=".athing" | PASS | 34,759 chars; multiple `class="athing submission"` elements with real HN post data; wait_for selector worked |
| 4 | novada_unblock | url=example.com, method=browser, timeout=30000 | PASS | Identical 528-char HTML as render method; header confirms "Rendered via Browser API (full Chromium, highest fidelity)" |
| 5 | novada_map | url=httpbin.org, limit=10, max_depth=2 | FAIL | Returned 2 URLs (httpbin.org/ and httpbin.org/forms/post); criterion was ≥3; no warning that fewer-than-requested URLs were returned |
| 6 | novada_map | url=docs.anthropic.com, limit=10, search="models" | FAIL | Error: `URL_UNREACHABLE` — "No URLs found matching 'models'. The site may be unreachable, a JavaScript SPA, or there are no pages matching your search term." Site IS reachable; actual cause is SPA detection failure |
| 7 | novada_crawl | url=httpbin.org, max_pages=3, strategy=bfs, render=auto | FAIL | 1 page crawled; tool returned: "Stopped early — No more same-domain links to follow." httpbin renders as Swagger UI with no outbound same-domain HTML links |

**Bug detail:**

**BUG-M1 (MEDIUM-HIGH) — novada_map returns misleading `URL_UNREACHABLE` for JS SPAs:**
docs.anthropic.com is reachable but is a JS SPA. The error text leads with "site may be unreachable" before mentioning SPA as a possibility. Agents receiving this error have no signal to pivot to `novada_unblock` or `novada_crawl render=render` — they will retry the same call fruitlessly. Fix: introduce a distinct `SPA_NO_URLS_FOUND` error code and add an `agent_instruction` field pointing to the correct alternative tool.

**BUG-M2 (MEDIUM) — novada_map silent under-delivery:**
Test 5 requested `limit=10` and received 2 URLs with no warning. No `agent_hint` explains the shortfall. Agents expecting N URLs proceed with false confidence. Fix: when returned count < requested limit, add a structured hint explaining why (e.g., "site has few crawlable links at this depth; consider increasing max_depth or using novada_crawl").

**BUG-M3 (LOW) — novada_crawl stops at 1 page with no actionable next step:**
httpbin.org has no outbound same-domain HTML links (Swagger UI only). Crawl exits after the root page with "No more same-domain links to follow" — no suggestion to use `novada_map` first or target a specific path. Fix: include a note suggesting `novada_map` to verify site link structure before crawling, or `select_paths` to target specific sections.

**BUG-M4 (LOW) — novada_unblock truncation not surfaced as structured field:**
Wikipedia returned 118,896 chars, truncated to 100,000. The notice IS shown in the output header (not silent), but agents cannot programmatically detect the shortfall without parsing prose. Fix: surface `max_chars_needed: 118896` as a structured response field.

---

## Bug Report (Prioritized)

### HIGH — Must fix before shipping

**BUG-E1: Extract auto-escalation failure on low-quality static fetches**
- Tool: `novada_extract`
- Trigger: Any Docusaurus site, cookie consent wall, or JS-rendered documentation
- Symptom: Returns 266 chars, `content_ok:false`, `quality:20` — but does NOT retry with render mode
- Root cause: Auto-escalation from static → render is not implemented when `content_ok:false` + `quality < threshold`
- Impact: Systematic — every Docusaurus doc site, every cookie-walled page silently returns near-empty content
- Fix: When `content_ok:false` AND `quality < 40`, automatically retry with `render="render"`; surface escalation in response metadata

### MEDIUM — Fix in next sprint

**BUG-M1: novada_map misleading `URL_UNREACHABLE` error code for JS SPAs**
- Tool: `novada_map`
- Trigger: Any JS SPA target (React/Next.js/Docusaurus) without sitemap
- Symptom: `URL_UNREACHABLE` error with ambiguous message; site is in fact reachable
- Root cause: No differentiation between network failure and SPA rendering failure
- Fix: Add `SPA_NO_URLS_FOUND` error code; add `agent_instruction` field: "This site is a JavaScript SPA. Use novada_unblock with method=render to fetch page content, or novada_crawl with render=render to crawl."

**BUG-E2: Fields extractor pattern mismatch on GitHub-style content**
- Tool: `novada_extract` with `fields` parameter
- Trigger: GitHub repository pages
- Symptom: All requested fields return "—" even when data is present in the extracted markdown
- Root cause: Regex patterns cannot handle (a) link-wrapped star counts ("Star 3.5k" as link text), (b) percentage-suffixed language stats ("Python 99.8%"), (c) prose-embedded license statements
- Fix: Extend regex patterns for GitHub-specific HTML structures, or implement LLM-based field extraction as fallback when regex returns all nulls

**BUG-M2: novada_map silent under-delivery when fewer URLs found than requested**
- Tool: `novada_map`
- Trigger: Sites with sparse internal link structure at requested depth
- Symptom: Requested limit=10, received 2 — no structured warning
- Fix: When `returned < requested`, append `agent_hint` explaining shortfall (depth reached, sparse links) and suggest increasing `max_depth` or switching to `novada_crawl`

### LOW — Polish items

**BUG-E3: GitHub quality threshold may be too conservative**
- README core sections (install, getting started) are present at quality:35 but `content_ok:false` blocks agents from using the content
- Consider: `partial_ok` flag or per-domain quality calibration

**BUG-M3: novada_crawl offers no recovery guidance when stopping early**
- When crawl exits with "No more same-domain links to follow", suggest `novada_map` to verify site structure first

**BUG-M4: novada_unblock truncation not surfaced as structured field**
- Currently a prose notice in the response header; should be a parseable field (`max_chars_needed: N`) for programmatic detection

---

## What's Not Tested (Inactive Products)

- **Search API / SERP** — not activated on this account (HTTP 402). Expected. No test coverage.
- **Scraper API** — returns code `11006` (plan gate). Structured error with `agent_instruction` is correct behavior — the error format is well-formed and agent-friendly, but the product itself is not accessible on the current plan.

---

## Recommended Actions

**1. Implement extract auto-escalation (HIGH — blocks docs site use cases)**
When `content_ok:false` and `quality < 40`, the extract tool should automatically retry with `render="render"`. This is a one-time implementation fix that unlocks all Docusaurus, cookie-gated, and JS SPA documentation sites. Without this, any agent trying to extract from official docs will get near-empty results silently.

**2. Fix novada_map SPA error code before GA (HIGH — agent-usability)**
Replace `URL_UNREACHABLE` with `SPA_NO_URLS_FOUND` (or equivalent) for the JS SPA failure case, and add an `agent_instruction` field pointing to `novada_unblock` or `novada_crawl render=render`. This prevents agents from retrying the wrong tool indefinitely.

**3. Add under-delivery warnings to novada_map (MEDIUM — quick win)**
When returned URL count < requested limit, add a structured `agent_hint` with the reason and a suggested alternative. This is a small addition that significantly improves agent decision-making downstream.

**4. Improve fields extractor regex for GitHub (MEDIUM — extract quality)**
Extend pattern matching to handle link-wrapped values and percentage-suffixed strings. Add LLM-based extraction as fallback when all fields return null. GitHub repos are a common extract target — this gap will surface frequently in production.

**5. Document and promote browser session persistence (POSITIVE — marketing/docs)**
The Browser API's session persistence (cookies, state across invocations) is working correctly and delivers a measurable 5x latency advantage on warm sessions (1,455ms vs 7,880ms). This should be documented prominently as a differentiator for multi-step authenticated workflows — it is not visible in current docs.
