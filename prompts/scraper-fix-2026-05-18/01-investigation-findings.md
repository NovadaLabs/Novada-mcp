# Scraper API Investigation Findings — 2026-05-18

## Root Cause: Two Param Formats

The Novada Scraper API uses TWO different param formats depending on the platform:

### Format A — Search Engines (flat form fields)
**Platforms:** google.com, bing.com, duckduckgo.com, yandex.com

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_search" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=test" \
  -d "json=1" \
  -d "device=desktop" \
  -d "domain=google.com" \
  -d "country=us" \
  -d "hl=en"
```

**Response format:** `[{spider_code: 200, rest: {search_metadata: {...}, organic_results: [...]}}]`

### Format B — All Other Platforms (scraper_params array)
**Platforms:** amazon.com, linkedin.com, youtube.com, instagram.com, facebook.com, tiktok.com, x.com, walmart.com, github.com

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_keywords" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"iphone 15\"}]" \
  -d "is_auto_push=false"
```

**Response format:** `[{title: "...", asin: "...", error: null, success: true, ...}]` (flat records)

### Common Fields (both formats)
- `scraper_errors=true` — include error details in response
- `is_auto_push=false` — don't auto-push results
- `json=1` — (search engines only) request JSON output format

## YouTube CAPTCHA Issue

YouTube scraping returns 403 CAPTCHA errors on Novada's backend. This is NOT an MCP bug.
- `youtube_video-post_url` expects a channel URL + sorting params, not a single video URL
- `youtube_video-url` is for single videos but also hits CAPTCHA
- Report to fudong as a Novada backend issue

## Verified Test Results (curl)

| Platform | Format | Submit | Scrape | Download JSON |
|----------|--------|--------|--------|---------------|
| google.com | flat | code 0 | spider_code 200 | WORKS |
| bing.com | flat | code 0 | spider_code 200 | WORKS |
| amazon.com | scraper_params | code 0 | 19 products | WORKS |
| linkedin.com | scraper_params | code 0 | 1 company | WORKS |
| github.com | scraper_params | code 0 | 1 repo | WORKS |
| youtube.com | scraper_params | code 0 | 403 CAPTCHA | Novada backend |
