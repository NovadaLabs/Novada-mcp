# Novada MCP Integration — Technical Questions for Backend Team
**From:** Novada MCP Team | **Date:** 2026-04-22
**Context:** Building the official Novada MCP server for AI agents (Claude, Cursor, VS Code). Published to npm as `novada-mcp`. 122 test calls completed, competitive benchmarking against Tavily MCP + Firecrawl MCP.

---

## Summary

We built and published the Novada MCP server — 5 tools (search, extract, crawl, map, research) for AI agents. The Novada product infrastructure is strong: 4/5 search engines work via the Scraper API, Web Unblocker delivers full anti-bot bypass, and the scraper library is extensive.

**We need answers to 3 technical questions to complete the integration and unlock all engines for agents.**

---

## Question 1 (CRITICAL): How to Retrieve Results from Scraper API Task IDs?

### What We Did

We successfully submit search tasks to `POST https://scraper.novada.com/request`:

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer 1f35b477c9e1802778ec64aee2a6adfa" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_search" \
  -d "q=apple" \
  -d "json=1"
```

Response: `{"code":0,"data":{"code":200,"data":{"task_id":"1f1901dc..."}}}`

### What We Need

The API returns a `task_id` but we can't find the endpoint to retrieve results. We tried 13 URL patterns (all returned 404):

```
GET  /result/{task_id}
GET  /task/{task_id}
GET  /request/{task_id}
POST /result  (with task_id in body)
GET  /v1/task/{task_id}
GET  /results?task_id=...
... etc
```

**Please provide:**
1. The result retrieval endpoint (e.g., `GET /result/{task_id}`)
2. Or: does the API support a synchronous mode? (e.g., a `sync=true` parameter that blocks until results are ready)
3. Or: does it support a `callback_url` parameter for webhook delivery?

**Why this matters:** MCP tools are synchronous — the agent calls a tool and waits for the response. Without a way to retrieve results, we can't migrate from the legacy `scraperapi.novada.com/search` to the Scraper API. This single endpoint unlocks 4 search engines (Google, Bing, DDG, Yandex) for all AI agents using Novada.

---

## Question 2: Scraper IDs — Verified Working vs Not Found

### Verified Working (20 test calls)

| Engine | scraper_name | scraper_id | Extra Params | Status |
|--------|-------------|-----------|-------------|--------|
| Google | `google.com` | `google_search` | — | ✅ task_id returned |
| Bing | `bing.com` | `bing_search` | `safe=off` | ✅ task_id returned |
| DuckDuckGo | `duckduckgo.com` | `duckduckgo` | — | ✅ task_id returned |
| Yandex | `yandex.com` | `yandex` | `yandex_domain=yandex.com` | ✅ task_id returned |

### Not Working

| Engine | scraper_name | scraper_id | Error |
|--------|-------------|-----------|-------|
| Yahoo | `yahoo.com` | `yahoo_search` | `11006 Scraper error` |
| Yahoo | `yahoo.com` | `yahoo` | `11006 Scraper error` |
| Yandex | `yandex.com` | `yandex_search` | `11006 Scraper error` (wrong id — `yandex` works) |

**Questions:**
1. Is Yahoo search available on the Scraper API? If so, what's the correct `scraper_id`?
2. Can we get the full list of available scraper_ids for search engines? (The web library shows Google has 4 scrapers — we only found `google_search`)
3. Are there additional required parameters per engine? (e.g., Yandex needs `yandex_domain`)

---

## Question 3: Legacy scraperapi.novada.com — Deprecated?

We originally built the MCP against `scraperapi.novada.com`. We found issues:

| Endpoint | Status |
|----------|--------|
| `scraperapi.novada.com/search` | Works for Google only. Bing/DDG/Yahoo/Yandex have issues. |
| `scraperapi.novada.com?url=...` (root path) | Returns 404 with both API keys |

**Questions:**
1. Is `scraperapi.novada.com` deprecated in favor of the Scraper API (`scraper.novada.com`)?
2. For URL fetching (content extraction), should we use Web Unblocker instead of scraperapi?
3. If scraperapi is still supported, the following engine-specific issues exist:
   - Yahoo: `q` parameter dropped → `410 empty query built`
   - Bing: query string truncated — only first keyword passes through
   - DDG: `502 Bad Gateway` at gateway layer
   - Yandex: `SearchParameters.Text` param mapping fails
   - Google: parallel calls unreliable (0 results or 413)

---

## Competitive Context

We've benchmarked Novada MCP against Tavily MCP and Firecrawl MCP. Novada's competitive position:

**Novada Advantages:**
- **Agent Hints** — unique feature, no competitor does this
- **5 search engines** (once Scraper API integration is complete) vs competitors' 1
- **Extensive scraper library** (Amazon, YouTube, LinkedIn, etc.) — untapped potential for MCP
- **195-country geo-targeting** via proxy infrastructure
- **Batch extract** (10 URLs parallel) — not available in Tavily

**What Competitors Have That We Don't (Yet):**
- Firecrawl: autonomous browser agent (FIRE-1), JSON Schema extraction, async crawl with polling
- Tavily: AI-ranked relevance scoring on search results

**Our Plan After Getting the Result Endpoint:**
1. Migrate `novada_search` to Scraper API — unlocks 4 engines for agents
2. Add `novada_research` parallel multi-engine search — unique capability
3. Eventually expose more scrapers (Amazon, YouTube, LinkedIn) as additional MCP tools

---

## Question 4 (HIGH): Scraper Library — Which Scrapers Are Actually Functional?

### The Concern

The Novada dashboard shows a large scraper library (Google, Bing, DDG, Yandex, Amazon, YouTube, LinkedIn, TikTok, GitHub, eBay, Walmart, IKEA, etc.). However, we have no way to verify which scrapers actually produce results vs which only accept requests.

**What we can verify today:**

| Category | Observation | What This Proves |
|----------|------------|-----------------|
| Google/Bing/DDG/Yandex return `task_id` | API accepts the request | Does NOT prove the scraper completes or returns data |
| Yahoo returns `11006 Scraper error` | API rejects the request | Could be wrong scraper_id OR genuinely non-functional |
| Amazon/YouTube/LinkedIn/etc. return `11006` | API rejects | We guessed scraper_ids — could be wrong params OR non-functional |

**What we cannot verify:**
- Whether tasks that return `task_id` actually complete with real search results
- Whether the `11006` errors are due to wrong parameters or genuinely broken scrapers
- Which scrapers in the library are production-ready vs experimental/planned

### Why This Matters

If we expose scrapers as MCP tools and agents discover they don't return data, agents will lose trust in the entire Novada MCP — not just the broken scraper. This is the same problem we identified with the 5-engine search: advertising capabilities that don't work in practice damages credibility more than having fewer features that all work.

### What We Need

1. **A status matrix:** which scrapers in the library are production-ready, beta, or planned?
2. **Correct scraper_id + required params** for each production-ready scraper
3. **Expected task completion time** per scraper type (seconds? minutes?)
4. If possible: a **health check endpoint** (`GET /scrapers/status`) so the MCP can dynamically know which scrapers are available

---

## Summary of What We Need

| # | Question | Priority | Impact |
|---|----------|----------|--------|
| 1 | Scraper API result retrieval endpoint | **CRITICAL** | Unlocks 4 search engines for all AI agents |
| 2 | Complete scraper_id list for search engines | HIGH | Correct integration params |
| 3 | scraperapi.novada.com deprecation status | MEDIUM | Architecture decision |
| 4 | Scraper library functional status matrix | HIGH | Know which scrapers to expose vs hide from agents |

The Novada product infrastructure has strong potential. These answers will let us complete the MCP integration with confidence — exposing only what works, and planning the roadmap for what's coming.

---

*Novada MCP v0.6.5 — published to npm, available on Smithery + LobeHub. 117 tests passing.*
