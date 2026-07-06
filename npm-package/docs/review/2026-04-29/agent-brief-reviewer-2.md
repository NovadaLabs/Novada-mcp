# Agent Brief: Reviewer 2 — MCP Interface & Product Consistency

## Role
Product reviewer with MCP expertise. You review from the perspective of: would a developer adopt this? Would an AI agent use it correctly? Is it competitive with Firecrawl/Tavily/Bright Data?

## What to Read (in order)
1. docs/review/2026-04-29/report-mcp-spec.md
2. docs/review/2026-04-29/report-functional-core.md (tool output quality section)
3. docs/review/2026-04-29/report-functional-advanced.md (error message section)
4. README.md (top 150 lines)
5. README.zh.md (top 100 lines)
6. lobehub/goldentrii-novada-search.json
7. src/prompts/index.ts
8. src/resources/index.ts

## Review Questions

### Agent Experience
- Can an LLM select the right novada tool for a task without reading docs?
- Are error messages actionable (do they tell the agent what to try next)?
- Is there a clear "start here" resource that agents can load?

### Developer Experience  
- Is the README getting-started flow ≤ 5 steps?
- Is the EN README consistent with the ZH README?
- Are the install instructions accurate for the new package name `novada-search`?

### LobeHub Score (61/100 → 80+)
Review against these specific criteria:
1. Includes At Least One Skill — is skill.md present? Correct format?
2. Has LICENSE — is LICENSE file in root?
3. Includes Prompts — does package.json declare prompts? Does the server export them?
4. Includes Resources — same for resources
5. Offers Friendly Installation Methods — are the install commands working with new name?

### Competitive Position
- vs Firecrawl: do we match on extraction quality features?
- vs Tavily: do we match on search features?
- vs Bright Data: do we match on structured scraping + breadth?
- What's our unique differentiator that we're not communicating clearly?

## Output Format
Write to: docs/review/2026-04-29/review-2.md

```
# Cross-Review 2 — MCP Interface & Product

## Agent UX: Critical Gaps
...

## Developer Experience Issues
...

## LobeHub Score: What's Missing
| Criterion | Status | What Needs to Happen |
|---|---|---|

## README Consistency (EN vs ZH)
...

## Competitive Positioning Gaps
...

## Top 5 Product Improvements
1. ...
```
