# CODEX-04-IMPL — research: standardize output format

## Role
Codex implementer. Shell + file access.

## Repo
cd /Users/tongwu/Projects/novada-mcp

## Problem
`novada_research` output format is unpredictable. Sometimes pure prose, sometimes headers,
sometimes mixed. Piping to other tools or parsing in multi-step agent workflows fails.

## Investigation first
```bash
cat src/tools/research.ts | head -100
```
Understand how output is currently assembled and returned.

## Task — enforce output structure

The final returned string must ALWAYS have these sections in this order:

```
## Research: {topic}

**Query**: {query}
**depth**: {depth}
**sources_searched**: {N}
**timestamp**: {iso_timestamp}

---

## Summary
{1-4 sentence synthesis. If unavailable: "Synthesis unavailable — see raw findings below."}

## Key Findings
- {finding 1}
- {finding 2}
(If none: "- No structured findings extracted.")

## Sources
- {url} — {title or domain}
(If none: "- No sources fetched.")

## Agent Hints
- {hint 1}
- {hint 2}
(Always at least 1 hint present.)

## Agent Notice — Coverage
requested_depth: {depth} | sources_found: {N} | synthesis: ok | failed
```

### How to implement
Find where the function builds and returns its output string. Wrap/reformat it to match above.
If research returns a plain string, put it in `## Summary` and use fallback values for other sections.
If research returns structured data, map it to the sections above.

`timestamp = new Date().toISOString()` at return time.

## Build & verify
```bash
npm run build
```
Exit 0 required.

## Constraints
- Do NOT change research logic (API calls, source fetching, depth handling)
- Only change output assembly
- Only touch: src/tools/research.ts
- No new npm packages
