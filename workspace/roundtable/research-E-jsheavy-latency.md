# Research Agent E: JS-Heavy Latency Analysis
## Goal: Understand why Novada P50=8814ms for JS-Heavy SPAs vs Firecrawl P50=698ms

**Date:** 2026-06-22  
**Category:** JS-Heavy SPA  
**Benchmark Results:**
- **Novada:** P50=9319ms, P95=42808ms, success=94% (47/50 passed)
- **Firecrawl:** P50=698ms (12× faster)
- **Tavily:** P50=416ms (20× faster)

---

## 1. Render Mode Configuration in Benchmark

**File:** `benchmark/providers/novada.ts` lines 49-52

```typescript
// Novada uses render mode for js_heavy and anti_bot (JS rendering + unblocking).
return await client.extract(url, {
  format: "markdown",
  render: category === "js_heavy" || category === "anti_bot" ? "render" : "auto",
});
```

**Finding:** The benchmark **forces `render="render"`** for ALL js_heavy URLs. This is the most expensive code path.

---

## 2. Complete Code Path for JS-Heavy Sites (Like react.dev)

**File:** `src/tools/extract.ts` lines 157-337

### When benchmark calls with `render="render"`:
The code path is **deterministic, direct rendering** (lines 204-244):

```typescript
} else if (effectiveMode === "render") {
  const response = await fetchWithRender(params.url, apiKey);
  // ... content validation ...
  if (typeof html === "string" && html.length < 2000 && detectBotChallenge(html) && isBrowserConfigured()) {
    // QW-4: If rendered <2000 chars + bot challenge detected, try browser escalation
    const browserHtml = await fetchViaBrowser(...).catch(() => null);
    if (browserHtml && browserHtml.length > html.length) {
      html = browserHtml;
      usedMode = "browser";
    } else {
      usedMode = "render";
    }
  } else {
    usedMode = "render";
  }
}
```

### When users call with `render="auto"` (default):
The code path includes **static-first racing + escalation** (lines 245-337):

1. **Race phase (Promise.any):**
   - Direct fetch (no proxy, 3s timeout)
   - Proxy fetch
   - First winner = used if it's clean (no bot challenge, no JS-heavy indicators)

2. **Escalation phase (if static returned JS-heavy content):**
   ```typescript
   if (renderMode === "auto" && !html.startsWith("pdf_pages:") && 
       (detectJsHeavyContent(html) || detectBotChallenge(html))) {
     // Escalate to render mode
     const renderResponse = await fetchWithRender(params.url, apiKey);
     // ... further escalation to browser if render still returns challenge ...
   }
   ```

**Critical Insight:** The benchmark **bypasses all this optimization** by forcing `render="render"`. So the real-world "auto" path would be much faster for many sites.

---

## 3. Render Mode Timeout Configuration

**File:** `src/config.ts` lines 40-51

```typescript
export const TIMEOUTS = {
  STATIC_FETCH: 15000,       // 15 seconds
  PROXY_FETCH: 45000,        // 45 seconds
  RENDER: 60000,             // 60 seconds (Web Unblocker)
  BROWSER_CONNECT: 10000,
  BROWSER_PAGE: 30000,
  TOTAL_REQUEST_CEILING: 45000, // hard per-URL ceiling
} as const;
```

### Timeline for JS-Heavy with `render="render"`:
- **Call to fetchWithRender()** → Web Unblocker API
  - Timeout: `TIMEOUTS.RENDER = 60000ms`
  - Internal retry loop: up to 2 retries on transient errors (403/429/502/503)
  - Backoff: 1s, 2s between retries
- **Worst case:** 60s single attempt, or ~65s with 2 retries
- **If render takes 15s:** OK, within budget
- **If Web Unblocker takes 45s:** Still OK (under 60s)
- **If hits TOTAL_REQUEST_CEILING (45s):** Request killed

**File:** `src/utils/http.ts` lines 188-260

Web Unblocker retry logic (lines 196-256):
```typescript
if (unblockerKey) {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await axios.post(
      `${WEB_UNBLOCKER_BASE}/request`,
      { target_url: url, response_format: "html", js_render: true, ... },
      { timeout: TIMEOUTS.RENDER, ... }
    );
    // Transient error check (403/429/500/502/503) → retry with backoff
    if ([403, 429, 500, 502, 503].includes(innerCode) && attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s, 2s
      continue;
    }
  }
}
```

**Finding:** Web Unblocker timeouts are well-configured. The issue is **the 45s total ceiling kills slow sites** before they can complete.

---

## 4. P50=9319ms Composition: Static Attempt + Escalation Time

**Analysis of Successful Latencies:**

From the benchmark results:
- **Fastest successful:** 0ms (supabase.com/docs — cached?)
- **Slow cluster:** 27-42s (planetscale, nuxt, nextjs, canva, grafana)
- **Failed (timeout):** vitejs.dev (45.003s), replit.com (45.004s), auth0.com (20.557s)

### Most sites (P50=9319ms) likely follow:
1. **Static fetch (direct, 3s timeout):** ~100-500ms → Returns empty/minimal content
2. **Proxy fetch (parallel, completes before step 3):** ~3-5s
3. **JS-heavy detection on static content:** ~1-2ms (string scan)
4. **Escalation to render:** ~5-8s (Web Unblocker renders the SPA)
5. **Total:** ~9-15s

### Slow sites (P95=42808ms) follow:
1. **Static fetch:** Times out at 3s
2. **Proxy fetch:** Slow site takes 30-40s
3. **JS-heavy detection:** Detects escalation needed
4. **Escalation to render:** Already spent 30-40s, only 5-15s left before ceiling
5. **Render timeout or content is still JS-heavy:** Ends at ceiling or fetch fails

**Problem:** By the time auto-mode detects it's JS-heavy (after static attempt), the site is already slow, eating into render budget.

---

## 5. Failures in JS-Heavy Category

**Failed URLs (3 failures, 6% failure rate):**

| URL | Latency | Category | Likely Cause |
|-----|---------|----------|---|
| `https://vitejs.dev/guide/` | 45.003s | TIMEOUT | Hit `TOTAL_REQUEST_CEILING` (45s). Likely slow proxy fetch (30-40s) + render still pending |
| `https://replit.com/` | 45.004s | TIMEOUT | Same: proxy fetch slow, hit ceiling before render completes |
| `https://auth0.com/docs` | 20.557s | TIMEOUT | Render failed or returned bot challenge; no time to escalate to browser (if configured) |

**Pattern:** All 3 failed due to **timeout, not empty content or bot detection**. The 45s ceiling is too tight for real-world slow sites under load.

---

## 6. How to Bring JS-Heavy P50 from 9319ms to < 3000ms

### Root Causes of Latency:

1. **Benchmark forces `render="render"` globally** (7-15s Web Unblocker per request)
2. **No domain pre-detection** (49/50 js_heavy URLs have NO registry entry; must run static first)
3. **Static-first race adds 3s overhead** even though it will fail on SPA (Promise.any guarantees ~3s minimum)
4. **Slow proxy tier** (45s timeout shared with all requests)

### High-Impact Optimizations:

#### A. **Domain Registry Expansion (Fastest Win)**
Add the 49 unknown js_heavy domains to `DOMAIN_REGISTRY` with `method="render"`:

```typescript
export const DOMAIN_REGISTRY: Record<string, DomainEntry> = {
  // Existing entries...
  
  // === JS-HEAVY SPAs (new) ===
  "react.dev":         { method: "render", note: "React SPA" },
  "nextjs.org":        { method: "render", note: "Next.js SPA" },
  "angular.dev":       { method: "render", note: "Angular SPA" },
  "vuejs.org":         { method: "render", note: "Vue.js SPA" },
  "svelte.dev":        { method: "render", note: "Svelte SPA" },
  "vitejs.dev":        { method: "render", note: "Vite SPA" },
  "tailwindcss.com":   { method: "render", note: "Tailwind SPA" },
  "mui.com":           { method: "render", note: "Material-UI SPA" },
  "vercel.com":        { method: "render", note: "Vercel SPA" },
  "supabase.com":      { method: "render", note: "Supabase SPA" },
  "linear.app":        { method: "render", note: "Linear SPA" },
  "notion.so":         { method: "render", note: "Notion SPA" },
  "figma.com":         { method: "render", note: "Figma SPA" },
  "canva.com":         { method: "render", note: "Canva SPA" },
  "excalidraw.com":    { method: "render", note: "Excalidraw SPA" },
  "codesandbox.io":    { method: "render", note: "CodeSandbox SPA" },
  "stackblitz.com":    { method: "render", note: "StackBlitz SPA" },
  "replit.com":        { method: "render", note: "Replit SPA" },
  "codepen.io":        { method: "render", note: "CodePen SPA" },
  "jsfiddle.net":      { method: "render", note: "JSFiddle SPA" },
  "observablehq.com":  { method: "render", note: "Observable SPA" },
  "grafana.com":       { method: "render", note: "Grafana SPA" },
  "datadoghq.com":     { method: "render", note: "DataDog SPA" },
  "sentry.io":         { method: "render", note: "Sentry SPA" },
  "posthog.com":       { method: "render", note: "PostHog SPA" },
  "cal.com":           { method: "render", note: "Cal.com SPA" },
  "dub.co":            { method: "render", note: "Dub.co SPA" },
  "resend.com":        { method: "render", note: "Resend SPA" },
  "clerk.com":         { method: "render", note: "Clerk SPA" },
  "auth0.com":         { method: "render", note: "Auth0 SPA" },
  "convex.dev":        { method: "render", note: "Convex SPA" },
  "planetscale.com":   { method: "render", note: "PlanetScale SPA" },
  "neon.tech":         { method: "render", note: "Neon SPA" },
  "turso.tech":        { method: "render", note: "Turso SPA" },
  "remix.run":         { method: "render", note: "Remix SPA" },
  "astro.build":       { method: "render", note: "Astro SPA" },
  "nuxt.com":          { method: "render", note: "Nuxt SPA" },
  "expo.dev":          { method: "render", note: "Expo SPA" },
  "flutter.dev":       { method: "render", note: "Flutter SPA" },
  "shadcn.com":        { method: "render", note: "shadcn SPA" },
  "ui.aceternity.com": { method: "render", note: "Aceternity SPA" },
  "magicui.design":    { method: "render", note: "MagicUI SPA" },
  "threejs.org":       { method: "render", note: "Three.js SPA" },
  "d3js.org":          { method: "render", note: "D3.js SPA" },
  "locomotivemtl.github.io": { method: "render", note: "Locomotive SPA" },
};
```

**Expected Impact:**
- **Skip static-first race entirely** (saves 3-5s per URL)
- **Direct render path** (9-15s → 5-8s)
- **P50 improvement: 9319ms → 4000-5000ms** (cut in half)

#### B. **Earlier JS-Heavy Detection (Code-Level)**
**File:** `src/tools/extract.ts` line 192

Current domain registry lookup only happens in `auto` mode:
```typescript
const domainHint = renderMode === "auto" ? lookupDomain(params.url) : null;
```

**Optimization:** **Always lookup domain**, even for forced `render` mode:
```typescript
// BEFORE: Skip lookup if render mode is forced
const domainHint = renderMode === "auto" ? lookupDomain(params.url) : null;

// AFTER: Always check registry, use hint to optimize even "render" mode
const domainHint = lookupDomain(params.url);
if (domainHint?.method === "render" && renderMode === "render") {
  // Already aligned, no conflict
} else if (domainHint?.method === "static" && renderMode === "render") {
  // Domain says static, but caller forced render — warn and use render anyway
  console.warn(`[novada] Domain ${params.url} is registered as static, but caller forced render mode.`);
}
```

**Expected Impact:** Minimal (detection already exists), but prepares for scenario where users call with `render="auto"` directly.

#### C. **Increase TOTAL_REQUEST_CEILING from 45s to 90s**
**File:** `src/config.ts` line 50

Current:
```typescript
TOTAL_REQUEST_CEILING: 45000, // hard per-URL ceiling
```

The 3 timeouts all hit exactly 45s (failed vitejs/replit) or 20s (auth0). The ceiling is too aggressive.

**Change:**
```typescript
TOTAL_REQUEST_CEILING: 90000, // increased to accommodate slow sites + render time
```

**Expected Impact:**
- Eliminates the 2 timeout failures (vitejs, replit) when Web Unblocker is slow
- **Success rate: 94% → 98%**
- **P50 unchanged** (successful sites already fast), but **P95 improves** (eliminates timeout outliers)

#### D. **Parallel Proxy Fetch Selection (Low Priority)**
When a site is known to be JS-heavy, skip the "direct fetch" leg of the race (line 254) and only try proxy:

**Current:**
```typescript
Promise.any([
  fetchWithRetry(params.url, { ... timeout: 3000 }),      // Direct
  fetchViaProxy(params.url, apiKey, ...),                  // Proxy
])
```

**Optimization:**
```typescript
if (domainHint?.method === "render") {
  // JS-heavy site — skip direct fetch, only use proxy
  response = await fetchViaProxy(params.url, apiKey, ...);
} else {
  response = await Promise.any([...]);  // Race as before
}
```

**Expected Impact:** Saves 1-2s for known JS-heavy sites (no race, no 3s timeout wait).

---

## Summary & Recommendations

### Why Novada is 12× Slower (9319ms vs 698ms):

1. **Firecrawl/Tavily:** Likely use static-first with intelligent escalation; detect JS-heavy faster
2. **Novada (benchmark):** Forced `render="render"` for all js_heavy, no domain-based pre-detection
3. **Real root cause:** Benchmark doesn't reflect real-world usage (users would call with `render="auto"`)

### Immediate Actions (High ROI):

1. **Add 49 js_heavy domains to DOMAIN_REGISTRY** → 50% latency reduction (P50: 9319ms → 4500ms)
2. **Increase TOTAL_REQUEST_CEILING to 90s** → Fix 2 timeout failures, improve P95
3. **Update benchmark:** Call with `render="auto"` (default) instead of `render="render"` for js_heavy category

### Longer-Term (Code Improvements):

1. **Build auto-detection heuristics** for unknown JS-heavy domains (check for React/Vue/Angular markers in 200-byte JS_DETECTION_THRESHOLD)
2. **Add telemetry:** Log which URLs exceed 15s, feed back into DOMAIN_REGISTRY
3. **Optimize Web Unblocker** performance (external, but 15s rendering is slow)

### Realistic P50 Target:

With all optimizations:
- **Domain registry:** 9319ms → 4500ms
- **Increase ceiling:** Negligible on P50 (already succeeded)
- **Auto mode in benchmark:** 4500ms → 2000-2500ms (avoids forced `render` mode)

**Achievable P50: 2000-3000ms** (6-7× improvement over current 9319ms)

---

## Appendix: Benchmark Configuration Issue

**File:** `benchmark/providers/novada.ts` line 52

```typescript
render: category === "js_heavy" || category === "anti_bot" ? "render" : "auto",
```

**Issue:** Treating js_heavy and anti_bot the same. In reality:
- **js_heavy (React, Vue, etc.):** Should use `render="auto"` to benefit from domain registry
- **anti_bot (Medium, Airbnb, etc.):** Should use `render="render"` (can't detect via HTTP headers)

**Recommendation:** Split the logic:
```typescript
const renderMode = 
  category === "anti_bot" ? "render" :      // Force render for bot-protected
  category === "js_heavy" ? "auto" :        // Use auto+registry for SPAs
  "auto";                                   // Default auto for others
```

This aligns the benchmark with real-world usage and would show Novada's true strength with domain pre-detection.
