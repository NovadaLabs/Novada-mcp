# Novada Scraper API — Operation IDs

> Extracted from dashboard.novada.com/overview/scraper/api-playground/ on 2026-05-18.
> Source of truth for all `scraper_id` and `scraper_name` values.
> 13 platforms active (scene_total > 0). All others (Reddit, Glassdoor, Zillow, etc.) = 0 scenes, not yet available.

## Format

Every request to `POST https://scraper.novada.com/request` requires:
- `scraper_name` — platform domain (e.g. `google.com`)
- `scraper_id` — operation identifier (values listed below)
- `scraper_errors=true` — include error details
- `is_auto_push=false` — don't auto-push results

### TWO param formats (CRITICAL — verified 2026-05-18):

**Format A — Search engines** (google.com, bing.com, duckduckgo.com, yandex.com):
- Flat form fields: `-d "q=test" -d "json=1" -d "device=desktop"`
- `json=1` is REQUIRED to get JSON-format results
- Response: `[{spider_code: 200, rest: {search_metadata: {...}, organic_results: [...]}}]`

**Format B — All other platforms** (amazon, linkedin, youtube, instagram, etc.):
- JSON array: `-d 'scraper_params=[{"keyword":"iphone 15"}]'`
- Response: `[{title: "...", error: null, success: true, ...}]` (flat records)

---

## google.com

Platform ID: 25

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| Google Search Engine Scraping | google search | `google_search` |
| Google Search Engine Scraping | Google web | `google_serp_web` |
| Google Search Engine Scraping | Google Videos | `google_serp_videos` |
| Google Search Engine Scraping | Google Hotels | `google_serp_hotels` |
| Google Search Engine Scraping | Google Jobs | `google_serp_jobs` |
| Google Maps Information | By URL | `google_map-details_url` |
| Google Maps Information | By CID | `google_map-details_cid` |
| Google Maps Information | By Location | `google_map-details_location` |
| Google Maps Information | By Merchant ID / Place ID | `google_map-details_placeid` |
| Google Shopping Information | By Keyword | `google_shopping_keywords` |
| Google Maps Reviews | Via URL | `google_comment_url` |

Key params: `google_search` uses `q` (keyword). Maps use `url` or `place_id`. Shopping uses `keyword`.

---

## amazon.com

Platform ID: 7

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| Amazon Product Scraper | By ASIN | `amazon_product_asin` |
| Amazon Product Scraper | By Product URL | `amazon_product_url` |
| Amazon Product Scraper | By Keywords | `amazon_product_keywords` |
| Amazon Product Scraper | By Product Category URL | `amazon_product_category-url` |
| Amazon Product Scraper | By Bestselling Product URL | `amazon_product_best-sellers` |
| Amazon Global Product | By URL | `amazon_global-product_url` |
| Amazon Global Product | By Product Category URL | `amazon_global-product_category-url` |
| Amazon Global Product | By Seller URL | `amazon_global-product_seller-url` |
| Amazon Global Product | By Keywords | `amazon_global-product_keywords` |
| Amazon Global Product | By Keyword or Brand | `amazon_global-product_keywords-brand` |
| Amazon Reviews/Comments | By URL | `amazon_comment_url` |
| Amazon Seller | By URL | `amazon_seller_url` |
| Amazon Product List | By Keywords | `amazon_product-list_keywords-domain` |

Key params: `amazon_product_asin` uses `asin`. `amazon_product_keywords` uses `keyword`.

---

## youtube.com

Platform ID: 13

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| YouTube Video Posts | By Video URL | `youtube_video-post_url` |
| YouTube Video Posts | By Video Search Filters | `youtube_video-post_search_filters` |
| YouTube Video Posts | By Label | `youtube_video_search_label` |
| YouTube Video Posts | By Podcast URL | `youtube_video-post-podcast-url` |
| YouTube Video Posts | By Keywords | `youtube_video-post-keyword` |
| YouTube Video Posts | By Exploration | `youtube_video-post_explore` |
| YouTube Video Posts | By Video ID | `youtube_product-videoid` |
| YouTube Video | By URL | `youtube_video-url` |
| YouTube Audio | By Audio URL | `youtube_audio_url` |
| YouTube Comments | By Video ID | `youtube_comment_id` |
| YouTube Transcript | By URL | `youtube_transcript_id` |
| YouTube Profiles | By Keywords | `youtube_profiles_keyword` |
| YouTube Profiles | By URL | `youtube_profiles_url` |

Key params: `youtube_video-post_url` uses `url`. `youtube_video-post-keyword` uses `keyword`.

---

## linkedin.com

Platform ID: 23

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| LinkedIn Company Information | By Company URL | `linkedin_company_information_url` |
| LinkedIn Job Listings | By Job Listing URL | `linkedin_job_listings_information_job-listing-url` |
| LinkedIn Job Listings | By Job URL | `linkedin_job_listings_information_job-url` |
| LinkedIn Job Listings | By Keywords | `linkedin_job_listings_information_keyword` |

Key params: `linkedin_company_information_url` uses `url`. Job listings use `url` or `keyword`.

---

## instagram.com

Platform ID: 24

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| Instagram Profiles | By Username | `ins_profiles_username` |
| Instagram Profiles | By Profile URL | `ins_profiles_profileurl` |
| Instagram Reels | By Reels URL | `ins_reel_url` |
| Instagram Reels | By Reels List URL | `ins_allreel_url` |
| Instagram Posts | By Profile URL | `ins_posts_profileurl` |
| Instagram Posts | By Post URL | `ins_posts_posturl` |
| Instagram Comments | By Post URL | `ins_comment_posturl` |

Key params: username-based ops use `username`. URL-based ops use `url`.

---

## facebook.com

Platform ID: 29

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| Facebook Events | By Event List URL | `facebook_event_eventlist-url` |
| Facebook Events | By Activity Search URL | `facebook_event_search-url` |
| Facebook Events | By Activity URL | `facebook_event_events-url` |
| Facebook Posts | By URL | `facebook_post_posts-url` |
| Facebook Comments | By Post URL | `facebook_comment_comments-url` |
| Facebook Profiles | By Personal Homepage URL | `facebook_profile_profiles-url` |

Key params: All URL-based, use `url`.

---

## tiktok.com

Platform ID: 22

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| TikTok Posts | By Video URL | `tiktok_posts_url` |
| TikTok Posts | By Profile URL | `tiktok_posts_profileurl` |
| TikTok Posts | By List URL | `tiktok_posts_listurl` |
| TikTok Profiles | By URL | `tiktok_profiles_url` |
| TikTok Profiles | By List URL | `tiktok_profiles_listurl` |

Key params: All URL-based, use `url`.

---

## bing.com

Platform ID: 26

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| Bing Search | Web Search | `bing_search` |
| Bing Maps | Maps | `bing_maps` |
| Bing Images | Images | `bing_images` |
| Bing Videos | Videos | `bing_videos` |
| Bing News | News | `bing_news` |
| Bing Shopping | Shopping | `bing_shopping` |

Key params: `bing_search` uses `keyword`.

---

## walmart.com

Platform ID: 21

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| Walmart Product | By Product URL | `walmart_product_url` |
| Walmart Product | By Category URL | `walmart_product_category-url` |
| Walmart Product | By SKU | `walmart_product_sku` |
| Walmart Product | By Keywords | `walmart_product_keywords` |
| Walmart Product | By Postal Code | `walmart_product_zipcodes` |

Key params: URL ops use `url`. Keyword ops use `keyword`. SKU uses `sku`. Postal uses `zip_code`.

---

## duckduckgo.com

Platform ID: 28

| Scene | scraper_id |
|-------|-----------|
| DuckDuckGo Web Search | `duckduckgo` |

Key params: uses `keyword`.

---

## yandex.com

Platform ID: 27

| Scene | scraper_id |
|-------|-----------|
| Yandex Web Search | `yandex` |

Key params: uses `keyword`.

---

## github.com

Platform ID: 126

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| GitHub Repository | By Repository URL | `github_repository_repo-url` |
| GitHub Repository | Via Search URL | `github_repository_search-url` |
| GitHub Repository | Via URL | `github_repository_url` |

Key params: URL-based ops use `url`.

---

## x.com (Twitter)

Platform ID: 31

| Scene | Sub-scene | scraper_id |
|-------|-----------|-----------|
| X Profile | By Profile URL | `twitter_profile_profileurl` |
| X Profile | By Username | `twitter_profile_username` |
| X Posts | By Post URL | `twitter_post_posturl` |

Key params: `twitter_profile_username` uses `username`. URL ops use `url`.

---

## Platforms with 0 scenes (NOT yet available)

These exist in the platform list but have no operations. Do NOT use them — any request will return error 11006.

reddit.com, glassdoor.com, zillow.com, tripadvisor.com, airbnb.com, booking.com, etsy.com, ebay.com, aliexpress.com, shopee.com, lazada.com, tokopedia.com, and ~94 others.

---

## Params Format Bug (CRITICAL)

The MCP `submitScrapeTask` in `scrape.ts` must wrap all operation params in a `scraper_params` JSON array:

```
# WRONG (current code):
-d "keyword=iphone 15"

# CORRECT:
-d 'scraper_params=[{"keyword":"iphone 15"}]'
```

Exception: `google_search` accepts both flat params AND `scraper_params` array.
All other operations require the `scraper_params` array format.

---

## Previous Incorrect IDs in MCP (now fixed)

| Was in MCP | Correct ID |
|------------|-----------|
| `amazon_product_by-keywords` | `amazon_product_keywords` |
| `amazon_product_by-asin` | `amazon_product_asin` |
| `youtube_search_by-keywords` | `youtube_video-post-keyword` |
| `github_repository_details` | `github_repository_url` or `github_repository_repo-url` |
| `reddit_posts_by-keywords` | **Not available** (0 scenes) |
