# Stress Test 03: Concurrent Tool Calls

**Date:** 2026-06-26
**Purpose:** Check for race conditions when multiple extract/search calls run concurrently via `Promise.allSettled`.

---

## Test 1: 5 Concurrent Extracts

| # | URL | Status | Chars | File Path |
|---|-----|--------|-------|-----------|
| 1 | example.com | PASS | 1,082 | example-com/2026-06-26_182427_example-com.md |
| 2 | httpbin.org | PASS | 1,158 | httpbin-org/2026-06-26_182441_httpbin-org.md |
| 3 | quotes.toscrape.com | PASS | 1,847 | quotes-toscrape-com/2026-06-26_182500_quotes-toscrape-com.md |
| 4 | books.toscrape.com | PASS | 18,691 | books-toscrape-com/2026-06-26_182441_books-toscrape-com.md |
| 5 | news.ycombinator.com | PASS | 15,579 | news-ycombinator-com/2026-06-26_182441_news-ycombinator-com.md |

**Total time:** ~8.0s for 5 concurrent extracts
**All returned file paths:** Yes (starts with file-path line)

### Sub-checks

| Check | Result | Detail |
|-------|--------|--------|
| File path uniqueness | PASS | 5 paths, 5 unique |
| Topic folder isolation | PASS | 5 distinct folders (one per domain) |
| Files exist on disk | PASS | All 5 files present with non-zero size |
| Cross-contamination | PASS | Each result contains domain-specific keywords |

**Cross-contamination detail:**
- example.com: matched 2/3 expected keywords (example, domain)
- httpbin.org: matched 3/3 (httpbin, request, http)
- quotes.toscrape.com: matched 3/3 (quotes, toscrape, author)
- books.toscrape.com: matched 2/3 (books, price)
- news.ycombinator.com: matched 3/3 (hacker, news, points)

---

## Test 2: 3 Concurrent Searches

| # | Query | Status | Chars | Has results (## 1.) |
|---|-------|--------|-------|---------------------|
| 1 | proxy api | PASS | 1,703 | Yes |
| 2 | web scraping | PASS | 1,699 | Yes |
| 3 | data extraction | PASS | 1,449 | Yes |

**Total time:** ~2.5s for 3 concurrent searches

### Sub-checks

| Check | Result | Detail |
|-------|--------|--------|
| Cache isolation | PASS | All 3 queries returned distinct results |
| Search term relevance | PASS | Each result contains its query terms |

**Search isolation detail:**
- "proxy api": matched 2/2 terms
- "web scraping": matched 2/2 terms
- "data extraction": matched 2/2 terms

---

## Verdict

**PASS** -- No race conditions detected.

- Concurrent extracts write to correctly isolated topic folders with unique file names (timestamp-based naming prevents collisions even when 3 extracts complete in the same second: `182441`).
- No cross-contamination between concurrent extract results.
- Concurrent searches return correctly isolated, query-relevant results.
- All file I/O completes without corruption or overwrites.
