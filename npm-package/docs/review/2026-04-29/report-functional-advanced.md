# Functional Test Report — Advanced Tools (Agent D)

## Test Environment
- Date: 2026-04-29
- API Key: `****adfa` (1f35b477c9e1802778ec64aee2a6adfa)
- Node: v24.14.0
- Known env: NOVADA_BROWSER_WS not set, NOVADA_WEB_UNBLOCKER_KEY not set, NOVADA_PROXY_* not set
- Build: `/Users/tongwu/Projects/novada-mcp/build/` (v0.8.3, pre-compiled)

---

## Results Summary

| Tool | Tests | Pass | Fail | Backend Error | Notes |
|------|-------|------|------|---------------|-------|
| novada_health | 2 | 2 | 0 | 0 | Minor bugs in Next Steps text |
| novada_scrape | 4 | 1 | 2 | 1 | google_search = backend 500; amazon/fakebook = correct errors |
| novada_proxy | 4 | 4 | 0 | 0 | Pure config output, no network calls |
| novada_verify | 1 | 1 | 0 | 0 | Returns SERP_UNAVAILABLE (correct) |
| novada_unblock | 3 | 3 | 0 | 0 | Works without WEB_UNBLOCKER_KEY but mode label is wrong |
| novada_browser | 2 | 2 | 0 | 0 | Correct not-configured message; list_sessions works |

---

## Detailed Results

### novada_health

#### Test 1 — Full health check with real API key
```
Tool: novada_health
Input: novadaHealth("1f35b477c9e1802778ec64aee2a6adfa")
Status: PASS
Duration: 1015ms
```

Output excerpt:
```
## Novada API — Health Check
api_key: ****adfa
checked: 2026-04-29T10:51:17.969Z

| Product | Status | Latency |
|---------|--------|---------|
| Search API | ❌ Not activated — visit dashboard.novada.com/overview/scraper/ ... | 1011ms |
| Web Unblocker / Extract | ⚠️ Not configured — set NOVADA_WEB_UNBLOCKER_KEY env var | — |
| Scraper API (129 platforms) | ❌ Not activated — ... | 744ms |
| Proxy | ⚠️ Not configured — set NOVADA_PROXY_USER env var | — |
| Browser API | ⚠️ Not configured — set NOVADA_BROWSER_WS env var | — |

## Summary
- 2 not activated  |  3 not configured

## Next Steps
- Search API: Go to visit dashboard.novada.com/overview/scraper/ — request SERP access to activate
...
```

Issues:
1. **Grammatical redundancy in Next Steps** — template is `"Go to ${r.note} to activate"` but `r.note` starts with "visit", producing `"Go to visit dashboard.novada.com/..."`. Should strip "visit" from note or remove "Go to" from template.
2. **Function signature mismatch with brief** — brief describes `novadaHealth({ verbose: true }, apiKey)` but actual signature is `novadaHealth(apiKey: string)`. No `verbose` param exists (`HealthParamsSchema = z.object({})`). Not a runtime bug.
3. **All probes ran correctly** — SERP returned code 402 (not activated), Scraper returned code 11006 (not activated), env-based probes correctly reflected missing vars.

#### Test 2 — Empty API key
```
Tool: novada_health
Input: novadaHealth("")
Status: PASS
Duration: 559ms
```

Key difference: Scraper API shows `❌ Error: Invalid API key (11000)` — correctly distinguishes invalid key from not-activated. Search API still shows "Not activated" (SERP endpoint returns code 402 even for empty key, not 401).

Issues:
4. **SERP key validation gap** — empty API key returns code 402 (no SERP quota) from SERP endpoint, not 401/400. Health maps 402 to `not_activated`, so empty key still shows "Not activated" for Search API rather than "Invalid key". Low severity.

---

### novada_scrape

The scrape tool uses a 2-step async flow: POST `/request` (Bearer auth, form-urlencoded) → poll `GET /scraper_download?task_id=...&file_type=json&apikey=...` until array result or 90s timeout.

#### Test 1 — google_search (async flow, known backend issue)
```
Tool: novada_scrape
Test: google_search for "proxy services"
Input: { platform: "google.com", operation: "google_search", params: { q: "proxy services", num: 3, json: "1" }, format: "markdown", limit: 5 }
Status: BACKEND_ERROR
Duration: ~21000ms (polled ~18-20s before array arrived)
Error: Scraper task failed (unknown): 500 Internal Server Error - Internal server error.
```

Raw download endpoint behavior confirmed by direct polling:
- Submit: `{ code: 0, data: { code: 200, data: { task_id: "..." } } }` — task_id extraction works correctly.
- Poll: `{ code: 27202 }` for ~16-20s (pending).
- Final: array `[{ "error": "500 Internal Server Error - Internal server error." }]`
- Tool correctly detects `"error" in firstItem` and throws.

Issues:
5. **error_code is missing from backend error payload** — backend returns `{ error: "500..." }` with no `error_code` field. Tool produces `"Scraper task failed (unknown): ..."` — the `(unknown)` looks like an unhandled case when it is just a missing backend field.
6. **Backend 500 for google_search** — confirmed backend issue since 2026-04-27. Not fixable client-side.

#### Test 2 — Amazon (expected 11006)
```
Tool: novada_scrape
Test: amazon_product_by-keywords
Input: { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "laptop" }, format: "markdown", limit: 5 }
Status: FAIL (expected — 11006)
Duration: 733ms
Error: Scraper error (code 11006): Scraper API not yet activated on this account. Go to dashboard.novada.com/overview/scraper/ to activate instantly — no email needed.
```
CORRECT behavior. Error message is clear and actionable.

#### Test 3 — Unknown platform (fakebook.com)
```
Tool: novada_scrape
Test: unknown platform
Input: { platform: "fakebook.com", operation: "anything", params: {}, format: "markdown", limit: 5 }
Status: FAIL (expected — 11008)
Duration: 723ms
Error: Scraper error (code 11008): Unknown platform 'fakebook.com'. Use the exact domain (e.g. 'amazon.com', 'reddit.com').
```
CORRECT behavior. Error message is clear and actionable.

#### Test 4 — Timeout behavior (code review only, not waited)
From `src/tools/scrape.ts`: `POLL_TIMEOUT_MS = 90_000`. After 90s deadline: `throw new Error("Scraper task ${taskId} did not complete within 90s. Check dashboard for status.")`. This plain Error bypasses the AxiosError catch in `novadaScrape` and propagates directly. Agent message is informative and includes task_id. No issue.

---

### novada_proxy

#### Test 1 — No env vars
```
Tool: novada_proxy  Input: {}  Status: PASS
```
Returns clear setup instructions with all 3 missing env var names (`NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, `NOVADA_PROXY_ENDPOINT`), dashboard link, and hint to use `novada_extract` as alternative.

#### Test 2 — Residential proxy, url format
```
Tool: novada_proxy  Input: { type: "residential", country: "us" }  Status: PASS
```
Username: `testuser123-country-us`. Masked URL in output. Node.js + Python examples correct.

#### Test 3 — curl format with city/session
```
Tool: novada_proxy  Input: { type: "residential", country: "us", city: "new york", session_id: "sess-abc", format: "curl" }  Status: PASS
```
Username: `testuser123-country-us-city-newyork-session-sess-abc`. Space stripped from city name. Curl shows real password (expected).

#### Test 4 — env format
```
Tool: novada_proxy  Input: { type: "mobile", format: "env" }  Status: PASS
```
Exports all 4 HTTP_PROXY/HTTPS_PROXY variants. Real password exposed in env exports (expected for this format).

Issues:
7. **No endpoint reachability check** — tool is purely config output; never validates whether the proxy endpoint accepts connections. Acceptable by design (validation would add latency) but neither `novada_proxy` nor `novada_health` actually ping the proxy endpoint for connectivity.
8. **Port fallback inconsistency** — when endpoint has no port (`"proxy.novada.com"`), the proxy URL omits the port, but the Node.js axios example still hardcodes `port: 7777`. The proxy_url and the example disagree.

---

### novada_verify

#### Test 1 — Claim verification (SERP unavailable)
```
Tool: novada_verify
Input: { claim: "coffee is beneficial for health", context: "nutrition" }
Status: PASS (correct behavior given SERP unavailable)
Duration: 1108ms
```

Output:
```
## Verify: Search Unavailable

The Novada SERP endpoint is not yet configured for this API key.

**Alternatives while SERP is unavailable:**
- `novada_extract` with a direct URL — e.g. `https://www.google.com/search?q=your+query`
- `novada_research` — multi-source research without a dedicated search API

Contact support@novada.com to enable SERP access for your account.
```

The tool correctly runs 3 parallel SERP queries, all return code 402, `allUnavailable = true`, returns the SERP_UNAVAILABLE constant with actionable alternatives. CORRECT behavior.

Issues:
9. **SERP_UNAVAILABLE is a constant string** — `contact support@novada.com` is hardcoded. If the action changes (e.g., dashboard self-serve link), both this constant and the health probe note need separate updates.
10. **No graceful degradation** — when SERP is unavailable, tool returns zero verification data. Suggests `novada_research` as alternative but does not internally route to it. Agents must manually re-route. Unlike health which at least gives a partial status table, verify returns nothing useful when SERP is down.

---

### novada_unblock

#### Test 1 — example.com without WEB_UNBLOCKER_KEY
```
Tool: novada_unblock
Input: { url: "https://example.com" }, apiKey: "1f35b477..."
Status: PASS (content returned correctly)
Duration: 57ms
Output: Raw HTML (528 chars)
```

Output excerpt:
```
## Unblocked Content
url: https://example.com
method: render | cost: medium | chars: 528
...
[HTML content — correct]
...
## Agent Hints
- Rendered via Web Unblocker (JS execution enabled).
```

**Critical issue:**
11. **False mode label when WEB_UNBLOCKER_KEY is missing** — `novadaUnblock` calls `routeFetch(url, { render: "render" })`. `router.ts` takes the forced-render branch and hardcodes `return { ..., mode: "render", cost: "medium" }`. Inside, `fetchWithRender()` silently falls back to `fetchViaProxy()` (static/direct fetch) when no unblocker key is configured. The agent receives:
    - `method: render` — FALSE (was static/direct)
    - `cost: medium` — FALSE (actual cost: low/free)
    - `"Rendered via Web Unblocker (JS execution enabled)"` — FALSE
    
    For simple pages like example.com this is harmless. For JS-heavy pages, the static fallback would return a shell/challenge page but still report `method: render`, leading agents to believe JS rendering succeeded.

    **Code path:** `unblock.ts` → `routeFetch({render:"render"})` → `http.ts fetchWithRender()` → no key → `fetchViaProxy()` → static fetch → `router.ts` returns `mode:"render"` hardcoded regardless.

#### Test 2 — cloudflare.com without WEB_UNBLOCKER_KEY
```
Tool: novada_unblock
Input: { url: "https://www.cloudflare.com" }
Status: PASS (content returned)
Duration: 288ms
Output: 981272 chars, truncated to 50000. method: render | cost: medium (BOTH INCORRECT)
```
Content was real cloudflare.com HTML (static fetch worked for this public page). Mode/cost still misreported.

#### Test 3 — No API key
```
Tool: novada_unblock
Input: { url: "https://example.com" }, apiKey: undefined
Status: PASS
Duration: 33ms
method: render | cost: medium (still wrong)
```
No error when apiKey is undefined — fetchViaProxy falls back to direct fetch. Same false label issue.

---

### novada_browser

#### Test 1 — Navigate without NOVADA_BROWSER_WS
```
Tool: novada_browser
Input: { actions: [{ action: "navigate", url: "https://example.com" }], timeout: 30000 }
Status: PASS
Duration: <5ms
```

Output:
```
## Browser API — Not Configured

Set the NOVADA_BROWSER_WS environment variable to enable browser automation.

Example:
  claude mcp add novada \
    -e NOVADA_API_KEY=your_key \
    -e NOVADA_BROWSER_WS=wss://user:pass@upg-scbr2.novada.com \
    -- npx -y novada-search

Get credentials at: https://dashboard.novada.com/overview/browser/
```

Clear, actionable, includes complete setup command. CORRECT.

#### Test 2 — list_sessions (no WS needed)
```
Tool: novada_browser
Input: { actions: [{ action: "list_sessions" }], timeout: 30000 }
Status: PASS
Duration: <5ms
Output: "## Active Browser Sessions\ncount: 0\n\nNo active sessions."
```

`list_sessions` correctly bypasses the WS check (handled before `getBrowserWs()` call). CORRECT.

Note: `playwright-core` optional import is handled gracefully — if WS is set but playwright not installed, returns `"## Browser API — Missing Dependency\n\nRun: npm install playwright-core"`. Good design.

---

## Cross-Tool Consistency Issues

| # | Issue | Tools Affected | Severity |
|---|-------|---------------|----------|
| C1 | Platform count: `"65+ platforms"` (health.ts line 177 error fallback) vs `"129 platforms"` (lines 104, 268) | health | Low |
| C2 | Error delivery inconsistency: scrape throws `Error`; proxy/verify/unblock return strings. Agents need different handling. | scrape vs others | Medium |
| C3 | No `## Agent Hints` section in health output (all other tools have it) | health | Low |
| C4 | "Go to visit..." double-verb in health Next Steps | health | Low |
| C5 | SERP dashboard URL is `dashboard.novada.com/overview/scraper/` (same as Scraper API). If they are different dashboard pages, this is misleading. | health, verify | Low |

---

## Backend Issues (not fixable client-side)

| # | Issue | Impact |
|---|-------|--------|
| B1 | `google_search` operation returns backend 500 after ~18-20s of polling | High — all google scraping fails |
| B2 | SERP API not activated for this API key (code 402) | High — novada_verify and novada_search nonfunctional |
| B3 | Scraper API not activated for this API key (code 11006) | High — novada_scrape nonfunctional except for error path testing |

---

## Code-Level Bugs

### Bug 1 (Medium) — novada_unblock: false `render` mode when WEB_UNBLOCKER_KEY is missing
**Location:** `src/utils/router.ts` lines 73-87; `src/utils/http.ts` lines 170-218  
**Fix options:** (a) Have `fetchWithRender` throw when no unblocker key in forced-render mode; (b) return a `fallback` mode flag that router.ts propagates; (c) check key presence in router before hardcoding `mode:"render"`.

### Bug 2 (Low) — novada_health: "Go to visit..." double-verb in Next Steps
**Location:** `src/tools/health.ts` line 222  
**Fix:** Change `r.note` values to start with the URL, not "visit", or remove "Go to" from template.

### Bug 3 (Low) — novada_health: stale platform count in error fallback path
**Location:** `src/tools/health.ts` line 177  
**Fix:** Use the same label string for both the success and error-fallback paths.

### Bug 4 (Low) — novada_proxy: port missing from proxy_url but shown in example
**Location:** `src/tools/proxy.ts` line 119  
**Fix:** Use `port || 7777` consistently in both the URL and the example object.

### Bug 5 (Low) — novada_scrape: "unknown" error code when backend omits error_code
**Location:** `src/tools/scrape.ts` lines 186-188  
**Fix:** Change template to `"Scraper task failed: ${errMsg}"` omitting the code prefix, or parse HTTP status from error string.

---

## Positive Observations

- **novada_proxy**: graceful no-env degradation; session/country/city username construction works correctly; masked passwords in URL format, real passwords in curl/env formats (correct by design).
- **novada_health**: parallel probe execution is fast (~1s total); correctly distinguishes "not activated" vs "invalid key" for the scraper endpoint; error for empty key (11000) is correct.
- **novada_scrape**: 11006 and 11008 error messages are actionable with next-step instructions embedded. Timeout message includes task_id for dashboard lookup. Async poll loop has correct deadline enforcement (no infinite loop).
- **novada_browser**: `list_sessions` correctly bypasses WS check. `playwright-core` optional import handled gracefully. Not-configured message includes complete setup command.
- **novada_verify**: `allUnavailable` path correctly handles when all 3 parallel SERP queries fail with the same error. SERP_UNAVAILABLE message lists concrete alternatives.
