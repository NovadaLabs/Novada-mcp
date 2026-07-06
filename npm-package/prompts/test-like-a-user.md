# novada-mcp v0.7.2 — Full Functionality Test Script

> Run this before every publish. Call each tool once with the simplest valid input.
> Report PASS / WARN / FAIL for each test.
> Pass threshold: 0 FAIL on P0/P1 tools (1–20). WARN acceptable on P2 tools (21–24).

## Setup

The MCP server must be running. All tools below are prefixed `novada_`.

---

## SEARCH GROUP

### Test 1 — Google search
```
novada_search(query="apple", engine="google", num=3, country="", language="")
```
EXPECT: 3 results, each with title + URL + snippet. No "SERP not available" error.

### Test 2 — Bing search (v0.7.2 fix: num param excluded)
```
novada_search(query="apple", engine="bing", num=5, country="", language="")
```
EXPECT: Organic results with titles and URLs. Must NOT return "no task_id in response" error.
CHECK: `data.data` is not null — if it is, the num-exclusion fix is not applied.

### Test 3 — DuckDuckGo search (v0.7.2 fix: source.link URL)
```
novada_search(query="cheapest phones", engine="duckduckgo", num=5, country="", language="")
```
EXPECT: Organic results with valid URLs (https://...). Must NOT return results with empty URLs.
CHECK: At least 3 results include a `url:` line starting with `https://`.

### Test 4 — Google with time filter
```
novada_search(query="AI news", engine="google", num=3, time_range="week", country="", language="")
```
EXPECT: 3 recent results. No error.

### Test 5 — DDG with domain filter
```
novada_search(query="machine learning", engine="duckduckgo", num=5, include_domains=["arxiv.org"], country="", language="")
```
EXPECT: Results only from arxiv.org. No results from other domains.

---

## EXTRACT GROUP

### Test 6 — Single URL extract
```
novada_extract(url="https://example.com")
```
EXPECT: Title + main content in markdown. No error.

### Test 7 — Batch extract
```
novada_extract(url=["https://example.com", "https://httpbin.org/html"])
```
EXPECT: Content from both URLs returned. 2 sections in output.

---

## CRAWL + MAP GROUP

### Test 8 — Crawl basic
```
novada_crawl(url="https://example.com", max_pages=2, strategy="bfs")
```
EXPECT: 2 pages of content. No error.

### Test 9 — Crawl with path filter
```
novada_crawl(url="https://www.novada.com", select_paths=["/pricing.*"], max_pages=3, strategy="bfs")
```
EXPECT: Only pages matching /pricing.* returned. Root "/" should NOT appear unless it matches the filter.

### Test 10 — Map
```
novada_map(url="https://example.com", limit=10)
```
EXPECT: List of discovered URLs. At least 1 URL. No error.

### Test 11 — Discover
```
novada_discover(url="https://example.com")
```
EXPECT: Structured discovery output (title, description, links, tech stack hints). No error.

---

## RESEARCH + VERIFY GROUP

### Test 12 — Research quick
```
novada_research(question="What is MCP protocol?", depth="quick")
```
EXPECT: Cited research report with at least 3 sources. No "SERP not available" error.

### Test 13 — Verify true claim
```
novada_verify(claim="The earth orbits the sun.")
```
EXPECT: verdict="supported", confidence > 70. No error.

### Test 14 — Verify false claim
```
novada_verify(claim="The moon is made of cheese.")
```
EXPECT: verdict="unsupported" or "contested". confidence > 50. No error.

---

## SCRAPE GROUP

### Test 15 — Scrape search engine (Format A)
```
novada_scrape(platform="google.com", operation="google_search", params={q: "test"}, limit=3, format="json")
```
EXPECT: 3 Google search results. No 11006/11009/10001 error.

### Test 16 — Scrape e-commerce (Format B)
```
novada_scrape(platform="amazon.com", operation="amazon_product_keywords", params={keyword: "iphone case"}, limit=3, format="json")
```
EXPECT: 3 Amazon products with title, price, ASIN. No error.

---

## SCRAPER ASYNC FLOW (submit → status → result)

### Test 17 — Scraper submit
```
novada_scraper_submit(platform="google.com", operation="google_search", params={q: "iphone"})
```
EXPECT: Returns a task_id string. No error.

### Test 18 — Scraper status (use task_id from Test 17)
```
novada_scraper_status(task_id="<task_id from test 17>")
```
EXPECT: Returns status (pending/running/completed). No error.

### Test 19 — Scraper result (poll until complete, max 90s)
```
novada_scraper_result(task_id="<task_id from test 17>")
```
EXPECT: Returns parsed results once task is complete. No timeout error within 90s.

---

## PROXY GROUP

### Test 20 — Residential proxy URL format
```
novada_proxy(type="residential", country="us", format="url")
```
EXPECT: Proxy URL with `***` masking the password. Plaintext password must NOT appear.

### Test 21 — Residential proxy curl format
```
novada_proxy(type="residential", country="us", format="curl")
```
EXPECT: curl --proxy flag with masked credentials. No plaintext password.

### Test 22 — Datacenter proxy
```
novada_proxy_datacenter(country="us", format="url")
```
EXPECT: Datacenter proxy URL. No error.

---

## UNBLOCK + BROWSER GROUP

### Test 23 — Unblock
```
novada_unblock(url="https://example.com", method="render")
```
EXPECT: Raw HTML returned. If large, "Content truncated from X to Y chars." message present.

### Test 24 — Browser actions
```
novada_browser(actions=[
  {action: "navigate", url: "https://example.com"},
  {action: "wait", ms: 1000},
  {action: "aria_snapshot"}
])
```
EXPECT:
- Navigation succeeds
- Wait ~1000ms (NOT 5000ms default)
- Snapshot returns accessible page structure

### Test 25 — Browser flow (multi-step)
```
novada_browser_flow(
  steps=["Go to https://example.com", "Take a screenshot"],
  output_format="markdown"
)
```
EXPECT: Completes both steps. Returns markdown summary with screenshot reference or description. No error.

---

## HEALTH GROUP

### Test 26 — Health (single product check)
```
novada_health(product="search")
```
EXPECT: Status for Search product — Active or Inactive with activation link. No error.

### Test 27 — Health all products
```
novada_health_all()
```
EXPECT: Status table for ALL products (Search, Extract, Scraper API, Proxy, Browser). No crash on unavailable products.
CHECK: Products that passed Tests 1–3 must show "Active" here.

---

## RESOURCES

### Test 28 — Scraper platforms resource
Read resource: `novada://scraper-platforms`
EXPECT: Lists platforms and operation IDs. Should show ≥10 platforms. No invented operation IDs.

### Test 29 — Countries resource
Read resource: `novada://countries`
EXPECT: ≥150 country codes listed (not just 54). Count should match the header claim.

---

## Scoring Table

| # | Tool | P-level | Result | Notes |
|---|------|---------|--------|-------|
| 1 | novada_search google | P0 | | |
| 2 | novada_search bing | P0 | | |
| 3 | novada_search duckduckgo | P0 | | |
| 4 | novada_search time_range | P1 | | |
| 5 | novada_search include_domains | P1 | | |
| 6 | novada_extract single | P0 | | |
| 7 | novada_extract batch | P1 | | |
| 8 | novada_crawl basic | P0 | | |
| 9 | novada_crawl path filter | P1 | | |
| 10 | novada_map | P0 | | |
| 11 | novada_discover | P1 | | |
| 12 | novada_research quick | P0 | | |
| 13 | novada_verify true | P0 | | |
| 14 | novada_verify false | P1 | | |
| 15 | novada_scrape search | P0 | | |
| 16 | novada_scrape e-commerce | P1 | | |
| 17 | novada_scraper_submit | P1 | | |
| 18 | novada_scraper_status | P1 | | |
| 19 | novada_scraper_result | P1 | | |
| 20 | novada_proxy residential url | P0 | | |
| 21 | novada_proxy residential curl | P1 | | |
| 22 | novada_proxy_datacenter | P1 | | |
| 23 | novada_unblock | P1 | | |
| 24 | novada_browser | P1 | | |
| 25 | novada_browser_flow | P1 | | |
| 26 | novada_health single | P1 | | |
| 27 | novada_health_all | P1 | | |
| 28 | Resource: scraper-platforms | P2 | | |
| 29 | Resource: countries | P2 | | |

---

## After Running All Tests, Report:

1. **Score:** X PASS / Y WARN / Z FAIL
2. **For each FAIL:** exact error message, expected vs actual
3. **For each WARN:** what was unexpected or degraded
4. **v0.7.2 regression check:**
   - Test 2 (Bing) must PASS — if it fails with "no task_id", the num-exclusion fix regressed
   - Test 3 (DDG) must PASS with valid URLs — if URLs are empty, the source.link fix regressed
5. **Verdict:** "Ready" or "NOT ready — N issues to fix"
