# Bug Report for Fudong — Novada Scraper API Issues

## Issue 1: YouTube Scraping — 403 CAPTCHA Block

**Severity:** High — all YouTube operations return CAPTCHA errors

**Steps to reproduce:**
```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=youtube.com" \
  -d "scraper_id=youtube_video-post_url" \
  -d "scraper_errors=true" \
  -d 'scraper_params=[{"url":"https://www.youtube.com/@mkbhd/videos","sorting_method":"Latest","start_index":"1","num_of_posts":"3"}]' \
  -d "is_auto_push=false"
```

**Result:** Task completes with 0% success. Download returns:
```json
{"error": "Forbidden - The target page returned a CAPTCHA, login page, or a 503 error, and access has been restricted.2", "error_code": "403"}
```

**Tested operations:** youtube_video-post_url, youtube_video-url — both fail.

**Dashboard task IDs:**
- f8c88f0e52b74ce78323d71316c13fd8 (2026/05/18 14:13:46)
- 5095d534105a4770941bcefbd1789245 (2026/05/18 13:17:16)

---

## Issue 2: Inconsistent Error Messages for Download Formats

**Context:** Bing search task succeeds (100%, 1 result) but download fails for ALL file types.

**Task ID:** 0392544ce7f64580bff48e4b3a4427be

| file_type | Response |
|-----------|----------|
| json | 10001 "Invalid file type" |
| csv | 10001 "Only supports JSON and HTML" |
| xlsx | 10001 "Only supports JSON and HTML" |
| html | 10001 "Invalid file type" |

The messages are contradictory — CSV says "only JSON and HTML", but JSON also fails.

**Note:** When using flat params (matching dashboard playground format), Bing download DOES work with `file_type=json` and returns `{spider_code: 200, rest: {...}}`. The 10001 error only happened when the task was submitted with `scraper_params` array format, suggesting the result storage format differs based on submission method.
