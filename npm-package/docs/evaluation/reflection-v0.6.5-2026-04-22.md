# Novada MCP v0.6.5 — Agent Experience Reflection
**Date:** 2026-04-22 | **By:** Claude Sonnet 4.6 (as agent consumer)
**Context:** 122 live MCP calls across 3 rounds, competitive analysis against Tavily + Firecrawl

---

## What We Accomplished This Session

We ran 122 live calls across 3 rounds, identified 6 bugs (5 backend, 1 MCP-layer), shipped v0.6.5 with fixes for 5 of 7 gaps, wrote the evaluation framework, and pushed to both repos.

---

## My Real Experience as the Agent Using Novada MCP

### Search: I learned to distrust 4 out of 5 engines

When I ran Round 3, I launched 5 parallel search calls — one per engine. Three came back as errors. One (Bing) came back with 10 results that had nothing to do with my query. Only Google returned something usable.

The problem isn't just that engines are broken. The problem is **I can't trust the tool**. An agent's most expensive resource is context window. When Bing returns 10 results about "Large Language Models" instead of "LLM fine-tuning techniques," those 10 wrong results consume ~800 tokens of my context for zero value. That's worse than an error — an error at least tells me to stop. Wrong results make me build on a false foundation.

**What I actually wanted:** A single `novada_search` call that tries the requested engine, and if it fails or returns garbage, automatically falls back to Google — then tells me it did so. I don't care which engine runs. I care about getting relevant results.

### Extract: The Stripe Test Revealed the Core Problem

I extracted `stripe.com/pricing`. I got back 144 characters in German. The metadata said `chars:144` but gave me **no signal** that this is a failure. The tool treated a 144-char German page as a successful extraction. I had to read the actual content to discover the result was useless.

**What I actually wanted:** The metadata line should have flagged: `chars:144 | WARNING: content appears geo-redirected (German title, expected English) | likely blocked or wrong locale`. Then the Agent Hints should have said: "This page returned minimal content in a non-English locale. Retry with novada_research for pricing comparisons."

Instead, Agent Hints said: "To discover more pages: `novada_map` with url='https://stripe.com'". Generic boilerplate. Same hint I'd get for a perfectly successful extraction.

### Research: The 100% Reliability Stat Is Misleading

The evaluation says `novada_research` is at 100%. This is dangerously misleading. It means "100% of calls returned a response." It does not mean "100% of calls returned useful results."

My query: *"What are the best practices for building production AI agents in 2025?"*

The tool returned 15 sources. Only 4 were about AI agents. 11 were about manufacturing, construction, building design, prefab homes.

**4 out of 15 sources were relevant. That's 27% precision.** Same success rate as `novada_search` — the tool everyone agrees is broken.

Root cause: `generateSearchQueries()` extracts keywords `["best", "practices", "building", "production"]` and generates sub-queries where "building" (as in agents) becomes "building" (as in construction) and "production" (as in deployment) becomes "production" (as in manufacturing).

### Map: Actually Good

FastAPI returned 25 clean URLs. Path-diverse queuing is smart. SPA detection is real and helpful. This tool does what an agent needs.

### Crawl: Functional but Silently Truncating

Next.js docs crawled 3 pages, 890 words. Works. But each page's content is silently truncated to 3000 chars. The word count is post-truncation, so I have no idea how much I lost.

---

## Competitive Position

### What Novada Does Better
1. **Agent Hints exist** — neither Tavily nor Firecrawl tells the agent what to do next
2. **Research tool concept** — configurable depth/focus/parallel queries is unique
3. **Batch extract** — `url=[url1, url2, ...]` in one call
4. **Tool descriptions** — "Best for / Not for / Tip" format is the clearest of the three
5. **Map with path-diverse queuing** — genuinely good URL discovery

### What Competitors Do Better
1. **Firecrawl FIRE-1 Agent** — autonomous browser: clicks, forms, CAPTCHAs. Novada has zero interaction capability.
2. **Firecrawl structured extraction** — pass JSON Schema, get structured data back. Novada returns markdown text.
3. **Tavily AI-ranked relevance** — results ranked by intent, not search engine order.
4. **Firecrawl async crawl** — job ID + polling. Novada blocks for 60-90s.
5. **Content quality measurement** — Firecrawl claims 77% coverage. Novada has never measured quality, only availability.

### Honest Position
Novada is a functional-but-basic web search/extract wrapper with good developer ergonomics but inferior intelligence compared to both competitors. The "more engines" advantage is nullified by 4/5 being broken. The "lighter" design means no browser agent, no structured extraction, no async.

---

## Where We Went Wrong

### 1. Optimized Plumbing Instead of Intelligence
Entire session fixing proxy endpoints, API formats, content limits. The most impactful bug (research query generation) was deferred to "Gap 8."

### 2. Measured Availability, Not Quality
"100% reliability" for research means "never crashes." It doesn't mean "returns useful results." We need quality metrics.

### 3. Agent Hints Are Static, Not Dynamic
Every response ends with the same 3 lines regardless of what happened. The hints don't reflect the actual result.

### 4. No Content Intelligence Layer
When Stripe returns 144 chars in German, the tool should know something is wrong. When research returns manufacturing sources for an AI question, it should know. There is zero intelligence between the raw API and the agent.

---

## What Would Make Me Switch to Novada Full-Time

1. Fix research query generation — keep full question as anchor
2. Add content quality detector — short content, wrong language, CAPTCHA detection
3. Make Agent Hints context-specific — reflect THIS response, not generic guidance
4. Auto-fallback in search — try Google when other engines fail
5. Add relevance filter to research — score sources against question, drop noise

None of these are infrastructure changes. They're all intelligence-layer improvements.

---

*The foundation (tool descriptions, batch extract, map, retry logic, Agent Hints concept) is solid. The gap is in the intelligence layer — the software between the raw API and the agent needs to be smarter about what it returns and how it guides the agent's next move.*
