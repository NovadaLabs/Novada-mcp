# UX Designer Position — Novada MCP Roundtable

## 1. What is blocking new user adoption?

The user gives up at "Get a key at novada.com." That link leads to a developer portal, not a one-click signup. There is no free tier, no trial, no sandbox. Every competitor (Firecrawl, Tavily) lets you paste an API key within 60 seconds of landing on their site. We ask users to navigate an unfamiliar dashboard, figure out which of 6+ proxy/search/scraper products to activate, and hope they export the right env var. The drop-off happens between "this README looks good" and "I have a working tool call." That gap is where 395x lives.

## 2. What to build next week?

A zero-config trial mode: `npx novada-mcp --demo` that works with no API key. 50 free requests, rate-limited, search+extract only. The user sees real results in their MCP client before creating any account. When the quota runs out, the error response includes a signup link and the exact `claude mcp add` command pre-filled with their new key. This converts curiosity into activation without any friction.

## 3. What NOT to do?

Do not add more tools. 35+ tools already cause decision paralysis for agents and users alike. The competitive analysis shows content quality (7.5 vs 8.9) and latency (7.1s vs 761ms) are the real gaps. Adding tool #36 before fixing the extraction pipeline and P50 latency is building a wider front door on a house with a leaky roof.
