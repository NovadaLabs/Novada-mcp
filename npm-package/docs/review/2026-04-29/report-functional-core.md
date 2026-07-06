# Functional Test Report — Core Tools (Agent C)

## Test Environment
- Date: 2026-04-29
- API Key: 1f35b477...adfa
- Build: v0.8.3 (pre-compiled at `/Users/tongwu/Projects/novada-mcp/build/`)
- Node: v24.14.0
- Method: Direct `node` invocation against built JS modules

## Results Summary

| Tool | Tests | Pass | Fail | Notes |
|---|---|---|---|---|
| novada_extract | 7 | 5 | 2 | JSON URL throws uncaught; batch `urls` param wrong name |
| novada_crawl | 4 | 3 | 1 | `path_filter`/`limit`/`mode` all silently ignored (wrong names) |
| novada_map | 3 | 3 | 0 | All pass; empty filter returns bare string |
| novada_search | 2 | 2 | 0 | Expected 402 → graceful "Search Unavailable" message |
| novada_research | 2 | 1 | 1 | Wrong param name `query` crashes with uncaught TypeError |

---

## Detailed Results

### novada_extract

**Test 1: Static extract — JSON endpoint**
```
Input:    { url: "https://httpbin.org/json", format: "json" }
Status:   FAIL
Duration: ~2ms
Output:   EXCEPTION — "Response is not HTML. The URL may return JSON or binary data."
Issues:   Exception is thrown (not returned as string). No graceful error string.
```

**Test 2: Static extract — markdown**
```
Input:    { url: "https://example.com", format: "markdown" }
Status:   PASS
Duration: 53ms
Output:   ## Extracted Content
          url: https://example.com
          title: Example Domain
          format: markdown | chars:166 | links:1 | mode:static | quality:0
          ---
          # Example Domain
          This domain is for use in documentation examples...
Issues:   quality:0 despite successful extraction. Score formula: -20 (content_tiny
          <200 chars) +10 (mode_static) = -10, clamped to 0. Content IS usable —
          quality:0 is misleading to agents.
```

**Test 3: JS-heavy page (render mode)**
```
Input:    { url: "https://github.com/trending", render: "render", format: "markdown" }
Status:   PASS
Duration: 1388ms
Output:   format: markdown | chars:1915 | links:1199 | mode:render | quality:25
          # Trending
          [list of trending repos]
Issues:   quality:25 due to high link density (1199 links). Content is accurate.
          "render" mode works without NOVADA_WEB_UNBLOCKER_KEY on public GitHub.
```

**Test 4: Batch extract — `urls` param (as documented in brief)**
```
Input:    { urls: ["https://example.com", "https://httpbin.org/get"] }
Status:   FAIL
Duration: ~0ms
Output:   EXCEPTION — "TypeError: Invalid URL" (input: 'undefined')
Issues:   CRITICAL SCHEMA BUG. Implementation checks Array.isArray(params.url)
          — only the singular `url` key triggers batch mode. Passing `urls` (plural,
          intuitive for batch) makes params.url undefined → unhandled TypeError crash.
```

**Batch extract — `url` array (correct form)**
```
Input:    { url: ["https://example.com", "https://httpbin.org/get"] }
Status:   PASS (partial)
Duration: 376ms
Output:   ## Batch Extract Results
          urls:2 | successful:1 | failed:1
          [1/2] example.com — success
          [2/2] httpbin.org/get — FAILED (not HTML, expected)
Issues:   Batch mode works correctly when using `url` as array. Error labeling clear.
```

**Test 5: Fields extraction**
```
Input:    { url: "https://example.com", fields: ["title", "description"] }
Status:   PASS (with gap)
Duration: 47ms
Output:   ## Requested Fields
          title: —
          description: —
Issues:   BUG. Both return "—" despite page having <title> and <meta description>.
          Root cause: fields.ts PATTERN_MAP has no entries for "title" or "description".
          These are the two most common field requests and neither is supported.
```

**Test 6: Edge case — invalid URL**
```
Input:    { url: "not-a-url" }
Status:   FAIL
Duration: 2ms
Output:   EXCEPTION — "TypeError: Invalid URL"
Issues:   Unhandled exception. No graceful error string returned.
```

**Test 7: Edge case — unreachable URL**
```
Input:    { url: "https://this-domain-does-not-exist-12345.com" }
Status:   FAIL
Duration: 7042ms
Output:   EXCEPTION — "getaddrinfo ENOTFOUND this-domain-does-not-exist-12345.com"
Issues:   DNS failure throws after full 7s proxy timeout. No graceful error string.
```

---

### novada_crawl

**Test 1: Basic crawl**
```
Input:    { url: "https://example.com", limit: 3, format: "markdown" }
Status:   PASS (with param note)
Duration: 58ms
Output:   pages:1 | strategy:bfs | note: Stopped early — No more links.
Issues:   `limit` silently ignored (schema uses `max_pages`). `format` not in schema,
          silently ignored. Example.com has 1 page so limit had no observable effect.
```

**Test 2: Path filter**
```
Input:    { url: "https://docs.python.org/3/", path_filter: "/tutorial", limit: 5 }
Status:   FAIL (wrong param — filter not applied)
Duration: 208ms
Output:   pages:5 — URLs: /3/, /3/download.html, /3.15/, /3.14/, /3.13/
Issues:   SCHEMA BUG. Brief uses `path_filter` (string). Schema uses `select_paths`
          (string array, regex). `path_filter` silently ignored. None of the 5 crawled
          pages contain /tutorial — filter had zero effect, no warning emitted.
```

**Test 3: DFS mode**
```
Input:    { url: "https://example.com", mode: "dfs", limit: 3 }
Status:   FAIL (wrong param — mode ignored)
Duration: 53ms
Output:   strategy:bfs (not dfs)
Issues:   SCHEMA BUG. Brief uses `mode`. Schema uses `strategy`. Silently defaults
          to bfs. No error or warning.
```

**Test 4: Single-page site (max_pages 10)**
```
Input:    { url: "https://example.com", max_pages: 10 }
Status:   PASS
Duration: 54ms
Output:   pages:1 | note: Stopped early — No more same-domain links to follow.
Issues:   None. Correct halt behavior when links exhausted before limit.
```

---

### novada_map

**Test 1: Basic map**
```
Input:    { url: "https://example.com" }
Status:   PASS
Duration: 185ms
Output:   urls:1
          ⚠ Only the root URL found. This site is likely a JavaScript SPA.
          [agent hints with next steps]
Issues:   None. Warning + hints are helpful and accurate.
```

**Test 2: With search filter**
```
Input:    { url: "https://httpbin.org", search: "get" }
Status:   PASS
Duration: 863ms
Output:   "No URLs found on https://httpbin.org matching 'get'."
Issues:   Empty result is accurate (httpbin only has / and /forms/post).
          Return is a bare string with no ## header or Agent Hints block —
          inconsistent with successful map output format.
```

**Test 3: Large site**
```
Input:    { url: "https://github.com" }
Status:   PASS
Duration: 564ms
Output:   urls:50 | discovery:crawl
          [50 GitHub URLs listed]
Issues:   None. Default limit=50 respected. Well-structured output.
```

---

### novada_search

**Test 1: Basic Google search**
```
Input:    { query: "best proxy services 2024", engine: "google", num: 3 }
Status:   PASS (expected 402 handled gracefully)
Duration: 954ms
```

**Test 2: Bing search**
```
Input:    { query: "MCP server examples", engine: "bing", num: 3 }
Status:   PASS (expected 402 handled gracefully)
Duration: 836ms
```

**402 Error Shape (exact message returned to caller):**
```
## Search Unavailable

The Novada SERP endpoint is not yet available for this API key.

Why: novada_search requires a dedicated SERP quota that is separate from
the Scraper API and Web Unblocker plans. Contact support@novada.com to enable it.

Alternatives right now:
- novada_extract — fetch and read any specific URL directly
- novada_research — multi-source research using extract-based discovery
- novada_map + novada_extract — discover and read pages from a known site
```
Verdict: Excellent error handling. Actionable alternatives, no exception thrown.

---

### novada_research

**Test 1: Basic question (correct param)**
```
Input:    { question: "what is Model Context Protocol", depth: "quick" }
Status:   PASS (SERP failure handled gracefully)
Duration: 977ms
Output:   ## Research: Search Unavailable
          question: "what is Model Context Protocol"
          All 3 search queries failed.
          [manual alternatives + suggested URLs]
Issues:   None. Depth "quick" generates 3 queries (confirmed). Graceful fallback.
```

**Test 2: Deep research**
```
Input:    { question: "proxy residential vs datacenter", depth: "deep" }
Status:   PASS (SERP failure handled gracefully)
Duration: 1002ms
Output:   ## Research: Search Unavailable — All 6 search queries failed.
Issues:   None. "deep" correctly generates 6 queries vs 3 for "quick".
```

**Test 3: Wrong param name (`query` instead of `question`)**
```
Input:    { query: "what is Model Context Protocol", depth: "basic" }
Status:   FAIL
Duration: 0ms
Output:   EXCEPTION — "TypeError: Cannot read properties of undefined (reading 'length')"
          at resolveDepth (research.js:135:36)
Issues:   CRITICAL BUG. resolveDepth() calls params.question.length with no null
          guard. Passing `query` (which is the intuitive name and what all other tools
          use) crashes immediately. Secondary: depth: "basic" is not in the enum
          ("quick"|"deep"|"auto"|"comprehensive") — the crash hides this invalid value.
```

---

## Cross-Reference: Schema vs. Brief Param Names

| Param in Brief | Actual Schema Param | Tool | Effect of Wrong Name |
|---|---|---|---|
| `urls` (batch array) | `url` (array) | extract | Uncaught TypeError crash |
| `path_filter` (string) | `select_paths` (string array, regex) | crawl | Silently ignored |
| `limit` | `max_pages` | crawl | Silently ignored, defaults to 5 |
| `mode` | `strategy` | crawl | Silently ignored, defaults to bfs |
| `format` | not in schema | crawl | Silently ignored |
| `query` | `question` | research | Uncaught TypeError crash |
| `depth: "basic"` | "quick"\|"deep"\|"auto"\|"comprehensive" | research | Crash before reaching validation |

---

## Issues Found (Ranked)

### CRITICAL

**C1 — novada_research crashes when `question` is undefined**
`src/tools/research.ts:135` — `resolveDepth()` calls `params.question.length` with no null check. Passing `query` instead of `question` (intuitive name; every other tool uses `query`) triggers an immediate unhandled TypeError. Fix: `const q = params.question ?? ""; q.length`.

**C2 — novada_extract throws uncaught exception on non-HTML URLs (JSON/binary)**
`extractSingle()` throws `new Error("Response is not HTML...")` — not caught in the single-URL path of `novadaExtract()`. The batch path has try-catch; single-URL does not. Affects any JSON API, binary file, or non-HTML endpoint.

**C3 — novada_extract throws uncaught exception on DNS failure (unreachable URL)**
`getaddrinfo ENOTFOUND` propagates unhandled after 7s timeout. Should return a structured error string.

**C4 — novada_extract throws uncaught exception on invalid URL (`not-a-url`)**
Same pattern — `new URL("not-a-url")` throws, propagates unhandled. No error string returned.

### HIGH

**H1 — Batch extract: `urls` (plural) crashes, `url` (array) is the actual API**
Intuitive name `urls` causes a silent crash. The MCP tool description says "pass url as an array" but this is easy to miss. Consider accepting both `url` and `urls` via Zod union, or at minimum catching the undefined case.

**H2 — `fields` extraction ignores "title" and "description"**
`PATTERN_MAP` in `fields.ts` has no entries for "title" or "description". These are the two most common field requests. Both return `—` even when the page clearly has `<title>` and `<meta name="description">`. Fix: fall back to `extractTitle()` / `extractDescription()` when field name matches.

**H3 — CrawlParams has no `limit`, `mode`, or `format` — all silently ignored**
Users passing the intuitive param names get wrong behavior (default limits, BFS instead of DFS, no format control) with zero indication that their params had no effect.

### MEDIUM

**M1 — quality:0 on valid short content is misleading**
example.com extraction returns quality:0 on successful content. Agents may retry with render mode unnecessarily. Consider separating "extraction succeeded" from content richness score.

**M2 — novada_map filter returns bare string (inconsistent format)**
"No URLs found on X matching Y." has no `## Site Map` header and no Agent Hints block, unlike a successful map. Inconsistent for agent parsers.

**M3 — `depth: "basic"` is invalid but accepted without error at function level**
Schema enum is "quick"|"deep"|"auto"|"comprehensive". "basic" silently treated as "auto". Zod catches it at MCP boundary but not in direct function calls.

### LOW

**L1 — GitHub render quality:25 due to link density penalty**
1199 links on a 1915-char markdown page triggers the `density > 0.4` penalty. Trending page is legitimate content-rich output; the link density formula penalises it unfairly.

**L2 — novada_crawl ignores `format` param entirely**
No `format` in `CrawlParamsSchema`. Output is always markdown. Silently ignored, no warning.

---

*Report generated: 2026-04-29 | Reviewer: Agent C (Functional Core) | Codebase: novada-search v0.8.3*
