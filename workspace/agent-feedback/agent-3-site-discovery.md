# Agent-3: Site Discovery Agent Feedback
role: site mapping and crawling agent
task: discover site structure and extract multi-page content
tools_used: [novada_map, novada_crawl]

## First Impression

Both tools loaded with clear schemas and were callable on the first try without confusion. The parameter names were self-explanatory (`max_pages`, `max_depth`, `strategy`, `render`). Running both in parallel was straightforward since their inputs were independent. No authentication friction — just pass a URL and go.

## What Worked Well

- **novada_map** delivered 50 URLs almost instantly via sitemap discovery. The response header told me how URLs were discovered (`discovery:sitemap`), which is useful — I know the data came from a fast path, not a slow crawl.
- URL list was clean, deduplicated, and well-organized. Hierarchical patterns (e.g., `/alternatives/firecrawl-vs-*`, `/use-cases/*`) were immediately legible.
- **novada_crawl** returned 3 pages with `words`, `depth`, and `failed` counts in the header. `failed:0` gave me confidence the crawl succeeded cleanly.
- The BFS traversal was transparent: depth:0 for root, depth:1 for linked pages. I could verify the traversal logic at a glance.
- Both tools appended **Agent Hints** at the bottom pointing to follow-up tools (`novada_extract`, `novada_crawl`). This is extremely useful — it removes the guesswork about what to do next.
- The `render: auto` mode on crawl escalated silently for JS-heavy pages — I didn't have to pre-decide render mode, which is good default behavior.

## What Was Confusing or Missing

- **novada_map** returned `www.firecrawl.dev` URLs even though I passed `https://firecrawl.dev` (no `www`). This is fine for humans but could cause downstream issues if an agent deduplicates by exact URL string match.
- **novada_crawl** content for the homepage (`depth:0`) included garbled/obfuscated strings like `"url": "h=t*A:!/z!aap?A-cZz"` inside a code block. It's unclear if this is intentional site content (e.g. a marketing visual), a rendering artifact, or a scraping glitch. No agent hint explains this. An agent without context might interpret this as a data quality failure.
- The crawl returned very low word counts: 274 words for the homepage, 63 for the pricing page. The pricing page content was essentially just headings with no actual pricing data. An agent tasked with competitive pricing analysis would get nothing actionable from this — and there's no warning that the content is shallow.
- No signal about whether `render:auto` actually escalated to JS rendering for any of the 3 pages. The agent has no visibility into what happened under the hood.
- `novada_map` did not return a `failed` or `partial` field — if sitemap parsing partially failed or returned stale entries, the agent has no way to detect it.

## Map vs Crawl Clarity

The descriptions are directionally correct but have a clarity gap:

- **novada_map**: described as "URL discovery without content" — this was accurate and clear. The `discovery:sitemap` label in the output reinforced that this is a fast path. I understood when to use it: before deciding which pages to read.
- **novada_crawl**: described as "content from multiple pages when you don't have the URLs yet" — this framing is slightly off. I often have the URLs (from map) but still want batch content extraction. The description nudges agents away from using crawl post-map, when that's actually a valid workflow.
- The "Common mistakes" section in the crawl description was genuinely helpful: it explicitly told me not to use crawl for a single page. That kind of negative instruction is rare and valuable.
- One gap: there's no description of what crawl returns *structurally* (e.g., does it return markdown? does it include metadata per page?). I had to infer from the output format.

## SPA/JS Site Handling

- `render: auto` is a good default — it removes a decision point for agents.
- However, the firecrawl.dev homepage appeared to be a React SPA, and the crawl still returned sparse, low-word-count content that suggests JS rendering may not have fully resolved the page. There was no output flag like `rendered: true/false` per page to confirm whether escalation happened.
- The fallback hint ("try render='render' explicitly") exists in the tool description but not in the output when sparse content is detected. An agent would need to proactively notice that word counts are low and re-run with `render: render` — there's no automatic suggestion to do so.
- The garbled code snippet on the homepage (`h=t*A:!/z!aap?A-cZz`) is suspicious and could indicate a partial JS render or an intentional obfuscation on the site. Either way, the agent gets no guidance on how to interpret or handle it.

## Agent Hints Quality

The Agent Hints blocks at the end of each response are the strongest agent-facing feature. They are:
- Concise and actionable
- Tool-specific (name the next tool to call)
- Contextual (map hints mention `novada_extract` with URL array syntax; crawl hints suggest doing map first)

What's missing:
- **Conditional hints**: hints don't adapt to what was found (e.g., "content was sparse — consider re-running with render='render'")
- **No hints about failures or edge cases**: if a page had 0 words or if there were redirect chains, a hint would help the agent respond
- The crawl hint says "For targeted extraction, use novada_map first then novada_extract on chosen pages" — but I already ran map. A smarter hint would say "You have content from 3 pages. To read more, pick URLs from novada_map results and call novada_extract."

## Output Format

- Map output: clean numbered list, easy to parse or copy-paste into a follow-up call. The metadata header (root, urls count, discovery method) is compact and useful.
- Crawl output: Markdown with fenced sections per page. `[N/N]` numbering, title, depth, and word count per section is exactly what an agent needs to track which pages were fetched.
- Both formats are agent-friendly: structured enough to parse programmatically, readable enough to reason about directly.
- One formatting issue: the crawl output duplicates heading text (`## Flexible pricingFlexible pricing`) — this appears to be a rendering artifact where `<h2>` and an adjacent span both got extracted. It's visually confusing but not blocking.

## Top 3 Improvements for Agent Experience

1. **Add per-page render status in crawl output**: Include a `rendered: true/false` flag per page in the crawl response. When `render:auto` escalates, agents should know. This also helps diagnose low word-count pages — was it a render failure or just a thin page?

2. **Surface sparse-content warnings as inline hints**: When a crawled page returns fewer than ~100 words (likely a JS-gated page or a block), automatically append a per-page hint: "Low content detected — re-run with render='render' or check if authentication is required." Agents need proactive guidance, not silent failures.

3. **Disambiguate the crawl description from the post-map workflow**: The current description implies crawl is only for "when you don't have URLs yet." Add explicit language: "Also use novada_crawl when you have a list of related URLs and want batch content in one call." This closes the gap between map→crawl workflows and prevents agents from defaulting to N sequential novada_extract calls when crawl would be faster.

## Overall Score (agent-friendliness): 7/10

Strong fundamentals — fast sitemap discovery, clean output formatting, and the Agent Hints blocks are genuinely excellent. The gaps are around observability (no render status, no sparse-content warnings) and documentation precision (crawl description framing, post-map workflow guidance). An agent can complete most tasks without hitting blockers, but will silently get low-quality content on JS-heavy sites without knowing it.
