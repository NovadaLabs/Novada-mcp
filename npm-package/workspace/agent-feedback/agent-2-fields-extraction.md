# Agent-2: Fields Extraction Agent Feedback
role: structured data extraction agent
task: extract specific fields from structured pages
tools_used: [mcp__novada-search__novada_extract, mcp__plugin_novada-proxy_novada-proxy__novada_proxy_extract]

## First Impression

The tool discovery flow was clean. `ToolSearch` with "novada extract fields" returned two relevant tools immediately — `novada_extract` (novada-search MCP) and `novada_proxy_extract` (novada-proxy MCP). The `fields` parameter was clearly documented, and the `## Requested Fields` block in the output format was immediately recognizable as the structured extraction result. Zero ambiguity about where to find extracted values.

One friction point: two tools exist that both do field extraction (`novada_extract` vs `novada_proxy_extract`). Their descriptions overlap significantly. An agent picking between them has to read carefully to understand the difference is proxy type (residential proxy + render_fallback in novada_proxy_extract vs the tiered auto-escalation of novada_extract). This is not obvious at a glance.

## What Worked Well

- **GitHub extraction was accurate and fast.** All four fields (stars, language, license, description) were returned from a single static fetch with no escalation needed. The `*(pattern)*` source annotations appeared on each field.
- **Parallel execution worked without issues.** Both URLs were submitted simultaneously; the GitHub result came back quickly while Amazon retried.
- **The `## Requested Fields` block is well-structured.** Each field is on its own line, value is immediately after the colon, and the source tag is appended inline. This is easy for an agent to parse with a simple line split.
- **`agent_instruction` in error responses is excellent.** The `novada_proxy_extract` BOT_DETECTION error included a concrete next step: "Try novada_proxy_render (real browser). Or retry with a different country/session_id." This is exactly what an agent needs to self-correct.
- **Agent Hints at the bottom of each response** were useful orientation — `novada_map` suggestion with the correct domain pre-filled is a nice touch.

## What Was Confusing or Missing

- **`language` field on GitHub returned "Covers" instead of the actual primary language (TypeScript).** This is a significant extraction error. The pattern matcher hit the word "Covers" from the sentence "Covers 96% of the web" rather than the Languages section at the bottom. An agent relying on this value would produce wrong downstream data without knowing it.
- **`description` returned a feature description ("Search the web and get full content from results.") instead of the repo's About text ("Search, scrape, and clean the web for AI agents.").** This is the wrong granularity — repo About text is the canonical description, not a sub-feature caption.
- **Amazon price and rating both returned `—` (missing) even after a successful browser render.** The page loaded (title was extracted correctly), 24k+ chars of content was returned, review ratings were clearly present in the markdown body (e.g., "4.7 de 5 estrellas", "4.4 de 5 estrellas"), yet the extractor returned nothing for `rating`. This is a significant miss on a well-structured product page.
- **No geo-targeting on `novada_extract`.** The Amazon page rendered in Spanish (Latin American locale) because there is no `country` parameter on `novada_extract`, unlike `novada_proxy_extract`. This geo mismatch likely contributed to price extraction failure (price was not rendered in the Spanish locale version that was served).
- **Two tools, no clear escalation path documented between them.** The novada_proxy_extract description says "On failure without render_fallback: retry with render_fallback:true" — but it doesn't say "if that fails, use novada_extract with render=browser". An agent hitting repeated failures doesn't know whether to escalate within the same tool or switch tools entirely.
- **`quality:0` and `content_ok:false` for 404 pages are useful**, but the distinction between a genuine 404 and a bot-block returning a 404-like response was not surfaced in the `novada_extract` output. I had to call `novada_proxy_extract` to get the explicit `BOT_DETECTION_SUSPECTED` code.

## Field Extraction Quality

**GitHub (stars, language, license, description):**
- `stars: 122k *(pattern)*` — Correct value, correct source tag. 9/10.
- `language: Covers *(pattern)*` — Wrong value. Pattern matched the wrong text. This is a critical failure for an agent that needs primary language. 1/10.
- `license: GNU Affero General Public License v3 *(pattern)*` — Correct. 10/10.
- `description: Search the web and get full content from results. *(pattern)*` — Partial. This is a feature caption, not the repo About text. An agent would use this value incorrectly. 4/10.

**Amazon (title, price, rating):**
- `title: Apple AirPods Auriculares Inalámbricos... *(pattern)*` — Correct product, but localized title (Spanish). For an agent expecting an English title, this is a mismatch. 5/10.
- `price: —` — Complete miss despite page content loading. 0/10.
- `rating: —` — Complete miss. The review text contained explicit star counts (e.g., "4.7 de 5 estrellas") but the extractor returned nothing. 0/10.

**Source tag usefulness:** The `*(pattern)*` tag is honest — it signals heuristic matching rather than structured data. However it doesn't help the agent understand *why* a value might be wrong. A tag like `*(pattern:star-count-text)*` or `*(pattern:og:description)*` would help an agent triage errors. The absence of JSON-LD sourcing on Amazon is expected, but an agent can't tell whether the failure was due to geo-blocking, missing JSON-LD, or a pattern-matching gap.

## Agent Hints Quality

The hints at the bottom of each response ("To discover more pages: novada_map with url=...") are structurally good but mechanically repetitive. Every response emits the same `novada_map` suggestion regardless of whether site discovery is relevant. For a field extraction task, suggesting to crawl the entire amazon.com domain is noise.

A better hint for failed field extraction would be: "Fields [price, rating] returned empty — try `render=browser` or add `country=US` for geo-specific pricing."

The `query` context echo ("Query context: 'product title price rating'. Focus analysis on this topic.") is not actionable for the agent — it's a reflection of input, not guidance.

## Output Format

The two-section format (header metadata + `## Requested Fields` block + full markdown body) is excellent for agents. The agent can:
1. Parse the header line to check `content_ok` and `quality` before trusting body content.
2. Extract the `## Requested Fields` block for structured values without parsing the full body.
3. Fall back to scanning the body markdown if fields are missing.

One issue: the body markdown is extremely verbose for Amazon (24k chars of reviews). An agent doing only field extraction doesn't need all of this. A `fields_only` mode that suppresses the body when fields are requested would reduce context consumption significantly.

## Top 3 Improvements for Agent Experience

1. **Fix pattern matching priority for known structured fields on GitHub and Amazon.** The `language` field on GitHub should prefer the Languages sidebar section (TypeScript 66.2%) over arbitrary text matches. The `rating` field on Amazon should target the aggregate star rating element (e.g., "4.7 out of 5 stars") before returning empty. These are high-frequency extraction targets that should have domain-aware heuristics, not generic pattern matching.

2. **Add `country` geo-targeting parameter to `novada_extract`.** Currently only `novada_proxy_extract` supports `country`. Amazon, pricing pages, and localized product data require geo control to return meaningful values. An agent using `novada_extract` has no way to force a US-locale response, which causes price/rating fields to either be absent or localized incorrectly.

3. **Suppress body content when `fields` are requested and `content_ok:false` or when fields are all populated.** Returning 24,000 characters of review text when the agent only asked for `title`, `price`, `rating` burns tokens without benefit. Add a `fields_only: true` option (or make it default when `fields` param is used) that returns only the `## Requested Fields` block plus the metadata header, skipping the full body.

## Overall Score (agent-friendliness): 5/10

GitHub extraction is solid (3/4 fields correct), the output format is well-designed for agent parsing, and the error messages with `agent_instruction` are genuinely helpful. But Amazon extraction (0/2 critical fields on price and rating) is a significant gap — product pages are a primary use case for structured field extraction. Combined with the wrong `language` value on GitHub and the lack of geo-targeting on `novada_extract`, an agent cannot reliably trust field extraction results without adding a verification layer, which defeats the purpose of the tool.
