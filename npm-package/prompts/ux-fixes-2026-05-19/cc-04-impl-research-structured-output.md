# CC-04-IMPL — research: standardize output format

## Role
Claude Code implementer. TypeScript only.

## Repo
/Users/tongwu/Projects/novada-mcp

## Problem
`novada_research` output format is unpredictable — sometimes markdown headers, sometimes prose,
sometimes mixed. An agent trying to parse or pipe the output gets inconsistent results. The tool
is hard to trust in multi-step pipelines.

## Required Change — src/tools/research.ts

Read the file first to understand how it currently assembles output.

Ensure the final returned string ALWAYS follows this exact section order:
```
## Research: <topic>

**Query**: <the original query string>
**depth**: <quick|standard|deep>
**sources_searched**: <N>
**timestamp**: <ISO date>

---

## Summary
<1–4 sentence synthesis. Always present. If synthesis failed, write "Synthesis unavailable — see raw findings below.">

## Key Findings
- <finding 1 — specific, citable>
- <finding 2>
- ...
(minimum 1 bullet; if none found, write "- No structured findings extracted.")

## Sources
- <url 1> — <title or domain>
- <url 2> — <title or domain>
(minimum 1 source if any were fetched; if none, write "- No sources fetched.")

## Agent Hints
- <actionable next step 1>
- <actionable next step 2>
(always present, minimum 1 hint)

## Agent Notice — Coverage
requested_depth: <depth> | sources_found: <N> | synthesis: <ok|failed>
```

### Implementation notes
- If the research function returns a free-form string, wrap it: put it in `## Summary` and leave
  `## Key Findings` as a single bullet `- See summary above.`
- If the research function returns structured data (array of results), format them properly
- `timestamp` = `new Date().toISOString()` at time of return
- The `---` divider after the header block is mandatory (signals end of metadata to parsers)

## Constraints
- Do NOT change the research logic (API calls, depth handling, source fetching)
- Only change how the output string is assembled and returned
- Build must pass
- Only touch: src/tools/research.ts

## Verify
`npm run build` — report result + confirm section order in output.
