# Agent Brief: Functional Tester — Core Tools (Agent C)

## Role
QA engineer. You test by running actual API calls and reporting what works, what fails, and what returns surprising results.

## Project
novada-search v0.8.3 — MCP server for web intelligence.
Location: ~/Projects/novada-mcp/
Build: ~/Projects/novada-mcp/build/ (already compiled)

## API Key
NOVADA_API_KEY=1f35b477c9e1802778ec64aee2a6adfa

## Tools to Test
- novada_extract (static + render modes)
- novada_crawl
- novada_map
- novada_search (expect 402 — document the error shape)
- novada_research (expect 402 — document the error shape)

## How to Run Tests
Use node to call the built functions directly. Example pattern:

```bash
cat > /tmp/test-tool.mjs << 'EOF'
import { novadaExtract } from '/Users/tongwu/Projects/novada-mcp/build/tools/extract.js';
const result = await novadaExtract({ url: "https://example.com", format: "markdown" }, "1f35b477c9e1802778ec64aee2a6adfa");
console.log(result.slice(0, 500));
EOF
node /tmp/test-tool.mjs
```

## Test Cases to Run

### novada_extract
1. Static extract: `{ url: "https://httpbin.org/json", format: "json" }`
2. Static extract markdown: `{ url: "https://example.com", format: "markdown" }`
3. JS-heavy page (render mode): `{ url: "https://github.com/trending", render: "render", format: "markdown" }` — needs NOVADA_WEB_UNBLOCKER_KEY, expect error message
4. Batch extract: `{ urls: ["https://example.com", "https://httpbin.org/get"] }`
5. With fields param: `{ url: "https://example.com", fields: ["title", "description"] }`
6. Edge case — invalid URL: `{ url: "not-a-url" }`
7. Edge case — unreachable URL: `{ url: "https://this-domain-does-not-exist-12345.com" }`

### novada_crawl
1. Basic crawl: `{ url: "https://example.com", limit: 3, format: "markdown" }`
2. With path filter: `{ url: "https://docs.python.org/3/", path_filter: "/tutorial", limit: 5 }`
3. DFS mode: `{ url: "https://example.com", mode: "dfs", limit: 3 }`
4. Edge case — single page site: `{ url: "https://example.com", limit: 10 }`

### novada_map
1. Basic map: `{ url: "https://example.com" }`
2. With filter: `{ url: "https://httpbin.org", filter: "get" }`
3. Edge case — large site (should respect limit): `{ url: "https://github.com" }`

### novada_search
1. Basic Google: `{ query: "best proxy services 2024", engine: "google", num: 3 }`
2. Bing: `{ query: "MCP server examples", engine: "bing", num: 3 }`
3. **Document the error** — what does 402 look like from the user's perspective?

### novada_research
1. Basic: `{ query: "what is Model Context Protocol", depth: "basic" }`
2. Deep: `{ query: "proxy residential vs datacenter", depth: "deep" }`
3. **Document the error** — what does the failure look like?

## For Each Test, Record

```
Tool: novada_extract
Test: static extract of https://example.com
Input: { url: "https://example.com", format: "markdown" }
Status: PASS / FAIL / ERROR
Duration: Xms
Output (first 300 chars): ...
Issues: ...
```

## Check Against Source
After testing, read the relevant src/tools/*.ts and check:
- Does the actual output match what the tool description promises?
- Are there parameters that exist in the schema but don't actually work?
- Are error messages helpful (include next step for the agent)?

## Output Format
Write to: docs/review/2026-04-29/report-functional-core.md

```
# Functional Test Report — Core Tools (Agent C)

## Test Environment
- Date: 2026-04-29
- API Key: 1f35b477...adfa
- Build: v0.8.3

## Results Summary
| Tool | Tests | Pass | Fail | Notes |
|---|---|---|---|---|

## Detailed Results
[per tool section with each test case]

## Issues Found
[ranked list of functional bugs or gaps]
```
