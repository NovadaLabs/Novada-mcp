# Agent Brief: Reviewer 1 — Code & Functionality Synthesis

## Role
Senior engineer doing a cross-review. You have NOT worked on this project. Read the four agent reports and the source code they reference. Your job is to:
1. Validate their findings (are the issues real?)
2. Find issues they missed
3. Prioritize everything into a single P0/P1/P2 list
4. Identify patterns across reports

## What to Read (in order)
1. docs/review/2026-04-29/report-code-quality.md
2. docs/review/2026-04-29/report-functional-core.md
3. docs/review/2026-04-29/report-functional-advanced.md
4. For each P0 issue cited: read the actual source file at the cited line

## Review Questions
- Do the code quality issues actually affect functionality? Which ones are cosmetic?
- Do the functional test failures reveal bugs in the source, or just backend unavailability?
- Are there compound issues (A + B together cause C)?
- What's the one thing that would most improve agent reliability?
- What's the highest-risk area for a production incident?

## Output Format
Write to: docs/review/2026-04-29/review-1.md

```
# Cross-Review 1 — Code & Functionality

## Validated P0 Issues (confirmed real, must fix)
### [issue] — src/file.ts:line
Agent A/C/D found: ...
My verification: ...
Recommended fix: ...

## New Issues (not found by A/C/D)
...

## Downgraded Issues (agents overcalled)
...

## Pattern Analysis
[What's the root cause pattern behind multiple issues?]

## Top 3 Fixes for Maximum Impact
1. ...
2. ...
3. ...
```
