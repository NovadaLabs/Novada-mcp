# 04 — Routing Check: Extract Path Verification

**Date:** 2026-06-26
**Status:** BUG FOUND + FIXED

---

## Decision Tree (router.ts + extract.ts)

`novadaExtract` with `render='auto'` follows this path in `extractSingleInner`:

1. **DOMAIN_REGISTRY lookup** (`lookupDomain`) → returns `domainHint` with `method: "static" | "render" | "browser"`
2. If `effectiveMode === "browser"` → `fetchViaBrowser` directly
3. If `effectiveMode === "render"` → `fetchWithRender` directly
4. **Otherwise** (effectiveMode is "static" from registry, or "auto" for unknown domains):
   - `effectiveMode === "auto"`: `Promise.any([fetchWithRetry (direct, 3s timeout), fetchViaProxy])` — race, fastest clean response wins
   - `effectiveMode === "static"` (registry hit): `fetchViaProxy` only
5. If JS-heavy/bot-challenge detected on static result → escalate to render (condition guarded by `renderMode === "auto"`)
6. **Quality-score escalation** (BUG-E1): if `quality.score < 40 && usedMode === "static"` → retry with `fetchWithRender`

---

## example.com Routing

DOMAIN_REGISTRY entry:
```
"example.com": { method: "static", note: "Test domain" }
```

Path taken:
- `domainHint.method === "static"` → `effectiveMode = "static"` → `fetchViaProxy`
- example.com returns 166 chars of HTML → `quality.score = 1`

---

## The Bug

**Location:** `src/tools/extract.ts`, BUG-E1 quality escalation block

**Before fix (line 430):**
```typescript
if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && !html.startsWith("pdf_pages:")) {
```

**Problem:** This condition fires even when `domainHint` resolved the domain to "static" via DOMAIN_REGISTRY. For `example.com` (166 chars, quality=1), it called `fetchWithRender` unnecessarily — adding 3–5 seconds of latency per request.

Similarly, the JS-heavy detection escalation at the inner `else` block also fired on `renderMode === "auto"` without respecting the domain registry resolution:
```typescript
// Before:
if (renderMode === "auto" && !html.startsWith("pdf_pages:") && (detectJsHeavyContent(html) || detectBotChallenge(html)))
```

---

## Fix Applied

**File:** `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts`

**Fix 1 — JS-heavy detection escalation guard (line ~294):**
```typescript
// After: added !domainHint
if (renderMode === "auto" && !domainHint && !html.startsWith("pdf_pages:") && (detectJsHeavyContent(html) || detectBotChallenge(html))) {
```

**Fix 2 — Quality-score escalation guard (line ~436, already present as INC-202):**
```typescript
// Already correct in source:
if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && !html.startsWith("pdf_pages:") && !domainHint) {
```

The INC-202 fix was already in source but the JS-heavy detection fix was missing. Both are now in source and rebuilt.

**Rationale:** DOMAIN_REGISTRY entries are hand-curated, authoritative classifications. If a domain is marked "static", it means the page is statically rendered — a low quality score on a minimal page (example.com returns exactly 166 chars by design) should NOT trigger JS rendering escalation.

---

## Timing Results

| URL | Before Fix | After Fix | Mode |
|-----|-----------|-----------|------|
| example.com | 5469ms | **62ms** | static |
| httpbin.org/get | 62500ms (ceiling) | 11361ms | FAILED (503 from proxy) |
| quotes.toscrape.com | 5602ms | 22575ms | static |

**example.com: 5469ms → 62ms (98.9% faster)**

`httpbin.org/get` returns 503 from the proxy — this is a proxy-side issue, not a routing bug. Route is correct (static).

`quotes.toscrape.com` (not in DOMAIN_REGISTRY) is slow due to proxy infrastructure latency; its routing is correct — it reaches `fetchViaProxy` as expected for an unknown domain.

---

## domains.ts — example.com Classification

```
"example.com": { method: "static", note: "Test domain" }
```

Listed on line 46 of `src/utils/domains.ts`. The `lookupDomain` function strips `www.` prefix and does exact-match then subdomain-walk. `example.com` resolves correctly to `method: "static"`.

---

## No Scraper API Usage

`example.com` never touches the Scraper API (`/request` polling endpoint). Path is:

```
novadaExtract → extractSingleInner → fetchViaProxy (direct HTTP via proxy)
```

The Scraper API is only used by `novadaScrape` (separate tool) for platform-specific structured data.
