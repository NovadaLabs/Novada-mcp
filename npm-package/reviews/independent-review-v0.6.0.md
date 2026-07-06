# Independent Quality Review: novada-mcp v0.6.0

**Date:** 2026-04-10
**Reviewer:** Fresh agent (no prior context)
**Verdict:** FIX THEN PUBLISH

## Score Card

| Dimension | Score | Key Finding |
|-----------|-------|-------------|
| Architecture | 6/10 | Clean separation, but index.ts does 3 jobs and tool defs + Zod schemas can drift out of sync |
| Type Safety | 7/10 | strict:true, Zod schemas, inferred types. But 3x `any` in html.ts, API response unvalidated |
| Error Handling | 6/10 | Good classifyError() + retry. Silent catch{} in 3 files, proxy fallback is invisible to user |
| Tool Descriptions | 8/10 | Excellent — Best for / Not for / Mistakes / Examples. Best in class for MCP tool descriptions |
| HTML Parsing | 5/10 | Cheerio is right choice, but no readability algo. 100-char threshold too low. Tables, SPAs unhandled |
| Test Coverage | 5/10 | 103 tests but ZERO tests for actual tool functions. Only utils/validation tested. Core logic untested. |
| Security | 4/10 | CRITICAL: axios 1.14.0 has known SSRF vuln. API key in URLs. No URL scheme restriction. No SSRF guard. |
| Dependencies | 6/10 | Lean 4-dep tree. But axios needs urgent upgrade. Zod v4 is cutting-edge, untested ecosystem. |
| Documentation | 7/10 | Strong README, real examples, multi-client setup. BUT: novada_map missing from tool docs entirely. |
| Competitive Position | 4/10 | No JS rendering (40% of modern web). No JSON schema extraction. No batch ops. Proxy is sole advantage. |
| **OVERALL** | **5.8/10** | Functional and clean, but security + coverage gaps make it unpublishable in current state. |

## Critical Issues (must fix before publish)

### C1. axios has a known CRITICAL SSRF vulnerability
File: package.json:69 — "axios": "^1.7.0", installed 1.14.0
Finding: npm audit reports GHSA-3p68-rc4w-qgx5 (critical severity) — NO_PROXY hostname normalization bypass leads to SSRF. Fix requires axios >= 1.15.0.

### C2. API key passed in URL query parameters
Files: src/tools/search.ts:9, src/utils/http.ts:51
Finding: api_key is passed as a URL query parameter. Appears in axios error objects, HTTP logs, stack traces. classifyError() only strips the pattern from message text, not from full error objects.

### C3. No URL scheme validation — SSRF risk
File: src/tools/types.ts:14 — z.string().url()
Finding: Accepts ftp://, file:///etc/passwd, gopher://. Direct fetch fallback has zero protection against internal network access (169.254.169.254).

## High Issues (should fix)

### H1. Zero tests for tool functions
All 5 tool functions have 0% test coverage. Only utilities tested.

### H2. Tool definitions and Zod schemas can drift
TOOLS inputSchema in index.ts and Zod schemas in types.ts maintained independently.

### H3. Silent error swallowing in 3 tools
research.ts, crawl.ts, map.ts silently discard failed requests with no indication to user.

### H4. README missing novada_map documentation
New tool not documented in README at all.

### H5. fetchViaProxy silently falls back to direct fetch
User may unknowingly get unproxied results with no indication.

## Medium Issues

- M1: index.ts has three responsibilities (362 lines)
- M2: `any` types in html.ts
- M3: HTML content selector threshold too low (100 chars)
- M4: html.slice(0, 10000) truncates mid-tag
- M5: cleanParams imported but never called
- M6: Coverage provider not installed
- M7: No relative URL resolution for non-root paths
- M8: Hardcoded Bing locale logic

## What's Genuinely Good

1. Tool descriptions — best in class
2. Error classification system — classifyError() with retryable flag
3. Zod validation with inferred types
4. Retry with exponential backoff
5. README comprehensive and user-friendly
6. Crawl implementation solid (BFS/DFS, concurrent, dedup)
7. Research query generation reasonable heuristic
8. Clean dependency tree (4 deps, 30.9KB packed)
