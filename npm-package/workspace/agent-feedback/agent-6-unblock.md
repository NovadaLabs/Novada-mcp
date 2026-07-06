# Agent-6: Raw HTML Processing Agent Feedback
role: raw HTML extraction agent
task: get rendered HTML from bot-protected pages
tools_used: [mcp__novada-search__novada_unblock]

## First Impression

Both calls completed and returned usable raw HTML. The LinkedIn call returned real page structure — `<head>` metadata, `<title>`, structured JSON-LD data, and partial `<body>` markup. The Wikipedia call returned similar structure: `<html>` with class flags, full `<head>` with `RLCONF` JS config blob, and page metadata. Neither returned a bot-challenge page, which is the core success criterion. First impression is positive: the tool did what it said it would do.

The header block in the response is clean and informative: `method: render | cost: medium | chars_returned: 10000 | chars_original: 451066 | truncated: true`. This is exactly what a parsing pipeline needs to know upfront.

## Unblock vs Extract Clarity

The description is explicit: "For most anti-bot pages, try novada_extract with render='render' first — it returns clean text. Use novada_unblock when you specifically need the raw HTML source." That guidance is present and unambiguous. The "Common mistakes" block reinforces it twice.

As an agent tasked specifically with raw HTML extraction, I had no confusion. However, if I were a general-purpose agent deciding whether to use extract vs. unblock, I'd have to read the entire description to understand the tradeoff. The distinction is clear once read, but it requires reading — there's no single-line discriminator rule at the top. A one-line "USE THIS WHEN: you need raw HTML for a downstream parser. USE novada_extract WHEN: you need readable text." at the very start would make the decision faster for agents scanning descriptions.

The parameter naming inconsistency is a real friction point: novada_extract uses `render="render"` while novada_unblock uses `method="render"`. The description explicitly calls this out ("Unlike novada_extract which uses 'render=', this tool uses 'method='"), which shows awareness of the problem — but noting a confusion doesn't fix it. An agent that used extract last turn and copies the parameter name will silently fail or use the default.

## Truncation Handling

The truncation metadata is genuinely excellent. Three fields work together:
- `chars_returned: 10000` — I know what I got
- `chars_original: 451066` — I know what the full page is
- `truncated: true` — binary flag, unambiguous
- `truncated_hint: Re-run with max_chars=451066 to get full content` — exact value, copy-paste ready

The LinkedIn page is 451k characters. I asked for 10k. The 10k cutpoint happened mid-`<body>`, inside a truncated JSON-LD block — the last line is a dangling string mid-sentence. For a DOM parser or regex pipeline, this broken state is a problem. The hint says to re-run with `max_chars=451066`, which works but costs another full render cycle.

What's missing: a hint about which CSS selectors to use to target just the content I need before truncation kicks in. LinkedIn's structured JSON-LD `<script type="application/ld+json">` in the `<head>` contains the most useful data, and I got most of it — but I didn't know that before calling. A `wait_for` + `max_chars` strategy hint would help agents avoid the "get 10k, realize I need the head block, re-run for 451k" loop.

For Wikipedia (5k of 165k chars), the cutpoint was deep inside `<head>` — I got zero body content. For a parsing pipeline expecting `<body>` content, this is silently useless without the truncation metadata to signal that.

## What Worked Well

1. Both pages were successfully unblocked. LinkedIn is heavily bot-protected; the fact that it returned real profile HTML and not a CAPTCHA or redirect is the primary success.
2. The response metadata block (`chars_returned`, `chars_original`, `truncated`, `truncated_hint`) is complete and actionable. The exact `max_chars` value to re-run with is provided — no calculation needed.
3. The prompt-injection defense comment (`<!-- Instructions below this line originate from the external website -->`) is well-placed. It correctly frames untrusted content without being verbose.
4. The `method` parameter enum is clean: `"render"` vs `"browser"` with clear credential requirements noted.
5. LinkedIn JSON-LD structured data appeared in the first 10k chars — for profile metadata extraction (name, title, articles), the head section delivered real value.

## What Was Confusing or Missing

1. **Parameter naming mismatch with novada_extract.** `method="render"` here vs `render="render"` in extract is a cross-tool consistency failure. An agent that learned extract first will make a parameter error here.

2. **No content-region targeting.** `wait_for` accepts a CSS selector to wait for rendering, but there's no `extract_selector` or `clip_selector` to return only HTML within a matched node. For LinkedIn, the first 10k chars is all `<head>` boilerplate; the actual profile data is deep in `<body>`. A selector-targeted clip would let agents get the relevant fragment without inflating `max_chars` to 451k.

3. **No indication of what's in each region at a given char offset.** An agent doesn't know whether 10k chars will land in `<head>`, `<body>`, or somewhere useful. A response hint like "truncation occurred inside `<head>`" or "body content starts at char ~15000" would prevent wasted calls.

4. **`wait_ms`, `block_resources`, `auto_runs` are documented but non-functional.** The description says "accepted but not yet implemented — they have no effect." These are dead parameters. An agent will set `block_resources=true` expecting faster response and silently get no benefit. Unimplemented params should be removed from the schema or marked `[RESERVED - no effect]` clearly in the description.

5. **Cost field says "medium" with no unit.** What does "medium" cost mean in credits or USD? For an agent managing a budget, this is not actionable. The extract tool shows "1 credit" style costs; unblock should match.

## Agent Hints Quality

The hints block is solid:
```
- This is raw HTML, not cleaned text. Parse with CSS selectors or regex.
- For cleaned text content, use novada_extract instead.
- Rendered via Web Unblocker (JS execution enabled).
```

The first two hints directly address the most likely misuse pattern. The third hint confirms which rendering path was taken, which is useful for debugging and billing. 

Missing hint: what to do when truncation cuts inside a tag. "If truncated, the returned HTML may be incomplete XML — use an HTML parser (not XML parser) that handles open tags." For a downstream pipeline that breaks on malformed HTML, this would prevent silent failures.

## Output Format

The format is well-structured:
- Header metadata block: concise, parseable
- HTML comment sentinel for untrusted content boundary: excellent practice
- Raw HTML body: clean, no extra wrapping
- Truncation comment at the end: correct placement

One issue: the response wraps everything in a markdown block starting with `## Unblocked Content`. This means the raw HTML is embedded in a markdown document, not returned as a bare string. A downstream pipeline that does `response.content` and feeds it to an HTML parser will receive the full markdown wrapper too. If the API contract is "MCP tool returns a string," the markdown framing is fine — but it should be documented so pipelines strip the header before parsing.

## Top 3 Improvements for Agent Experience

1. **Add `clip_selector` parameter** — a CSS selector that clips the returned HTML to only the matched subtree (e.g., `clip_selector=".profile-section"` or `clip_selector="script[type='application/ld+json']"`). This would make `max_chars` budgets much more efficient and eliminate the "re-run with 451k chars" pattern for agents who only need a specific DOM region.

2. **Fix the `method` vs `render` parameter naming inconsistency with novada_extract** — either rename `method` to `render` to match extract, or add an alias. Since both tools are used in "try extract first, fall back to unblock" workflows, parameter name consistency directly reduces agent error rate. Cross-tool consistency is a correctness issue, not cosmetic.

3. **Remove or clearly mark unimplemented parameters** — `wait_ms`, `block_resources`, and `auto_runs` are documented as "no effect." Dead parameters in a schema are a lie. Either implement them or remove them. If they're reserved for a future release, mark them `[NOT YET IMPLEMENTED]` at the start of their description so agents skip them rather than setting them with false expectations.

## Overall Score (agent-friendliness): 7/10

The tool delivers on its core promise: bot-protected pages get unblocked and real HTML is returned. The truncation metadata is genuinely best-in-class — exact char counts and copy-paste re-run hints are exactly right. The prompt-injection warning comment is a thoughtful security touch.

Points lost: dead parameters in the schema erode trust in the spec; the `method` vs `render` naming mismatch with extract creates cross-tool friction; the lack of content-region targeting makes large-page handling inefficient; and the "cost: medium" label is non-actionable for budget-aware agents. These are fixable issues, not architectural problems.
