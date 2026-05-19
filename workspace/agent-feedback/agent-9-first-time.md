# Agent-9: First-Time Agent Feedback
role: first-time user — no prior knowledge
task: figure out which tool to use from descriptions alone
tools_used: [mcp__novada-search__novada_extract]

## Tool Discovery

I used `ToolSearch` with query "novada" to surface all available tools and their descriptions. The results returned 14+ tools across categories. Picking the right tool was fairly straightforward because `novada_extract` opens with: **"Use when you have a URL and need its content."** That sentence directly matches the task. No ambiguity.

The harder part: the ToolSearch results returned duplicate tools (e.g., `mcp__novada-search__novada_extract` AND `mcp__plugin_novada-search_novada-search__novada_extract`). I could not tell from descriptions which namespace to use. I picked the shorter prefix (`mcp__novada-search__`) arbitrarily — it worked, but this is a hidden trap for a first-time agent.

## Description Clarity

**Clear on first read:**
- `novada_extract` — opening line is decisive. "Best for" and "Not for" sections immediately ruled out the alternatives.
- `novada_scrape` — "Not for: General web pages (use novada_extract)" is excellent negative guidance; it actively steered me to the right tool.
- `novada_crawl` — "Common mistakes: Do NOT use novada_crawl to fetch one page" was direct and useful.
- `novada_discover` — `agent_instruction: Call this first...` is a helpful onboarding signal, though I had already found what I needed via ToolSearch.

**Required re-reading:**
- `novada_browser` vs `novada_browser_flow` — the boundary between them took two reads. Both describe "multi-step automation," but `novada_browser` is the more capable CDP tool and `novada_browser_flow` is a higher-level wrapper with a fallback note. The distinction only became clear from the fallback line buried at the end of `novada_browser_flow`.
- `novada_unblock` — not returned in initial search results, so I could not evaluate it. Its role relative to `novada_extract render="render"` is unclear without seeing both side-by-side.

## Parameter Discoverability

Parameters for `novada_extract` were self-explanatory:
- `url` — obvious
- `format` — default `markdown` is clearly stated; enum values are self-describing
- `render` — default `auto` is clearly stated; the "Common mistakes" block explains when NOT to override it, which is the most common error a first-time agent would make
- `query` — "Optional query for relevance context" is clear
- `fields` — clear from examples

No guessing required. The defaults are sane and stated explicitly. This is the strongest part of the tool's UX.

One mild friction point: `urls` is described as an "alias for url when passing multiple URLs" — having two parameters that do the same thing (`url` accepting an array vs `urls`) is confusing. The docstring clarifies it, but a first-time agent might set both or wonder which takes precedence.

## Common Mistakes Sections

Extremely helpful. Specifically:

1. `novada_extract` — "Do NOT set render='render' for all pages. auto mode is 15x-113x faster" — I would have defaulted to `render='render'` thinking it was safer. This warning saved me from a bad pattern.
2. `novada_crawl` — "Do NOT use novada_crawl to fetch one page" — direct and decisive.
3. `novada_scrape` — "Not for: General web pages (use novada_extract)" — this cross-referencing to the correct tool is the single most useful pattern in the whole suite.

The "Not for" + explicit redirect pattern (`use X instead`) is the best discoverability feature across all the tools. Every tool has it and it works.

## What the Ideal First-Time Experience Would Look Like

The single most impactful change: **consolidate or clearly label the duplicate namespaces.** I was presented with `mcp__novada-search__*` and `mcp__plugin_novada-search_novada-search__*` variants of every tool. A first-time agent has no basis to choose. One canonical namespace with a note ("plugin variant available for X environment") would eliminate this confusion entirely and reduce decision paralysis.

## Top 3 Improvements for Agent Experience

1. **Resolve namespace duplication.** Two copies of every tool (`mcp__novada-search__*` vs `mcp__plugin_novada-search_novada-search__*`) with identical descriptions force an arbitrary choice. Either expose only one or add a one-line header to each copy explaining when to use which (e.g., "Use this variant when running as a standalone MCP server vs. plugin-embedded").

2. **Add a "Start here" breadcrumb to `novada_discover`.** The tool says `agent_instruction: Call this first` — but this instruction is buried inside the description body, not surfaced in the tool name or as a schema-level hint. A new agent using ToolSearch will find `novada_extract` before `novada_discover` and skip the discovery step. Either make `novada_discover` appear first in search results, or add to each tool's description: "New? Run novada_discover first for a full tool map."

3. **Clarify `novada_extract url` vs `urls` parameter redundancy.** Having `url` accept either a string or an array, AND a separate `urls` array parameter, is a schema design smell. A first-time agent will wonder which to use for batch requests, whether setting both causes an error, and which takes precedence. Collapse to one parameter (`url`, always accepting string or array) and remove `urls`, or document exactly: "`urls` is ignored if `url` is set."

## Overall Score (first-time discoverability): 8/10

The core task — read a URL — was solved in one tool call with zero prior knowledge. The "Best for / Not for / Common mistakes" pattern is genuinely excellent and prevented at least two wrong choices. The primary friction is the namespace duplication (a structural issue, not a docs issue) and minor schema redundancy in `novada_extract`. For a first-time agent with no onboarding, this is a strong result.
