# Agent Brief: Code Quality Reviewer (Agent A)

## Role
Senior TypeScript engineer. No prior context on this project. Fresh eyes.

## Project
novada-search v0.8.3 — MCP server for web intelligence.
Location: ~/Projects/novada-mcp/

## Task
Review all source code for quality, correctness, and maintainability. Produce a ranked issue list.

## What to Read (in order)
1. src/config.ts — constants and timeouts
2. src/tools/types.ts — all Zod schemas and TypeScript types
3. src/tools/extract.ts
4. src/tools/search.ts
5. src/tools/crawl.ts
6. src/tools/map.ts
7. src/tools/research.ts
8. src/tools/scrape.ts — special attention: async polling flow
9. src/tools/verify.ts
10. src/tools/browser.ts
11. src/tools/proxy.ts
12. src/tools/unblock.ts
13. src/tools/health.ts
14. src/index.ts — MCP server wiring, tool registration
15. src/resources/index.ts
16. src/prompts/index.ts
17. src/sdk/index.ts
18. src/utils/ — all utility files
19. tests/tools/*.ts — sample to check test quality

## What to Check

### Type Safety
- Any `unknown` cast that isn't narrowed properly
- Overuse of `as any` or `as never`
- Missing return type annotations on exported functions
- Zod schemas vs TypeScript types consistency

### Error Handling
- All axios calls: are AxiosError caught and re-thrown meaningfully?
- Are error messages actionable for AI agents? Do they include next steps?
- Any swallowed errors (catch with no rethrow)?
- Missing timeout handling

### Architecture
- Duplicate code across tools (copy-paste patterns)
- Tools that should share utilities but don't
- Config values hardcoded in tool files instead of config.ts
- Circular imports

### Test Coverage
- Which tools have no tests or sparse tests?
- Are error paths tested?
- Are edge cases covered (empty results, network timeout, malformed response)?

### Security
- API keys ever logged?
- User input ever interpolated into commands?
- Any SSRF risk (user-controlled URLs passed directly)?

### Correctness
- scrape.ts async polling: is the 90s timeout appropriate? Is the poll interval 2s appropriate?
- Is `extractRecords` in scrape.ts complete enough? (keys: organic_results, organic, results, items, records, data, products, posts)
- Any off-by-one errors in limit/slice logic?

## Output Format
Write to: docs/review/2026-04-29/report-code-quality.md

Structure:
```
# Code Quality Report — Agent A

## P0 Issues (must fix before shipping)
### [Issue title] — src/file.ts:line
Problem: ...
Fix: ...

## P1 Issues (important, fix soon)
...

## P2 Issues (nice to have)
...

## Summary
- Total issues: P0=N, P1=N, P2=N
- Most critical file: ...
- Biggest pattern: ...
```
