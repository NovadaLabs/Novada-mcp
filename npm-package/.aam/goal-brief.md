---
session_id: novada-competitive-20260430-cf69f8fa
alias: novada-competitive-audit
created: 2026-04-30
---

# Goal Brief

## Goal
Competitive gap analysis of novada-search v0.8.3 vs Firecrawl, BrightData MCP, Decodo, Tavily, and other MCP web-data tools. Find gaps. Create improvement plan. Implement high-priority improvements. Run structural review. Multi-reviewer final validation.

## Success Command
```bash
test -f /Users/tongwu/Projects/novada-mcp/docs/competitive/improvement-plan.md && cd /Users/tongwu/Projects/novada-mcp && npx vitest run 2>&1 | grep -E "passed"
```

## From (Baseline)
- novada-search v0.8.3 published on npm
- LobeHub score: 61/100 before P0+P1 fixes (estimated 75–83 after fixes, unverified)
- P0 + P1 improvements applied (444 tests passing)
- P2 polish items identified but NOT implemented
- Blockers: novada_scrape error 11006 (account-level), SERP backend 404

## Not In Scope
- npm publish (needs explicit approval)
- git push (needs explicit approval)
- version number changes (no bumps without approval)
- DB schema changes
- Any deploy action

## Project Path
/Users/tongwu/Projects/novada-mcp

## Budget
$5.00 USD (Claude token cost)

## Innovation Principle
Agent-first, human-second. Agents are the primary users. Every improvement must ask: "Can an LLM use this tool correctly on first try?"

## Credentials (available in env)
NOVADA_API_KEY=1f35b477c9e1802778ec64aee2a6adfa
NOVADA_PROXY_USER=tongwu_TRDI7X
NOVADA_PROXY_PASS=_Asd1644asd_
NOVADA_PROXY_HOST=1b9b0a2b9011e022.vtv.na.novada.pro
NOVADA_PROXY_PORT=7777
NOVADA_WEB_UNBLOCKER_KEY=b27ad6e6834dd36407b00f4e502e055e
NOVADA_BROWSER_WS=wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com
