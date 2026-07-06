# Customer Perspective: AI Agent Developer Evaluating Novada MCP

## 1. Would I choose Novada MCP today?

**Not yet.** The value proposition is strong -- `novada_research` alone replaces a multi-step search-extract-synthesize pipeline I'd otherwise build myself. The tool breadth is genuine (search + extract + scrape + proxy in one key). But I'd pilot it alongside Firecrawl, not replace it. Two concerns hold me back: I can't find independent benchmarks validating the "8.5/10 agent-first score" (self-assigned?), and 40+ tools in one MCP server risks context window bloat -- the exact problem the README criticizes BrightData for.

## 2. What would make me switch from Firecrawl?

**Reliability proof.** One production week where `novada_extract` succeeds on pages Firecrawl fails on (anti-bot escalation actually working), with latency under 3 seconds for static pages. I'd also need the hosted MCP endpoint (currently missing) -- requiring `npx` install is friction my team won't tolerate for a managed service. If Novada published a public status page with uptime and p95 latency, that would matter more than any feature table.

## 3. Biggest red flag?

**The product sells breadth but I can't verify depth.** 129 platform scrapers, 5 search engines, 6 proxy types -- impressive on paper. But the README comparison table is self-reported with no methodology. When a product claims superiority on every axis against established competitors, my instinct is skepticism. Show me a third-party benchmark or a public error-rate dashboard, and the red flag disappears.
