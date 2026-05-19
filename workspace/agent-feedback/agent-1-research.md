# Agent-1: Research Agent Feedback
role: research agent
task: multi-source web research
tools_used: [mcp__novada-search__novada_research, mcp__plugin_novada-proxy_novada-proxy__novada_proxy_research, mcp__novada-search__novada_extract]

## First Impression

The tool descriptions were clear and directive. `novada_research` explicitly said "One call replaces 3–10 manual searches" and flagged when to use alternatives instead (`novada_search` for just URLs, `novada_extract` for known URLs). The "Best for / Not for" pattern in `novada_extract` gave me enough signal to pick the right tool without trial-and-error. The `depth` enum options (`quick`, `deep`, `comprehensive`, `auto`) communicated capability scope immediately. Overall, the descriptions read like they were written with agent consumption in mind — terse, decision-tree shaped, with explicit "use X instead if Y" redirects.

## What Worked Well

1. **Auto-escalation transparency in `novada_extract`:** The response explicitly said `auto_escalated:true` and noted "static quality score was < 40, escalated to render mode." This tells me exactly why the behavior changed without me having to debug a silent fallback.

2. **Agent Hints section at the bottom of every extract response:** The `## Agent Hints` block appended to each extraction gave me concrete next steps (`novada_map with url=...`, focus reminders). This is the single most useful structural feature — it closes the loop for a stateless agent that would otherwise stall.

3. **`content_ok` field in the response header:** The per-response metadata (`chars:1877 | links:54 | mode:static | quality:35 | content_ok:false`) gave me a quick parse-able signal to know whether to trust or discard the content — without reading the full body first.

4. **Error responses from `novada_research` were graceful:** When SERP was unavailable, the tool returned a structured markdown block with fallback instructions ("use novada_extract with specific URLs you already know") rather than a bare HTTP error. An agent can parse and act on that without a human in the loop.

5. **`novada_proxy_research` error had `agent_instruction`:** The 402 error returned `"agent_instruction": "Retry the request. Check novada_proxy_status for network health."` — this is exactly the right pattern. No ambiguity about what to do next.

## What Was Confusing or Missing

1. **Two parallel tool namespaces with identical capabilities:** `mcp__novada-search__novada_research` and `mcp__plugin_novada-search_novada-search__novada_research` appear to be the same tool under different MCP plugin registrations, as do their `novada_extract` counterparts. As an agent I had to guess which to call. There is no description-level guidance on which namespace to prefer. This creates unnecessary branching logic.

2. **`novada_research` SERP failure gave no indication this was a permission/billing issue:** The failure message said "The Novada SERP endpoint is not available for this API key. All 3 search queries failed." — but it was framed as a capability limit rather than a recoverable credential issue. The `novada_proxy_research` error correctly returned a 402 with `agent_instruction`. The `novada_research` tool should do the same — include a `code: SERP_NOT_ENABLED` and a recovery action like "contact support@novada.com or check your plan at app.novada.com."

3. **`content_ok: false` with no explanation of why:** The Firecrawl extraction returned `content_ok:false` and `quality:35`, but the content itself looked partially valid. There is no explanation in the response (or in the tool description) of what threshold triggers `content_ok:false` or what an agent should do when it sees it. Should I retry with `render="render"`? Discard? Use anyway? The Agent Hints block did not address this either.

4. **`query` parameter in `novada_extract` is described as "helps the calling agent focus on relevant sections" but the behavior is opaque:** I passed a query but cannot verify whether it influenced the output at all. There is no "relevance_score" or "sections_matched" field in the response. An agent cannot know if the query param did anything.

5. **No explicit result count or source list in `novada_research` success path:** From reading the description I expected a `findings[]` array with per-source data. When the tool failed, the error message implied this structure — but there was no example of what a successful response looks like in the description. A single JSON example of the success response shape would remove ambiguity.

## Error Handling

Three calls, two failures:

- `novada_research`: Failed with a structured markdown fallback. Actionable (it suggested alternatives), but the failure mode (SERP not available) should have been a coded error with `agent_instruction`, not free-form markdown.
- `novada_proxy_research`: Failed with a proper JSON error object including `code`, `message`, `recoverable: true`, and `agent_instruction`. This is the gold standard pattern.
- `novada_extract` on `brightdata.com/products/scraping-apis`: Returned a clean 404 error with Agent Hints pointing to `novada_map` as a recovery path. Correct behavior.

The inconsistency is the problem: two tools in the same product return structurally different error objects. An agent building conditional retry logic has to handle both shapes.

## Agent Hints Quality

The `## Agent Hints` sections in `novada_extract` responses were the standout feature. They provided:
- A concrete next action (`novada_map with url=...`)
- A reminder of the active query context
- An explanation for auto-escalation (when it occurred)

What was missing: no hint was provided for the `content_ok:false` case. When content quality is flagged as low, the Agent Hints block should say something like: "Content quality is below threshold. Retry with render='render' to attempt JS rendering bypass."

## Output Format

`novada_extract` returns a structured markdown document. The response header line (`url | title | format | chars | links | mode | quality | content_ok`) is machine-parseable if you treat `|`-separated key:value pairs as a flat metadata record. The body is markdown prose — usable but not JSON. For agent workflows that need to feed extracted content downstream (into a summarizer, into a structured field extractor), markdown is fine. For workflows that need to compare fields across multiple URLs, a JSON envelope with `{ metadata: {...}, content: "..." }` would be preferable. The `## Agent Hints` and `## Requested Fields` sections are well-delineated headers, making the document parse-friendly for agents that do section splitting.

The `novada_research` failure response was pure markdown — no structured fields at all. That is the weakest format in the set.

## Top 3 Improvements for Agent Experience

1. **Unify error response shape across all tools.** Every failure — whether SERP unavailable, 402, 404, or timeout — should return a JSON object with `{ ok: false, error: { code, message, recoverable, agent_instruction } }`. Currently `novada_research` returns markdown on failure while `novada_proxy_research` returns structured JSON. Inconsistency forces agents to write multi-path error parsers.

2. **Add `content_ok:false` recovery guidance to Agent Hints.** When quality is below threshold, the Agent Hints block should prescribe the recovery action (e.g., "retry with render='render'", "try novada_unblock for bot-protected pages"). Right now the signal exists but the prescription is absent, leaving the agent to guess.

3. **Resolve or document the duplicate namespace problem.** `mcp__novada-search__*` and `mcp__plugin_novada-search_novada-search__*` expose the same tools under two MCP registrations. Either consolidate to one, or add a one-line note in each description: "Prefer mcp__novada-search__ namespace; plugin namespace is an alias." Without this, agents will call both in parallel or pick arbitrarily.

## Overall Score (agent-friendliness): 6/10

Strong foundations — Agent Hints, auto-escalation transparency, and the `agent_instruction` error pattern show deliberate agent-first design — but inconsistent error shapes across tools and missing recovery guidance for degraded content states meaningfully raise the cost of reliable agent integration.
