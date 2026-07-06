# Scrape, Crawl & Map

Three tools for different scales of web data extraction: structured platform data (`novada_scrape`), multi-page content extraction (`novada_crawl`), and URL discovery (`novada_map`).

## When to Use Which

| Scenario | Tool | Why |
|----------|------|-----|
| Product data from Amazon, TikTok, LinkedIn | `novada_scrape` | Returns clean structured records |
| Extract content from 5-20 pages of a docs site | `novada_crawl` | BFS/DFS multi-page extraction |
| Find all URLs on a site before reading | `novada_map` | Fast URL discovery, no content download |
| Read a single known URL | `novada_extract` | Use extract, not crawl or scrape |
| Unknown domain not in the platform list | `novada_crawl` or `novada_extract` | Scrape only covers 13 platforms |

---

## novada_scrape

Retrieve structured data from 13 supported platforms (~78 operations). Returns clean tabular records instead of raw HTML -- product listings, social posts, company profiles, search results.

### Supported Platforms

| Platform | Domain | Category | Example Operations |
|----------|--------|----------|-------------------|
| Amazon | `amazon.com` | E-Commerce | Product search, ASIN lookup, reviews, seller info |
| Walmart | `walmart.com` | E-Commerce | Product search, SKU lookup, category browse |
| Google | `google.com` | Search | Web search, SERP, Maps, Shopping, Jobs, Hotels |
| Bing | `bing.com` | Search | Web, Maps, Images, Videos, News, Shopping |
| DuckDuckGo | `duckduckgo.com` | Search | Web search |
| Yandex | `yandex.com` | Search | Web search |
| YouTube | `youtube.com` | Social | Video search, comments, transcripts, profiles, audio |
| X / Twitter | `x.com` | Social | Profile by URL/username, post by URL |
| TikTok | `tiktok.com` | Social | Posts by URL, profiles |
| Instagram | `instagram.com` | Social | Profiles, reels, posts, comments |
| Facebook | `facebook.com` | Social | Events, posts, comments, profiles |
| LinkedIn | `linkedin.com` | Professional | Company info, job listings |
| GitHub | `github.com` | Developer | Repository info, search |

> **Not available:** Reddit, Glassdoor, Zillow, Airbnb, eBay, Etsy, and ~94 other platforms have 0 active operations. Use `novada_extract` for those sites.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `platform` | string | Yes | -- | Platform domain. E.g. `"amazon.com"`, `"x.com"`, `"linkedin.com"` |
| `operation` | string | Yes | -- | Exact operation ID from the platform list below |
| `params` | object | Yes | `{}` | Operation-specific parameters (keyword, url, asin, etc.) |
| `format` | string | No | `"markdown"` | Output format: `"markdown"`, `"json"`, or `"toon"` |
| `limit` | number | No | `20` | Max records to return (1-100) |

### Output Formats

- **markdown** (default) -- Human-readable table. Best for reading in chat.
- **json** -- Structured array. Best for programmatic processing.
- **toon** -- Token-optimized pipe-separated format. 40-65% smaller than JSON/markdown. Best for context-constrained agents.

Output files are automatically saved to `~/Downloads/novada-mcp/` as JSON or CSV.

### Examples

**Search Amazon for products:**

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_keywords",
  "params": { "keyword": "mechanical keyboard" },
  "limit": 10
}
```

**Look up a specific Amazon product by ASIN:**

```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_asin",
  "params": { "asin": "B09V3KXJPB" }
}
```

**Get YouTube video details and search:**

```json
{
  "platform": "youtube.com",
  "operation": "youtube_video_search_label",
  "params": { "label": "MCP tutorial Claude" },
  "limit": 5
}
```

**Get LinkedIn company info:**

```json
{
  "platform": "linkedin.com",
  "operation": "linkedin_company_information_url",
  "params": { "url": "https://www.linkedin.com/company/anthropic/" }
}
```

**Scrape a Twitter/X profile:**

```json
{
  "platform": "x.com",
  "operation": "twitter_profile_username",
  "params": { "username": "AnthropicAI" }
}
```

**Google Shopping search:**

```json
{
  "platform": "google.com",
  "operation": "google_shopping_keywords",
  "params": { "keyword": "wireless earbuds" },
  "format": "json"
}
```

### Complete Operation Reference

#### Amazon (`amazon.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `amazon_product_keywords` | `{ keyword }` | Search products by keyword |
| `amazon_product_asin` | `{ asin }` | Lookup by ASIN |
| `amazon_product_url` | `{ url }` | Scrape product page URL |
| `amazon_product_category-url` | `{ url }` | Browse a category page |
| `amazon_product_best-sellers` | `{ url }` | Best sellers page |
| `amazon_global-product_url` | `{ url }` | Global product by URL |
| `amazon_global-product_category-url` | `{ url }` | Global category page |
| `amazon_global-product_seller-url` | `{ url }` | Global seller page |
| `amazon_global-product_keywords` | `{ keyword }` | Global keyword search |
| `amazon_global-product_keywords-brand` | `{ keyword }` | Global brand keyword search |
| `amazon_comment_url` | `{ url }` | Product reviews by URL |
| `amazon_seller_url` | `{ url }` | Seller profile |
| `amazon_product-list_keywords-domain` | `{ keyword }` | Product list by keyword+domain |

#### Walmart (`walmart.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `walmart_product_url` | `{ url }` | Product page |
| `walmart_product_category-url` | `{ url }` | Category page |
| `walmart_product_sku` | `{ sku }` | Lookup by SKU |
| `walmart_product_keywords` | `{ keyword }` | Search by keyword |
| `walmart_product_zipcodes` | `{ url, zip_code }` | Product with zip code pricing |

#### Google (`google.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `google_search` | `{ q, device?, domain?, country?, hl? }` | Web search |
| `google_serp_web` | `{ q }` | SERP web results |
| `google_serp_videos` | `{ q }` | SERP video results |
| `google_serp_hotels` | `{ q }` | SERP hotel results |
| `google_serp_jobs` | `{ q }` | SERP job results |
| `google_map-details_url` | `{ url }` | Google Maps by URL |
| `google_map-details_cid` | `{ cid }` | Google Maps by CID |
| `google_map-details_location` | `{ location }` | Google Maps by location |
| `google_map-details_placeid` | `{ place_id }` | Google Maps by place ID |
| `google_shopping_keywords` | `{ keyword }` | Shopping search |
| `google_comment_url` | `{ url }` | Google reviews |

#### Bing (`bing.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `bing_search` | `{ keyword }` | Web search |
| `bing_maps` | `{ keyword }` | Maps search |
| `bing_images` | `{ keyword }` | Image search |
| `bing_videos` | `{ keyword }` | Video search |
| `bing_news` | `{ keyword }` | News search |
| `bing_shopping` | `{ keyword }` | Shopping search |

#### DuckDuckGo (`duckduckgo.com`)

| Operation | Params |
|-----------|--------|
| `duckduckgo` | `{ keyword }` |

#### Yandex (`yandex.com`)

| Operation | Params |
|-----------|--------|
| `yandex` | `{ keyword }` |

#### YouTube (`youtube.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `youtube_video-post_url` | `{ url }` | Video details by URL |
| `youtube_video-post_search_filters` | `{ keyword }` | Search with filters |
| `youtube_video_search_label` | `{ label }` | Search by label |
| `youtube_video-post-podcast-url` | `{ url }` | Podcast episode |
| `youtube_video-post-keyword` | `{ keyword }` | Video by keyword |
| `youtube_video-post_explore` | `{ keyword }` | Explore trending |
| `youtube_product-videoid` | `{ video_id }` | Product info from video |
| `youtube_video-url` | `{ url }` | Video by URL |
| `youtube_audio_url` | `{ url }` | Audio extraction |
| `youtube_comment_id` | `{ video_id }` | Comments by video ID |
| `youtube_transcript_id` | `{ url }` | Transcript |
| `youtube_profiles_keyword` | `{ keyword }` | Channel search |
| `youtube_profiles_url` | `{ url }` | Channel by URL |

#### X / Twitter (`x.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `twitter_profile_profileurl` | `{ url }` | Profile by URL |
| `twitter_profile_username` | `{ username }` | Profile by username |
| `twitter_post_posturl` | `{ url }` | Single post by URL |

#### TikTok (`tiktok.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `tiktok_posts_url` | `{ url }` | Posts by URL |
| `tiktok_posts_profileurl` | `{ url }` | Posts from a profile |
| `tiktok_posts_listurl` | `{ url }` | Posts from a list |
| `tiktok_profiles_url` | `{ url }` | Profile details |
| `tiktok_profiles_listurl` | `{ url }` | Profile list |

#### Instagram (`instagram.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `ins_profiles_username` | `{ username }` | Profile by username |
| `ins_profiles_profileurl` | `{ url }` | Profile by URL |
| `ins_reel_url` | `{ url }` | Single reel |
| `ins_allreel_url` | `{ url }` | All reels from profile |
| `ins_posts_profileurl` | `{ url }` | Posts from profile |
| `ins_posts_posturl` | `{ url }` | Single post |
| `ins_comment_posturl` | `{ url }` | Comments on a post |

#### Facebook (`facebook.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `facebook_event_eventlist-url` | `{ url }` | Event list |
| `facebook_event_search-url` | `{ url }` | Event search |
| `facebook_event_events-url` | `{ url }` | Event details |
| `facebook_post_posts-url` | `{ url }` | Posts |
| `facebook_comment_comments-url` | `{ url }` | Comments |
| `facebook_profile_profiles-url` | `{ url }` | Profiles |

#### LinkedIn (`linkedin.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `linkedin_company_information_url` | `{ url }` | Company info |
| `linkedin_job_listings_information_job-listing-url` | `{ url }` | Job listing page |
| `linkedin_job_listings_information_job-url` | `{ url }` | Job details |
| `linkedin_job_listings_information_keyword` | `{ keyword }` | Job search |

#### GitHub (`github.com`)

| Operation | Params | Description |
|-----------|--------|-------------|
| `github_repository_repo-url` | `{ url }` | Repository details |
| `github_repository_search-url` | `{ url }` | Search results page |
| `github_repository_url` | `{ url }` | Repository by URL |

### Common Errors

| Error Code | Meaning | Fix |
|------------|---------|-----|
| 11006 | Invalid operation ID or Scraper API not activated | Verify the operation ID against the table above. If correct, activate Scraper API at dashboard. |
| 11008 | Unknown platform name | Use the exact domain (e.g. `"amazon.com"`, not `"amazon"`) |
| 50001/50002 | Authentication error | Check `NOVADA_API_KEY` |

### Discovering Platforms Programmatically

Read the `novada://scraper-platforms` MCP resource for the complete platform list at runtime:

```
Read resource: novada://scraper-platforms
```

This returns the full list with operation IDs and required parameters, verified against the live dashboard.

---

## novada_crawl

Extract content from multiple pages of a website. Crawls via BFS or DFS, up to 20 pages, extracting readable text from each. Use path regex filters to target specific sections.

### When to Use

- You need content from multiple pages on one domain (e.g., all `/docs/*` pages).
- You need BFS discovery of related content under a path prefix.
- Building a knowledge base from a documentation site.

### When NOT to Use

- Single page -- use `novada_extract` (faster, simpler).
- URL discovery only -- use `novada_map` (no content download, much faster).
- Structured platform data -- use `novada_scrape`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Starting URL to crawl from |
| `max_pages` | number | No | `5` | Maximum pages to crawl (1-20) |
| `strategy` | string | No | `"bfs"` | `"bfs"` (breadth-first) or `"dfs"` (depth-first) |
| `select_paths` | string[] | No | -- | Regex patterns to restrict URL paths. E.g. `["/docs/.*"]` |
| `exclude_paths` | string[] | No | -- | Regex patterns for paths to skip. E.g. `["/blog/.*"]` |
| `instructions` | string | No | -- | Natural language hint for page prioritization |
| `format` | string | No | `"markdown"` | Output format: `"markdown"` or `"json"` |
| `render` | string | No | `"auto"` | `"auto"`, `"static"`, or `"render"` (JS rendering) |
| `limit` | number | No | -- | Alias for `max_pages` |
| `mode` | string | No | -- | Alias for `strategy` |

### Crawl Strategies

- **BFS (breadth-first)** -- Visits all pages at the current depth before going deeper. Good for broad discovery across a site's top-level sections.
- **DFS (depth-first)** -- Follows links deeply before backtracking. Good for exploring a specific path thoroughly (e.g., a nested documentation tree).

### Rendering Modes

- **auto** (default) -- Starts with static HTML. If JS-heavy content is detected on the first batch, auto-escalates to JS rendering for subsequent pages.
- **static** -- Always fetch static HTML only. Fastest (~0.5s/page).
- **render** -- Always use JS rendering. Handles React/Vue/Angular SPAs. Slower (~3-5s/page).

### Examples

**Crawl a documentation site (first 10 pages):**

```json
{
  "url": "https://docs.example.com",
  "max_pages": 10,
  "strategy": "bfs"
}
```

**Crawl only API reference pages:**

```json
{
  "url": "https://docs.example.com",
  "max_pages": 15,
  "strategy": "bfs",
  "select_paths": ["/docs/api/.*", "/docs/reference/.*"],
  "exclude_paths": ["/docs/blog/.*", "/docs/changelog/.*"]
}
```

**Crawl a JS-heavy SPA with rendering:**

```json
{
  "url": "https://spa-docs.example.com",
  "max_pages": 5,
  "strategy": "dfs",
  "render": "render"
}
```

**Crawl with natural language instructions:**

```json
{
  "url": "https://docs.stripe.com",
  "max_pages": 10,
  "instructions": "only API reference pages, skip blog and changelog"
}
```

**Get structured JSON output:**

```json
{
  "url": "https://docs.example.com",
  "max_pages": 8,
  "format": "json"
}
```

The JSON output includes per-page objects with `url`, `title`, `depth`, `word_count`, `js_content_missing`, and `text` fields.

### Performance Notes

- Crawl time scales linearly: ~1.4s/page (static), ~3-5s/page (rendered).
- At `max_pages=20`, expect 28s minimum (static) or 60-100s (rendered).
- Total output is capped at ~25,000 characters. Pages exceeding the cap are truncated with a notice to use `novada_extract` for full content.
- Use `select_paths` to restrict scope before setting `max_pages` high.

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "Sparse content" error | Site returns bot challenge or requires JS | Set `render="render"` |
| Stopped early, few pages | JavaScript SPA generates links dynamically | Use `render="render"` or `novada_map` first |
| Pages truncated | Total crawl text exceeded 25K chars | Use `novada_extract` on individual URLs for full content |
| Seed URL excluded | `select_paths` filter doesn't match the starting URL | Adjust regex to include the seed path |

---

## novada_map

Discover all URLs on a website without downloading page content. Tries sitemap.xml first (fast, complete coverage), falls back to parallel BFS link crawl.

### When to Use

- Site structure discovery before deciding which pages to read.
- Finding the correct subpage URL when you extracted the wrong page.
- Planning which pages to pass to `novada_extract` or `novada_crawl`.

### When NOT to Use

- You need page content -- follow up with `novada_extract` or `novada_crawl`.
- Structured platform data -- use `novada_scrape`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Root URL to map |
| `limit` | number | No | `50` | Maximum URLs to return (1-100) |
| `search` | string | No | -- | Filter discovered URLs by this substring |
| `include_subdomains` | boolean | No | `false` | Include URLs from subdomains |
| `max_depth` | number | No | `2` | Link-hops from root to follow (1-5). Higher = slower but more URLs. |

### Discovery Strategy

1. **Sitemap check** -- Reads `robots.txt` for sitemap references, then tries `/sitemap.xml` and `/sitemap_index.xml`. Fastest method; returns comprehensive URL lists when available.
2. **BFS crawl fallback** -- If no sitemap is found, performs a parallel breadth-first crawl to discover URLs by following links. Respects `max_depth` and `limit`.

### Examples

**Discover all pages on a site:**

```json
{
  "url": "https://docs.example.com",
  "limit": 100
}
```

**Search for specific pages:**

```json
{
  "url": "https://docs.example.com",
  "search": "authentication"
}
```

**Include subdomains:**

```json
{
  "url": "https://example.com",
  "limit": 50,
  "include_subdomains": true
}
```

**Deep crawl for more URLs:**

```json
{
  "url": "https://docs.example.com",
  "limit": 100,
  "max_depth": 4
}
```

### Typical Workflow: Map then Extract

```
Step 1: novada_map({ url: "https://docs.example.com", search: "api" })
        --> Returns list of URLs matching "api"

Step 2: novada_extract({ url: ["https://docs.example.com/api/auth", "https://docs.example.com/api/users"] })
        --> Extracts content from the 2 most relevant pages
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 0 URLs returned | JavaScript SPA with no static links | Use `novada_crawl` with `render="render"`, or `novada_search` with `site:domain.com` |
| Binary content detected | URL points to PDF/ZIP/image | Use `novada_extract` to read the document content |
| Fewer URLs than expected | Site has limited same-domain links | Increase `max_depth` or `limit` |
| No results for search term | Term not in any URL path | Remove `search` filter to see all URLs, then search manually |

---

## Combining the Three Tools

### Competitive Analysis Pipeline

```
novada_map("https://competitor.com", limit=50)
  --> discover all pages

novada_crawl("https://competitor.com", select_paths=["/pricing", "/features"], max_pages=10)
  --> extract pricing and features pages

novada_scrape("amazon.com", "amazon_product_keywords", { keyword: "competitor product" })
  --> get competitor product listings
```

### Documentation Ingestion

```
novada_map("https://docs.example.com", limit=100)
  --> discover all doc pages

novada_crawl("https://docs.example.com", select_paths=["/docs/api/.*"], max_pages=20)
  --> extract all API reference pages
```

### E-Commerce Research

```
novada_scrape("amazon.com", "amazon_product_keywords", { keyword: "standing desk" }, limit=20)
  --> get top 20 product listings

novada_scrape("walmart.com", "walmart_product_keywords", { keyword: "standing desk" }, limit=20)
  --> compare with Walmart listings
```
