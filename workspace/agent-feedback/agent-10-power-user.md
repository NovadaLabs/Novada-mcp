# Agent-10: Power User Agent Feedback
role: production pipeline / competitive intelligence agent
task: batch extraction, site mapping, field extraction at scale
tools_used: [novada_extract (batch), novada_map (x3 parallel), novada_extract (fields batch x2)]

## Batch Mode Performance

Batch extraction worked and succeeded (3/3 URLs, 0 failed) — but the parallelism story is opaque. There is no latency metadata per-URL in the response, so as an agent I cannot verify whether the 3 URLs were fetched truly in parallel or sequentially under the hood. The output format is a single consolidated markdown document with `### [1/3]`, `### [2/3]`, `### [3/3]` sections — this is readable but not machine-parseable without regex. A JSON envelope with one object per URL (keyed by URL or index) would be far more composable for downstream processing.

Quality scores were inconsistently low for dynamic sites: firecrawl.dev scored 35 (quality:35, content_ok:false), tavily.com scored 30. Both are Next.js/React SPAs. The tool defaulted to `static` mode for all three, which explains why firecrawl.dev returned obfuscated code snippets (`"url": "h=t*A:!/z!aap?A-cZz"`) — that is anti-bot obfuscation visible only in static HTML, not to a real browser. The `auto` mode did not escalate to `render` for these. For a production pipeline targeting SaaS homepages, this is a meaningful reliability gap.

Exa.ai was the exception — quality:65, content_ok:true — because exa.ai serves meaningful static HTML with JSON-LD schema markup. That worked well.

## Tool Composability at Scale

The map→extract→fields pipeline composed structurally but broke semantically. Specifically:

- `novada_map` returned clean URL arrays per domain, formatted as numbered lists. These are human-readable but require parsing to extract URLs for the next `novada_extract` call. There is no native "pipe map output into extract" mechanism — the agent must manually parse the list, construct a URL array, and make another call.
- Field extraction (`fields=["pricing","description","features"]`) returned `—` for `pricing` and `features` on all three homepages. Only `description` was populated, via pattern matching, not structured data. On the dedicated `/pricing` pages, results were identical: all fields returned `—` for firecrawl and tavily (both SPA-rendered). Exa's pricing page worked because it has a real pricing table in static HTML — the tool extracted the table correctly as markdown.
- The `## Requested Fields` block appears before the full content body — good for agent scanning. However, when all fields are `—`, the block provides no value and an agent has no automatic trigger to retry with `render=render`. The tool should emit a `field_extraction_confidence: low` signal with an explicit `agent_instruction` recommending escalation.

## Missing Capabilities

1. **No render-mode auto-escalation in batch**: The `render_fallback` mechanism exists in `novada_proxy_extract` but `novada_extract`'s `auto` mode did not escalate for firecrawl or tavily even though `content_ok:false` was set. Batch mode needs a per-URL render strategy, not a single mode for all URLs.

2. **No structured JSON output mode for batch**: Batch results come back as a monolithic markdown document. For a pipeline agent, I need `{url, fields, content, quality}` per URL as a JSON array. Markdown output forces regex parsing downstream — fragile and error-prone.

3. **No pagination / deep-crawl signal**: `novada_map` returns a flat URL list. There is no signal about which URLs are "documentation", "pricing", "API reference", etc. Competitive intelligence pipelines need URL classification (type: doc | pricing | blog | landing). Right now the agent must make N extract calls to classify pages manually.

4. **No diff/staleness signal**: For competitive monitoring (re-running this pipeline daily), there is no `last_modified`, `etag`, or `content_hash` in the response. Without this, an agent cannot detect what changed vs. the previous run.

5. **No rate-limit / credit metadata in response**: After a batch of 6 extract calls and 3 map calls, I have no idea how many credits were consumed or what my remaining quota is. A production pipeline needs this to implement backpressure.

## vs. Firecrawl/Tavily/Exa

From direct experience running this pipeline against their homepages:

**Firecrawl** publishes a dedicated `/agent-onboarding/SKILL.md` endpoint — a machine-readable onboarding doc for agents. Their MCP server is installable in one line. Their docs site was discovered via sitemap (50 URLs, sitemap-based — fast). The static fetch quality was low on their own SPA homepage, which is somewhat ironic.

**Tavily** has a `/research` endpoint (seen in sitemap), a `competitors/firecrawl` comparison page, and explicit benchmark data (180ms p50, SimpleQA scores) embedded on the homepage. This data extracted cleanly as text. Their agent-friendliness messaging is strong and the pricing page partially conveyed structure (slider-based — garbled in static mode as `$01234567890123456789`).

**Exa** had the best static extraction quality (65/100) because they invest in JSON-LD schema markup and well-structured HTML. Their pricing table extracted as a clean markdown table with actual numbers ($7/1k search, $12/1k deep search, etc.). For competitive intelligence, Exa's own site is the easiest to scrape — and they know it.

Novada MCP's agent-friendliness gap vs. these three: all three competitors have dedicated agent/MCP onboarding paths, structured API responses with machine-parseable fields, and explicit agent documentation. Novada's `## Agent Hints` inline annotations are a good pattern and differentiated — none of the three competitors' own sites surfaced equivalent inline guidance. That is a genuine UX advantage if extended consistently.

## Production Readiness

Not yet production-ready for a competitive intelligence pipeline against SPA-heavy targets. The blockers:

1. **SPA sites return content_ok:false in auto mode** and the agent receives no automatic retry guidance with escalated render mode. For a pipeline targeting SaaS marketing sites (almost universally Next.js/React), this means silent data loss on roughly 60-70% of targets.

2. **Field extraction returns `—` for most fields on most sites** without actionable fallback. A production pipeline cannot tolerate silent field misses — it needs either a confidence score, a fallback value from the content body, or an explicit `retry_with` instruction.

3. **No JSON output mode for batch results** means parsing overhead and fragility. Every downstream agent in the pipeline must implement its own markdown-to-struct parser.

4. **No credit/quota visibility** makes cost management impossible at scale.

Would use it for: static content pipelines (docs sites, GitHub repos, news articles), single-URL extractions where render mode can be specified manually, and site mapping before targeted scraping.

Would not use it for: SaaS homepage monitoring, pricing intelligence at scale, or any pipeline requiring guaranteed field extraction across unknown-renderer targets.

## Top 3 Improvements for Agent Experience

1. **Per-URL render strategy in batch mode**: Accept `render` as either a single string (applies to all) or an array parallel to `url` (one strategy per URL). Add auto-escalation logic: if `quality < 40` on first attempt, retry the failing URLs with `render=render` and merge results. Return a `render_escalated: true` flag per URL so the agent knows.

2. **Structured JSON output mode**: Add `output_format: "json"` option to `novada_extract`. Response shape: `{results: [{url, title, description, fields: {}, content, quality, render_mode, chars}]}`. This eliminates all markdown parsing from downstream pipeline code and makes the tool first-class for agentic pipelines.

3. **`agent_instruction` on field miss**: When a requested field returns `—`, include an `agent_instruction` in the fields block: e.g. `pricing: {value: null, agent_instruction: "Field not found in static HTML. Retry with render=render or target /pricing page directly."}`. This closes the silent-failure loop and gives the agent a deterministic next step without requiring human intervention.

## Overall Score (production agent-friendliness): 6/10

Strong foundation: batch mode works, map tool is fast and sitemap-based, inline `## Agent Hints` are a genuine differentiator, 3/3 success rate on basic extraction. Score held back by: SPA content_ok failures without auto-escalation, silent field extraction misses, markdown-only output format, and no credit/quota visibility. Fix items 1-3 above and this becomes an 8/10 tool for production pipelines.
