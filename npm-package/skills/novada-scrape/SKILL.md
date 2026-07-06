# novada_scrape — Platform Scraper Skill

**When to use:** You need structured records from a known platform (Amazon, TikTok, LinkedIn, GitHub, etc.) — not raw HTML, but clean tabular data. 13 platforms are supported: Amazon, Walmart, Google (incl. Shopping), Bing, DuckDuckGo, Yandex, X/Twitter, TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub.

## Step 1: Find the right platform and operation

ALWAYS read the `novada://scraper-platforms` resource before calling novada_scrape. Platform names and operation IDs are exact — guessing causes 11008 errors.

```json
// Read the resource first:
// novada://scraper-platforms
```

## Common platforms quick reference

| Platform | Operation example | Key params |
|----------|------------------|------------|
| amazon.com | amazon_product_keywords | keyword |
| amazon.com | amazon_product_asin | asin |
| walmart.com | walmart_product_keywords | keyword |
| tiktok.com | tiktok_posts_url | url |
| linkedin.com | linkedin_company_information_url | url |
| google.com | google_search | q, num |
| google.com | google_shopping_keywords | keyword |
| youtube.com | youtube_video_search_label | label |
| github.com | github_repository_repo-url | url |

(Exact operation IDs vary — always read `novada://scraper-platforms` first.)

## Call pattern

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_keywords",
  "params": {"keyword": "mechanical keyboard"},
  "format": "markdown",
  "limit": 10
}
```

## Format guide

- `markdown` — best for agents reading and reasoning over results
- `json` — best for code processing and downstream pipelines
- `toon` — token-optimized format (40-65% smaller), pipe-separated rows

## Error handling

| Error | Meaning | Action |
|-------|---------|--------|
| 11006 | Scraper API not activated | Activate at dashboard.novada.com. Do NOT retry. |
| 11008 | Invalid platform name | Check platform name. Read novada://scraper-platforms. |
| 10001 | Invalid file type for operation | Try different operation. Contact support. |
| code 0, no task_id | Unexpected response shape | Retry once. |

## When NOT to use novada_scrape

- Arbitrary web pages → use novada_extract
- Pages not in the 13-platform list → use novada_crawl
- After getting 11006 → this is a plan-tier error, don't retry
