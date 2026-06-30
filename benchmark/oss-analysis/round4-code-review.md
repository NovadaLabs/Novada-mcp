# Round 4 — Code Review

**Reviewer:** Code Review Agent (fresh eyes, no Round 3 authorship)
**Date:** 2026-06-22
**Scope:** Round 3 changes across 8 files (types.ts, extract.ts, browser.ts, http.ts, domains.ts, credentials.ts, router.ts, unblock.ts)

---

## Overall Verdict: PASS WITH ISSUES

No CRITICAL issues. Two HIGH issues and three MEDIUM issues that should be addressed before shipping.

---

## Issues Found

### [HIGH] `waitForSelector` timeout uses the page-level `timeout`, not a selector-specific timeout

**File:** `src/utils/browser.ts` lines 115, 155

**Problem:** The timeout passed to `waitForSelector` is `Math.min(options.timeout ?? 15000, 15000)`. The `options.timeout` parameter is the *page navigation* timeout (defaults to `TIMEOUTS.BROWSER_PAGE`, which could be 30–60s). When a caller passes `{ timeout: 60000, waitForSelector: ".price" }`, the effective `waitForSelector` timeout is `Math.min(60000, 15000) = 15000ms`. That is correct in capping the selector wait. However, when a caller passes *no* `timeout` at all (e.g., all 6 call sites in `extract.ts` which never pass a `timeout` option), `options.timeout` is `undefined`, so the expression resolves to `Math.min(undefined ?? 15000, 15000) = 15000ms`.

This is actually the correct intended result — 15s cap when no timeout specified. So the math itself is not wrong.

The real issue is subtler: **when `options.timeout` is a small value (e.g., 5000ms passed by a caller), `Math.min(5000, 15000) = 5000ms`**, meaning the page navigation timeout accidentally sets the selector timeout too. If the page finishes loading in 4s but the selector appears at 6s, the selector wait will time out even though 15s was intended. This defeats the purpose of having a 15s selector cap independent from the page timeout.

**Fix:** Use a fixed `SELECTOR_TIMEOUT_MS = 15000` constant instead of re-using `options.timeout`. The page navigation timeout and selector wait are independent concerns.

---

### [HIGH] QW-4 content-length floor fires on non-HTML render paths (PDF, JSON)

**File:** `src/tools/extract.ts` lines 230–242

**Problem:** The QW-4 check (`html.length < 2000`) runs after the render response is assigned to `html`. The code correctly handles PDF and JSON early-return paths *above* the check, so those return before reaching line 232. However, when the render response is non-string (hits the `throw makeNovadaError` at line 222), the `html` variable is still uninitialized at the point where the `typeof html === "string"` check at line 232 would be reached — but that path throws before reaching it. No bug here on the throw path.

The actual bug: when the render response is an object that has its JSON body treated as HTML (the `body.trimStart().startsWith("<")` branch at line 215 is true), `html` is set to a JSON-like string that begins with `<`. If that string is short (e.g., `<result/>` = 10 chars), the QW-4 check fires and triggers an unnecessary browser escalation. The 2000-char threshold was meant to detect bot-challenge pages (Cloudflare's interstitial is ~800–1200 chars), but a short XML/HTML API response is not a bot challenge. There is no prior `detectBotChallenge(html)` guard on the QW-4 path.

**Fix:** Add `&& detectBotChallenge(html)` to the QW-4 condition, consistent with how other escalation paths work:
```ts
if (typeof html === "string" && html.length < 2000 && detectBotChallenge(html) && isBrowserConfigured()) {
```
This avoids wasting a browser call on legitimately short responses.

---

### [MEDIUM] `getResidentialProxyCredentials` does not read SDK-scoped credentials

**File:** `src/utils/credentials.ts` lines 53–60

**Problem:** `getResidentialProxyCredentials()` reads only `process.env.NOVADA_RESIDENTIAL_PROXY_*` and then falls back to `getProxyCredentials()`. But `getProxyCredentials()` *does* check the `AsyncLocalStorage` store first (`store.getStore()?.proxyUser`). So the datacenter fallback path supports SDK multi-tenant isolation; the residential path does not. In SDK use, a caller who passes `proxyUser/proxyPass/proxyEndpoint` into `withCredentials()` will correctly get those for the datacenter tier. But there is no `ToolCredentials` field for residential proxy creds — so SDK callers can never inject residential credentials programmatically; they must use env vars. This is a design gap, though not a correctness bug for MCP server (single-tenant) use.

**Fix:** Either document this limitation explicitly in the function JSDoc ("SDK credential injection not supported for residential tier — use env vars"), or add `residentialProxyUser/Pass/Endpoint` fields to `ToolCredentials` and check them.

---

### [MEDIUM] `domainProxyTier` is not passed when escalating from static to render in `extractSingle`

**File:** `src/tools/extract.ts` line 295

**Problem:** The residential proxy tier is correctly passed to the two `fetchViaProxy` calls in the static/auto branch (lines 258, 260). However, when the auto-mode escalation chain calls `fetchWithRender` at line 295, it passes only `(params.url, apiKey)` — no country or proxy-tier context. `fetchWithRender` internally calls the Web Unblocker which has its own proxy pool, so this may be intentional. But the comment for MT-1 in the round3 doc says "domain-aware residential proxy tier" — if the intent is that known-residential domains get residential proxies all the way through escalation, then the Web Unblocker call should also receive geo-targeting (the `country` option exists on `fetchWithRender`). This is a design question, not a definitive bug, but worth auditing.

---

### [MEDIUM] `wait_ms` guard uses `> 0` but schema allows `min(0)` with no-op semantics

**File:** `src/utils/browser.ts` lines 117, 160

**Problem:** The guard `if (options.wait_ms && options.wait_ms > 0)` is redundant — `options.wait_ms && options.wait_ms > 0` is equivalent to just `options.wait_ms > 0` when `wait_ms` is a number (since `0` is falsy). Passing `wait_ms: 0` is a valid schema value (min is 0) and means "no wait," which is correctly skipped by both `&& options.wait_ms` (falsy) and `> 0`. So the logic is correct. However, the double guard is confusing to readers and the schema description says "Max: 30000ms" while the `UnblockParamsSchema` sets max at `100000ms`. Round 3 notes this mismatch is intentional (tighter budget in extract). This is acceptable but should be documented in the schema description of `wait_ms` in `ExtractParamsSchema` to prevent future confusion.

---

## Confirmed Correct

- **QW-1 `wait_for` wiring — 6 call sites in extract.ts:** All confirmed present at lines 200, 233, 302, 316, 328, 454. Round 3 claimed 6 sites; all 6 verified. None missed.
- **QW-3 `waitForSelector` timeout cap — both session paths:** Lines 115 and 155 in browser.ts both use `Math.min(options.timeout ?? 15000, 15000)`. Both paths covered (existing-session and new-session).
- **QW-2 challenge strings in `detectBotChallenge`:** All 5 new strings are present in `knownChallengeStrings`. The Amazon WAF strings and DataDome strings are specific enough to avoid false positives. "sorry, we just need to make sure" is somewhat generic but acceptable — it only triggers when combined with Amazon/DataDome page context (and is in the definitive list, so one hit returns true). Risk of false positive on legitimate pages is low but nonzero.
- **MT-1 residential proxy fallback:** `getResidentialProxyCredentials()` correctly falls back to `getProxyCredentials()` when residential env vars are absent. The circuit-breaker in `fetchViaProxy` is keyed by endpoint, so residential and datacenter circuits are isolated from each other. Correct.
- **MT-1 `proxyTier` destructuring:** `{ proxyTier, ...axiosOptions }` correctly prevents the non-Axios field from being spread into `fetchWithRetry`. Correct.
- **MT-2 `wait_ms` wired in `router.ts`:** All 4 `fetchViaBrowser` calls in router.ts pass `wait_ms: options.wait_ms`. Confirmed.
- **MT-2 `wait_ms` wired in `unblock.ts`:** `wait_ms: wait_ms` is present in the `routeFetch` call. `void wait_ms` no-op removed. Correct.
- **`wait_for` schema in types.ts:** `wait_for` at lines 100–101 and `wait_ms` at lines 102–103 present with correct types, constraints, and descriptions.
- **`isBrowserConfigured()` guard on QW-4:** Present at line 232. The browser escalation path is correctly gated behind availability check.
- **`proxyTier` domains correctly tagged in DOMAIN_REGISTRY:** Spot-checked amazon.com, walmart.com, booking.com, g2.com — all have `proxyTier: "residential"` consistent with their provider entries.
- **Batch extract: `wait_for` flows through correctly:** `extractSingle` is called with `{ ...params, url }` which preserves `wait_for` and `wait_ms`. Correct.

---

## Open Questions

1. **"sorry, we just need to make sure" false positive risk:** This string appears in DataDome challenge pages but also plausibly in legitimate UX copy ("sorry, we just need to make sure you're human" is standard). In the definitive list, a single match returns `true` immediately. Is there a known legitimate page where this string causes a false positive in practice? If so, it should be moved to the heuristic section.

2. **QW-4 threshold (2000 chars) vs detectBotChallenge:** The existing `detectBotChallenge` function already has a body-text length heuristic (`bodyTextLen < 1500` counts as one signal, needs 2+ to trigger). The QW-4 raw length check at 2000 chars bypasses this more careful detection. Is the intent to catch challenge pages that passed `detectBotChallenge`? If so, the `< 2000` raw length check will also fire on any short legitimate API response in render mode. The HIGH issue above captures this — confirming that a `detectBotChallenge()` guard should be added.

3. **`router.ts` `fetchViaBrowser` — `waitForSelector` not passed from `options`:** `routeFetch` signature has `waitForSelector?: string` and passes it to all 4 `fetchViaBrowser` calls correctly. But `router.ts` is only consumed by `unblock.ts` (which passes `wait_for` via `waitForSelector: wait_for`). The `extract.ts` escalation path does NOT go through `routeFetch` — it calls `fetchViaBrowser` directly. This is the correct architecture; no issue. Just confirming the two call paths are independent by design.

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 2     | warn   |
| MEDIUM   | 3     | info   |
| LOW      | 0     | pass   |

**Verdict: WARNING — 2 HIGH issues should be resolved before merge.**

The HIGH issues are:
1. `waitForSelector` timeout coupling to page-level `timeout` (minor behavioral edge case, not data-loss level)
2. QW-4 content-length floor fires on short legitimate render responses without a `detectBotChallenge` guard (can cause unnecessary browser escalation = cost waste + latency)

Issue 2 is the more impactful of the two and should be fixed before shipping to avoid spurious Browser API usage on short but valid HTML responses.
