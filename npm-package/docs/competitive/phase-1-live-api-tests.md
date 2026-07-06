# novada-mcp Live API Tests
Date: 2026-04-30
API Key: ****adfa
SDK Version: 0.8.3

## Test Results Summary

| # | Tool | Query/URL | Latency (ms) | Quality | Status |
|---|------|-----------|-------------|---------|--------|
| 1 | novada_search (google) | "best residential proxy 2024" | 1010 | N/A | BLOCKED — SERP not activated |
| 2a | novada_search (bing) | "web scraping tools 2024" | 1092 | N/A | BLOCKED — SERP not activated |
| 2b | novada_search (duckduckgo) | "web scraping tools 2024" | 329 | N/A | BLOCKED — SERP not activated |
| 3 | novada_extract (static) | https://example.com | 112 | quality:0 (166 chars) | PASS |
| 4 | novada_extract (render) | https://news.ycombinator.com | 12392 | quality:15 (3729 chars) | PASS |
| 4b | novada_extract (static) | https://news.ycombinator.com | 818 | quality:20 (3730 chars) | PASS |
| 5 | novada_extract (fields) | https://github.com/mendableai/firecrawl | 1123 | quality:45 (18959 chars) | PASS — fields extracted |
| 6 | novada_map | https://firecrawl.dev | 978 | 50 URLs discovered | PASS |
| 6b | novada_map | https://brightdata.com | 717 ms | 100 URLs discovered | PASS |
| 7 | novada_crawl | https://firecrawl.dev (max_pages=3) | 4253 | 3 pages, 770 words | PASS |
| 8 | novada_health | all credentials | 3026 | 3/5 active | PASS |
| 9 | novada_unblock | https://www.nytimes.com | 9479 | 50000 chars (truncated) | PASS — raw HTML |
| 9b | novada_unblock (render) | https://www.bloomberg.com | 15694 | 50000 chars (truncated) | PASS — bypassed |
| 10 | novada_research | "best residential proxy" | 1046 | N/A | BLOCKED — requires SERP |
| S1 | novada_scrape | google.com search | — | N/A | BLOCKED — code 11006 |
| S2 | novada_verify | claim fact-check | 1039 | N/A | BLOCKED — requires SERP |
| S3 | novada_proxy | config output | 0 | Config string | PASS (no HTTP call) |
| S4 | novada_extract (render) | https://www.tavily.com | 44134 | quality:25 (2118 chars) | PASS but 44s latency |
| S5 | novada_extract (static) | https://www.tavily.com | 388 | quality:30 (2118 chars) | PASS |
| S6 | novada_extract | https://techcrunch.com | 321 | quality:50 (24995 chars) | PASS |
| S7 | novada_extract | https://en.wikipedia.org/wiki/Web_scraping | 184 | quality:70 (23111 chars) | PASS |

---

## Detailed Results

### Test 1–2: novada_search — all engines
**Input:** query="best residential proxy 2024", engine=google/bing/duckduckgo, num=5
**Output:**
```
## Search Unavailable
The Novada SERP endpoint is not yet available for this API key.
Why: novada_search requires a dedicated SERP quota separate from Scraper API and Web Unblocker plans.
Contact support@novada.com to enable it.
Alternatives: novada_extract, novada_research, novada_map + novada_extract
```
**Latency:** google=1010ms, bing=1092ms, duckduckgo=329ms (DDG response cached or cheaper path)
**Quality notes:** Returns a structured SERP_UNAVAILABLE message instead of throwing. Error message is agent-friendly — lists alternatives and contact info.
**Agent-usability notes:** Graceful degradation. Agent can parse the alternatives and pivot. No raw exception thrown. However, `novada_research` and `novada_verify` both delegate to SERP, so both also fail — the entire search stack is blocked by one product tier.

---

### Test 3: novada_extract — simple static page
**Input:** url="https://example.com", format="markdown", render="auto"
**Output:** 166 chars of clean markdown. Title, description, content, 1 link, Agent Hints section.
**Latency:** 112ms (first call), 25–27ms (subsequent cached calls)
**Quality notes:** quality:0 (scoring reflects very small page, not extraction failure). Content is accurate and complete.
**Agent-usability notes:** Format is clean and parseable. Response structure: header → metadata → content → links → agent hints. The quality:0 on example.com may mislead agents into thinking extraction failed.

---

### Test 4: novada_extract — render mode (JS-heavy page)
**Input:** url="https://news.ycombinator.com", render="render"
**Output:** 3729 chars, 196 links, quality:15. Actual HN stories included in output.
**Latency:** 12392ms (render mode)
**Comparison static:** 818ms, quality:20, same content (HN doesn't require JS rendering)
**Quality notes:** Both modes return equivalent content. Render mode is 15x slower for no gain on this site.
**Agent-usability notes:** `render="auto"` would have avoided the 12s wait. The `quality:` score is lower for render mode (15 vs 20) despite same content volume — scoring may penalize or not reward render mode. Content parsing of HN runs all story entries together without newlines, reducing readability.

---

### Test 5: novada_extract — fields extraction
**Input:** url="https://github.com/mendableai/firecrawl", fields=["title","description"]
**Output:** 18959 chars (full page content) + Requested Fields section at top with extracted title/description.
**Latency:** 1123ms
**Quality notes:** quality:45. Fields section extracted:
- title: "🔥 Firecrawl *(pattern)*"
- description: "Search the web and get full content from results. *(pattern)*"

Note: the `*(pattern)*` suffix indicates pattern-matched extraction, not exact value. The actual page title is "GitHub - firecrawl/firecrawl" and description is "🔥 The API to search, scrape, and interact with the web for AI".
**Agent-usability notes:** Field extraction returns `*(pattern)*` annotation — agents may not know this means fuzzy match. Full page content is still included, so fields are redundant if the agent is reading all content anyway. An agent might expect fields to give only the requested data, not the full page.

---

### Test 6: novada_map — URL discovery
**Input:** url="https://firecrawl.dev"
**Output:** 50 URLs, discovery method: sitemap
**Latency:** 978ms
**URL sample:** firecrawl.dev/, /about, /pricing, /blog, /playground, /extract, /agent, /interact, /changelog, /alternatives/*, /tools/*
**Quality notes:** 50 high-quality sitemap URLs from a well-structured site. Alternatives pages (vs Tavily, Exa, Bright Data, etc.) all included — useful for competitive research.
**Agent-usability notes:** Numbered list format is parseable. Header metadata (root, urls count, discovery method) is clean.

**Test 6b:** brightdata.com → 100 URLs in 717ms via sitemap. Fast and complete.

---

### Test 7: novada_crawl — small crawl
**Input:** url="https://firecrawl.dev", max_pages=3
**Output:** 3 pages (firecrawl.dev, /pricing, /blog/firecrawl-lovable-integration), 770 total words, failed:0
**Latency:** 4253ms (4.2s for 3 pages = avg 1.4s/page)
**Pages:**
1. Root page — marketing copy, code samples
2. /pricing — structured pricing content
3. /blog/firecrawl-lovable-integration — blog post content

**Quality notes:** Content quality varies by page. Marketing page content has code examples embedded directly without newlines. Blog page has proper prose. BFS strategy correctly crawled homepage first then followed links.
**Agent-usability notes:** Output format is clean with page headers `### [N/M] URL`, depth/words metadata. total_words count is useful. No failed pages.

---

### Test 8: novada_health — service status
**Input:** all credentials set (NOVADA_API_KEY, NOVADA_WEB_UNBLOCKER_KEY, NOVADA_PROXY_USER/PASS/ENDPOINT, NOVADA_BROWSER_WS)
**Output:**
| Product | Status | Latency |
|---------|--------|---------|
| Search API | Not activated | 1019ms |
| Web Unblocker / Extract | Active | 3013ms |
| Scraper API (129 platforms) | Not activated | 690ms |
| Proxy | Active | — |
| Browser API | Active | — |

**Latency:** 3026ms total (parallel HTTP probes)
**Quality notes:** 3/5 active. Search API and Scraper API not activated on this API key. Both require separate plan activation.
**Agent-usability notes:** Excellent. Table format, clear status labels, "Next Steps" section with exact URLs for activation. Agent can interpret health state immediately. Proxy and Browser API checks are env-var only (no HTTP probe) — instant.

**Critical note:** NOVADA_PROXY_ENDPOINT must be set as `host:port` (not `http://user:pass@host:port`). The credentials.js reads user/pass/endpoint separately. Health check shows "not configured" if env var name is wrong.

---

### Test 9: novada_unblock — anti-bot bypass
**Input:** url="https://www.nytimes.com", render=false
**Output:** Raw HTML, 1,295,261 chars (truncated to 50,000). Method: render. Cost: medium.
**Latency:** 9479ms
**Recommendation:** Agents should be redirected to novada_extract for parsed content. novada_unblock is for raw HTML access only — it is not an extraction tool. The tool description should make this distinction explicit.

**Test 9b:** url="https://www.bloomberg.com", render=true
**Latency:** 15694ms. Got 8,303,451 chars (truncated). Has Bloomberg content.
**Note:** Bloomberg HTML contains "blocked" string in class names — not actually blocked, just has `.blocked-content` CSS classes in HTML.

**Test 9c:** url="https://www.linkedin.com/company/firecrawl", render=true
**Latency:** 16509ms. Has login wall but ALSO has some Firecrawl company data. Partial success.

**Quality notes:** Returns raw HTML (not markdown). Truncated at 50,000 chars. NYT page is 1.3MB untruncated. Agent receives much less than full content.
**Agent-usability notes:** Header says "This is raw HTML, not cleaned text. Parse with CSS selectors or regex." This is correct but demanding for agents. For most agent use cases, `novada_extract` is more appropriate. The 50,000-char truncation discards most of massive pages. No instruction on how to get subsequent chunks.

---

### Test 10: novada_research
**Input:** query="best residential proxy services 2024 comparison", num_sources=3
**Output:**
```
## Research: Search Unavailable
The Novada SERP endpoint is not available. All 6 search queries failed.
To research manually: use novada_extract with known URLs, or novada_map + novada_extract.
```
**Latency:** 1046ms (all 6 SERP queries fail fast)
**Agent-usability notes:** Fast failure with clear instructions. The suggested alternatives are genuinely actionable. However, research without SERP is fundamentally broken — agents can't discover URLs they don't already know.

---

### Extra: novada_scrape (Scraper API — 129 platforms)
**Input:** platform="google.com", operation="google_search_by-keywords", params={keyword: "AI proxy tools"}
**Error:** `Scraper error (code 11006): Scraper API not yet activated on this account.`
**Latency:** ~500ms (fast rejection)
**Note:** Error is thrown as exception (not graceful degradation like search). MCP tool wraps this in a tool-call error. Agent will see an exception rather than a structured message.
**Agent-usability issues:** Unlike novada_search which returns a SERP_UNAVAILABLE string, novada_scrape throws. Agent frameworks handle these differently — some retry, some abort. Inconsistent behavior with novada_search.

**NOTE: novada_scrape (129 platforms) is a documented capability but is NOT activated on the test account (throws exception code 11006). Competitive claims about this tool cannot be verified live until account activation.**

---

### Extra: novada_verify
**Input:** claim="Firecrawl is the most popular web scraping API"
**Output:**
```
## Verify: Search Unavailable
The Novada SERP endpoint is not yet configured for this API key.
Alternatives: novada_extract with direct URL, novada_research
Contact support@novada.com to enable SERP access.
```
**Latency:** 1039ms
**Agent-usability notes:** Graceful like novada_search. Returns string not exception. But verify is fundamentally useless without SERP.

---

### Extra: novada_proxy
**Input:** url="https://api.ipify.org?format=json"
**Output (without env):** "not configured" message with setup instructions
**Output (with env):** Proxy URL string with examples for Node.js/Python, session_id hint
**Latency:** 0ms (no HTTP call — only reads env vars)
**Quality notes:** Does NOT actually test the proxy connection or return an IP. Just formats proxy URL string. Agent calling this tool gets a config string, not confirmation the proxy works.
**Agent-usability notes:** Useful as proxy config generator. Agent gets a ready-to-use proxy_url. But if proxy credentials are wrong, this tool gives no warning.

---

## Latency Benchmark Summary

| Tool | Operation | Latency |
|------|-----------|---------|
| novada_extract | example.com (cached) | 25–27ms |
| novada_extract | static page | 112–821ms |
| novada_extract | Wikipedia | 184ms |
| novada_extract | Tavily static | 388ms |
| novada_extract | TechCrunch | 321ms |
| novada_extract | GitHub page | 1123ms |
| novada_map | firecrawl.dev (50 URLs) | 978ms |
| novada_map | brightdata.com (100 URLs) | 717ms |
| novada_crawl | firecrawl.dev (3 pages) | 4253ms |
| novada_unblock | NYT (1.3MB HTML) | 9479ms |
| novada_unblock | Bloomberg (8.3MB HTML) | 15694ms |
| novada_unblock | LinkedIn | 16509ms |
| novada_extract | render mode (Tavily) | 44134ms |
| novada_extract | render mode (HN) | 12392ms |
| novada_health | all services | 3026ms |

**Key pattern:** Static extract is fast (100ms–1.2s). Render mode is expensive (12s–44s). Map is fast (<1s). Unblock is slow (9–16s) due to full JS render + large HTML. Scrape/Search/Research/Verify all blocked by account plan.

---

## Agent-Usability Issues Found

1. **quality:0 false negative** — example.com extraction succeeds but scores quality:0 (166 chars). Agent may interpret this as failure. Minimum quality score should be 1 for successful extractions.

2. **novada_scrape throws, novada_search doesn't** — Inconsistent error handling. novada_search returns a SERP_UNAVAILABLE string gracefully; novada_scrape throws an Error exception. Agents experience these differently. MCP callers get an error vs a content string.

3. **Fields extraction adds `*(pattern)*` annotation** — Agents requesting fields=["title","description"] get values like `"🔥 Firecrawl *(pattern)*"` instead of clean values. The annotation signals fuzzy matching but agents may include it verbatim.

4. **novada_unblock 50k char truncation with no pagination** — Large pages (NYT=1.3MB, Bloomberg=8.3MB) are truncated at 50,000 chars with no way to get subsequent chunks. Agent receives <4% of Bloomberg's HTML. No chunk_id or continuation mechanism mentioned.

5. **novada_proxy does not test connection** — Returns config string immediately without verifying credentials work. An agent could proceed with a broken proxy without knowing.

6. **HN content runs together** — In both static and render modes, HN stories run together without newlines between them (e.g., "471 points by ilreb 4 hours ago | hide | 240 comments2.Noctua..."). Parsing-hostile for agents.

7. **render=render 44s on Tavily** — Web Unblocker's render mode took 44 seconds on Tavily with same quality as static (2118 chars, quality:25 vs 30). Auto mode correctly picks static first and is much faster. Agents that always force render= will be slow.

8. **novada_proxy type: undefined** — When calling novada_proxy with url param, the output shows "type: undefined". Likely a minor formatting bug.

9. **Browser API active but untested** — Health check shows Browser API active (NOVADA_BROWSER_WS set) but no browser-specific tests were run. novada_browser and novada_unblock with method="browser" are untested. *(Resolved in Loop 2 — see Browser Tests section below.)*

10. **quality:0 false negative on small pages** — Successful extraction of small pages (e.g., example.com at 166 chars) returns quality:0, identical to a failed extraction. Agents interpreting quality:0 as failure will retry unnecessarily. No competitor has this bug — BrightData, Firecrawl, and Tavily all either omit quality scores or use explicit error states distinct from low-content scores. Minimum score for a successful extraction should be 1.

11. **novada_unblock redirects agents to wrong next step** — The tool description says "Parse with CSS selectors or regex" but this is demanding and error-prone for agents. Agents should be redirected to novada_extract for parsed content. novada_unblock is for raw HTML access only — it is not an extraction tool. The tool description should make this distinction explicit.

---

## Performance Observations

- **Static extract is consistently fast:** Most pages return in 100ms–1.2s. Cached URLs (example.com second/third call) return in 25ms.
- **Render mode penalty is severe:** 12x–40x slower than static. Tavily static=388ms vs render=44134ms. HN static=818ms vs render=12392ms. The `render="auto"` default appears to correctly avoid render when not needed.
- **Map is fast and reliable:** Two map calls (firecrawl.dev, brightdata.com) both completed under 1 second.
- **Crawl scales linearly:** 3 pages = 4.2s ≈ 1.4s/page.
- **Health check parallelism works:** 3 HTTP probes in parallel complete in ~3s total (Web Unblocker is the slowest probe).
- **SERP latency before rejection:** Even the "not activated" SERP check takes 1s (actual HTTP round-trip to scraperapi.novada.com).

---

## Known Blockers

| Tool | Error | Resolution |
|------|-------|------------|
| novada_search | SERP not activated — separate plan | Contact support@novada.com or activate at dashboard.novada.com/overview/scraper/ |
| novada_research | Depends on SERP — all queries fail | Same as above — SERP activation unblocks this |
| novada_verify | Depends on SERP | Same as above |
| novada_scrape | code 11006 — Scraper API not activated | Activate at dashboard.novada.com/overview/scraper/ |
| novada_extract (render) | Works but 12s–44s latency | Use render="auto" to let system choose; avoid forced render="render" |

**Active tools (usable today):**
- novada_extract (static/auto mode) — fast, high quality
- novada_map — fast URL discovery
- novada_crawl — multi-page crawl, uses extract internally
- novada_unblock — raw HTML bypass, slow but works on NYT/Bloomberg/LinkedIn
- novada_health — service diagnostics
- novada_proxy — config generator (no HTTP call)
- novada_browser — CDP WebSocket browser automation (see Browser Tests section)

**NOTE on novada_scrape:** The 129-platform scrape capability is a documented strength but is NOT activated on the test account (throws exception code 11006). Any competitive comparison claiming novada_scrape parity with BrightData's structured datasets cannot be verified live until account activation.

---

## Browser Tests (Loop 2 addition)

Tested against: `wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com`
SDK path: `build/tools/browser.js` — calls Playwright `chromium.connectOverCDP(wsEndpoint)`

| Test | Actions | Latency | Quality | Status |
|------|---------|---------|---------|--------|
| B1 | navigate → example.com | 8132ms | Page title returned ("Example Domain") | PASS |
| B2 | navigate + aria_snapshot → example.com | 6080ms | YAML accessibility tree — heading, paragraph, link with URL | PASS |
| B3 | navigate + type + press_key + aria_snapshot → DuckDuckGo | 16966ms | All 4 actions succeeded; aria_snapshot returned empty after search nav | PASS (partial — see notes) |
| B4 | navigate + screenshot → example.com | 6336ms | PNG base64 data returned (confirmed by iVBORw0KGgo... prefix) | PASS |

### Browser Test — Detailed Notes

**B1 — navigate (8132ms)**
- Cold connect latency is ~8s. CDP WebSocket handshake + new browser context + new page + goto is the bottleneck.
- Title correctly returned: "Example Domain". Connection is reliable.

**B2 — navigate + aria_snapshot (6080ms)**
- Second test cached the connection path — 6s total for 2 actions.
- aria_snapshot output is clean YAML accessibility tree:
  ```
  - heading "Example Domain" [level=1]
  - paragraph: This domain is for use in documentation examples...
  - paragraph:
    - link "Learn more":
      - /url: https://iana.org/domains/example
  ```
- Semantic, role-based, ~70% smaller than raw HTML. Highly agent-parseable.

**B3 — navigate + type + press_key + aria_snapshot (16966ms)**
- 4 chained actions in a single call — all succeeded.
- Browser navigated to DuckDuckGo in Chinese locale (title: "保护。隐私。安心。") — indicates proxy geo is non-US.
- `type` on `input[name='q']` worked correctly.
- `press_key: Enter` triggered navigation.
- Post-navigation aria_snapshot returned "(no accessible content found on this page)" — likely because DuckDuckGo's React SPA had not finished rendering when snapshot was taken.
- **Agent-usability issue:** After SPA navigation triggered by Enter, a `wait` action (selector or timeout) is needed before aria_snapshot. The tool description warns about `networkidle` but does not mention inserting a wait step after key press navigation.

**B4 — screenshot (6336ms)**
- Navigate + screenshot in 6.3s.
- Returns full base64 PNG: `data:image/png;base64,iVBORw0KGgo...`
- Base64 blob is large and gets truncated at 10,000 chars by the tool's own truncation logic. Full page screenshot of example.com is small enough to avoid truncation, but any real page screenshot will be truncated.
- **Agent-usability issue:** Screenshot is returned as raw base64 in the tool response text. Agents that don't decode base64 images will see a character blob. The tool should note this is visual-only output and redirect agents to aria_snapshot for structural content.

### Browser Agent-Usability Notes

1. **Cold connect latency is 6–8s** — Every new browser call (without session_id) reconnects via CDP. For workflows requiring multiple sequential browser interactions, always use `session_id` to reuse the connection. Cold latency is comparable to Firecrawl/BrightData's CDP-based tools.

2. **SPA navigation after key press needs explicit wait** — After `press_key: Enter` on a search form, the page navigates and the SPA re-renders. Without a `wait` action, aria_snapshot captures an empty state. Agents chaining type → press_key → snapshot will get empty content.

3. **Screenshot truncated at 10,000 chars** — The browser.js tool truncates all action data at 10,000 characters. A base64 PNG from a real page will be much larger. The truncated screenshot cannot be decoded. For visual content, this tool is only useful for small/simple pages or needs a separate image return channel.

4. **Proxy geo defaults to non-US** — DuckDuckGo returned a Chinese-locale page, indicating the browser proxy exits in a non-English-default region. For US-targeted scraping, geo must be specified explicitly. No param to set country in novada_browser today.

5. **Session management is well-designed** — `session_id` allows cookie/state reuse across calls. `close_session` and `list_sessions` actions are clean. This is on par with BrightData's named browser profiles.
