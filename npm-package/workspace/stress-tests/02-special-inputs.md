# Stress Test 02: Special Inputs

**Date:** 2026-06-25
**Scope:** Unicode queries, URL edge cases, SSRF protection, long strings
**API Key:** `1f35b477...` (test key)

---

## Part A: Functional Tests (Direct Function Calls)

These tests call `novadaSearch` / `novadaExtract` directly (bypassing MCP Zod validation).

| # | Test Case | Result | Length | Latency | Notes |
|---|-----------|--------|--------|---------|-------|
| 1 | search: Chinese query `人工智能代理记忆系统` | PASS | 1768ch | 2646ms | 3 results returned, reranked. Unicode handled correctly. |
| 2 | extract: URL with query params `?q=test&hl=en` | PASS | 7772ch | 6390ms | Escalated to render mode. Google served content. |
| 3 | extract: URL with hash fragment `#tutorials` | PASS | 102525ch | 249ms | MDN page extracted. Hash fragment preserved in URL, full page returned (hash is client-side). |
| 4 | search: very long query (650 chars, `"web scraping "` x50) | PASS | 945ch | 3475ms | 0 results returned (expected — degenerate query). No crash or timeout. Graceful empty result. |
| 5 | extract: encoded URL `path%20with%20spaces` | PASS | 567ch | 264ms | 404 error returned correctly with `suggested_fix` guidance. No crash. |
| 6 | extract: `http://localhost:3000` | **PASS (BAD)** | 2563ch | 45764ms | **NOT BLOCKED.** Returned content with quality:20/100. See SSRF finding below. |
| 7 | extract: `http://127.0.0.1:8080` | PASS | 524ch | 4308ms | Failed with "All promises were rejected" — connection refused, but NOT explicitly blocked by validation. |

### Finding: SSRF Protection Gap (Direct Function Calls)

**Severity: Medium** (mitigated by MCP boundary validation)

When `novadaExtract()` is called directly as a JS function (not through MCP `tools/call`), the Zod `safeUrl` validation is bypassed because:

1. `novadaExtract(params: ExtractParams)` accepts already-typed params
2. Zod validation only runs at the MCP boundary via `validateExtractParams()`
3. Direct callers (SDK, tests, imports) skip the `safeUrl` refine check

**Localhost test (#6)** actually fetched through the proxy and returned 2563 chars of content in 45 seconds. The request was NOT blocked.

**Impact:** Any code that imports and calls `novadaExtract()` directly can pass internal/private URLs. The hosted MCP endpoint (`mcp.novada.com`) is safe because all calls go through the MCP handler which invokes `validateExtractParams()` first.

**Recommendation:** Add a runtime SSRF guard inside `novadaExtract()` / `extractSingle()` that validates the URL before making any HTTP request, independent of the Zod schema.

---

## Part B: Zod Boundary Validation Tests

These test the MCP input validation layer (`validateExtractParams` / `validateSearchParams`).

| # | Test Case | Blocked? | Error Message |
|---|-----------|----------|---------------|
| 1 | `http://localhost:3000` | YES | "URLs pointing to localhost or private network ranges are not allowed" |
| 2 | `http://127.0.0.1:8080` | YES | "URLs pointing to localhost or private network ranges are not allowed" |
| 3 | `http://0.0.0.0/` | YES | "URLs pointing to localhost or private network ranges are not allowed" |
| 4 | `http://2130706433/` (decimal IP = 127.0.0.1) | YES | "URLs pointing to localhost or private network ranges are not allowed" |
| 5 | `http://0x7f000001/` (hex IP = 127.0.0.1) | YES | "URLs pointing to localhost or private network ranges are not allowed" |
| 6 | `http://10.0.0.1/` (private range) | YES | "URLs pointing to localhost or private network ranges are not allowed" |
| 7 | `https://zh.wikipedia.org/wiki/人工智能` (unicode) | PASS | Validated successfully |
| 8 | URL with `\n` newline injection | YES | "URL must not contain newline characters" |
| 9 | Empty search query `""` | YES | "String must contain at least 1 character(s)" |
| 10 | `file:///etc/passwd` | YES | "Only HTTP and HTTPS URLs are supported" |
| 11 | `ftp://example.com/file` | YES | "Only HTTP and HTTPS URLs are supported" |

**All 10 blocked cases correctly rejected.** The `safeUrl` schema covers:
- localhost / 127.x / 0.0.0.0 / ::1 / IPv6 loopback
- Private ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x (link-local)
- Decimal IP notation (e.g., `2130706433`)
- Hex IP notation (e.g., `0x7f000001`)
- Non-HTTP schemes (`file://`, `ftp://`)
- Newline injection in URLs

---

## Summary

| Category | Verdict |
|----------|---------|
| Unicode queries (Chinese) | OK -- search and extract handle CJK correctly |
| URL query params (`?key=val`) | OK -- passed through to upstream |
| URL hash fragments (`#section`) | OK -- preserved, full page returned |
| Very long queries (650 chars) | OK -- graceful empty result, no crash |
| Encoded URLs (`%20`) | OK -- 404 returned cleanly with guidance |
| SSRF via MCP boundary | BLOCKED -- all private IPs/localhost rejected by Zod |
| SSRF via direct function call | **NOT BLOCKED** -- localhost request went through proxy |
| Protocol injection (file://, ftp://) | BLOCKED at Zod |
| Newline injection in URLs | BLOCKED at Zod |
| Empty/missing required params | BLOCKED at Zod |

### Action Items

1. **P2**: Add runtime SSRF guard inside `extractSingle()` to validate URLs before HTTP requests, so direct function callers are also protected. The `BLOCKED_HOSTS` regex already exists in `types.ts` -- export it and reuse in the extract pipeline.
