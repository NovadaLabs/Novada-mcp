# Anti-Bot Extraction Success Rate

**Date:** 2026-06-26
**Tool:** `novadaExtract` (novada-mcp v0.8.x, render=auto)
**API Key:** production key (1f35b...)
**Criteria:** >3000 chars of real content returned, no extraction errors

## Results

| # | Site | Protection | Status | Time (ms) | Content (chars) | Notes |
|---|------|-----------|--------|-----------|-----------------|-------|
| 1 | Cloudflare Learning | Cloudflare WAF | FAIL | 815 | 878 | Browser CDP disconnected (code=1006) |
| 2 | Reuters | JS-heavy + paywall | PASS | 7,318 | 45,796 | Full homepage extracted via render escalation |
| 3 | TechCrunch | Light protection | PASS | 253 | 36,836 | Static fetch succeeded immediately |
| 4 | Wired | Conde Nast stack | PASS* | 567 | 28,162 | Content extracted; test false-negative (article title contained "Failed") |
| 5 | StackOverflow | Aggressive bot detection | FAIL | 130 | 642 | HTTP 403 — blocked at network level |

**Corrected pass rate: 3/5 = 60%**
(Raw test reported 2/5 = 40% due to Wired false negative)

## Failure Analysis

### Cloudflare Learning (FAIL)
- **Error:** `browserType.connectOverCDP: Target page, context or browser has been closed` (ws code=1006)
- **Root cause:** Browser API session terminated before page load completed. Cloudflare's challenge page likely triggered a disconnect.
- **Fix path:** Retry with longer timeout, or use `render="render"` (Web Unblocker) instead of Browser CDP for Cloudflare-protected pages.

### StackOverflow (FAIL)
- **Error:** HTTP 403 Forbidden
- **Root cause:** Static fetch blocked by StackOverflow's bot detection. Auto-escalation to render/browser did not trigger (403 is treated as terminal).
- **Fix path:** Force `render="render"` to use Web Unblocker with residential IP rotation. Auto-escalation should treat 403 as a signal to escalate, not fail.

## Benchmark Comparison

| Provider | Success Rate | Notes |
|----------|-------------|-------|
| Firecrawl (Proxyway 2025) | 33.69% | On truly protected sites |
| **Novada (this test)** | **60%** | 5 protected sites, render=auto |
| Target | 80%+ | With Browser API + stealth patches |

## Test Validity Notes

1. **False negative in test script:** The check `!r.includes('Failed')` is too broad -- it flags article content containing the word "Failed" (e.g., Wired headline "How the Startup Mentality Failed Kids"). A better check would be `r.startsWith('## Extract Failed')`.
2. **Small sample size:** 5 sites is directional, not statistically significant. A proper benchmark needs 20+ sites across protection tiers (Cloudflare, DataDome, Akamai, PerimeterX, Kasada).
3. **Render mode:** All tests used `render=auto`. Forcing `render="render"` on the two failures might improve results.

## Gap to 80% Target

Current: **60%** (3/5). Need **80%+** (4/5 minimum).

### Blocking issues to fix:
1. **403 auto-escalation** -- When static fetch returns 403, auto-escalate to Web Unblocker instead of failing immediately.
2. **Browser CDP stability** -- Cloudflare challenge pages cause CDP disconnect. Need retry logic or fallback to Web Unblocker.
3. **StackOverflow specifically** -- Requires residential IP rotation + proper User-Agent + cookie handling.

### Recommended next steps:
- Re-run with `render="render"` forced on all 5 sites to measure Web Unblocker-only success rate
- Add DataDome (e.g., footlocker.com), Akamai (e.g., nike.com), and PerimeterX (e.g., ticketmaster.com) sites
- Implement 403-to-render auto-escalation in extract.ts
- Add CDP retry with exponential backoff for code=1006 disconnects
