# novada_scrape — Platform Scraper Skill

**When to use:** You need structured records from a known platform (Amazon, TikTok, LinkedIn, GitHub, etc.) — not raw HTML, but clean tabular data. 16 platforms are in the catalog: Amazon, Walmart, SHEIN, Google (incl. Shopping), Bing, DuckDuckGo, Yandex, X/Twitter, TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub, ChatGPT, Perplexity. **15 of those 16 have a dedicated `novada_scrape_<platform>` tool** (see below) — only ChatGPT doesn't, because both of its catalog operations are backend-dead. Note: 8 operations across the catalog are currently backend-broken (forwarded with a warning — backend may fix any day); the other 79 are verified working as of 2026-07-13.

## Prefer the dedicated `novada_scrape_<platform>` tool over generic `novada_scrape`

For these 15 platforms, call the dedicated tool instead of generic `novada_scrape` — its `operation` parameter is a **closed, typed enum** scoped to exactly that platform's verified-working operations. This removes the two failure modes generic `novada_scrape` is prone to: error 11008 (wrong/misspelled platform name) and picking an operation ID that belongs to a different platform. Same params shape otherwise (`params`, `limit`, `format`), same output rendering.

| Tool | Platform | Verified ops |
|------|----------|--------------|
| `novada_scrape_amazon` | amazon.com | 10 |
| `novada_scrape_google` | google.com | 13 |
| `novada_scrape_bing` | bing.com | 4 |
| `novada_scrape_duckduckgo` | duckduckgo.com | 1 |
| `novada_scrape_yandex` | yandex.com | 1 |
| `novada_scrape_youtube` | youtube.com | 13 |
| `novada_scrape_instagram` | instagram.com | 7 |
| `novada_scrape_facebook` | facebook.com | 6 |
| `novada_scrape_tiktok` | tiktok.com | 5 |
| `novada_scrape_x` | x.com / twitter.com | 3 |
| `novada_scrape_walmart` | walmart.com | 5 |
| `novada_scrape_shein` | shein.com | 2 |
| `novada_scrape_linkedin` | linkedin.com | 4 |
| `novada_scrape_github` | github.com | 3 |
| `novada_scrape_perplexity` | perplexity.ai | 2 |

Fall back to generic `novada_scrape` only for a platform outside this list of 15 (e.g. ChatGPT, currently backend-dead either way).

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
- `csv` — inline CSV text, header row + one row per record
- `excel` (alias `xlsx`) — real .xlsx via exceljs, returned inline as base64
- `html` — inline HTML `<table>`

## Deliverable-first: default to a file, not a wall of text

When a result has more than ~10 records, don't dump every row as inline markdown/JSON — produce a file instead. This is the default behavior, not an opt-in:

1. Call with `format: "excel"` for general/business consumers, or `format: "csv"`/`"json"` if the user's phrasing points to a technical/programmatic consumer.
2. `excel` returns inline base64, `csv`/`json` return inline text — decode/save it yourself as an actual file (e.g. via the Write tool locally, or as a downloadable artifact in your environment). Name it `<topic-or-query>-<platform>-<YYYY-MM-DD>.<ext>`, kebab-case.
3. Carry the tool's own header line (`platform: ... | operation: ... | records: ... | format: ...`) into the file — as a title row in the xlsx sheet, or a leading comment line in the CSV — so the file is self-describing even opened out of context.
4. Lead your response with the file path/download reference, not a prose recap — the deliverable is the point.

Under ~10 records (a quick lookup, single answer): inline markdown stays correct — don't force a file for small results.

## Error handling

| Error | Meaning | Action |
|-------|---------|--------|
| 11006 | Scraper API not activated | Activate at dashboard.novada.com. Do NOT retry. |
| 11008 | Invalid platform name | Check platform name. Read novada://scraper-platforms. |
| 10001 | Invalid file type for operation | Try different operation. Contact support. |
| code 0, no task_id | Unexpected response shape | Retry once. |

## When NOT to use novada_scrape

- Arbitrary web pages → use novada_extract
- Pages not in the 16-platform catalog → use novada_crawl
- After getting 11006 → this is a plan-tier error, don't retry
