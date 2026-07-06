# Agent-7: Content Pipeline Agent Feedback
role: content pipeline / workflow automation agent
task: multi-source extraction and comparison pipeline
tools_used: [mcp__novada-search__novada_extract]

## First Impression

Tool discovery via ToolSearch was clean — the schema came back with enough context to understand the right tool immediately. The `novada_extract` description is unusually good: it calls out anti-patterns ("do NOT set render='render' for all pages"), provides timing comparisons ("auto mode is 15x-113x faster for static sites"), and distinguishes when to use `novada_map` vs `novada_crawl` vs `novada_extract`. That decision-tree framing is exactly what an agent needs at tool selection time. First call worked on first try with no guessing.

## Pipeline Composability

Both extractions ran in parallel with no friction. The output format is consistent: every response has the same header block (`url`, `title`, `description`, `format`, `chars`, `links`, `mode`, `quality`, `content_ok`), followed by structured data, then markdown body, then same-domain links, then agent hints. This predictable envelope made it trivial to compose: I could parse or pass either result downstream without per-site handling logic.

The `## Agent Hints` section at the bottom is a standout composability feature. Both responses included follow-up tool suggestions (e.g., `novada_map with url="https://docs.firecrawl.dev"`). This means the tool actively helps the agent decide the next step — a genuine pipeline affordance, not just raw content dumped into a box.

One composability gap: there is no `next_page` or `truncation_token` when content hits the `max_chars` limit. The response just appends a truncation notice. For a multi-step pipeline that needs to paginate through long docs, there is no clean continuation mechanism.

## Batch Extraction

The tool description explicitly calls out batch mode: "Supports batch extraction — pass url as an array to fetch up to 10 pages in parallel." It also documents the `urls` alias param and notes the output format for batch ("one labeled section per URL"). I did not use batch mode for this task since I had only two URLs and ran them as parallel tool calls instead. In retrospect, batch would have been the idiomatic choice — a single tool call for `[https://docs.firecrawl.dev, https://docs.exa.ai]`. Discovery was easy; the description led me directly to it.

One thing that was not obvious: does batch mode return one combined markdown doc or two separate responses? The description says "Returns a structured markdown document with one labeled section per URL" — that answered it, but I had to re-read carefully. A small example showing the `### [1/2]` section header would remove any remaining doubt.

## Render Mode Decision

The guidance in the description is strong: use `render="auto"` by default, reserve `render="render"` for "JavaScript-heavy SPAs (LinkedIn, Glassdoor, React SPAs, Next.js apps)". I used `auto` for both URLs and the tool handled them correctly:

- Firecrawl docs: fetched in render mode (quality:70), no auto-escalation note — the site likely requires JS and auto detected it.
- Exa docs: explicitly flagged `auto_escalated:true` in the response header, with the agent hint "Auto-escalated to render mode (static quality score was < 40)."

The auto-escalation transparency is excellent — the agent knows exactly what happened and why. There is no ambiguity about whether the content is static or rendered. The quality score (70 vs 80) also gives a signal about output confidence.

What is missing: guidance on when to use `render="browser"` (the CDP mode). The description mentions it exists but does not say when it beats `render="render"`. An agent has to guess.

## Agent Hints Quality

The `## Agent Hints` section at the bottom of each response is genuinely useful and not just boilerplate. Specifically:

- Both responses included the correct follow-up tool (`novada_map`) with the exact URL pre-filled.
- The Exa response explained the auto-escalation decision in plain language.
- The query context echo ("Focus analysis on this topic") confirms that the `query` param was registered and may have influenced content prioritization.

One gap: neither hint mentioned that the home pages I fetched are navigation-heavy (mostly links, not prose). A hint like "This page is primarily a navigation index — consider crawling /docs/* for richer content" would be more actionable for a pipeline agent trying to ingest documentation substance.

## Output Format

The output format is excellent for agent consumption. Key strengths:

1. **Metadata header is machine-parseable**: `chars:7556 | links:55 | mode:render | quality:70 | content_ok:true` — key-value in a predictable order. An agent can extract these without regex gymnastics.
2. **Structured data block** (JSON-LD / Open Graph) is surfaced separately from body content, enabling clean field extraction without re-parsing markdown.
3. **Same-domain links** are deduplicated into a footer list, making it easy to feed into the next `novada_map` or `novada_crawl` call.
4. **Truncation is explicit**: when content is cut, a notice is appended rather than silently truncated — the agent knows it did not get the full page.

One format issue: the navigation sidebar (all the `- [Link text](url)` items) was included verbatim in both outputs, inflating character count and reducing signal density. A `strip_nav` option or a "main content only" mode would improve quality for doc ingestion pipelines.

## Comparison: Firecrawl Docs vs Exa Docs (Task Output)

**Clarity of the extracted content:**

- **Firecrawl** was clearer for quick orientation. The intro page included actual code examples for every major feature (Search, Scrape, Interact) with real API responses shown inline. An agent can understand what the product does from a single page fetch.
- **Exa** was denser but more agent-forward. The page explicitly had a section titled "For your coding agent" in the nav, and the search type comparison table (auto/instant/fast/deep/deep-reasoning with speed and use-case columns) was immediately actionable for tool selection decisions.

**Key differences:**
- Firecrawl's homepage is a product pitch + quickstart. Code samples are the first thing shown after navigation. Time-to-working-code is short.
- Exa's homepage is more reference-oriented. Less hand-holding prose, more tables and structured comparisons. Assumes the reader knows what search APIs are; skips straight to "here are the tradeoffs."
- Firecrawl metadata quality (70) vs Exa (80) — Exa's page rendered with higher content confidence despite requiring auto-escalation.
- Both sites surface `llms.txt` links in their extracted content, signaling that both are actively designed for AI/agent consumption.

**For a pipeline agent ingesting competitor docs:** Exa's structure is more pipeline-friendly (tables, consistent schema examples). Firecrawl's is more human-readable but harder to parse programmatically without the code blocks.

## Top 3 Improvements for Agent Experience

1. **Add `strip_nav` or `content_only` option.** Both doc pages returned 40-50% navigation chrome (sidebar links) before any actual content. For doc ingestion pipelines, this wastes tokens and reduces the useful content ratio within the `max_chars` budget. A parameter to return only the main content region would significantly improve extraction quality for structured sites.

2. **Clarify `render="browser"` vs `render="render"` decision criteria.** The description explains when to use `auto` vs `render` well, but `browser` (CDP mode) has no guidance on when it wins over `render`. Add a one-liner: e.g., "Use `browser` when you need DOM interaction (clicking, scrolling) before extraction; `render` is sufficient for static JS-rendered pages."

3. **Provide a `continuation_token` or `page` param for paginated content.** When a page exceeds `max_chars`, the current behavior is a hard truncation. For pipeline agents that need the full content of a long doc page, there is no way to fetch the remainder without knowing the underlying URL structure. A `page=2` or continuation token would unlock reliable full-document ingestion without requiring `max_chars=100000` as a blunt instrument.

## Overall Score (agent-friendliness): 8/10

Strong tool description, auto-escalation transparency, consistent output envelope, and agent hints that suggest next steps are all best-in-class. The main drags are nav-heavy extraction output inflating token cost, and the missing guidance on `render="browser"` that forces guesswork in edge cases.
