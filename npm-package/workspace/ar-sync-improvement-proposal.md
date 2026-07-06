# AgentRecall ↔ Local Memory Sync — Improvement Proposal

## Problem Statement

AgentRecall journal 和 local .md memory 是两个独立系统，没有同步机制。
- AR journal: `session_end()` 自动写，始终最新
- Local .md: 需要 agent 手动 `Write()` 更新，经常忘记 → 过时

实际案例：2026-06-24，`project_novada_mcp.md` 还写着 v0.7.9 / 11 tools（5月27日），而 AR journal 已正确记录 v0.8.1 / 40+ tools。28 天的信息差。

## 三个改进方案

### 方案 A：session_end PostToolUse Hook（推荐）

在 `~/.claude/settings.json` 的 hooks 里加一个 PostToolUse hook：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__agent-recall__session_end",
        "command": "echo 'AR_SYNC: session_end completed — check if local .md files need updating'"
      }
    ]
  }
}
```

或者更智能：写一个脚本 `~/.claude/hooks/ar-sync-local-memory.sh`：

```bash
#!/bin/bash
# After session_end, remind agent to sync local memory
# This runs as a hook output that the agent sees

MEMORY_DIR="$HOME/.claude/projects/-Users-$(whoami)/memory"
JOURNAL_DIR="$HOME/.agent-recall/projects/*/journal"

# Find .md files older than 7 days
STALE=$(find "$MEMORY_DIR" -name "project_*.md" -mtime +7 -exec basename {} \; 2>/dev/null)

if [ -n "$STALE" ]; then
  echo "⚠️ STALE LOCAL MEMORY FILES (>7 days old):"
  echo "$STALE"
  echo "Consider updating these .md files with current project state from AR journal."
fi
```

### 方案 B：session_start 时的 Stale Detection

在 AR 的 `session_start` response 里加一段：

```
# In AgentRecall session_start logic:
for each local project .md file:
  if file.age > 7 days:
    compare file.description vs latest AR journal entry
    if version/status mismatch:
      warn: "project_novada_mcp.md says v0.7.9 but AR journal says v0.8.1 — UPDATE NEEDED"
```

这样每次 session 开始时 agent 就知道哪些 memory 是旧的。

### 方案 C：AR session_end 自动回写

最彻底的方案：`session_end()` 时，AR 自动解析 summary 里的 project state 变更，回写到对应的 local .md 文件。

```python
# In session_end handler:
summary = parse_summary(user_summary)
project_slug = detect_project(summary)  # e.g., "novada-mcp"
memory_file = f"~/.claude/projects/-Users-{user}/memory/project_{project_slug}.md"

if os.path.exists(memory_file):
  current = read_frontmatter(memory_file)
  changes = detect_state_changes(current, summary)
  # e.g., version 0.7.9 → 0.8.1, tools 11 → 40+
  if changes:
    update_frontmatter(memory_file, changes)
    log(f"Auto-synced {len(changes)} fields in {memory_file}")
```

## 推荐优先级

| 方案 | 实现难度 | 效果 | 推荐 |
|------|---------|------|------|
| A (Hook 提醒) | 低（配置文件改动） | 中（提醒但不自动修） | ✅ 先做这个 |
| B (Stale 检测) | 中（AR 代码改动） | 高（每次 session 提醒） | ✅ 第二步 |
| C (自动回写) | 高（需要 .md 解析） | 最高（全自动） | 长期目标 |

## 额外建议：Stale 标记机制

在 local .md 文件的 frontmatter 里加 `last_verified` 字段：

```yaml
---
name: novada-mcp
description: ...
type: project
last_verified: 2026-06-24
stale_after_days: 14
---
```

任何读取 .md 的 agent 都能检查：`if today - last_verified > stale_after_days: warn("stale memory")`
