# Agent Brief: Verifier (Agent V)

## Role
Final gate. You verify that all identified issues are real, reproducible, and that the improvement plan covers them. You produce the final checklist that the orchestrator presents to the human for approval.

## What to Read (ALL of these)
1. docs/review/2026-04-29/report-code-quality.md
2. docs/review/2026-04-29/report-mcp-spec.md
3. docs/review/2026-04-29/report-functional-core.md
4. docs/review/2026-04-29/report-functional-advanced.md
5. docs/review/2026-04-29/review-1.md
6. docs/review/2026-04-29/review-2.md

## What to Verify

### LobeHub Score Checklist
Go through each criterion and state: current status + what file/change would satisfy it.

| # | Criterion | Current | What fixes it |
|---|---|---|---|
| 1 | Validated | ✅ | — |
| 2 | Provides Installation Method | ✅ | — |
| 3 | Includes At Least One Skill | ❌ | Create skills/novada-search/SKILL.md |
| 4 | Has README | ✅ | — |
| 5 | Offers Friendly Installation | ✅ | — |
| 6 | Has LICENSE | ⬜ | File exists — verify format |
| 7 | Includes Prompts | ⬜ | Check package.json mcp field |
| 8 | Includes Resources | ⬜ | Check package.json mcp field |
| 9 | Claimed by Owner | ✅ | — |

### Functionality Checklist
For each tool, verify status:
- WORKING: tested and confirmed
- BACKEND_ERROR: client correct, server-side issue
- MISSING_KEY: works when correct env var set
- BROKEN: client-side bug

### Issue Deduplication
Are any issues mentioned by multiple agents the same issue? Consolidate.

### Improvement Plan Completeness
Does the combined set of findings cover:
- [ ] All LobeHub score gaps
- [ ] All P0 functional bugs
- [ ] All P1 agent UX issues
- [ ] README EN/ZH consistency
- [ ] npm package metadata

### Risk Assessment
Which improvements are safe to make without risk of regression?
Which are risky and need careful testing?

## Output Format
Write to: docs/review/2026-04-29/verification.md

```
# Verification Report

## LobeHub Score Path
Current: 61/100
After fixes: estimated X/100
Criteria breakdown: ...

## Tool Status Matrix
| Tool | Status | Blocker |
|---|---|---|

## Consolidated Issue List (deduped)
### P0 — Ship Blockers
### P1 — Important  
### P2 — Polish

## Improvement Plan Coverage
[Does the plan address everything?]

## Ready for Human Approval: YES/NO
Reason: ...
```
