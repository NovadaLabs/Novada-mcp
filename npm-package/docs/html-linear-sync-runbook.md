# HTML ↔ Linear Sync Runbook (KR-4 M-4.1)

**Purpose:** Document the AI-driven workflow that keeps `~/Projects/novada-june-kr-report-2026.html` and the Linear initiative `tongwu / June 2026 Personal OKRs` in sync.

**Status:** Battle-tested across 4 sessions (2026-06-03 → 2026-06-15). Used to update KR-1 through KR-6 progress, milestones, issue states, and new issue creation — all AI-driven from a single conversational prompt.

---

## When to run

- After any significant ship (npm publish, deploy LIVE, milestone closure)
- Weekly progress review (Mon morning)
- Before sharing the KR report HTML with Ethan / leadership
- After any session that touches the underlying projects (novada-mcp, novada-mcpserver, prismma-gateway, AgentRecall, aam)

## Prerequisites

- Linear personal API key stored at `~/.config/linear/api_key` (chmod 600), auto-loaded via `~/.zshenv`
- AgentRecall MCP attached (for recall of progress notes)
- Git access to all relevant repos under `~/Projects/`

## Workflow (3 phases)

### Phase 1 — Audit (read-only, ~5 min)

1. **Pull git activity** since last sync across active repos:
   ```bash
   for repo in prismma-gateway novada-mcp novada-mcpserver agentproxy AgentRecall plywood aam; do
     cd ~/Projects/$repo && git log --oneline --since='<last sync date>' --all
   done
   ```
2. **Query AgentRecall** for any non-code progress notes per KR (`recall("KR-N <topic>")`).
3. **Pull Linear state** via GraphQL (`~/.config/linear/api_key`):
   ```graphql
   { initiative(id: "<June-OKR-id>") { projects { nodes { ... issues { nodes { ... } } } } } }
   ```
4. **Read HTML current state** (grep for `id="june-desc-pct-krN"` and `data-pct=` in the report).
5. **Verify any external endpoints** (e.g., `curl https://mcp.novada.com/mcp` for KR-5).

### Phase 2 — Synthesize delta + get human approval

For each KR, produce a table of:
- HTML current % vs Linear auto % vs reality
- Issues to close (with evidence from git/AR/live check)
- Issues to create for un-tracked shipped work
- Proposed new HTML %

**Always confirm with the user before writing.** Use a single message presenting the full delta, then wait for "confirm" / "go" / approval.

### Phase 3 — Execute (writes)

Three categories of writes, in order:

1. **Linear: close existing issues** — `issueUpdate` with `stateId` for "Done" or "In Progress"
2. **Linear: create new issues** — `issueCreate` with project + milestone + state
3. **HTML: update %** — modify `data-pct`, `data-manual-pct`, donut-label, `id="june-desc-pct-krN"`, and overall `overallLabelJune`

After writes:
- Re-pull Linear state to verify auto-progress matches expectation
- Open HTML in browser to spot-check
- Save a short summary to AgentRecall

## Key conventions

| Where | Convention | Why |
|---|---|---|
| **HTML %** | Threshold-based (manual override via `data-manual-pct`) | OUTPUT-driven OKR; checkbox auto-compute is too granular |
| **Linear %** | Auto (issue completion ratio) | Single source of truth for issue state |
| **Divergence** | Expected; HTML usually higher than Linear | HTML rewards milestone-level threshold closure; Linear counts every sub-issue |
| **Hard rules** | No git push / no npm publish / no domain change without explicit human approval | Avoids accidental ships |

## Tooling notes

- **Linear MCP connector (Anthropic-hosted, hash `74fa23e6-...`):** Flaky — returns 403 intermittently. Prefer direct GraphQL via personal API key when reliability matters.
- **The newer plugin connector (`plugin_product-management_linear`):** more stable but tools must be loaded via ToolSearch first.
- **AgentRecall MCP:** use for cross-session memory (decisions, blockers, learnings). Save key state at end of each sync session.

## Common patterns

### Pattern: "Issue is shipped but not in Linear"

Happens when an agent ships work in a session without simultaneously updating Linear. Audit phase catches this via git log + AR recall. Fix: create a new issue with `state: Done` and a clear `[M-X·OUT 2026-MM-DD]` prefix in the title.

### Pattern: "Linear auto % is much lower than HTML %"

Common — HTML uses milestone-threshold scoring, Linear counts every issue. Both are correct lenses. Resolution: keep HTML as the agreed-upon "true" OKR score; Linear as operational tracker.

### Pattern: "An issue is blocked on external party"

Mark state as `Blocked` (Incubation team's `Blocked` state id). Don't move to Done unless OUTPUT is genuinely satisfied. Track the blocker in `agent_instruction`-style title prefix: `[M-X·BLOCKED 2026-MM-DD] <thing> — blocked on <whom>`.

## File locations

- KR report HTML: `~/Projects/novada-june-kr-report-2026.html`
- This runbook: `~/Projects/novada-mcp/docs/html-linear-sync-runbook.md`
- Linear API key: `~/.config/linear/api_key` (chmod 600)
- Linear API key env loader: `~/.config/linear/env.sh` (auto-sourced by `~/.zshenv`)
- AgentRecall: `~/.agent-recall/projects/novada-mcp/`

## Linear initiative + project IDs (for scripts)

- **Initiative:** `tongwu / June 2026 Personal OKRs` — `dfd2f9e8-9137-44e5-a290-f417a3414862`
- **Team (all 6 KRs):** Incubation (`INC`) — `dd939584-f57d-436d-9ee3-347f20a3e502`
- **Workflow state IDs (Incubation team):**
  - Done: `4e0598c9-399e-4537-b9a7-57c3bc616c67`
  - In Progress: `21b843a7-5fa4-407b-9f12-639e1962b38b`
  - Backlog: `152d3416-e8e5-4349-9367-a797c61d4299`
  - Blocked: `cd802f52-c601-4a7e-bf55-b5310e58c8b6`

## Change log

- **2026-06-03** Initial scaffold (KR-1..4 in Linear, KR-5/KR-6 added)
- **2026-06-08** novada-mcp@0.8.0 published; close 5 Linear issues
- **2026-06-11** Sync after fudong unblock + landing page LIVE
- **2026-06-15** This runbook committed (closes INC-95); 4 close + 4 create
