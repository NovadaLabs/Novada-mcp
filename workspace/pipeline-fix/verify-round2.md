# Verification Round 2 — ONE KEY Consistency Audit

**File:** `src/index.ts`
**Date:** 2026-06-25

---

## Summary: ALL CONSISTENT

No tool description violates the ONE KEY claim. All three forbidden patterns are absent.

---

## Forbidden Pattern Check

| Pattern | Result | Notes |
|---------|--------|-------|
| `Requires.*NOVADA_BROWSER_WS` | CLEAR | Zero matches |
| `Requires.*separate.*key` | CLEAR | Zero matches |
| `NOVADA_WEB_UNBLOCKER_KEY.*required` | CLEAR | Zero matches |

---

## Per-Tool Findings

### novada_browser — CONSISTENT
**Line 372:**
```
Auth: NOVADA_API_KEY (auto-provisions Browser API credentials). NOVADA_BROWSER_WS is optional — set it to override auto-provision.
```
Correctly frames NOVADA_BROWSER_WS as an optional override, not a requirement. Auto-provision is the default path.

---

### novada_unblock — CONSISTENT
**Line 360:**
```
Auth: Uses NOVADA_API_KEY (the single key for all Novada products) — no separate key needed. NOVADA_WEB_UNBLOCKER_KEY is an optional override; NOVADA_API_KEY is used as fallback if it is not set.
```
Correctly states NOVADA_API_KEY is the single key. NOVADA_WEB_UNBLOCKER_KEY explicitly labeled as optional override with fallback.

---

### novada_health_all — CONSISTENT
**Line 396:**
```
Auth: NOVADA_API_KEY (the single key for all Novada products). NOVADA_WEB_UNBLOCKER_KEY is OPTIONAL — NOVADA_API_KEY is used as fallback if it is not set.
```
Same pattern as novada_unblock. Consistent.

---

### novada_discover — CONSISTENT
**Line 409:**
```
KEY FACT: ONE API KEY COVERS ALL PRODUCTS. NOVADA_API_KEY authenticates search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. No separate keys needed for any product. NOVADA_BROWSER_WS and NOVADA_PROXY_ENDPOINT unlock additional capabilities but require no extra API key.
```
Canonical ONE KEY statement present.

Also repeated in server description at **line 673:**
```
Novada MCP — unified web data API. ONE API KEY (NOVADA_API_KEY) covers all products: search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. Optional: NOVADA_BROWSER_WS for browser automation, NOVADA_PROXY_ENDPOINT for proxy routing.
```

---

### novada_setup — CONSISTENT
**Lines 491:**
```
UNIFIED KEY: NOVADA_API_KEY is the only required key. ... NOVADA_BROWSER_WS (Browser WebSocket) and NOVADA_PROXY_ENDPOINT unlock additional capabilities but require no separate API key — NOVADA_API_KEY authenticates them all.
```
Explicit "no separate API key" language present.

---

### Proxy tools (novada_proxy_*) — CONSISTENT
**Lines 245, 259, 272, 285, 298, 311, 324** (all 7 proxy tool variants):
```
Requires: NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
```
"Requires" here refers to the endpoint env var (a routing config, not an API key). Credentials are auto-fetched via NOVADA_API_KEY. This is correct and consistent with the ONE KEY claim — no second API key is implied.

---

### Help text (line 980) — CONSISTENT
```
NOVADA_WEB_UNBLOCKER_KEY    Override unblocker key (optional — NOVADA_API_KEY is used as fallback)
```
Optional override, not a requirement.

---

## Verdict

**CONSISTENT across all tools.** No action required.

The three forbidden patterns are absent. All references to NOVADA_BROWSER_WS and NOVADA_WEB_UNBLOCKER_KEY are correctly framed as optional overrides with NOVADA_API_KEY as the single required key and fallback.
