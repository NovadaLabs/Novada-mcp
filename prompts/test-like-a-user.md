# novada-search MCP — "Test Like a User" QA Script

> Run this EVERY time before publishing a new version.
> Call each tool once with the simplest possible input. Note what breaks.
> This is what yixuan did and found 11 bugs we missed.

## Setup
```
export NOVADA_API_KEY=your-key-here
```

---

## Tool 1: novada_search
```
novada_search(query="apple", engine="google", num=3)
```
EXPECT: 3 search results with titles, URLs, snippets. No "SERP not available" error.

## Tool 2: novada_extract
```
novada_extract(url="https://example.com")
```
EXPECT: Page title + main content in markdown. No error.

## Tool 3: novada_scrape — search engine (flat params)
```
novada_scrape(platform="google.com", operation="google_search", params={q: "test"}, limit=3, format="json")
```
EXPECT: 3 Google search results. No 11006/11009/10001 error.

## Tool 4: novada_scrape — e-commerce (scraper_params)
```
novada_scrape(platform="amazon.com", operation="amazon_product_keywords", params={keyword: "iphone"}, limit=3, format="json")
```
EXPECT: 3 Amazon products with title, price, ASIN. No error.

## Tool 5: novada_scrape — social (scraper_params)
```
novada_scrape(platform="linkedin.com", operation="linkedin_company_information_url", params={url: "https://www.linkedin.com/company/openai/"}, limit=1, format="json")
```
EXPECT: Company data (name, followers, about). No error.

## Tool 6: novada_crawl
```
novada_crawl(url="https://example.com", max_pages=2, strategy="bfs")
```
EXPECT: 2 pages of content. No error.

## Tool 7: novada_crawl — with select_paths
```
novada_crawl(url="https://www.novada.com", select_paths=["/pricing.*"], max_pages=3, strategy="bfs")
```
EXPECT: Only pages matching /pricing.* returned. Root page "/" should NOT appear unless it matches the filter.

## Tool 8: novada_map
```
novada_map(url="https://example.com", limit=10)
```
EXPECT: List of URLs found on the site. No error.

## Tool 9: novada_research
```
novada_research(question="What is MCP?", depth="quick")
```
EXPECT: Cited research report. No "SERP not available" error.

## Tool 10: novada_verify
```
novada_verify(claim="The earth orbits the sun.")
```
EXPECT: Verdict (supported/unsupported/contested) with confidence 0-100. No error.

## Tool 11: novada_proxy
```
novada_proxy(type="residential", country="us", format="url")
```
EXPECT: Proxy URL with masked password (***). No plaintext credentials.

## Tool 12: novada_proxy — curl format
```
novada_proxy(type="residential", country="us", format="curl")
```
EXPECT: curl command with masked password. CHECK: password should NOT be in plaintext.

## Tool 13: novada_unblock
```
novada_unblock(url="https://example.com", method="render")
```
EXPECT: Raw HTML returned. If truncated, should say "Content truncated from X to Y chars."

## Tool 14: novada_browser
```
novada_browser(actions=[{action: "navigate", url: "https://example.com"}, {action: "wait", ms: 2000}, {action: "aria_snapshot"}])
```
EXPECT: 
- Navigation succeeds
- Wait reports ~2000ms (NOT 5000ms)
- Snapshot returns page structure

## Tool 15: novada_health
```
novada_health()
```
EXPECT: Status of each product. Status should match what actually works (if scrape works, health should show Active).

## Tool 16: novada://scraper-platforms resource
```
Read the novada://scraper-platforms resource
```
EXPECT: All operation IDs match real API. No invented IDs like "amazon_product_by-keywords". Should show 13 platforms, 78 operations.

## Tool 17: novada://countries resource
```
Read the novada://countries resource
```
EXPECT: ~195 country codes listed (not just 54). Count should match the header claim.

---

## Scoring

| Result | Score |
|--------|-------|
| Works as expected | PASS |
| Returns data but with issues | WARN |
| Errors, wrong data, or misleading output | FAIL |

**Pass threshold: 0 FAIL on P0/P1 tools (1-15). WARN acceptable on P2/P3 (16-17).**

## After testing, report:
1. Total PASS / WARN / FAIL count
2. For each FAIL: exact error message + expected vs actual
3. For each WARN: what was unexpected
4. Overall: "Ready to publish" or "NOT ready — N issues to fix"
