# novada_scrape Retest — After Dual-Format Fix

The MCP was fixed to use TWO param formats:
- Search engines (google, bing, duckduckgo, yandex) → flat form fields + json=1
- All others → scraper_params=[{...}] array

Run these tests IN ORDER. All should pass except YouTube (known Novada backend CAPTCHA issue).

---

## Test 1 — Google search (was FAILING, should now PASS)
```
novada_scrape(platform="google.com", operation="google_search", params={q: "Claude AI"}, limit=5, format="json")
```
Expected: 5 search results with titles and URLs.

## Test 2 — Bing search (was FAILING, should now PASS)
```
novada_scrape(platform="bing.com", operation="bing_search", params={q: "MCP server"}, limit=3, format="json")
```
Expected: 3 search results.

## Test 3 — Amazon (was PASSING, regression check)
```
novada_scrape(platform="amazon.com", operation="amazon_product_keywords", params={keyword: "airpods"}, limit=3, format="json")
```
Expected: 3 products.

## Test 4 — LinkedIn (was PASSING, regression check)
```
novada_scrape(platform="linkedin.com", operation="linkedin_company_information_url", params={url: "https://www.linkedin.com/company/openai/"}, limit=1, format="json")
```
Expected: Company data.

## Test 5 — GitHub (was PASSING, regression check)
```
novada_scrape(platform="github.com", operation="github_repository_url", params={url: "https://github.com/anthropics/anthropic-sdk-python"}, limit=1, format="json")
```
Expected: Repo data.

## Test 6 — DuckDuckGo search (new test)
```
novada_scrape(platform="duckduckgo.com", operation="duckduckgo", params={q: "Claude MCP"}, limit=3, format="json")
```
Expected: 3 search results.

## Test 7 — YouTube (KNOWN ISSUE — Novada backend CAPTCHA)
```
novada_scrape(platform="youtube.com", operation="youtube_video-post_url", params={url: "https://www.youtube.com/@mkbhd/videos", sorting_method: "Latest", start_index: "1", num_of_posts: "3"}, limit=3, format="json")
```
Expected: May fail with CAPTCHA (Novada backend issue). If it returns data, it's a bonus.

---

## Pass criteria: Tests 1-6 must all pass. Test 7 is informational.
