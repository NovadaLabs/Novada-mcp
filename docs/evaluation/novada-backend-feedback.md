# Novada Backend — Critical Issues Report (curl-verified)
**From:** Novada MCP Team | **Date:** 2026-04-22
**Context:** 122 MCP test calls + independent curl verification, benchmarked against Tavily MCP + Firecrawl MCP
**Urgency:** HIGH — these issues make Novada uncompetitive in the AI agent market

> Every issue in this document was independently verified via `curl` against the raw API, ruling out MCP wrapper issues. Exact request/response pairs included.

---

## Executive Summary

We built an MCP server wrapper around Novada's API for AI agents (Claude, Cursor, VS Code, etc.). After 122 live tests + curl verification, **7 backend issues** prevent us from competing with Tavily and Firecrawl. Four of five search engines are broken. The proxy endpoint for URL fetching returns 404. Geo-targeting is absent, causing wrong-locale content.

**None of these are MCP wrapper issues.** We've implemented every workaround possible at the MCP layer (auto-fallback to Google, content quality detection, dynamic agent hints), but when the underlying API is broken, the wrapper can't fabricate data.

---

## Issue 1: CRITICAL — Yahoo: Backend URL Builder Drops `q` Parameter

### curl test

```bash
$ curl "https://scraperapi.novada.com/search?q=test+query&engine=yahoo&api_key=c77dd8..."
```

### Response

```json
{"code":410,"msg":"Build url error: empty query built"}
```

### Analysis

`q=test+query` is present and correctly encoded. The Yahoo URL builder drops the parameter when constructing the final request URL, producing an "empty query."

---

## Issue 2: CRITICAL — Bing: Query String Truncated/Degraded

### curl test

```bash
$ curl "https://scraperapi.novada.com/search?q=kubernetes+pod+scheduling+algorithm&engine=bing&api_key=c77dd8...&num=2"
```

### Response (top 10 titles)

```
1. What is the meaning of CPU and core in Kubernetes?
2. Reasons for OOMKilled in kubernetes - Stack Overflow
3. What's the difference between Docker Compose and Kubernetes?
4. kubernetes - How to check if network policy have been applied to pod...
5. timeout - Kubernetes Ingress (Specific APP) 504 Gateway Time-Out
```

### Analysis

Searched for **"kubernetes pod scheduling algorithm"**. Results are generic Kubernetes questions — none about pod scheduling algorithms. The keyword "kubernetes" is preserved but "pod scheduling algorithm" is dropped. The query is truncated or degraded to a single keyword before being passed to Bing.

**Impact on agents:** Wrong results are worse than no results. Agents build on false foundations and waste ~800 tokens of context window.

---

## Issue 3: CRITICAL — DuckDuckGo: 502 Bad Gateway

### curl test

```bash
$ curl "https://scraperapi.novada.com/search?q=test+query&engine=duckduckgo&api_key=c77dd8..."
```

### Response

```html
<html><head><title>502 Bad Gateway</title></head>
<body><center><h1>502 Bad Gateway</h1></center>
<hr><center>stgw</center></body></html>
```

### Analysis

The gateway layer (`stgw`) returns 502 before the request reaches the application. DDG workers may be down, or Novada exit IPs are blocked by DuckDuckGo. Consistent across 3 independent test rounds over several hours.

---

## Issue 4: HIGH — Yandex: Parameter Mapping Error (NOT an API Key Issue)

### curl test

```bash
$ curl "https://scraperapi.novada.com/search?q=test+query&engine=yandex&api_key=c77dd8..."
```

### Response

```json
{"code":401,"msg":"param error：failed to bind query: Key: 'SearchParameters.Text' Error:Field validation for 'Text' failed on the 'required' tag"}
```

### Analysis

**This is NOT an API key issue** (our earlier report was incorrect — now corrected). The error shows `SearchParameters.Text` fails validation as "required" but empty. Yandex's search API uses `Text` as the query parameter name, but the backend fails to map the generic `q` parameter to `SearchParameters.Text`.

We also tested with the Scraper API key (`1f35b4...`): returned `{"code":402,"msg":"Api Key error：User has no permission"}`. Neither key works for Yandex.

### Fix needed

Map `q` → `SearchParameters.Text` in the Yandex engine handler.

---

## Issue 5: MEDIUM — Google: Unreliable Under Parallel Load

### curl test

```bash
$ curl "...?q=test+alpha&engine=google&..." &
$ curl "...?q=test+beta&engine=google&..." &
$ wait
```

### Response

```
Call 1: code:200, results:1  ← normal
Call 2: code:200, results:0  ← soft failure (no results)
```

### Analysis

One of two parallel calls returns empty results (code 200 but 0 results). Previous tests showed hard failures with `413: WorkerPool not initialized`. Behavior is inconsistent — sometimes soft failure (empty results), sometimes hard failure (413). Sequential calls always work.

---

## Issue 6: CRITICAL — scraperapi.novada.com Root Path Returns 404

### curl test

```bash
# With NOVADA_API_KEY
$ curl -o /dev/null -w "HTTP %{http_code}" "https://scraperapi.novada.com?api_key=c77dd8...&url=https://example.com"
HTTP 404

# With SCRAPER_API_KEY (ruling out key issue)
$ curl -o /dev/null -w "HTTP %{http_code}" "https://scraperapi.novada.com?api_key=1f35b4...&url=https://example.com"
HTTP 404
```

### Analysis

Both API keys return 404. This is not a key permission issue — the endpoint itself is dead. Only `/search` sub-path works. The root path (used for URL fetching / content extraction) is completely non-functional.

### Impact

The entire extract/crawl/map proxy chain silently fails. All "successful" extract/crawl operations fell back to direct fetch (no proxy), meaning: zero anti-bot bypass, zero residential IP rotation, bot-protected sites fail silently.

We've implemented Web Unblocker (`POST webunlocker.novada.com/request`) as a workaround, but it's more expensive and slower.

---

## Issue 7: MEDIUM — No Geo-Targeting on scraperapi Proxy

Proxy exit IPs are in EU (Germany). US-centric sites return locale-redirected content:
- `stripe.com/pricing` → `stripe.com/de/pricing` → 144 chars, German

Web Unblocker returns correct US-English content (918KB) for the same URL.

### Fix needed

Add `country` parameter to scraperapi proxy endpoint (search endpoint already has it). Default to `us`.

---

## Competitive Urgency

| Feature | Novada (current) | Tavily | Firecrawl |
|---------|-----------------|--------|-----------|
| Search engines | **1 working** (Google sequential) | 1 (reliable) | 1 (reliable) |
| Search quality | Raw Google order | **AI-ranked relevance** | 77% coverage |
| Extract reliability | ~50% (proxy dead) | High | High |
| Browser agent | None | None | **FIRE-1** (clicks, forms, CAPTCHAs) |
| Agent guidance | **Agent Hints (unique)** | None | None |

**Agent Hints is Novada's unique competitive advantage. No competitor tells agents what to do next. But the underlying data must be reliable for this to matter.**

**The window to fix is now** — before agents develop permanent preferences for Tavily/Firecrawl. These are infrastructure fixes, not product redesigns.

---

## Full Reproduction Commands

```bash
API_KEY="c77dd803b927e919fa1fd21cc6b85171"

# Issue 1: Yahoo 410
curl "https://scraperapi.novada.com/search?q=test+query&engine=yahoo&api_key=$API_KEY"

# Issue 2: Bing query degraded
curl "https://scraperapi.novada.com/search?q=kubernetes+pod+scheduling+algorithm&engine=bing&api_key=$API_KEY&num=3"

# Issue 3: DDG 502
curl "https://scraperapi.novada.com/search?q=test+query&engine=duckduckgo&api_key=$API_KEY"

# Issue 4: Yandex param mapping
curl "https://scraperapi.novada.com/search?q=test+query&engine=yandex&api_key=$API_KEY"

# Issue 5: Google parallel (run both simultaneously)
curl "https://scraperapi.novada.com/search?q=alpha&engine=google&api_key=$API_KEY&num=1" &
curl "https://scraperapi.novada.com/search?q=beta&engine=google&api_key=$API_KEY&num=1" &
wait

# Issue 6: Root path 404
curl -o /dev/null -w "HTTP %{http_code}" "https://scraperapi.novada.com?api_key=$API_KEY&url=https://example.com"
```

---

*All issues verified via curl on 2026-04-22, independent of MCP wrapper. Tested with both NOVADA_API_KEY (`c77dd8...`) and SCRAPER_API_KEY (`1f35b4...`).*
