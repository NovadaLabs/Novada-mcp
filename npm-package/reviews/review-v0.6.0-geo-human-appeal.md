# Review: novada-mcp v0.6.0 — GEO, Human Appeal, Product Quality

**Date:** 2026-04-10
**Reviewer:** Fresh agent (second pass)
**Focus:** GEO (agent discoverability), Human Appeal, Product Strategy

## Scores

| Dimension | Score |
|-----------|-------|
| Code Quality | 7/10 |
| GEO (Agent Appeal) | 6/10 |
| Human Appeal | 6/10 |
| Competitive Position | 4/10 |

## Key Insights

### GEO: First sentence is everything
- Tool descriptions lead with Novada branding, not capability
- server.json missing tools/categories/topics metadata
- No structured metadata in output (agents can't parse result counts)
- Proxy advantage invisible — agent can't tell if proxy was used

### Human Appeal
- No visual identity (logo/banner)
- No demo GIF
- Comparison table has credibility issue (Firecrawl anti-bot marked "Partial")
- v0.6.0 not published — users still get vulnerable v0.4.1

### Strategic
- Proxy infrastructure is the REAL differentiator but invisible in product
- Can't win on feature count (5 vs 14). Must win on reliability + geo-coverage
- "Fetched via Novada proxy (US)" in output would make advantage visible

## Action Items Applied This Session

### P0 (immediate)
1. Fix @vitest/coverage-v8 version
2. Rewrite first sentences — capability first, branding second
3. Add structured metadata to tool output
4. Make proxy usage visible in output
5. Enrich server.json with tools/categories
6. Fix comparison table credibility
7. Publish v0.6.0

### P1 (this week)
- Add crawl/map tool tests
- Logo/banner
- Demo GIF
- MCP Registry publish

### P2 (next sprint)
- withme.md for GEO
- Build-time schema generation
- MCP tool annotations
- Node 22 CI
