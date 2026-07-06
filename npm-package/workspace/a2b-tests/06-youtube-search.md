# A2B Test 06 — YouTube Search

**Scenario:** Content creator wants top YouTube videos about "web scraping tutorial"
**A (input):** search term `web scraping tutorial python`
**B (output):** list of videos with titles, views, URLs
**Date:** 2026-06-25

---

## Result: PASS

**Operation used:** `youtube_video-post-keyword` (not `youtube_search_keyword` — that ID does not exist)
**Latency:** 28,462ms
**Records returned:** 3

---

## Videos Returned

| Title | Views | URL | Channel |
|-------|-------|-----|---------|
| Python Tutorial: Web Scraping with BeautifulSoup and Requests | 1,187,447 | https://www.youtube.com/watch?v=ng2o98k983k | Corey Schafer (1.54M subs) |
| Web Scraping in Python using Beautiful Soup | 182,556 | https://www.youtube.com/watch?v=LCVSmkyB4v8 | techTFQ (401K subs) |
| Web Scraping in Python (Urdu) - Live hands-on training | 22,105 | https://www.youtube.com/watch?v=wH8x9tUzdRQ | Codanics (231K subs) |

---

## Issues Found

### 1. Wrong operation ID in test script — ERROR (not a product bug)
The test used `youtube_search_keyword` which does not exist. Correct ID is `youtube_video-post-keyword`. The error message was clear: `"Operation IDs are exact and cannot be guessed"` with code 11006. The `agent_instruction` in the error message should list valid operations for the platform to prevent this.

**Suggestion:** Add a `nearby_operations` hint in the 11006 error response showing valid operations for the requested platform.

### 2. Only 3 results returned despite limit: 5
The scraper returned 3 records when 5 were requested. May be a platform-side limitation or live data availability. Not a blocker but worth noting.

### 3. Latency: 28s is high
28 seconds for a YouTube keyword search is slow for real-time use. Acceptable for batch workflows; would block interactive UX.

---

## A→B Verdict

COMPLETE. Given the correct operation ID, the tool returns structured video data (title, view count, URL, channel, duration, likes) — satisfying the B requirement fully.
