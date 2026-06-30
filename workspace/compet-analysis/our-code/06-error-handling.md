# 06 — Error Handling & Circuit Breaker Analysis

**Date:** 2026-06-23
**Files analyzed:**
- `src/_core/errors.ts` — error taxonomy and agent instructions
- `src/utils/http.ts` — circuit breaker + retry implementation
- `src/tools/extract.ts` (lines 200-400) — error paths in the hot extract path
- `src/utils/router.ts` — escalation error handling

---

## 1. Error Type Inventory

All 12 `NovadaErrorCode` values are defined in `errors.ts`. Every single one has an `agent_instruction` via the `INSTRUCTIONS` record — there are **no error codes without `agent_instruction`**.

| Code | FailureClass | Retryable | retry_after_ms | Has agent_instruction |
|---|---|---|---|---|
| INVALID_API_KEY | auth | false | — | YES |
| RATE_LIMITED | quota | true | 30 000 | YES |
| URL_UNREACHABLE | transient | true | 10 000 | YES |
| SPA_NO_URLS_FOUND | permanent | false | — | YES |
| API_DOWN | transient | true | 30 000 | YES |
| INVALID_PARAMS | permanent | false | — | YES |
| PRODUCT_UNAVAILABLE | permanent | false | — | YES |
| TASK_NOT_FOUND | permanent | false | — | YES |
| TASK_PENDING | transient | true | 5 000 | YES |
| SESSION_EXPIRED | permanent | false | — | YES |
| PROXY_AUTH_FAILURE | auth | false | — | YES |
| UNKNOWN | permanent | false | — | YES |

**Coverage verdict:** 100% — every error code has an `agent_instruction`. The `toAgentString()` method always emits it. This is the strongest part of the error design.

---

## 2. Circuit Breaker Analysis

**File:** `src/utils/http.ts`, `fetchViaProxy()`

### Design

A session-level circuit breaker (in-memory `Map<string, CircuitState>`) keyed on `"${tier}:${endpoint}"`. States:

| State (`available`) | Meaning | Behavior |
|---|---|---|
| `null` | Unknown (cold start) | Race proxy vs direct fetch using `Promise.any` |
| `true` | Known-good | Skip race; call proxy directly with full `fetchWithRetry` |
| `false` | Open (disabled) | Bypass proxy entirely; call direct fetch only |

**Auto-reset TTL:** `PROXY_CIRCUIT_RESET_MS = 5 * 60 * 1000` (5 minutes). After TTL, state resets to `null` from `false`, triggering a fresh probe race.

**Trip condition:** Proxy probe (`retries=0`) returns any non-401/403/407 error → `circuit.available = false`.

**Recovery condition:** TTL expires (5 min) → state → `null` → next request probes again.

### Threshold

There is **no failure-count threshold**. A single proxy failure trips the circuit. This is an intentional "single-shot" design for session-scope rather than the classic N-out-of-M-in-window pattern:

- **Upside:** Zero retry burn on a broken proxy endpoint; falls through to direct immediately.
- **Risk:** A single flaky probe (e.g., one overloaded datacenter pod) opens the circuit for 5 minutes. If that pod was a transient blip, the session loses proxy coverage for the rest of the 5-min window.

### Window Size

Not applicable — there is no sliding window counter. State is binary (`null` / `true` / `false`). This is simpler than a Hystrix-style half-open circuit but less nuanced.

### Recovery Strategy

After TTL: reset to `null` (not to `true`). This means recovery requires a successful race probe, not just a timeout. That is correct — it avoids silently restoring a still-dead proxy.

---

## 3. Retry Strategy Per Error Type

### Layer 1 — `fetchWithRetry` (http.ts, line 21)

- **MAX_RETRIES = 3** (4 total attempts)
- **Base delay:** 1 000 ms, doubles each attempt: 1s → 2s → 4s
- **No jitter.** (See gap analysis below.)
- **Retryable statuses:** 429, 503, and connection errors (`!error.response`)
- **Not retried:** 4xx (except 429), all `permanent` errors throw immediately

### Layer 2 — `fetchWithRender` (Web Unblocker, http.ts, line 204)

- **MAX_RETRIES = 2** (3 total attempts)
- **Delay:** 1s, 2s (linear, not exponential — `1000 * (attempt + 1)`)
- **Retryable inner codes:** 403, 429, 500, 502, 503
- **No jitter.**

### Layer 3 — `errors.ts` `RETRY_AFTER_MS`

These are advisory values surfaced in `toAgentString()` for the *agent* to act on, not used internally for any sleep:

| Code | Suggested wait |
|---|---|
| RATE_LIMITED | 30 000 ms |
| URL_UNREACHABLE | 10 000 ms |
| API_DOWN | 30 000 ms |
| TASK_PENDING | 5 000 ms |

### Summary table

| Error | Internal retry? | Agent-side retry hint? |
|---|---|---|
| RATE_LIMITED | YES (fetchWithRetry on 429) | YES (30s) |
| URL_UNREACHABLE | YES (fetchWithRetry on timeout/ECONNREFUSED) | YES (10s) |
| API_DOWN | YES (fetchWithRetry on 500/503) | YES (30s) |
| TASK_PENDING | NO (caller polls manually) | YES (5s) |
| All others | NO | NO |

---

## 4. Cascade Risk Analysis

### Risk 1 — Transient errors trip the circuit permanently (for the session window)

`URL_UNREACHABLE` is classified `transient` but **also trips the circuit** if it occurs during the proxy probe. A 10-second network blip triggers a 5-minute circuit-open window. The agent receives a correct `URL_UNREACHABLE` error with `retry_recommended: true`, but the circuit silently degrades the proxy quality for the entire session.

**Severity:** Medium. The fallback to direct fetch usually works; the agent never sees this degradation explicitly.

### Risk 2 — `fetchWithRetry` retries on 503 (API_DOWN), which can cascade into RATE_LIMITED

If the API is down and returning 503s, `fetchWithRetry` retries 3 times with 1s/2s/4s delays (7s total per call). If the caller also has upstream retry logic (e.g., the escalation path in `extract.ts`), a single user call can produce 9+ upstream requests. No retry budget is shared across the escalation chain.

**Severity:** Medium. No circuit breaker guards the Novada scraper API itself — only the proxy tier has one.

### Risk 3 — `UNKNOWN` classified `permanent` / `retryable: false`

Unknown errors (`catch` fallback in `classifyError`) are conservatively marked permanent and non-retryable. This is correct for safety but means genuine transient errors that don't pattern-match the string detection logic (e.g., DNS resolution edge cases) get permanently blocked.

**Severity:** Low. The `agent_instruction` says "check error message above for clues" which is the right guidance.

### Risk 4 — No circuit breaker for the Novada Scraper API itself

`fetchWithRetry` retries 503/502 up to 3 times against the Novada API endpoints but there is no state machine tracking "is the API persistently down?" Parallel tool calls (e.g., 5 concurrent `novada_extract`) can each burn 3 retries against a down API = 15 API calls before giving up.

**Severity:** Medium-High. If API_DOWN persists, the retry amplification is significant.

---

## 5. Swallowed Errors Audit

### `router.ts` — three silent `catch {}` blocks

```typescript
// Lines 157-162
try {
  const browserHtml = await fetchViaBrowser(...);
  return { html: browserHtml, mode: "browser", cost: "high" };
} catch {
  // Browser unavailable — fall through to render-failed
}
```

```typescript
// Lines 172-178
try {
  const browserHtml = await fetchViaBrowser(...);
  return { html: browserHtml, mode: "browser", cost: "high" };
} catch {
  // Browser unavailable — fall through to render result
}
```

```typescript
// Lines 184-194
try {
  const browserHtml = await fetchViaBrowser(...);
  return { html: browserHtml, mode: "browser", cost: "high" };
} catch {
  // Browser also unavailable — fall back to static
}
```

**Problem:** All three `catch {}` blocks completely discard the browser error. If the browser fails for a reason other than "not configured" (e.g., CDP connection drops mid-session, memory OOM, timeout), the agent gets `render-failed` or static HTML with no indication that browser was tried and failed. The error is not logged, not surfaced, and not included in the result metadata.

**Impact:** Debugging is hard. The agent sees `mode: "render-failed"` and has no signal that browser escalation was attempted but errored differently.

### `extract.ts` (line 328-338) — `catch (err)` with re-throw to browser

```typescript
} catch (err) {
  renderError = err instanceof Error ? err.message : String(err);
  if (isBrowserConfigured()) {
    html = await fetchViaBrowser(...);
    ...
  } else {
    usedMode = "render-failed";
  }
}
```

This correctly captures `renderError` but the value is only used in the `extract.ts` response metadata (if at all). It is not surfaced to the agent unless the tool output explicitly includes it. **Verdict:** Partial — error is saved but may not reach the agent.

### `http.ts` — `Promise.any` fallback catch

```typescript
}).catch(async () => {
  const [proxyResult, directResult] = await Promise.allSettled([proxyFetch, directFetch]);
  ...
  throw directResult.status === "rejected" ? directResult.reason : new Error("All fetch paths failed");
});
```

This is **not a swallowed error** — it re-throws. Correct behavior.

**Swallowed error count: 3 locations** (all in `router.ts` browser fallback blocks).

---

## 6. Circuit Open — What Does the Agent See?

When `circuit.available === false` (proxy open), `fetchViaProxy` silently falls through to `fetchWithRetry(url, axiosOptions)` (direct fetch, no proxy). **The agent sees no indication that the circuit is open.** If direct fetch succeeds, the response is normal. If direct fetch also fails, the error message says:

```
Direct fetch failed: <error>. Proxy circuit: open (disabled)
```

This message **does** include the circuit state when direct also fails (line 176 in `http.ts`). So:

- **Circuit open + direct succeeds:** agent is unaware (acceptable)
- **Circuit open + direct fails:** agent sees "Proxy circuit: open (disabled)" in the error message

The circuit state flows into `classifyError` as an `Error` instance, likely matching the `URL_UNREACHABLE` or `UNKNOWN` path depending on the underlying error. The `agent_instruction` for those codes is appropriate.

**Gap:** No telemetry or log entry when the circuit trips. A `console.warn` or structured log when `circuit.available` changes from `null` to `false` would aid debugging.

---

## 7. Comparison to Best Practices

### Exponential Backoff + Jitter (AWS Builders Library)

Best practice: `min(cap, base * 2^attempt) + random(0, base * 2^attempt)` ("Full Jitter").

Our implementation in `fetchWithRetry`:
```typescript
const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s — no jitter
```

**Gap:** No jitter. Under concurrent load (e.g., 10 agents all hitting rate limits simultaneously), all 10 will retry at exactly 1s, 2s, 4s — creating synchronized thundering herd bursts. Full jitter spreads retries across the window, reducing peak load on the backend.

### Circuit Breaker Standard (Martin Fowler / Netflix Hystrix)

Standard pattern has three states: **CLOSED** (normal) → **OPEN** (failing, reject fast) → **HALF-OPEN** (probe to test recovery).

Our implementation:
- `null` ≈ CLOSED/unknown (probe on next request — similar to HALF-OPEN probe)
- `true` ≈ CLOSED (proxy known good)
- `false` ≈ OPEN (proxy disabled, fallback to direct)

**Gap:** No explicit HALF-OPEN state. After TTL expiry, reset goes to `null` which probes via the race — functionally equivalent to HALF-OPEN but implicit. The lack of a named HALF-OPEN means failure counting during probe is absent: if the probe fails again, circuit re-opens immediately without any gradual recovery count.

**Gap:** No trip threshold counter. Standard implementations require N failures in a window before opening (e.g., 5 failures in 10 seconds). A single failure trips ours. This is intentionally conservative but can cause false opens on transient probe failures.

### MCP Error Response Best Practices (modelcontextprotocol.io, dev.to)

Industry guidance: errors should be **instructions for the LLM, not logs for the developer**. Key elements:
1. What went wrong (machine-readable code)
2. Why it happened (human-readable message)
3. What to do next (agent_instruction)
4. Whether to retry (retryable flag + timing)

**Our alignment:** Excellent. The `toAgentString()` format covers all four elements:
```
Error [RATE_LIMITED]: Rate limit exceeded.
failure_class: quota
retry_recommended: true
retry_after_ms: 30000
agent_instruction: "You have hit the Novada API rate limit..."
```

This exceeds most MCP server error designs. The sanitization (`sanitizeServerMsg`) to prevent `agent_instruction` injection via server-controlled error messages is a security-correct pattern rarely seen in MCP servers.

---

## 8. Errors Without agent_instruction — Full List + Suggested Instructions

**Verdict: None.** Every `NovadaErrorCode` has a populated entry in the `INSTRUCTIONS` record. Coverage is 100%.

However, there are **three error paths that surface raw errors outside the `NovadaError` system**:

### 8a. `router.ts` browser fallback `catch {}` blocks

These swallow errors entirely — no `agent_instruction`, no error at all. Suggested fix:

When browser fails after render also failed, the returned `RouteResult` should include an optional `warning` field:

```typescript
// Instead of silent catch {}:
} catch (browserErr) {
  const browserMsg = browserErr instanceof Error ? browserErr.message : String(browserErr);
  // Store for inclusion in response metadata
  browserFallbackError = browserMsg;
}
```

The `novada_extract` tool response could then append:
```
Note: Browser escalation attempted but failed: <browserFallbackError>
agent_instruction: "Browser API failed. Verify NOVADA_BROWSER_WS is set correctly and the browser is running. Consider using render='render' or render='static' to skip browser escalation."
```

### 8b. `http.ts` line 39-43 — maxContentLength error

```typescript
throw new Error(
  `Response from ${url} exceeds the 10MB content limit. ...`
);
```

This raw `Error` is thrown, not a `NovadaError`. It will be caught by `classifyError` and fall to the `UNKNOWN` fallback because "maxcontentlength" doesn't match any pattern in `classifyError`. The agent gets the `UNKNOWN` agent_instruction ("check error message above") rather than a specific one.

Suggested fix: throw a `makeNovadaError(NovadaErrorCode.INVALID_PARAMS, ...)` here, or add a pattern match for "maxcontentlength" in `classifyError` with:

```
agent_instruction: "The target URL returned more than 10MB of content.
Action: Use a more specific subpage URL (e.g. /blog/my-post instead of /blog).
Alternative: Use novada_map to find the exact page you need, then extract that URL directly."
```

### 8c. `http.ts` line 62 — retry exhaustion error

```typescript
throw new Error(`Failed after ${retries + 1} attempts: ${url}`);
```

This is reachable when `attempt === retries && !isRetryable` is false but the loop exits. In practice, either the early `if (!isRetryable) throw error` fires or `attempt === retries` throws the original error, so this line is dead code — but if reached, it produces a raw `Error` that maps to `UNKNOWN`.

---

## 9. Improvement Recommendations

### P0 — Add jitter to `fetchWithRetry`

```typescript
const baseDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
const jitter = Math.random() * baseDelay; // full jitter
const delay = Math.min(baseDelay + jitter, 30000); // cap at 30s
```

Prevents synchronized thundering herd under concurrent load. AWS recommends this as P0 for any API client.

### P1 — Add a circuit breaker for the Novada Scraper API itself

Currently, only the proxy tier has a circuit. The Novada API endpoints (`scraper.novada.com`, `webunlocker.novada.com`) have no circuit. Under sustained API_DOWN conditions, every parallel extract call burns 3 retries independently. A shared per-session circuit keyed on the API base URL would cap blast radius.

### P1 — Surface browser fallback errors (fix swallowed errors in `router.ts`)

Replace the three silent `catch {}` blocks with error capture. Surface in tool response metadata. Add a `browserError?: string` field to `RouteResult`.

### P2 — Promote `maxContentLength` error to named `NovadaError`

Add pattern match in `classifyError` for `"maxcontentlength"` → `INVALID_PARAMS` with a specific actionable instruction. The current `UNKNOWN` fallback is unhelpful for a predictable, fixable condition.

### P2 — Log circuit state transitions

Add a `console.warn("[novada-mcp][circuit] ...")` when `circuit.available` transitions to `false` and back to `null`. Aids debugging proxy failures without changing agent-visible behavior.

### P3 — Consider half-open probe failure counting

A single transient probe failure opens the circuit for 5 minutes. Adding a "required consecutive successes to close" counter (e.g., 2 probe successes needed to set `available = true`) would make the circuit more robust against unstable proxy endpoints without false-opens from single blips.

---

## 10. Summary

| Dimension | Score | Notes |
|---|---|---|
| agent_instruction coverage | 10/10 | Every error code has one; format is structured and actionable |
| Error sanitization | 10/10 | API key, auth token, URL param scrubbing; injection prevention |
| Circuit breaker design | 7/10 | Correct concept, single-failure threshold is aggressive |
| Retry logic | 6/10 | Correct exponential base; missing jitter is the main gap |
| Swallowed errors | 6/10 | 3 silent browser fallback catch blocks in router.ts |
| Scraper API resilience | 5/10 | No circuit breaker guarding the upstream API itself |
| Error cascade protection | 6/10 | Retry amplification possible under sustained API_DOWN |

**Strongest asset:** The `agent_instruction` system is production-grade and exceeds industry norms. Errors are instructions, not logs.

**Biggest gap:** No jitter in `fetchWithRetry` + no circuit breaker on the Novada API tier itself. These two gaps compound under concurrent load or sustained API downtime.
