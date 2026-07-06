# Backend API Issues — novada-mcp

Confirmed via live curl tests on 2026-04-24. Issues that require backend changes to resolve.

---

## B1: SERP Search endpoint returns 404

**Endpoint:** `GET scraper.novada.com/search`  
**Expected:** Returns SERP results (organic, knowledge panel, news, etc.)  
**Actual:** HTTP 404 — endpoint not deployed  
**Impact:** `novada_search` falls back to direct HTTP requests, bypassing the Scraper API. Search results are not personalized, not routed through proxies, and miss structured scraper output.  
**Fix:** Deploy `/search` endpoint with SERP support on `scraper.novada.com`.

---

## B2: Scraper `/result` polling endpoint not exposed

**Endpoint:** `GET scraper.novada.com/result?task_id=...`  
**Expected:** Returns completed async scrape results  
**Actual:** Not accessible — results are only returned synchronously in the `/request` response body  
**Impact:** Long-running scrapes (>60s) cannot be polled. SDK cannot implement async task patterns.  
**Fix:** Either expose `/result` polling or confirm synchronous-only is the intended design.

---

## B3: Web Unblocker response wraps HTML inside `data.data.html`

**Endpoint:** `POST webunlocker.novada.com/request`  
**Current response format:**
```json
{ "code": 0, "data": { "code": 200, "html": "...", "msg": "", "msg_detail": "" } }
```
**Expected / more ergonomic:**
```json
{ "code": 0, "html": "...", "status": 200 }
```
**Impact:** Requires double-unwrapping in client code. Every caller must check `resp.data?.code === 0 && resp.data?.data?.html`.  
**Fix:** Flatten the response — either return HTML at top-level or reduce nesting to one level. Backward-compatible: add a top-level `html` field.

---

## B4: Residential Proxy — no endpoint for IP verification

**Feature:** `novada_proxy verify` shows the outbound IP of a proxied request  
**Workaround used:** Calls `https://api.ipify.org?format=json` through the proxy — works but depends on a third-party service  
**Impact:** Cannot verify proxy connectivity without external service. IP geolocation accuracy is not validated.  
**Fix:** Expose a first-party endpoint (e.g., `GET api.novada.com/proxy/myip`) that returns the proxied IP + geolocation. Eliminates third-party dependency.

---

## B5: Scraper API — no endpoint to list supported platforms

**Feature needed:** `GET scraper.novada.com/platforms` — returns list of supported scraper IDs and their operations  
**Workaround:** We hardcode a partial list of 129 platform names  
**Impact:** Platform list goes stale. Agents cannot discover available scrapers dynamically.  
**Fix:** Add a `/platforms` endpoint returning `[{ id, name, operations: [...] }]`. This enables auto-discovery and makes the tool self-documenting.

---

## B6: Web Unblocker — no JS-rendered screenshot capability

**Feature needed:** `js_render=true` + `include_screenshot=true` in request body  
**Current behavior:** Returns HTML only, no screenshot  
**Impact:** Cannot visually verify rendered page state. Bot challenge detection relies on HTML parsing heuristics only — screenshots would allow ground-truth verification.  
**Fix:** Add optional `include_screenshot: true` field to `/request`. Returns base64 PNG alongside HTML. Used by `novada_browser` screenshot action as fallback when full Browser API is too expensive.

---

## Summary

| ID | Severity | Area | Status |
|----|----------|------|--------|
| B1 | High | SERP API | 404, not deployed |
| B2 | Medium | Scraper async | Not exposed |
| B3 | Low | Web Unblocker | Workaround in place |
| B4 | Low | Proxy | Third-party workaround |
| B5 | Medium | Scraper metadata | Hardcoded list |
| B6 | Low | Web Unblocker | Feature request |

B1 has the highest impact — it prevents proper SERP search functionality. B5 is important for long-term SDK maintainability.
