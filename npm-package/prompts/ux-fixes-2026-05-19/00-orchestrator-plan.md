# Orchestrator Plan — UX Fix Sprint — 2026-05-19

## Context
novada-search MCP v0.1.0 is live locally. After end-to-end agent testing, 4 UX issues were
identified that block a smooth agent experience. These must be fixed BEFORE npm publish (still v0.1.0).

## Repo
/Users/tongwu/Projects/novada-mcp (TypeScript, built with `npm run build`)
Key files:
- src/tools/extract.ts — field extraction + quality scoring
- src/tools/crawl.ts   — multi-page crawl
- src/tools/search.ts  — SERP + scraper fallback
- src/tools/research.ts — deep research synthesis
- src/utils/fields.ts  — matchHeadingSection, extractFields helpers

## 4 Priority Fixes

| # | Fix | File | Priority |
|---|-----|------|----------|
| 1 | extract-diagnostics: null fields return reason_null + extraction_quality | src/tools/extract.ts | P0 |
| 2 | crawl-js-signal: js_content_missing flag when JS-heavy page not rendered | src/tools/crawl.ts | P0 |
| 3 | search-yahoo-fallback: yahoo degrades silently → fix with fallback or explicit retry | src/tools/search.ts | P1 |
| 4 | research-structured-output: unpredictable output format → standardize sections | src/tools/research.ts | P1 |

## Agent Grid (16 total)

| Fix | CC Implementer | CC Reviewer | Codex Implementer | Codex Reviewer |
|-----|---------------|-------------|-------------------|----------------|
| 1 | cc-01-impl | cc-01-rev | codex-01-impl | codex-01-rev |
| 2 | cc-02-impl | cc-02-rev | codex-02-impl | codex-02-rev |
| 3 | cc-03-impl | cc-03-rev | codex-03-impl | codex-03-rev |
| 4 | cc-04-impl | cc-04-rev | codex-04-impl | codex-04-rev |

## Exit Condition
Build passes (`npm run build` zero errors) AND each CC-reviewer reports "no regressions, fix correct".

## Do NOT
- Bump version number (stays 0.1.0)
- Push to npm
- Push to GitHub (without explicit user approval)
- Modify any file not listed above
