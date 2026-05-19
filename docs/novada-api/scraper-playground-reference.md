# Novada Scraper API — Complete Playground Reference

> Extracted from dashboard.novada.com/overview/scraper/api-playground/ on 2026-05-18.
> 78 operations across 13 platforms. Every curl command is copy-paste ready.
> Replace `YOUR_API_KEY` with your Novada API key.
> Source: https://dashboard.novada.com/overview/scraper/api-playground/

## Quick Start

```bash
# 1. Set your API key
export NOVADA_API_KEY=your_key_here

# 2. Submit a scrape task (returns task_id)
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer $NOVADA_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_keywords" \
  -d "scraper_errors=true" \
  -d 'scraper_params=[{"keyword":"iphone 15"}]' \
  -d "is_auto_push=false"

# 3. Poll for result (replace TASK_ID)
curl "https://api.novada.com/g/api/proxy/scraper_download?task_id=TASK_ID&file_type=json&apikey=$NOVADA_API_KEY"
```

## Two Param Formats

| Format | Platforms | How |
|--------|-----------|-----|
| **Flat params** | google, bing, duckduckgo, yandex | `-d "q=test" -d "json=1"` |
| **scraper_params array** | amazon, youtube, linkedin, instagram, facebook, tiktok, walmart, github, x.com | `-d 'scraper_params=[{"key":"val"}]'` |

---

## google.com (11 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=25

### `google_search`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_search" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "device=desktop" \
  -d "json=1" \
  -d "render_js=false" \
  -d "no_cache=false" \
  -d "ai_overview=false" \
  -d "domain=google.com" \
  -d "country=us" \
  -d "hl=en" \
  -d "safe=off"
```

### `google_serp_web`
Scene: Google web

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_serp_web" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "device=desktop" \
  -d "json=1" \
  -d "render_js=false" \
  -d "no_cache=false" \
  -d "domain=google.com" \
  -d "country=us" \
  -d "hl=en" \
  -d "cr=countryAU" \
  -d "safe=off"
```

### `google_serp_videos`
Scene: Google Videos

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_serp_videos" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "domain=google.com" \
  -d "country=us" \
  -d "hl=en" \
  -d "safe=off"
```

### `google_serp_hotels`
Scene: google hotels

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_serp_hotels" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "domain=google.com" \
  -d "country=us" \
  -d "hl=en" \
  -d "check_in_date=2026-01-10" \
  -d "check_out_date=2026-01-15"
```

### `google_serp_jobs`
Scene: Google Jobs

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_serp_jobs" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "domain=google.com" \
  -d "country=us" \
  -d "hl=en" \
  -d "safe=off"
```

### `google_map-details_url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_map-details_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.google.com/maps/place/Apple+Valley+Airport/@34.5728574,-117.1933326,17z/data=!3m1!4b1!4m6!3m5!1s0x80c36229c7225aad:0x35497575ff4ef638!8m2!3d34.572853!4d-117.1907577!16s%2Fm%2F025ywmw?authuser=0&hl=en&entry=ttu&g_ep=EgoyMDI2MDMxNS4wIKXMDSoASAFQAw%3D%3D\"}]" \
  -d "is_auto_push=false"
```

### `google_map-details_cid`
Scene: By CID

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_map-details_cid" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"cid\":\"5751726597071950148\"}]" \
  -d "is_auto_push=false" \
  -d "file_name={{TasksID}}"
```

### `google_map-details_location`
Scene: By location

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_map-details_location" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"country\":\"gb\",\"keyword\":\"iphone\",\"merchant_limit \":\"5\",\"lat\":\"\",\"long\":\"\",\"zl\":\"\"}]" \
  -d "is_auto_push=false"
```

### `google_map-details_placeid`
Scene: By merchant ID

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_map-details_placeid" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"place_id\":\"ChIJN1t_tDeuEmsRUsoyG83frY4\"}]" \
  -d "is_auto_push=false"
```

### `google_shopping_keywords`
Scene: By Keyword

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_shopping_keywords" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"pizza\",\"country\":\"us\"}]" \
  -d "is_auto_push=false" \
  -d "file_name={{TasksID}}"
```

### `google_comment_url`
Scene: Via URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=google.com" \
  -d "scraper_id=google_comment_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.google.com/maps/place/Apple+Higuera+Street/@35.280377,-120.661721,898m/data=!3m1!1e3!4m16!1m9!3m8!1s0x80ecf103bcc3e3b3:0xb614fedd28b71ea2!2sApple+Higuera+Street!8m2!3d35.280377!4d-120.661721!9m1!1b1!16s%2Fg%2F1tc_fl2d!3m5!1s0x80ecf103bcc3e3b3:0xb614fedd28b71ea2!8m2!3d35.280377!4d-120.661721!16s%2Fg%2F1tc_fl2d?authuser=0&hl=en&entry=ttu&g_ep=EgoyMDI2MDMyMi4wIKXMDSoASAFQAw%3D%3D\",\"limit\":\"30\"}]" \
  -d "is_auto_push=false"
```

---

## amazon.com (13 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=7

### `amazon_product_asin`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_asin" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"asin\":\"B0BWBK8F37\"}]" \
  -d "is_auto_push=false"
```

### `amazon_product_url`
Scene: By Product URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/dp/B0BWBK8F37/\",\"zip_code\":\"\"}]" \
  -d "is_auto_push=false"
```

### `amazon_product_keywords`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_keywords" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"Coffer\",\"max_pages\":\"1\",\"min_price\":\"5\",\"max_price\":\"50\"}]" \
  -d "is_auto_push=false"
```

### `amazon_product_category-url`
Scene: By Product Category URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_category-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"URLs\":\"https://www.amazon.com/s?k=coffer\",\"max_pages\":\"1\",\"sort_by\":\"Best Sellers\"}]" \
  -d "is_auto_push=false"
```

### `amazon_product_best-sellers`
Scene: By Bestselling Product URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product_best-sellers" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/best-sellers-movies-TV-DVD-Blu-ray/zgbs/movies-tv\",\"max_pages\":\"1\"}]" \
  -d "is_auto_push=false"
```

### `amazon_global-product_url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_global-product_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/dp/B0BWBK8F37/\"}]" \
  -d "is_auto_push=false"
```

### `amazon_global-product_category-url`
Scene: By Product Category URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_global-product_category-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/s?k=coffer\",\"maximum\":\"3\",\"sort_by\":\"Best Sellers\",\"get_sponsored\":\"false\"}]" \
  -d "is_auto_push=false"
```

### `amazon_global-product_seller-url`
Scene: By Seller URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_global-product_seller-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/stores/page/45E1434A-FD58-40A7-BC14-A698CD36DF7C?ingress=2&lp_context_asin=B0DZ75TN5F&visitId=d75d18f3-4036-4781-80a8-b9f3b2045b07&ref_=ast_bln\",\"maximum\":\"10\"}]" \
  -d "is_auto_push=false"
```

### `amazon_global-product_keywords`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_global-product_keywords" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"Chocolate\",\"domain\":\"https://www.amazon.com\",\"min_price\":\"10\",\"max_price\":\"30\",\"max_pages\":\"1\"}]" \
  -d "is_auto_push=false"
```

### `amazon_global-product_keywords-brand`
Scene: By Keyword or Brand

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_global-product_keywords-brand" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"iphone 17 Pro Max\",\"brands\":\"Apple\",\"max_pages\":\"1\"}]" \
  -d "is_auto_push=false"
```

### `amazon_comment_url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_comment_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/dp/B0987XD787\"}]" \
  -d "is_auto_push=false"
```

### `amazon_seller_url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_seller_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.amazon.com/sp?seller=A19CIDGEL341NO\"}]" \
  -d "is_auto_push=false"
```

### `amazon_product-list_keywords-domain`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=amazon.com" \
  -d "scraper_id=amazon_product-list_keywords-domain" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"Coffee\",\"domain\":\"https://www.amazon.com\",\"max_pages\":\"1\"}]" \
  -d "is_auto_push=false"
```

---

## youtube.com (13 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=13

### `youtube_video-post_url`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-post_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.youtube.com/@dukehuanyoushijie/videos\",\"sorting_method\":\"Latest\",\"start_index\":\"1\",\"num_of_posts\":\"10\"}]" \
  -d "is_auto_push=false"
```

### `youtube_video-post_search_filters`
Scene: By Video Search Filters

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-post_search_filters" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword_search\":\"music\",\"attributes\":\"\",\"type\":\"\",\"duration\":\"\",\"upload_date\":\"\",\"num_of_posts\":\"\"}]" \
  -d "is_auto_push=false"
```

### `youtube_video_search_label`
Scene: By Label

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video_search_label" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"search_label\":\"pupular\",\"num_of_posts\":\"10\"}]" \
  -d "is_auto_push=false"
```

### `youtube_video-post-podcast-url`
Scene: By Podcast URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-post-podcast-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.youtube.com/playlist?list=RDCLAK5uy_lS3E3PgpboCkZ_PfLPCkLLNPI1uH6kfc0\",\"num_of_posts\":\"\"}]" \
  -d "is_auto_push=false"
```

### `youtube_video-post-keyword`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-post-keyword" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"Top music\",\"num_of_posts\":\"10\"}]" \
  -d "is_auto_push=false"
```

### `youtube_video-post_explore`
Scene: By Exploration

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-post_explore" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.youtube.com/watch?v=HAwTwmzgNc4\",\"all_labels\":\"\"}]" \
  -d "is_auto_push=false"
```

### `youtube_product-videoid`
Scene: By Video ID

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_product-videoid" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"video_id\":\"HAwTwmzgNc4\"}]" \
  -d "is_auto_push=false"
```

### `youtube_video-url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.youtube.com/watch?v=_SdpvpvVrLY\"}]" \
  -d "scraper_universal={\"resolution\":\"≥720p\",\"video_codec\":\"avc1\",\"audio_format\":\"m4a\",\"bitrate\":\"≥160\",\"subtitles_language\":\"ab\",\"selected_only\":\"false\"}" \
  -d "is_auto_push=false"
```

### `youtube_audio_url`
Scene: By Audio URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_audio_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.youtube.com/watch?v=5qap5aO4i9A\"}]" \
  -d "scraper_universal={\"bitrate\":\"≤64\",\"audio_format\":\"m4a\",\"kHz\":\"\",\"is_subtitles\":\"false\",\"selected_format\":\"false\"}" \
  -d "is_auto_push=false" \
  -d "file_name={{VideoID}}"
```

### `youtube_comment_id`
Scene: By Video ID

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_comment_id" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"video_id\":\"w6hQCEQZoac\",\"replay_times\":\"10\",\"sorting_methods\":\"\",\"num_of_comments\":\"10\"}]" \
  -d "is_auto_push=false"
```

### `youtube_transcript_id`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_transcript_id" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"video_id\":\"LCAY3PGHZyw\"}]" \
  -d "scraper_universal={\"subtitles_language\":\"pt\",\"subtitles_type\":\"uploader_provided\",\"selected_only\":\"false\"}" \
  -d "is_auto_push=false"
```

### `youtube_profiles_keyword`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_profiles_keyword" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"keyword\":\"proxy\",\"page_numbers\":\"2\"}]" \
  -d "is_auto_push=false"
```

### `youtube_profiles_url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_profiles_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.youtube.com/@disneykids\"}]" \
  -d "is_auto_push=false"
```

---

## linkedin.com (4 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=23

### `linkedin_company_information_url`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=linkedin.com" \
  -d "scraper_id=linkedin_company_information_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.linkedin.com/company/novadaproxies/\"}]" \
  -d "is_auto_push=false"
```

### `linkedin_job_listings_information_job-listing-url`
Scene: By Job Listing URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=linkedin.com" \
  -d "scraper_id=linkedin_job_listings_information_job-listing-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"listing_url\":\"https://www.linkedin.com/jobs/search?keywords=Google%20Ads&location=Worldwide&geoId=92000000&trk=public_jobs_jobs-search-bar_search-submit&position=1&pageNum=0\",\"page_limit\":\"0\"}]" \
  -d "is_auto_push=false"
```

### `linkedin_job_listings_information_job-url`
Scene: By Job URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=linkedin.com" \
  -d "scraper_id=linkedin_job_listings_information_job-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"position_url\":\"https://www.linkedin.com/jobs/view/4378890064/?alternateChannel=search&eBP=NON_CHARGEABLE_CHANNEL&trk=d_flagship3_search_srp_jobs&refId=wQ3OJoLFRtDTS7VOTG8uVA%3D%3D&trackingId=WIH7fcyGLiR68ooAC41DQA%3D%3D\"}]" \
  -d "is_auto_push=false" \
  -d "file_name={file_name}"
```

### `linkedin_job_listings_information_keyword`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=linkedin.com" \
  -d "scraper_id=linkedin_job_listings_information_keyword" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"location\":\"Germany\",\"keyword\":\"product manager\",\"range\":\"Any_time\",\"level\":\"Internship\",\"position_type\":\"Full_time\",\"remote\":\"On_site\",\"company\":\"\",\"selective_search\":\"\",\"position_to_not_include\":\"\",\"location_radius\":\"\",\"page_limit\":\"\"}]" \
  -d "is_auto_push=false" \
  -d "file_name={file_name}"
```

---

## instagram.com (7 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=24

### `ins_profiles_username`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_profiles_username" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"username\":\"novadaproxies\"}]" \
  -d "is_auto_push=false"
```

### `ins_profiles_profileurl`
Scene: By Profile URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_profiles_profileurl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"profileurl\":\"https://www.instagram.com/novadaproxies/\"}]" \
  -d "is_auto_push=false"
```

### `ins_reel_url`
Scene: By Reels URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_reel_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.instagram.com/reel/DWWNIklky2O/\"}]" \
  -d "is_auto_push=false"
```

### `ins_allreel_url`
Scene: By Reels List URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_allreel_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.instagram.com/laikastudios/\",\"num_posts\":\"5\",\"uncrawled_posts\":\"3860725888782584854\",\"start_date\":\"\",\"end_date\":\"\"}]" \
  -d "is_auto_push=false"
```

### `ins_posts_profileurl`
Scene: By Profile URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_posts_profileurl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"profileurl\":\"https://www.instagram.com/novadaproxies/\",\"resultsLimit\":\"10\",\"start_date\":\"\",\"end_date\":\"\",\"post_type\":\"Post\"}]" \
  -d "is_auto_push=false"
```

### `ins_posts_posturl`
Scene: By Post URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_posts_posturl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"posturl\":\"https://www.instagram.com/p/DWT8s6zDYUh\"}]" \
  -d "is_auto_push=false"
```

### `ins_comment_posturl`
Scene: By Post URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=instagram.com" \
  -d "scraper_id=ins_comment_posturl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"posturl\":\"https://www.instagram.com/cats_of_instagram/reel/CyFH4k6qEF0/\"}]" \
  -d "is_auto_push=false"
```

---

## facebook.com (6 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=29

### `facebook_event_eventlist-url`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=facebook.com" \
  -d "scraper_id=facebook_event_eventlist-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.facebook.com/yestheory/events\",\"upcoming_events\":\"false\"}]" \
  -d "is_auto_push=false"
```

### `facebook_event_search-url`
Scene: By activity search URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=facebook.com" \
  -d "scraper_id=facebook_event_search-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.facebook.com/events/search/?q=Linkin%20Park\"}]" \
  -d "is_auto_push=false"
```

### `facebook_event_events-url`
Scene: By activity URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=facebook.com" \
  -d "scraper_id=facebook_event_events-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.facebook.com/events/4332074220347336\"}]" \
  -d "is_auto_push=false"
```

### `facebook_post_posts-url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=facebook.com" \
  -d "scraper_id=facebook_post_posts-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.facebook.com/zuck/posts/10102577175875681\"}]" \
  -d "is_auto_push=false"
```

### `facebook_comment_comments-url`
Scene: By Post URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=facebook.com" \
  -d "scraper_id=facebook_comment_comments-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.facebook.com/share/p/1K6xfHFkrK/\",\"get_all_replies\":\"True\",\"limit_records\":\"10\"}]" \
  -d "is_auto_push=false"
```

### `facebook_profile_profiles-url`
Scene: By personal homepage URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=facebook.com" \
  -d "scraper_id=facebook_profile_profiles-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.facebook.com/buzzfeedtastyjapan\"}]" \
  -d "is_auto_push=false"
```

---

## tiktok.com (5 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=22

### `tiktok_posts_url`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=tiktok.com" \
  -d "scraper_id=tiktok_posts_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.tiktok.com/@gingercat168/video/7586318922010332446\",\"country\":\"BR\"}]" \
  -d "is_auto_push=false"
```

### `tiktok_posts_profileurl`
Scene: By Profile URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=tiktok.com" \
  -d "scraper_id=tiktok_posts_profileurl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.tiktok.com/@gingercat168\",\"start_date\":\"\",\"end_date\":\"\",\"num_of_posts\":\"\",\"what_to_collect\":\"\",\"post_type\":\"\",\"country\":\"\",\"posts_to_not_include\":\"postsid\"}]" \
  -d "is_auto_push=false"
```

### `tiktok_posts_listurl`
Scene: By LIst URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=tiktok.com" \
  -d "scraper_id=tiktok_posts_listurl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.tiktok.com/discover/cake\",\"num_of_posts\":\"3\"}]" \
  -d "is_auto_push=false"
```

### `tiktok_profiles_url`
Scene: By URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=tiktok.com" \
  -d "scraper_id=tiktok_profiles_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.tiktok.com/@maggieend\",\"country\":\"\"}]" \
  -d "is_auto_push=false"
```

### `tiktok_profiles_listurl`
Scene: By List URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=tiktok.com" \
  -d "scraper_id=tiktok_profiles_listurl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"search_url\":\"\",\"country\":\"BR\",\"page_turning\":\"\"}]" \
  -d "is_auto_push=false"
```

---

## bing.com (6 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=26

### `bing_search`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_search" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "safe=off"
```

### `bing_maps`
Scene: Bing maps

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_maps" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false"
```

### `bing_images`
Scene: Bing images

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_images" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "safe=off"
```

### `bing_videos`
Scene: Bing videos

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_videos" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "length=short"
```

### `bing_news`
Scene: Bing News

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_news" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "json=1" \
  -d "no_cache=false"
```

### `bing_shopping`
Scene: Bing Shopping

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_shopping" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false"
```

---

## walmart.com (5 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=21

### `walmart_product_url`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=walmart.com" \
  -d "scraper_id=walmart_product_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.walmart.com/ip/Fresh-Gala-Apples-3-lb-Bag/44390958?classType=REGULAR&athbdg=L1600&from=/search\",\"all\":\"\"}]" \
  -d "is_auto_push=false"
```

### `walmart_product_category-url`
Scene: By Category URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=walmart.com" \
  -d "scraper_id=walmart_product_category-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"category_url\":\"https://www.walmart.com/shop/savings\",\"all\":\"true\",\"page_limit\":\"1\"}]" \
  -d "is_auto_push=false"
```

### `walmart_product_sku`
Scene: By SKU

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=walmart.com" \
  -d "scraper_id=walmart_product_sku" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"sku\":\"433078517\",\"all\":\"true\"}]" \
  -d "is_auto_push=false" \
  -d "file_name={file_name}"
```

### `walmart_product_keywords`
Scene: By Keywords

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=walmart.com" \
  -d "scraper_id=walmart_product_keywords" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"domain\":\"https://www.walmart.com/\",\"keyword\":\"shoes\",\"all\":\"false\",\"page_turning\":\"0\"}]" \
  -d "is_auto_push=false"
```

### `walmart_product_zipcodes`
Scene: By Postal Code

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=walmart.com" \
  -d "scraper_id=walmart_product_zipcodes" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://www.walmart.com/ip/Nike-Men-s-Air-More-Uptempo-Low-White-Hyper-Royal-from-StockX/17722213945?classType=VARIANT&from=/search\",\"zipcode\":\"95829\"}]" \
  -d "is_auto_push=false"
```

---

## duckduckgo.com (1 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=28

### `duckduckgo`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=duckduckgo.com" \
  -d "scraper_id=duckduckgo" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false"
```

---

## yandex.com (1 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=27

### `yandex`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=yandex.com" \
  -d "scraper_id=yandex" \
  -d "scraper_errors=true" \
  -d "is_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "yandex_domain=yandex.com" \
  -d "rstr=false"
```

---

## github.com (3 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=126

### `github_repository_repo-url`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=github.com" \
  -d "scraper_id=github_repository_repo-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://github.com/gin-gonic/gin\"}]" \
  -d "is_auto_push=false"
```

### `github_repository_search-url`
Scene: Via the search URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=github.com" \
  -d "scraper_id=github_repository_search-url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"search_url\":\"https://github.com/search?q=ai&type=repositories\",\"page_limit\":\"1\",\"max\":\"1\"}]" \
  -d "is_auto_push=false"
```

### `github_repository_url`
Scene: Via URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=github.com" \
  -d "scraper_id=github_repository_url" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"url\":\"https://github.com/QwenLM/Qwen\"}]" \
  -d "is_auto_push=false"
```

---

## x.com (3 operations)

Dashboard: https://dashboard.novada.com/overview/scraper/api/?id=31

### `twitter_profile_profileurl`
Scene: Overview Overview

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=x.com" \
  -d "scraper_id=twitter_profile_profileurl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"profile_url\":\"https://x.com/BillGates\"}]" \
  -d "is_auto_push=false"
```

### `twitter_profile_username`
Scene: By username

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=x.com" \
  -d "scraper_id=twitter_profile_username" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"user_name\":\"BillGates\"}]" \
  -d "is_auto_push=false"
```

### `twitter_post_posturl`
Scene: By post URL

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=x.com" \
  -d "scraper_id=twitter_post_posturl" \
  -d "scraper_errors=true" \
  -d "scraper_params=[{\"post_url\":\"https://x.com/NASA/status/2048903895716364742\"}]" \
  -d "is_auto_push=false"
```

---

## Summary

**78 total operations** across **13 platforms**.

For MCP usage, call `novada_scrape` with:
```
novada_scrape(platform="<domain>", operation="<scraper_id>", params={...})
```

The MCP automatically handles param format (flat vs scraper_params), auth, polling, and result parsing.