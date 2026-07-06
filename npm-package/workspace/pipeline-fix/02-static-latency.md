# Pipeline Fix: Static Latency for Simple Domains (example.com)

**Date:** 2026-06-26
**Observed:** example.com takes 4.9–11s, expected <500ms
**Root cause:** Two compounding bugs — see below

---

## 1. Routing Path (Confirmed)

example.com IS in DOMAIN_REGISTRY (`domains.ts:46`) as `{ method: "static" }`.

`extractSingleInner` (extract.ts:193–194) reads the domain hint, sets `effectiveMode = "static"` — correct. It does NOT hit Scraper API. The domain lookup works.

The actual fetch goes through the `auto`/`static` branch at extract.ts:248–265:

```
Promise.any([
  fetchWithRetry(url, { timeout: 3000 })   // direct, 3s cap
  fetchViaProxy(url, apiKey)               // proxy, 45s cap
])
```

For example.com the direct fetch wins in ~200ms. This part is fine.

---

## 2. Root Cause 1: Quality Scorer Triggers Unnecessary Render Escalation

After static fetch succeeds, `scoreExtraction` is called with example.com's content.

**Score calculation for example.com:**
- `content_tiny:-20` — fires when markdown < 200 chars. example.com's full-page markdown is ~166–231 chars (minimal page)
- `link_density_ok:+10` — fires only when link density >= 0.05. At 1 link / ~40 words = 0.025, does NOT fire
- `mode_static:+10` — fires
- Net: score = 0–10, floored to 1 by P0-1 guard (`extract.ts:419-421`)

**Threshold check at extract.ts:430:**
```typescript
if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && ...)
```
Score 1 < 40 → escalation triggered.

**Escalation sequence:**
1. `fetchWithRender()` called — hits webunlocker.novada.com with `TIMEOUTS.RENDER = 60s`
2. Web Unblocker is not configured (no `NOVADA_WEB_UNBLOCKER_KEY`) → falls back to `fetchViaProxy()`
3. Proxy fetch for render path adds another ~3–7s
4. Render result is also short (example.com is genuinely minimal) → score still low
5. `escalationFailed = true` logged, but result is returned as-is

**Total latency path:**
- Direct static fetch: ~200ms
- Unnecessary render escalation (fetchWithRender → proxy): ~4.5–10s
- **Total observed: 4.9–11s**

---

## 3. Root Cause 2: Quality Threshold Does Not Account for Known-Minimal Domains

The scorer's `content_tiny:-20` penalty is appropriate for JS-heavy pages that return empty shells. But example.com is a deliberately minimal page — it has exactly 166 chars of content by design. Penalizing it for being "too short" is a false positive.

The fix should recognize that domains in DOMAIN_REGISTRY with `method: "static"` have already been pre-classified. Running a quality-score-driven escalation on top of a registry-resolved "static" domain is redundant and harmful.

---

## 4. Code Location of the Bug

**File:** `src/tools/extract.ts`
**Line 430 (BUG-E1 escalation block):**
```typescript
if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && !html.startsWith("pdf_pages:")) {
```

**The missing guard:** when `domainHint` is not null (domain was registry-resolved), skip BUG-E1 escalation entirely.

---

## 5. Fix

In `extractSingleInner`, add a `domainHint` guard to the BUG-E1 escalation block:

**Current (extract.ts:430):**
```typescript
if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && !html.startsWith("pdf_pages:")) {
```

**Fix:**
```typescript
if (renderMode === "auto" && usedMode === "static" && quality.score < 40 && !html.startsWith("pdf_pages:") && !domainHint) {
```

Adding `&& !domainHint` means: if the domain was already resolved via DOMAIN_REGISTRY (i.e. we know this is a "static" site), do not run quality-score-based escalation. Trust the registry classification.

**Why this is safe:**
- DOMAIN_REGISTRY entries are manually curated and tested
- A "static" registry entry means the domain is known to be static HTML — quality score < 40 just means the page is small, not that it needs JS rendering
- The quality escalation was designed for unknown domains where short content is ambiguous (could be a bot challenge page)
- Known domains with `method: "static"` are unambiguous — no escalation needed

---

## 6. Secondary Issue: Misleading ESCALATION FAILED Warning

When escalation fires and fails (as happens here because NOVADA_WEB_UNBLOCKER_KEY is not set), the output reads:

```
- [ESCALATION FAILED] Auto-escalation attempted (render) but quality remained low (1/100).
- Set NOVADA_WEB_UNBLOCKER_KEY to enable Web Unblocker...
```

This is actively misleading for example.com — the page is fine, the quality score is just low because the page is intentionally minimal. The fix above eliminates the escalation so this warning never fires for registry-resolved domains.

---

## 7. Verification After Fix

After adding `&& !domainHint` to the escalation guard:

```
Expected: example.com → ~200ms, mode: static, no escalation
```

Test command:
```bash
NOVADA_API_KEY=... node -e "
process.env.NOVADA_API_KEY='...';
import('./build/tools/extract.js').then(async ({novadaExtract}) => {
  const t = Date.now();
  const r = await novadaExtract({url:'https://example.com', format:'markdown', render:'auto'}, process.env.NOVADA_API_KEY);
  console.log('ms:', Date.now()-t);  // expect < 500
  console.log('escalated:', r.includes('auto_escalated') || r.includes('ESCALATION FAILED'));  // expect false
});
"
```

---

## 8. Affected Domains

All DOMAIN_REGISTRY entries with `method: "static"` and minimal content are affected by this bug. Examples:
- `example.com` (this report)
- `httpbin.org` (test utility)
- `iana.org`

Any domain that is genuinely small (< 1000 chars of extracted markdown) will trigger the spurious render escalation, adding 3–10s of unnecessary latency per cold call.

---

## 9. Files to Change

- `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts` — line 430: add `&& !domainHint`
- No other files need changes
- Build: `npm run build` after edit
