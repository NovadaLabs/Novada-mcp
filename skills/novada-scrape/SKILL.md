# novada_scrape — Platform Scraper Skill

**When to use:** You need structured records from a known platform (Amazon, TikTok, Reddit, LinkedIn, etc.) — not raw HTML, but clean tabular data.

## Step 1: Find the right platform and operation

ALWAYS read the `novada://scraper-platforms` resource before calling novada_scrape. Platform names and operation IDs are exact — guessing causes 11008 errors.

```json
// Read the resource first:
// novada://scraper-platforms
```

## Common platforms quick reference

| Platform | Operation example | Key params |
|----------|------------------|------------|
| amazon.com | amazon_product_by-keywords | keyword, num |
| amazon.com | amazon_product_by-asin | asin |
| reddit.com | reddit_posts_by-keywords | keyword, num |
| tiktok.com | tiktok_user_videos | username, num |
| linkedin.com | linkedin_job_listings | keyword, location |
| google.com | google_search | q, num |
| glassdoor.com | glassdoor_jobs_by-keywords | keyword, location |
| zillow.com | zillow_listings | location |
| github.com | github_repository_details | owner, repo |

## Call pattern

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_by-keywords",
  "params": {"keyword": "mechanical keyboard", "num": 10},
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
- Pages not in the 129-platform list → use novada_crawl
- After getting 11006 → this is a plan-tier error, don't retry
