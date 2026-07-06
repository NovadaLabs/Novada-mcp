# Novada MCP Integration — Root Cause Found + Questions for Backend Team
**From:** Novada MCP Team | **Date:** 2026-04-22
**Context:** Building the official Novada MCP server for AI agents (Claude, Cursor, VS Code). Published to npm as `novada-mcp`.

---

## Root Cause: Auth Mismatch Between Task Submission and Result Retrieval

We found exactly why the Scraper API works on the Novada dashboard but not via CLI/MCP.

### The Problem in One Diagram

```
TASK SUBMISSION (works)                RESULT RETRIEVAL (blocked)
────────────────────                   ────────────────────────
POST scraper.novada.com/request        POST api.novada.com/g/api/proxy/scraper_task_list
Auth: Bearer token ✅                  Auth: Bearer token ❌ (code 10001: auth check error)
                                       Auth: Dashboard session cookie ✅ (works in browser)
Returns: task_id                       Returns: task list with status + download
```

**The Scraper API accepts tasks with Bearer token, but the result retrieval endpoint only accepts dashboard session cookies.** External integrations (MCP, CLI, SDK) have no way to get results back.

### How We Proved This

**Step 1:** Submit a Bing search task via Bearer token — succeeds:
```bash
$ curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer 1f35b4..." \
  -d "scraper_name=bing.com&scraper_id=bing_search&q=apple&json=1"

Response: {"code":0,"data":{"data":{"task_id":"b083308a2dc8..."}}}  ✅
```

**Step 2:** Try to get results via the same Bearer token — rejected:
```bash
$ curl -X POST "https://api.novada.com/g/api/proxy/scraper_task_list" \
  -H "Authorization: Bearer 1f35b4..."

Response: {"code":10001,"msg":"auth check error"}  ❌
```

**Step 3:** The same endpoint works in the browser (with session cookie):

![Dashboard shows tasks completing successfully](images/dashboard-task-success.png)
*Dashboard Task List — all tasks show "Success", 100% rate, with Download button*

**Step 4:** We found the endpoint URL via Chrome DevTools Network tab:

![Network tab shows the API URL](images/network-headers-url.png)
*Headers tab: `POST https://api.novada.com/g/api/proxy/scraper_task_list` — Status 200*

**Step 5:** The response contains full task data:

![Response JSON with task details](images/network-response-json.png)
*Response shows task_id, status, success_rate, scene, api, timing, etc.*

**Step 6:** Downloaded results are perfect — real Bing search data:
```json
{
  "search_metadata": { "status": "Success", "total_time_taken": 2.06 },
  "search_information": { "total_results": 195000 },
  "organic_results": [
    { "rank": 1, "title": "Apple", "link": "https://www.apple.com" },
    { "rank": 2, "title": "Apple Inc. - Wikipedia", "link": "..." },
    { "rank": 3, "title": "Apple says John Ternus will be new CEO...", "link": "..." }
    // ... 10 results total, all relevant
  ]
}
```

### Verification Summary

| Test | Auth Method | Endpoint | Result |
|------|------------|----------|--------|
| Submit task | Bearer token | `scraper.novada.com/request` | ✅ task_id returned |
| Get task list | Bearer (Scraper key) | `api.novada.com/g/api/proxy/scraper_task_list` | ❌ `auth check error` |
| Get task list | Bearer (API key) | same | ❌ `auth check error` |
| Get task list | No auth | same | ❌ `auth fail` |
| Get task list | Dashboard cookie | same | ✅ full task list with status |
| Download results | Dashboard cookie | download link | ✅ perfect search JSON |

---

## What We Need (One Change)

**Make the result retrieval endpoint accept Bearer token authentication** — the same token used for task submission.

Either:
1. Add Bearer token auth to `api.novada.com/g/api/proxy/scraper_task_list`
2. Or create a new public endpoint: `scraper.novada.com/task/{task_id}` with Bearer auth

This single change unlocks the entire Scraper API for external integrations. Without it, only the dashboard can use the scrapers.

---

## What Works Great (Confirmed)

The scrapers themselves are excellent. Bing search returned 10 perfectly relevant results in 2 seconds for $0.0012. We verified:

| Engine | scraper_id | Task Accepted | Results Quality |
|--------|-----------|---------------|-----------------|
| Google | `google_search` | ✅ | Not yet retrievable via API |
| Bing | `bing_search` | ✅ | ✅ Perfect (verified via dashboard download) |
| DuckDuckGo | `duckduckgo` | ✅ | Not yet retrievable via API |
| Yandex | `yandex` | ✅ | Not yet retrievable via API |
| Yahoo | `yahoo_search` | ❌ 11006 | Not available |

The scraper library is extensive:

![Scraper library showing many available scrapers](images/scraper-library.png)
*Google, Bing, DDG, Amazon, YouTube, LinkedIn, TikTok, GitHub, eBay, and many more*

---

## Additional Questions

| # | Question | Priority |
|---|----------|----------|
| 1 | **Bearer token auth for result retrieval** | CRITICAL — blocks all external integration |
| 2 | Correct scraper_ids for all search engines | HIGH |
| 3 | Yahoo scraper_id (or confirmation it's unavailable) | MEDIUM |
| 4 | Which scrapers in the library are production-ready? | HIGH |
| 5 | Is `scraperapi.novada.com` deprecated in favor of `scraper.novada.com`? | MEDIUM |

---

## Why This Matters

We built the Novada MCP server with 5 tools for AI agents. It's published on npm, Smithery, and LobeHub. Once the Bearer token auth is unified, we can migrate search from the legacy endpoint to the Scraper API — unlocking 4 engines (Google, Bing, DDG, Yandex) for every AI agent using Novada.

The product infrastructure is strong. This is the last piece.

---

*Novada MCP v0.6.5 — 117 tests passing, published to npm.*
