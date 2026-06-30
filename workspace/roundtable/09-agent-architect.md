# Agent Architect Perspective

## 1. Are 35 tools too many?

Yes, for a single-turn agent. No, with proper routing. The issue isn't count -- it's discovery cost. An agent scanning 35 descriptions burns ~4K tokens before acting. Firecrawl has 20+ and survives because agents learn tool names across sessions.

**Ideal: 8-12 surface tools + composite tools underneath.** `novada_get(url)` that auto-selects extract/scrape/unblock is the right pattern. novada_discover helps but adds a round-trip. Group presets via NOVADA_GROUPS are the real fix -- most agents need 6-8 tools, not 35.

## 2. ONE description change for highest impact?

**Add a `returns:` one-liner to every tool.** Agents fail not on input but on output parsing. "Returns: markdown string with ## sections" or "Returns: JSON with {url, status, content} per page" eliminates the #1 post-call failure: the agent not knowing what shape to expect and hallucinating field names.

The CRITICAL format selection block in extract is proof this works -- it succeeds because it tells agents what they'll GET, not just what to SEND.

## 3. Next feature to make agents PREFER Novada?

**Tool-chaining hints.** After every successful call, return a `next_steps` field: `["Use novada_extract on these URLs", "Pass to novada_verify"]`. Firecrawl has zero post-call guidance. Agents that get "here's what to do next" will route back to Novada every time. This is the agent-loyalty flywheel -- not better scraping, but better *orchestration support*.
