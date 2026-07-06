# Code Quality Report — Agent A

Based on a thorough review of all 11 tools, 13 utilities, 1 SDK, and supporting infrastructure for **novada-search v0.8.3**.

## P0 Issues (must fix before shipping)

### [Type Casting Without Narrowing] — src/tools/browser.ts:203, src/index.ts:65, src/index.ts:224-229, src/index.ts:233-237
**Problem:** Multiple `eslint-disable @typescript-eslint/no-explicit-any` comments suppress type safety. Line 203 in browser.ts casts to `any` for page operations. Lines 224-229 and 233-237 in index.ts suppress type checks on request handlers.

**Impact:** Loss of type safety on critical functions. The `any` cast on `page` in executeAction bypasses Playwright type contracts. MCP handlers lose type safety on request/response objects.

**Fix:**
- Line 203: Type the page parameter properly: `async function executeAction(page: Page, action: BrowserAction)` and import `Page` from `"playwright-core"`
- Lines 224, 226, 233, 235: Replace `as any` with proper generic type parameters

---

### [Missing Error Category in Error Classification] — src/tools/types.ts:160-166
**Problem:** `classifyError()` returns `NovadaErrorCode.UNKNOWN` for unhandled error types, but `INVALID_PARAMS` code is defined but never returned. Zod validation errors are handled in index.ts but not by classifyError.

**Impact:** Zod validation errors don't get proper error classification, making it harder for agents to distinguish parameter validation failures from API failures.

**Fix:**
```typescript
if (error instanceof ZodError) {
  return {
    code: NovadaErrorCode.INVALID_PARAMS,
    message: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
    retryable: false,
  };
}
```

---

### [Unsafe Type Assertion in SDK Parser] — src/sdk/index.ts:75
**Problem:** Line 75 asserts mode match as `ExtractResult["mode"]` without validating the matched value is actually a valid mode string. Returns "static" if no match, but the assert doesn't enforce type safety.

**Fix:**
```typescript
const modeMatch = raw.match(/\| mode:([\w-]+)/);
const modeValue = modeMatch?.[1];
const mode: ExtractResult["mode"] = (["static", "render", "browser", "render-failed"].includes(modeValue ?? "") ? modeValue : "static") as ExtractResult["mode"];
```

---

### [Missing Timeout Handling in probeSearch/probeScraper] — src/tools/health.ts:28-56, 88-119
**Problem:** Both `probeSearch()` and `probeScraper()` set up AbortController timers but don't handle the abort exception explicitly. If the promise rejects due to abort, the catch block treats it as a general error instead of a timeout.

**Fix:**
```typescript
catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    return { status: "error", label: "Search API", latency: null, note: `timeout after ${PROBE_TIMEOUT_MS}ms` };
  }
  // ... rest of error handling
}
```

---

## P1 Issues (important, fix soon)

### [Async Polling Timeout vs Interval Mismatch] — src/tools/scrape.ts:9-10, 73-101
**Problem:** Poll timeout is 90s but poll interval is fixed 2s (up to 45 polls). No jitter or exponential backoff. Some tasks finish in <1s, others take 30-60s — uniform polling is wasteful early on.

**Fix:** Exponential backoff starting at 500ms, capping at 5s:
```typescript
const INITIAL_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 5_000;
let interval = INITIAL_POLL_INTERVAL_MS;
// after each pending response:
await sleep(interval);
interval = Math.min(interval * 1.5, MAX_POLL_INTERVAL_MS);
```

---

### [Swallowed Error in fetchViaBrowser Session Reuse] — src/utils/browser.ts:100-106, 145-150
**Problem:** When fetchViaBrowser is called with an existing sessionId and goto fails, the error is silently propagated without cleaning up the session entry from activeSessions.

**Fix:** Explicitly close the failed page and remove from activeSessions:
```typescript
try {
  await existingPage.goto(url, { waitUntil: "domcontentloaded", timeout });
  return existingPage.content();
} catch (err) {
  await existingPage.close().catch(() => {});
  activeSessions.delete(options.sessionId);
  throw err;
}
```

---

### [Incomplete Error Narrowing in extractSingle] — src/tools/extract.ts:130-139
**Problem:** Catch block catches all errors but silently converts any failure in render mode to "render-failed" mode when browser is not configured. The actual error message is lost.

**Fix:** Preserve original error even in fallback paths; still set usedMode = "render-failed" but keep renderError accurate.

---

### [Missing Test Coverage for Error Paths]
**Problem:** No tests for:
- AxiosError 401/403/429/503 responses
- Timeout scenarios in pollForResult
- Malformed API responses (missing `organic_results`, wrong nesting)
- extractRecords fallback chains (all 8 key names)

---

### [Potential SSRF in Bing URL Unwrapping] — src/tools/search.ts:148-170
**Problem:** `unwrapBingUrl()` decodes base64 URLs and accepts the result if it starts with "http" — but doesn't validate it's a safe/external URL after decoding. Could accept `file://` or internal IP if Bing's encoding were creative enough.

**Fix:** Validate the decoded URL with `new URL(decoded)` and check it's http/https before returning.

---

### [Missing Timeout on Browser Context Creation] — src/tools/browser.ts:116-120
**Problem:** `browser.newContext()` and `newPage()` have no explicit timeout. If Browser API is slow, these hang until the page.goto() timeout fires — no granular feedback.

**Fix:** Wrap in Promise.race with TIMEOUTS.BROWSER_CONNECT.

---

### [Unused validateHealthParams] — src/tools/types.ts:98-102
**Problem:** `validateHealthParams()` validates an empty object schema — always succeeds. The call in index.ts discards the result. Zero-value validation.

**Fix:** Remove the validation call; just call `novadaHealth(API_KEY)` directly.

---

## P2 Issues (nice to have)

### [Hardcoded 25000 char limit] — src/tools/extract.ts:170-171, 200
Magic number used in two places. Extract to named constant `MAIN_CONTENT_CHAR_LIMIT`.

### [Duplicate Proxy Username Building] — src/tools/proxy.ts:8-16 vs src/sdk/index.ts:284-287
Username format built in two places. Export `buildProxyUsername` from proxy.ts and import in sdk.

### [detectBotChallenge Threshold Undocumented] — src/utils/http.ts:289-308
The "2-signal" threshold for bot challenge detection is not documented. Add a comment explaining the tradeoff.

### [Regex Pattern Duplication in detectJsHeavyContent] — src/utils/http.ts:226-246
Quote variants `id="root"></div>` and `id='root'></div>` hardcoded separately. Replace with single regex `/id=['"](?:root|app)['"]\s*>\s*<\/div>/i`.

### [Session Cleanup Not Periodic] — src/utils/browser.ts:53-65
Sessions only cleaned when listSessions() is called. Add a module-level `setInterval` to clean up expired sessions every 60s.

### [Missing Return Type on novadaMap] — src/tools/map.ts:11
All other tools have explicit `Promise<string>` return type. novadaMap is missing it.

### [Duplicate Error Message Sanitization] — src/tools/types.ts:179-183
`sanitizeMessage()` used in one place. Export it and use consistently across all error paths to prevent accidental API key leakage.

### [Concurrent Execution Limit Not Configurable] — src/tools/crawl.ts:5
`CRAWL_CONCURRENCY = 3` is hardcoded. Add an optional `concurrency` param to CrawlParamsSchema.

### [Naming: `rest` in Scrape Result] — src/tools/scrape.ts:190
The field `successItem.rest` is the actual scraper data payload. The name `rest` (from the API response) is confusing. Add a comment or rename in the type cast for clarity.

---

## Summary

- **Total issues:** P0=4, P1=7, P2=9
- **Most critical file:** src/tools/browser.ts (session management, missing error handling)
- **Biggest pattern:** Error swallowing in async escalation chains (extract.ts, browser.ts)

### Key Findings

1. **Type Safety Gaps:** Multiple `any` casts without narrowing (browser.ts, index.ts)
2. **Error Handling Inconsistency:** Errors caught but not re-thrown in escalation paths; no consistent error classification
3. **Timeout/Polling:** Async polling uses fixed interval instead of exponential backoff; missing timeouts on some operations
4. **Test Coverage:** Error paths, timeouts, malformed responses not well covered
5. **Resource Leaks:** Browser sessions not auto-cleaned
6. **Duplication:** Proxy username building in two places; error sanitization not centralized

### Recommendations Before Shipping

**Must fix (P0):** Replace `any` casts; add ZodError classification; fix AbortError handling in health probes; add error narrowing in escalation paths.

**Should fix (P1):** Exponential backoff polling; comprehensive error tests; SSRF guard in Bing unwrap; browser context timeout; remove no-op validation.

**Nice to have (P2):** Centralize magic numbers; remove duplication; add concurrency config; periodic session cleanup.

---

*Report generated: 2026-04-29 | Reviewer: Agent A (Code Quality) | Codebase: novada-search v0.8.3*
