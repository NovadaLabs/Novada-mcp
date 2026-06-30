# Stress Test 06: Timeout & Slow Site Handling

**Date:** 2026-06-25
**Tool:** `novadaExtract` (`src/tools/extract.ts`)
**API Key:** `1f35b47...` (truncated)

## Summary

All four edge cases were handled gracefully -- no unhandled exceptions. The tool returns structured error messages with `agent_instruction` hints instead of throwing, which is correct agent-first behavior.

## Results

| # | Scenario | Elapsed | Result | Error Handling |
|---|----------|---------|--------|----------------|
| 1 | Nonexistent domain | 3723ms | Returned structured error | GOOD -- `agent_instruction` with `suggested_fix` |
| 2 | httpbin 5s delay | 5651ms | Returned JSON content | GOOD -- waited for response, extracted successfully |
| 3 | HTTP->HTTPS redirect | 116ms | Returned page content | GOOD -- followed redirect, extracted Example Domain |
| 4 | Expired SSL cert | 90002ms | Returned structured error | OK -- hit 90s ceiling, returned agent_instruction |

## Detailed Analysis

### Test 1: Nonexistent Domain (`thissitedoesnotexist12345.com`)

- **Behavior:** Static fetch failed (DNS resolution), all retry promises rejected. Tool caught the error and returned a structured markdown response instead of throwing.
- **Output format:**
  ```
  ## Extract Failed
  url: https://thissitedoesnotexist12345.com
  Error: All promises were rejected
  ## Agent Hints
  - If the URL returns JSON or binary data, it cannot be extracted as HTML.
  - If the URL is unreachable, check the domain and try novada_map first.
  ## Agent Action
  agent_instruction: status:failed | suggested_fix: domain may be unreachable...
  ```
- **Verdict:** PASS. Error is caught in `formatError()`, matched by `"all promises were rejected"` pattern in `getSuggestedFix()`, and returns helpful `agent_instruction`.

### Test 2: httpbin 5s Delay

- **Behavior:** Static fetch waited the full 5s server delay and successfully returned the JSON response body. No timeout triggered (5s < 15s `STATIC_FETCH` timeout).
- **Output:** Full JSON body with headers, origin IP, etc. Formatted as `format: json (raw)`.
- **Verdict:** PASS. Slow-but-valid responses are handled correctly within the 15s static fetch timeout.

### Test 3: HTTP->HTTPS Redirect (`http://example.com`)

- **Behavior:** Redirect followed automatically. Page extracted in 116ms (cache hit). Content returned with quality assessment (`quality:1/100 (low)` due to minimal content).
- **Output:** Clean markdown with title, content, and a `remember:` line for agent memory.
- **Verdict:** PASS. Protocol redirects handled transparently.

### Test 4: Expired SSL Certificate (`expired.badssl.com`)

- **Behavior:** Hit the 90s `TOTAL_REQUEST_CEILING` hard ceiling. The auto-escalation pipeline (static -> render -> browser) kept retrying through the entire budget before the ceiling timer fired.
- **Output:**
  ```
  ## Extraction Error
  url: https://expired.badssl.com/
  error: Request exceeded the 90s total ceiling and was aborted.
  ## Agent Action
  agent_instruction: This URL took too long (>90s). Try render="static" to skip escalation...
  ```
- **Verdict:** PASS (functional), but **90s is a long wait for a cert error**. The underlying SSL failure should ideally be caught earlier in the static fetch phase and surfaced as a specific cert error rather than timing out through all escalation steps.

## Architecture Notes

### Timeout Layers (from `src/config.ts`)

```
STATIC_FETCH:           15,000ms   (per static attempt, 3 retries = 45s max)
PROXY_FETCH:            45,000ms
RENDER:                 60,000ms
BROWSER_CONNECT:        10,000ms
BROWSER_PAGE:           30,000ms
TOTAL_REQUEST_CEILING:  90,000ms   (hard per-URL ceiling via Promise.race)
```

### Error Path (from `extractSingle`)

1. `extractSingleInner()` runs the extraction pipeline (static -> render -> browser escalation)
2. `Promise.race([extractSingleInner(), ceiling])` enforces the 90s hard ceiling
3. If ceiling fires: returns structured error string (not thrown)
4. If inner throws: `formatError()` catches and adds `agent_instruction` via `getSuggestedFix()`
5. `getSuggestedFix()` pattern-matches on error message keywords (ENOTFOUND, timeout, 403, etc.)

### Key Design Decision

Timeout errors are **returned as strings**, not thrown as exceptions. This means the calling agent always gets usable output with actionable hints, even on failure. Good agent-first pattern.

## Issues Found

### MEDIUM: Expired cert burns full 90s ceiling

The expired SSL cert scenario exhausted the entire 90s budget because the auto-escalation pipeline (static -> render -> browser) kept trying. An SSL/TLS certificate error should be detected at the static fetch layer and fail fast with a specific error message like:

```
agent_instruction: SSL certificate error (expired/invalid).
The site's certificate is not trusted. Use novada_unblock or
novada_extract with skipTlsVerification if available.
```

**Impact:** Agent wastes 90s on a deterministic failure. Low frequency (rare in practice), but bad UX when it happens.

**Fix location:** `src/tools/extract.ts` lines 115-141 (`getSuggestedFix`) + add cert-error detection in the static fetch error handler to short-circuit escalation.

### LOW: Quality assessment noise on redirect test

The `http://example.com` test returned `quality:1/100 (low)` and `content_ok:false` even though extraction was successful. This is technically correct (Example Domain has minimal content), but the `content_ok:false` flag could mislead agents into thinking extraction failed.

## Conclusion

Timeout handling is solid. The `TOTAL_REQUEST_CEILING` + `Promise.race` pattern guarantees no request blocks indefinitely. Error messages include `agent_instruction` with actionable next steps. The only notable issue is the expired cert scenario burning the full 90s budget rather than failing fast.
