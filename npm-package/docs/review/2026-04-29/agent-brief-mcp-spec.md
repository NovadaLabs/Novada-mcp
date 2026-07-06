# Agent Brief: MCP Spec Reviewer (Agent B)

## Role
MCP protocol expert + AI agent UX specialist. You evaluate MCP servers from the perspective of: can an LLM use this correctly on first try, without reading docs?

## Project
novada-search v0.8.3 — MCP server for web intelligence.
Location: ~/Projects/novada-mcp/

## Task
Review the MCP interface layer (tool descriptions, schemas, resources, prompts) for agent-usability, completeness, and consistency. This is NOT a code quality review — it's a UX review for AI agents.

## What to Read
1. src/index.ts — tool registration, description strings
2. src/tools/types.ts — all Zod schemas (these become the tool JSON schema LLMs see)
3. src/resources/index.ts — MCP resources
4. src/prompts/index.ts — MCP prompts
5. README.md top 100 lines — what the human-facing docs say
6. The actual tool implementations (skim only): src/tools/*.ts

## What to Check

### Tool Descriptions
- Are tool descriptions ≥ 2 sentences that tell an LLM WHEN and WHY to use each tool?
- Do they include concrete examples of use cases?
- Do they mention what NOT to do (disambiguation from similar tools)?
- Is there a clear decision guide for overlapping tools (e.g., extract vs crawl vs unblock)?

### Parameter Schemas
- Are all parameters documented with `.describe("...")`?
- Are enum values self-explanatory?
- Are defaults documented?
- Are required vs optional parameters clearly separated?
- Any parameter name that would confuse an LLM (ambiguous names)?

### Error Messages (Agent-Facing)
- When a tool fails, does the error message tell the agent what to do next?
- Do error messages reference which parameter was wrong?
- Is there an `agent_instruction` field in error responses?

### Resources
- What resources are available? Are they useful for agents?
- Do resource names follow `novada://` URI scheme?
- Is the content structured (JSON/markdown tables) or just prose?

### Prompts
- What prompts are available? Are they useful?
- Do prompts include variable injection placeholders?

### Consistency Issues
- Tool naming: all tools named `novada_*`?
- Parameter naming: is `url` always called `url` and not `link` or `uri`?
- Format parameter: is `format` consistent across all tools that return text?
- Output format: do all tools return structured strings vs raw objects consistently?

### Missing Tools / Gaps
- Is there a tool that should exist but doesn't?
- Is there functionality that exists but isn't exposed as a tool?
- Are there redundant tools that could be merged?

### LobeHub Score Criteria (evaluate against these)
- Does the manifest declare prompts and resources?
- Is there a skill.md?

## Output Format
Write to: docs/review/2026-04-29/report-mcp-spec.md

Structure:
```
# MCP Spec Review — Agent B

## Agent UX Issues (P0 — agent will fail on first try)
### [Issue]
Current: ...
Fix: ...

## Agent UX Issues (P1 — agent will struggle or make wrong choices)
...

## Missing Pieces
...

## Consistency Issues
...

## Resource/Prompt Quality
...

## LobeHub Gaps
...

## Summary
```
