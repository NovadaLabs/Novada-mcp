# Orchestrator Plan — novada-mcp Structural Fix + Benchmark

Date: 2026-05-19
Mode: Orchestrator (Opus) dispatching workers (Sonnet)

## Agents to Dispatch

### Fix Agents (sequential dependency: C1 must finish before H1)

| Agent | Issue | File(s) | Priority |
|-------|-------|---------|----------|
| fix-c1-dead-types | Remove duplicate NovadaErrorCode/NovadaError/classifyError from types.ts | types.ts | CRITICAL |
| fix-c2-version | Sync VERSION with package.json at build time | config.ts, package.json | CRITICAL |
| fix-h1-scrape-types | Align ScrapeParams type with actual Zod schema | types.ts | HIGH |
| fix-h2-browser-any | Type `page` parameter properly in browser.ts | browser.ts | HIGH |
| fix-h3-apikey-url | Remove API key from polling URL, use header instead | scrape.ts | HIGH |
| fix-h5-error-pattern | Replace string-matching error detection with typed NovadaError | scrape.ts | HIGH |
| fix-proxy-env | Configure proxy env vars in MCP settings | ~/.claude/settings.json | CONFIG |

### Benchmark Agents (independent, run in parallel)

| Agent | Scope |
|-------|-------|
| bench-extract | Test novada_extract on 5 different sites (static + JS) x 3 rounds |
| bench-scrape | Test novada_scrape on 3 platforms x 3 rounds |
| bench-proxy | Test proxy latency across 3 regions x 3 rounds |

### Review Agent (runs after all fixes)

| Agent | Scope |
|-------|-------|
| final-reviewer | Re-run code review on all changed files |
