# Loop 2 Documentation Review — R2

## PASS / FAIL (overall)

**CONDITIONAL PASS** — No blockers, but 3 quality issues need fixing before publish and 2 minor items should be addressed.

---

## Critical Issues (must fix before publish)

None. No blockers found.

---

## Quality Issues (should fix)

### Q1 — `novada_proxy` credential requirement mismatch (SKILL.md vs src/index.ts)

SKILL.md states proxy "derives from `NOVADA_API_KEY`" under the key parameters section. `src/index.ts` tool description says: "Requires NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars." `README.md` correctly reflects the latter. The SKILL.md message would mislead an agent into calling `novada_proxy` without the required env vars and getting a confusing error.

**Fix:** Change SKILL.md `novada_proxy` key parameters note to:
- Requires `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, `NOVADA_PROXY_ENDPOINT` env vars (not derived from `NOVADA_API_KEY`).

### Q2 — README.md Resources table missing `novada://scraper-platforms`

The Resources section lists only 3 URIs: `novada://engines`, `novada://countries`, `novada://guide`. The codebase registers a fourth: `novada://scraper-platforms` — and `src/index.ts` tool description for `novada_scrape` instructs agents to read it. An agent following the README resources table would not know this resource exists, yet would be told by the tool itself to "Read the `novada://scraper-platforms` MCP resource". This is a README gap, not a documentation error per se, but it creates a confusing first-discovery experience.

**Fix:** Add `novada://scraper-platforms` row to both EN and ZH README Resources tables.

### Q3 — README.md `novada_browser` actions list is incomplete vs SKILL.md

README.md `novada_browser` supported actions list:
`navigate · click · type · screenshot · snapshot · evaluate · wait · scroll`

SKILL.md `novada_browser` supported actions list:
`navigate, click, type, screenshot, aria_snapshot, evaluate, wait, scroll, hover, press_key, select`

`src/index.ts` tool description confirms the longer list (aria_snapshot, hover, press_key, select are all listed). README is missing 4 actions and uses `snapshot` instead of `aria_snapshot`. An agent using README as its guide would not know it can `hover`, `press_key`, or `select` — and the action name mismatch (`snapshot` vs `aria_snapshot`) could cause a hard error if the agent uses the README variant.

**Fix:** Sync README action list to match SKILL.md / src/index.ts.

---

## Minor Observations

### M1 — Test badge: 443 vs 444

The brief notes 444 total (443 passing + 1 pre-existing failure). Showing 443 is the better choice — it represents passing tests, which is the signal users and agents care about. 444 would include a known failure, which is misleading. Current badge (443) is correct.

### M2 — README.zh.md still reflects old (pre-v0.8) content in some sections

The ZH README still has the `v0.7.0 更新内容` section referencing "124 个测试" which contradicts the updated badge (443 tests). The update section itself is stale and creates inconsistency for a Chinese reader who reads the update log vs the badge. Either remove the stale update section or update it to v0.8.x to match the EN README, which has no such section.

---

## File-by-file Notes

### SKILL.md

Structurally solid. Decision tree is clear and covers all 11 tools correctly. The `unblock` vs `browser` decision guidance is correct: use `novada_unblock` for raw HTML, `novada_browser` for interaction. The `novada_scrape` vs `novada_extract` guidance is correct: scrape for known platforms with structured data, extract for general pages.

The `novada_proxy` description in SKILL.md (line ~180) contains a factual error on credentials — see Q1. The "derives from `NOVADA_API_KEY`" claim is contradicted by the actual implementation. Every other tool section checks out against `src/index.ts`.

One cosmetic note: the `novada_health` example shows `{}` as the invocation — this is accurate (no required params) and useful for agents.

### README.md

Badges are correct: `tools-11` and `tests-443` and `NovadaLabs/novada-search`. The simplified install command `claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-search` is syntactically correct for Claude Code's `mcp add` command (flag `-e` sets env vars, `--` separates command args). The "Quick Install" section matches the "Quick Start > Claude Code" section.

Platform count discrepancy: `novada_scrape` tool description in `src/index.ts` says "129 platforms", but README.md comparison table says "65+ platforms" in two places, and SKILL.md says "129 platforms". The README comparison table is stale at "65+". This should say "129 platforms" to match src and SKILL.md.

Missing `novada://scraper-platforms` resource — see Q2.

`novada_browser` actions list incomplete — see Q3.

### README.zh.md

Badges correctly updated to `工具数-11` and `测试用例-443`, and GitHub star badge now points to `NovadaLabs/novada-search`. These three W2A changes are accurate.

However, the ZH README is structurally older than the EN README: it lacks the full tool sections for `novada_proxy`, `novada_scrape`, `novada_verify`, `novada_unblock`, `novada_browser`, and `novada_health`. The EN README has dedicated parameter tables for all 11 tools; the ZH README only covers the original 5. This was not part of W2A's stated scope, but an agent reading the ZH README would have no guidance on 6 of the 11 tools. This is a pre-existing gap, not a W2A regression.

The `v0.7.0 更新内容` section still references 124 tests — stale, see M2.
