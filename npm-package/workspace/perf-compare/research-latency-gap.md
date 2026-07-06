# JS Page Latency Gap: 7.1s P50 vs Firecrawl 761ms

## Research Question
Can we close the JS rendering latency gap through CODE changes alone?

## Answer
**Code can get us to ~3.0-3.5s P50. Sub-2s requires infrastructure. Sub-1s requires Firecrawl's architecture (pre-warmed browser pools).**

---

## 1. Where the 7.1s Comes From (Breakdown)

### Auto-mode JS-heavy page (worst path): static -> render escalation
```
Static probe (fetchViaProxy)           ~200-800ms
  ├── proxy race + direct race         ~200ms (Promise.any in extract.ts L256-265)
  └── detectJsHeavyContent check       ~0ms
Escalation decision                    ~0ms
fetchWithRender (Web Unblocker)        ~3,000-10,000ms  <-- DOMINANT
  ├── POST to webunlocker.novada.com   ~3,000ms (happy path)
  ├── Inner retry on 403/502           ~+2,000-4,000ms (30% flaky rate per code comment)
  └── timeout ceiling                  60,000ms (config.ts L44: RENDER: 60000)
detectBotChallenge check               ~0ms
(if bot challenge) -> fetchViaBrowser  ~6,000-15,000ms  <-- SLOWEST
  ├── connectOverCDP                   ~2,000-5,000ms (cold connect)
  ├── newContext + newPage             ~500ms
  ├── page.goto + domcontentloaded     ~1,000-3,000ms
  ├── waitForLoadState('networkidle')  ~up to 12,000ms (browser.ts L174)
  ├── Cloudflare wait                  ~6,000ms (browser.ts L185: waitForTimeout(6000))
  └── waitForSelector                  ~up to 15,000ms (browser.ts L190)
```

### Known-domain path (domain registry hit, e.g. amazon.com):
```
lookupDomain -> "render"               ~0ms
fetchWithRender (Web Unblocker)        ~3,000-10,000ms
Total:                                 ~3,000-10,000ms
```

### Measured P50 breakdown estimate:
| Step | Duration | Notes |
|------|----------|-------|
| Wasted static probe | ~500ms | Always runs first in auto mode |
| Web Unblocker request | ~3,000-5,000ms | POST + server-side rendering |
| Web Unblocker retry (30% of requests) | ~2,000ms avg | Exponential backoff on inner 403/502 |
| Bot challenge -> Browser fallback | ~6,000ms | Only ~20% of requests |
| **Weighted P50** | **~7,100ms** | Dominated by Unblocker latency + retries |

## 2. Why Firecrawl Gets 761ms

Based on [Firecrawl's Fire-Engine architecture](https://www.firecrawl.dev/blog/introducing-fire-engine-for-firecrawl) and [DeepWiki analysis](https://deepwiki.com/firecrawl/firecrawl/10.3-browser-service-integration):

1. **Pre-warmed browser pool**: Chromium instances are always-on, already loaded. Navigation is the only cost (~200-500ms). No cold start.
2. **Dedicated Browser Service microservice**: Separate process manages browser lifecycle. Firecrawl API just sends CDP commands over HTTP.
3. **Connection reuse**: Browser sessions persist. No `connectOverCDP` per request (~2-5s saved).
4. **Intelligent wait strategy**: They "intelligently wait for content to load" -- likely using mutation observers or network idle detection without the hard 12s timeout we use.
5. **Proxy pre-connected**: Residential proxy connections are persistent, not established per-request.
6. **No escalation chain**: They don't probe static first. Known-JS pages go straight to the warm browser.

**Their architecture advantage is ~5-6s of cold-start + connection overhead we pay on every request.**

## 3. Code Changes We CAN Make (Ordered by Impact)

### P0: Eliminate wasted static probe for known-JS domains (~500ms saved)
**Status: ALREADY DONE** (domains.ts + router.ts L70-80). Domain registry skips static probe.
But only covers ~60 domains. Unknown JS-heavy domains still waste ~500ms on static probe.

### P1: Pre-resolve Browser API credentials at MCP startup (~2-3s saved on first browser request)
**Current**: `resolveBrowserWs()` is called lazily in `fetchViaBrowser()` on first request.
When `NOVADA_BROWSER_WS` is not set, it calls `fetchBrowserSubAccountCredentials()` which does an HTTP POST to the management API -- adding 1-2s to the first browser request.

**Fix**: Call `resolveBrowserWs()` eagerly during MCP server initialization. Cache the result.
```typescript
// In server startup:
resolveBrowserWs(process.env.NOVADA_API_KEY).catch(() => {}); // fire-and-forget warm
```
**Impact**: Saves ~1-2s on first browser request only. Negligible for P50.

### P2: Reduce Web Unblocker timeout from 60s to 30s (~0ms P50, but cuts P99 tail)
**Current**: `TIMEOUTS.RENDER: 60000` (config.ts L44)
**Fix**: Reduce to 30000ms. If the Unblocker hasn't responded in 30s, it won't.
**Impact**: No P50 improvement, but cuts worst-case P99 from 60s to 30s.

### P3: Eliminate the networkidle wait in browser.ts (~3-8s saved per browser request)
**Current** (browser.ts L174-175):
```typescript
await page.waitForLoadState('networkidle', { timeout: 12000 })
  .catch(() => page.waitForLoadState('domcontentloaded'));
```
`networkidle` waits for NO network activity for 500ms. SPA pages with analytics, websockets, or lazy-loaded assets will NEVER reach networkidle. This wastes up to 12s per request.

**Fix**: Replace with `domcontentloaded` + short fixed wait:
```typescript
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000); // Give JS 2s to hydrate
```
**Impact**: Saves 3-10s on browser-mode requests. Critical path for the ~20% of requests that reach browser.

### P4: Reduce Cloudflare challenge wait from 6s to 3s (~3s saved)
**Current** (browser.ts L185): `await page.waitForTimeout(6000);`
Cloudflare Turnstile typically resolves in 2-3s. The 6s is over-cautious.

**Fix**: Use `page.waitForFunction` with a completion check:
```typescript
// Wait for CF challenge to resolve (max 5s)
await page.waitForFunction(() => {
  return !document.querySelector('.cf-challenge') &&
         !document.body?.textContent?.includes('Just a moment');
}, { timeout: 5000 }).catch(() => {});
```
**Impact**: Saves ~3s on Cloudflare-protected pages.

### P5: Race render + browser in parallel for known-heavy domains (~3-5s saved)
**Current**: Sequential escalation: static -> render -> browser (each waits for previous to complete/fail).
**Fix**: For domains with `method: "browser"` in the registry, skip render and go straight to browser. For domains with `method: "render"`, race render against a browser fallback:

```typescript
if (domainHint?.method === "render") {
  const result = await Promise.any([
    fetchWithRender(url, apiKey, { country }),
    // Browser starts 3s after render, as fallback
    new Promise<string>((resolve, reject) => {
      setTimeout(async () => {
        try { resolve(await fetchViaBrowser(url, opts)); }
        catch (e) { reject(e); }
      }, 3000);
    }),
  ]);
}
```
**Impact**: Saves 3-5s when render is slow/flaky (the 30% retry case). Costs more in browser bandwidth.

### P6: Browser session reuse across extract calls (~2-5s saved on 2nd+ call)
**Current**: Session management exists (browser.ts L16-86) but `extractSingle` never passes `sessionId`.
Every extract call does a full `connectOverCDP` -> `newContext` -> `newPage` cycle.

**Fix**: Generate a per-MCP-session browser session ID. Reuse the same browser connection for subsequent extract calls. The session system already handles TTL (10 min) and cleanup.

```typescript
// In extractSingleInner, when effectiveMode === "browser":
const SESSION_ID = "__novada_extract_reuse__";
html = await fetchViaBrowser(params.url, {
  sessionId: SESSION_ID,
  waitForSelector: params.wait_for,
  wait_ms: params.wait_ms
});
```
**Impact**: Saves 2-5s on every browser request after the first one. The `connectOverCDP` handshake is the single most expensive step and this eliminates it entirely for subsequent calls.

### P7: Expand domain registry to cover top 200 JS-heavy domains (~500ms saved per hit)
**Current**: ~60 domains. Static probe is wasted for unknown JS sites.
**Fix**: Add 140+ more domains (news sites with CF, e-commerce, SaaS dashboards).
**Impact**: Eliminates wasted static probe for more sites. ~500ms per hit, but only helps coverage.

## 4. What Requires INFRASTRUCTURE (Cannot Do in Code)

| Feature | What It Does | Why It's Infra |
|---------|-------------|----------------|
| Browser pool (always-on instances) | Eliminate cold start entirely | Needs persistent server processes, memory management, scaling |
| Pre-rendering cache | Serve cached renders for popular pages | Needs storage backend, cache invalidation strategy |
| Edge-deployed rendering | Render close to target servers | Needs CDN integration, distributed Chromium instances |
| Persistent proxy connections | Pre-authenticated residential proxy tunnels | Needs connection pool server, health monitoring |
| Warm browser service | Firecrawl's core advantage: dedicated microservice with ready instances | Needs separate deployment, orchestration, ~2GB RAM per instance |

## 5. Realistic Targets

### Code-only changes (P3 + P4 + P6 combined):
```
Current JS P50:                    7.1s
- P3 (kill networkidle):          -4.0s  (most impactful single change)
- P4 (smarter CF wait):           -2.0s  (overlaps with P3 for browser path)
- P6 (session reuse, 2nd+ calls): -3.0s  (only helps repeat calls)
- P5 (parallel race):             -2.0s  (conditional, not always hit)
- P1 (pre-resolve creds):         -1.0s  (first call only)

Estimated JS P50 after code changes:  ~3.0-3.5s (first call)
                                       ~1.5-2.5s (subsequent calls with session reuse)
```

### With light infrastructure (warm browser session pool on existing server):
```
Estimated JS P50:                  ~1.5-2.0s
```

### With Firecrawl-equivalent infrastructure (dedicated browser service):
```
Estimated JS P50:                  ~0.5-1.0s
```

## 6. Recommended Implementation Order

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| **P3** | Kill networkidle, use domcontentloaded + 2s wait | 15 min | -4.0s on browser path |
| **P4** | Smart CF wait (waitForFunction instead of 6s sleep) | 30 min | -2.0s on CF pages |
| **P6** | Browser session reuse in extractSingle | 1 hour | -3.0s on 2nd+ browser calls |
| **P5** | Parallel render+browser race for known domains | 2 hours | -2.0s on flaky render |
| **P2** | Reduce RENDER timeout 60s -> 30s | 5 min | Cuts P99 tail |
| **P7** | Expand domain registry to 200+ domains | 1 hour | -500ms per new domain hit |
| **P1** | Pre-resolve browser creds at startup | 15 min | -1s first call only |

## 7. Conclusion

**Code gets us from 7.1s to ~3.0s P50 (first call) / ~2.0s P50 (subsequent calls).**

The remaining gap to Firecrawl's 761ms is architectural: pre-warmed browser pools eliminate the 2-3s cold-start that persists even with all code optimizations. Building that requires a dedicated browser service (~Firecrawl's fire-engine), which is a 2-4 week infrastructure project, not a code change.

The 3.0s target is achievable this week with P3+P4+P6. That's a 57% improvement and closes the gap to 4x Firecrawl (vs current 9.3x).

---

*Research date: 2026-06-26*
*Sources: novada-mcp codebase analysis, [Firecrawl Fire-Engine blog](https://www.firecrawl.dev/blog/introducing-fire-engine-for-firecrawl), [DeepWiki Firecrawl Browser Service](https://deepwiki.com/firecrawl/firecrawl/10.3-browser-service-integration)*
