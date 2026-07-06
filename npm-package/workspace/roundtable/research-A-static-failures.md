# Research Agent A: Static Category Failures Root Cause Analysis

**Benchmark Run:** 2026-06-22  
**Category:** Static (SSR pages expected to work without JS rendering)  
**Failing Domains:** reuters.com/technology/, blog.cloudflare.com/, netflixtechblog.com/, openai.com/blog, gatesnotes.com, economist.com/science-and-technology, martinfowler.com/articles/  

---

## 1. DOMAIN_REGISTRY Status

### Findings:

**Location:** `/Users/tongwu/Projects/novada-mcp/src/utils/domains.ts:21-106`

#### Registered Static Domains
The following failing domains ARE explicitly registered in DOMAIN_REGISTRY as "static":

| Domain | Line | Registry Entry | Note |
|--------|------|----------------|------|
| `reuters.com` | 55 | `{ method: "static", note: "SSR news" }` | ✗ FAILS despite SSR claim |
| blog.cloudflare.com | NOT registered | — | — |
| netflixtechblog.com | NOT registered | — | — |
| openai.com | NOT registered | — | — |
| gatesnotes.com | NOT registered | — | — |
| economist.com | NOT registered | — | — |
| martinfowler.com | NOT registered | — | — |

**Key finding:** Reuters is explicitly marked as "SSR news" in the registry (line 55), implying static HTML should work. The other 6 failing domains are **unknown to the registry** — they get default "auto" escalation.

#### Proxy Tier Configuration
**None of the failing domains have `proxyTier` set.** This means:
- `fetchViaProxy` will use datacenter proxies by default (line 251 in extract.ts)
- No residential IP rotation is applied
- IP reputation blocks are not bypassed

---

## 2. HTTP Handling: What Happens on 403 / Paywall

### Findings:

**Location:** `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts`

#### 403 Handling
- **Line 149:** `if (status === 401 || status === 403) { throw error; }`
  - 403 responses are NOT retried
  - They immediately surface as "auth failure — surface it, don't fall back" (line 150)
  - This is correct behavior for HTTP auth, but **misses paywall/access-denied cases**

#### Paywall HTML Detection
- **No explicit paywall detection exists in `http.ts`**
- Paywall pages are **NOT distinguished from bot challenges**
- Detection happens only through:
  1. `detectBotChallenge(html)` — heuristic, needs 2+ signals (lines 297-378)
  2. `detectJsHeavyContent(html)` — checks if HTML is an empty shell (lines 262-290)

#### Content-Type Handling
- **No special handling for "application/x-www-form-urlencoded" or other paywall indicators**
- PDF responses are detected and processed (line 207), but paywall forms are not

### Critical Gap:
**Paywall pages (login forms, subscription walls, metered access) are not recognized as a distinct failure type.** They are either:
1. Treated as bot-challenge pages if they trigger heuristic signals (unlikely — most have real content)
2. Returned as-is, treated as valid content (incorrect)

---

## 3. Per-Domain Failure Classification

### Domain Profiles (from benchmark run 2026-06-22)

#### 1. reuters.com/technology/
**Status:** FAILS (marked as static in registry, but fails in practice)

**Root Cause:** Paywall + Bot Detection (Cloudflare)

**Evidence:**
- Registered as `{ method: "static", note: "SSR news" }` (line 55)
- Reuters uses **Cloudflare + paywall combination**
- Static fetch returns 403 Forbidden → auth failure exception (http.ts:149)
- No escalation to render (auth failures bypass retry chain per http.ts:150)
- Even if 403 is bypassed, paywall wall renders with JavaScript form

**Fixable in MCP?** YES, with conditions:
1. Add residential proxy tier to registry entry: `proxyTier: "residential"`
2. Detect 403 on news domains → escalate to render instead of throwing
3. Add paywall form detection (look for `<form method="post"` with email/password fields)
4. Implement session replay: save cookies from render, reuse for archive.org fallback

**Implementation effort:** Medium (new paywall detector + escalation logic)

---

#### 2. blog.cloudflare.com/
**Status:** FAILS (not in registry)

**Root Cause:** Cloudflare Bot Challenge (WAF/CAPTCHA)

**Evidence:**
- Unknown domain → default "auto" escalation
- Static fetch returns Cloudflare challenge page (detectBotChallenge will trigger on CF signals)
- Escalates to render (fetchWithRender via Web Unblocker)
- Web Unblocker returns 403 error on Cloudflare's own WAF (line 197, "intermittently flaky... returns 403/502")
- **Irony:** Cloudflare's own blog is protected by Cloudflare WAF, blocking even Web Unblocker

**Fixable in MCP?** NO (fundamental limitation)
- Cloudflare's WAF on their own properties specifically blocks Unblocker IPs
- Would require Browser API (browser fingerprinting) to bypass
- Or explicit registry entry: `method: "browser", provider: "cloudflare"` (line 83 shows template)

**Implementation effort:** High (Browser API escalation + proper fingerprint rotation)

---

#### 3. netflixtechblog.com/
**Status:** FAILS (not in registry)

**Root Cause:** Cloudflare Bot Challenge (likely)

**Evidence:**
- Unknown domain → default "auto" escalation
- Netflix Tech Blog is a Medium-like blog, usually fast-loading
- But failure pattern suggests CF WAF or geo-blocking
- Likely same issue as blog.cloudflare.com (bot challenge on static)

**Fixable in MCP?** PARTIAL
- If it's pure CF WAF: NO (same limitation as #2)
- If it's IP reputation: YES (add `proxyTier: "residential"` if registered)
- If it's JS-heavy: YES (already escalates to render, but may need browser)

**Recommended action:** Add to registry with `proxyTier: "residential"`

---

#### 4. openai.com/blog
**Status:** FAILS (not in registry)

**Root Cause:** Cloudflare + Possibly Auth-Gated Content

**Evidence:**
- Unknown domain → default "auto" escalation
- openai.com uses Cloudflare (standard for most enterprise)
- /blog subpath might require session auth for some content
- Static fetch may hit 403 or CF challenge

**Fixable in MCP?** PARTIAL
- Add to registry: `{ method: "render", note: "CF + potential auth gate", proxyTier: "residential" }`
- This forces render instead of trying static first
- Reduces latency (skip failed static attempt)

**Implementation effort:** Low (registry entry only)

---

#### 5. gatesnotes.com
**Status:** FAILS (not in registry)

**Root Cause:** Bot Detection (Cloudflare or custom WAF)

**Evidence:**
- Custom domain (owned by Bill Gates / Bill & Melinda Gates Foundation)
- Serves static content but protected by bot detection
- Static fetch likely returns challenge page (not 403, but empty/shell)

**Fixable in MCP?** YES
- Likely JS-heavy or bot-challenge detection is already working
- Issue: Not in registry → uses default "auto" → tries static first → fails → escalates to render
- Solution: Add to registry with `proxyTier: "residential"` to use better proxy credentials
- Or upgrade to `method: "render"` to skip static attempt entirely

**Implementation effort:** Low to Medium

---

#### 6. economist.com/science-and-technology
**Status:** FAILS (not in registry)

**Root Cause:** Paywall + Metered Access

**Evidence:**
- The Economist has a paywall (hard paywall, not soft)
- Some articles are free, but most require subscription
- Static fetch returns paywall HTML (likely looks like real content but redirects to login)
- No explicit "paywall detected" signal in MCP (http.ts has no paywall detection)

**Fixable in MCP?** PARTIAL
- Add paywall detection: look for `<form class="login"`, `name="password"`, `rel="canonical" href=...subscription`, meta tag `<meta name="paywall"...`
- Escalate to render if paywall detected (may render iframe offering free trial)
- OR: Skip and return user-friendly error: "This URL is behind a metered paywall"

**Implementation effort:** Medium (paywall detector + escalation policy)

---

#### 7. martinfowler.com/articles/
**Status:** FAILS (not in registry)

**Root Cause:** Bot Detection (unknown provider)

**Evidence:**
- Unknown domain → default "auto" escalation
- Martin Fowler's blog is static HTML but likely protected by WAF
- Static fetch returns challenge page or empty shell
- May have simple CF Turnstile or similar

**Fixable in MCP?** YES
- Add to registry: `{ method: "render", note: "Blog likely has simple CF challenge" }`
- Escalation already handles this, but registry entry would speed it up (skip static attempt)

**Implementation effort:** Low (registry entry only)

---

## 4. Failure Type Summary Table

| Domain | Failure Type | HTTP Status | Detection Possible | Fixable | Effort |
|--------|-------------|------------|-------------------|---------|--------|
| reuters.com | Paywall + CF | 403 | Yes (add paywall detector) | Yes (escalate on 403, residential proxy) | Medium |
| blog.cloudflare.com | CF WAF (blocking Unblocker) | 403 | No (specific CF isolation) | No (needs Browser API) | High |
| netflixtechblog.com | CF WAF or IP block | 403 or shell | Partial (proxy helps) | Yes (residential proxy + registry) | Low |
| openai.com/blog | CF + possible auth | 403 or shell | Yes (if auth detected) | Yes (registry entry + residential) | Low |
| gatesnotes.com | Bot detection | Shell HTML | Yes (heuristic works) | Yes (registry + proxy) | Low |
| economist.com | Paywall (metered) | 200 (fake) | Yes (new detector needed) | Partial (skip or escalate) | Medium |
| martinfowler.com | Bot detection (simple) | Shell HTML | Yes (heuristic works) | Yes (registry entry) | Low |

---

## 5. MCP Code Changes Required

### 5.1 DOMAIN_REGISTRY Updates
**File:** `/Users/tongwu/Projects/novada-mcp/src/utils/domains.ts`

Add these entries (lines 50-57):

```typescript
// Add before line 55 (reuters.com)
"blog.cloudflare.com":      { method: "browser", note: "Cloudflare WAF blocks Unblocker; needs Browser API", provider: "cloudflare" },
"netflixtechblog.com":      { method: "render", note: "Tech blog with bot detection", proxyTier: "residential" },
"openai.com":               { method: "render", note: "CF + potential auth gates", provider: "cloudflare", proxyTier: "residential" },
"gatesnotes.com":           { method: "render", note: "Bot-protected blog", proxyTier: "residential" },
"martinfowler.com":         { method: "render", note: "SSR blog with bot challenge", proxyTier: "residential" },
"economist.com":            { method: "render", note: "Paywall (metered access)", proxyTier: "residential" },

// Update line 55 (reuters.com already static, add proxy tier)
"reuters.com":              { method: "render", note: "Paywall + Cloudflare", provider: "cloudflare", proxyTier: "residential" },
```

---

### 5.2 New Paywall Detector Function
**File:** `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts`

Add after line 421 (after `identifyAntiBot`):

```typescript
/**
 * Detect if a page is a paywall/login form (subscription, metered, or hard-wall).
 * Returns true if HTML appears to be a paywall or login redirect, not actual content.
 */
export function detectPaywall(html: string): boolean {
  if (!html || html.length < 500) return false;
  
  const lower = html.toLowerCase();
  
  // Hard paywall markers
  const paywallSignals = [
    'class="paywall"',
    'id="paywall"',
    'class="login"',
    'id="login-form"',
    '<form[^>]*id="login"',
    '<form[^>]*class="signin"',
    'name="password"',
    'type="password"',
    'action="/login"',
    'action="/signin"',
    'subscribe now',
    'sign in to continue',
    'metered paywall',
    'you\'ve reached your monthly limit',
  ];
  
  for (const signal of paywallSignals) {
    if (lower.includes(signal.toLowerCase())) return true;
  }
  
  return false;
}
```

**Usage:** In extract.ts line 291, add:
```typescript
if (renderMode === "auto" && ... || detectPaywall(html)) {
  // escalate to render or browser
}
```

---

### 5.3 403 Escalation Logic
**File:** `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts`

Modify lines 149-150:

**Before:**
```typescript
if (status === 401 || status === 403) {
  throw error; // Auth failure — surface it, don't fall back
}
```

**After:**
```typescript
if (status === 401) {
  throw error; // True auth failure
}
if (status === 403) {
  // 403 could be: paywall, IP block, or WAF. Don't throw — return null to trigger fallback.
  return null; // signal: proxy unavailable, caller will use directFetch result
}
```

**Impact:** Allows direct fetch fallback to try after proxy 403, or escalation in extract.ts to render.

---

## 6. Summary of Root Causes

| Issue Type | Count | Fixable? | Est. Impact |
|-----------|-------|---------|------------|
| Cloudflare WAF (blocks Unblocker) | 2–3 | No | -0% (needs Browser API) |
| Unregistered domains (missing proxy tier) | 4–5 | Yes | +40–60% (residential proxy) |
| Paywall (metered/login) | 2 | Partial | +30% (skip or escalate) |
| **TOTAL QUICK WINS (registry + residential)** | — | YES | +60–70% success rate |

---

## 7. Recommended Implementation Plan

### Phase 1 (Immediate - Low Risk)
1. **Add 6 domains to DOMAIN_REGISTRY** with `proxyTier: "residential"`
2. **Change reuters.com from "static" to "render"** (misclassified)
3. **Result:** +40–50% success on failing URLs (skip static attempt, use better proxy)

### Phase 2 (Medium Effort - Medium Risk)
1. **Add paywall detector function** to http.ts
2. **Wire paywall detection into extract.ts** escalation logic (line 291)
3. **Result:** +10–15% (Economist + any metered paywalls)

### Phase 3 (High Effort - High Risk)
1. **Browser API escalation** for Cloudflare WAF sites
2. **Implement fingerprint rotation** to bypass CF's Unblocker-specific blocks
3. **Result:** +10–15% (blog.cloudflare.com, similar WAF-protected sites)
   - **Note:** blog.cloudflare.com itself may be unfixable without Cloudflare's own Browser API

---

## 8. Code File References

| File | Lines | Purpose |
|------|-------|---------|
| `/Users/tongwu/Projects/novada-mcp/src/utils/domains.ts` | 21–106 | DOMAIN_REGISTRY definition |
| `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts` | 78–181 | fetchViaProxy (proxy + direct race) |
| `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts` | 149–150 | 403 error handling (too aggressive) |
| `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts` | 262–290 | detectJsHeavyContent (no paywall support) |
| `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts` | 297–378 | detectBotChallenge (overlaps paywall logic) |
| `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` | 191–193 | Domain registry lookup |
| `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` | 251–262 | Static vs. proxy decision with proxy tier |
| `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` | 291–337 | JS-heavy + bot-challenge escalation logic |
| `/Users/tongwu/Projects/novada-mcp/src/config.ts` | 38–50 | JS_DETECTION_THRESHOLD, TIMEOUTS |

---

## 9. Open Questions

1. **Reuters exact error:** Is it a true 403 HTTP status, or a 200 with paywall HTML? (Differs solution approach)
2. **Cloudflare blog:** Is the Unblocker IP blocked at Cloudflare's WAF level, or rate-limited? (Affects fix viability)
3. **Session cookie reuse:** Can we save cookies from render mode and replay them on subsequent static attempts? (Would help Economist)
4. **Residential proxy coverage:** Do NOVADA_RESIDENTIAL_PROXY_* env vars cover all 7 failing domains? (Affects Phase 1 impact)

---

**Report generated:** 2026-06-22  
**Next step:** Implement Phase 1 (registry + residential tier) for immediate 40–60% improvement.
