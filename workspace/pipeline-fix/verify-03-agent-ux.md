# Agent UX Verification: Dual-Output Design
Date: 2026-06-26

---

## Live Test Result (HN extract, format:markdown, render:auto)

```
FIRST 5 lines:
## Extracted Content
url: https://news.ycombinator.com
mode: static | source: live | quality:45/100 (moderate) | content_ok:true
fetched_at: 2026-06-26T09:02:13.359Z
extraction_quality: n/a

LAST 5 lines:
## Agent Action
agent_instruction: status:success quality:45/100 | next: novada_map for related pages | next: novada_research for multi-source analysis

---
Output saved: /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_news_ycombinator_com_110214210.md
```

Total: 164 lines, 15,484 chars.

---

## Q1: Will agents know what output_formats to use?

VERDICT: **BAD** — the parameter does not exist.

The proposed "output_formats" or "save_formats" param is not implemented. There is only one
`format` param, which controls the MCP response format (text/markdown/html/json). The file save
is always automatic and always mirrors that same format: markdown response → .md file, json
response → .json file. The agent has zero control over what gets saved.

The current `format` param description is:
```
Output format. 'markdown' (default): structured readable output. 'text': plain text.
'html': raw HTML (truncated at 10K). 'json': structured JSON object with typed fields —
best for programmatic agent consumption.
```

This is clear about what the RESPONSE looks like. But it says nothing about file side effects.
An agent reading this description would have no idea that calling `format:"json"` also saves a
.json file to ~/Downloads.

Ideal description snippet for the param if dual-output is formalized:

```
format: Controls both the MCP response format AND the format of the automatically saved file.
  'markdown' (default): agent gets clean text response; file saved as .md
  'json': agent gets structured JSON object; file saved as .json with full metadata
          (title, content, links, quality, structured_data, hints)
  'html': agent gets raw HTML (truncated to 10K in response); file saved as .html (full)
  'text': plain text in response; file saved as .md

Use 'json' when you need structured fields (price, title, availability) to parse programmatically.
Use 'markdown' when you need content for direct reading or summarization.
```

The html/json distinction is currently buried and not actionable for most agents. Most agents
default to markdown and never discover that format:"json" returns a richer object with
structured_data, quality scores, and a hints array.

---

## Q2: Does returning file paths in the response help agents?

VERDICT: **NEEDS_CHANGE** — current string append is worse than useless.

Current behavior: `mdOutput += "\n\n---\nOutput saved: /Users/tongwu/Downloads/..."`

This is a plain string appended after the markdown content. Problems:

1. It leaks a user's local filesystem path into the agent context — only relevant on that
   specific machine. Agents running in CI or remote environments will get a wrong path.
2. It is the LAST line of a 164-line response. Agents that truncate or summarize the tail will
   miss it entirely.
3. "Output saved: /path/to/file" communicates nothing about what the agent can DO with that
   path. An agent cannot tell a user "your file is at X" because the agent doesn't know if
   the user is on that machine.

The json format is better: it injects `output_saved` as a field INSIDE the JSON object, making
it parseable. But it still has the local-path problem.

Recommended design — structured `saved_files` section:

```
## Saved Files
md_path: /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_news_...md
```

Or better, for the json format, add a `saved_files` key with all available paths:

```json
"saved_files": {
  "md": "/Users/tongwu/Downloads/.../extract_news_ycombinator_com_110214210.md"
}
```

For the markdown format, keep the save line but move it UP — put it in the header block
alongside url/mode/quality, not appended at the tail. Agents read headers; they skip tails.

The structured data option (returning `{ md_path, html_path, json_path }`) is overkill unless
you plan to save multiple formats per call. Currently each call saves exactly one file.
The current `output_saved` key in json is the right structure — it just needs to move earlier
and be surfaced in the markdown header too.

---

## Q3: Is the two-output separation clear enough?

VERDICT: **NEEDS_CHANGE** — structurally fine, but not documented for agents.

The separation is:
- Agent receives: full markdown in MCP response (what the tool returns)
- User receives: file on disk (side effect, never described anywhere in tool docs)

The problem is that this is an UNDOCUMENTED SIDE EFFECT. Nothing in the novada_extract
description mentions that a file is saved. An agent that is asked "download this page for me"
will return the MCP response text to the user, not knowing there is also a file. The user
might expect a file and be confused, or the agent might double-report.

The tool description should add one sentence:

```
Output is also automatically saved to ~/Downloads/novada-mcp/YYYY-MM-DD/ for human access.
The saved file path is returned at the end of the response.
```

The `## Agent Action` / `agent_instruction:` block at the end is well-designed. Agents read it
correctly. The `remember:` line in `## Agent Memory` is also good — it gives agents a one-line
summary to store.

The two-section tail (`## Agent Memory` then `## Agent Action`) is slightly redundant with the
header metadata. Agents that need the path would benefit from a `## Saved Files` section
between `## Agent Action` and the closing separator.

---

## Q4: Research sources — useful for agents?

VERDICT: **NEEDS_CHANGE** — sources are present but not structured for agent use.

Current research output includes a `## Sources` section as a markdown bullet list:
```
- **Title** (url) — snippet
```

The sources.json file path is returned inline: `Research saved: .../research_...json`

Problems:
1. The sources list is prose-embedded, not machine-parseable in the markdown format.
2. The saved .json file contains full research output but agents are not told the structure
   of that file or how to use it.
3. Agents can't easily reference source[N] for citation or follow-up extraction.

The sources ARE useful for agents in two scenarios:
a. Agent needs to cite claims — needs `url + title + snippet` per source
b. Agent needs to extract full content from a specific source — needs `url`

For (a), the existing bullet list works but a table is better:
```
## Sources
| # | Title | URL | Quality |
|---|-------|-----|---------|
| 1 | Hacker News | https://news.ycombinator.com | extracted |
```

For (b), the `agent_instruction` at the end already says:
```
Use `novada_extract` with specific source URLs to get full content: ...
```
This is good — keep it.

The sources.json file is purely for human verification (open in browser, inspect citations).
Agents don't need to read the file — they already have the sources inline in the response.

---

## Summary

| Question | Verdict | Severity |
|----------|---------|----------|
| output_formats param clarity | BAD — param doesn't exist, format doc doesn't mention file saves | HIGH |
| File path in response | NEEDS_CHANGE — string tail, wrong position, not structured | MEDIUM |
| Two-output separation clarity | NEEDS_CHANGE — undocumented side effect | MEDIUM |
| Research sources for agents | NEEDS_CHANGE — table > bullet list, json file is human-only | LOW |

## Recommended Changes (priority order)

1. **Add one sentence to novada_extract description**: "Output is also saved locally to
   ~/Downloads/novada-mcp/YYYY-MM-DD/ — the path is returned in the response."

2. **Move saved file info to header block** (markdown format): add `saved: <path>` line
   alongside `url:`, `mode:`, `quality:` instead of appending at tail.

3. **Document format:"json" as the agent-preferred choice** when structured data extraction
   is needed — explicitly say it returns `structured_data`, `quality`, `hints`, and
   `saved_files` as typed fields, not prose.

4. **Research sources**: change bullet list to markdown table with index column so agents
   can reference `source[1]`, `source[2]` in reasoning chains.

5. **No change needed**: the `## Agent Action` / `agent_instruction:` pattern, the
   `## Agent Memory` / `remember:` line, and the `## Agent Hints` block all work well.
   Do not restructure these.
