# R2 Review — novada_extract Description Update

**File:** `src/index.ts` lines 163–181
**Source grounded:** Yes — `src/tools/extract.ts`, `src/utils/output.ts`, `src/tools/types.ts` all read before verdict.

---

## Verdict: REQUEST_CHANGES

Two issues must be fixed before merge. Neither is blocking-severity, but one is a factual inaccuracy and one is a structural placement problem that will cause agents to miss the CRITICAL block.

---

## Issues

### [HIGH] CRITICAL block placed at bottom — agents that truncate long descriptions will never see it

**Location:** `src/index.ts:173–179`

The description is 17 lines long. The `**CRITICAL — Format Selection:**` block is placed at the very end (lines 14–17 of the description). MCP clients and agent tool-selection pipelines typically use only the first 3–5 lines of a tool description for routing decisions. An agent reading a truncated description will see "Leave render=auto" and nothing about format selection — exactly the guidance gap the CRITICAL block is meant to close.

The "Results auto-saved" notice (line 166) is also placed before the core use-case guidance, which pushes the `**Use for:**` and `**Key rule:**` blocks even further from top.

**Fix:** Restructure order:
1. First sentence (what it does / escalation)
2. CRITICAL block
3. Use for / Not for
4. Key rule (render)
5. Auto-save notice (informational, not decision-critical)

---

### [HIGH] `format="json"` field list is inaccurate — description claims `{title, content, quality, links, structured_data, hints}` but actual output has more fields

**Location:** `src/index.ts:175`

Description says:
```
`format="json"`: structured object `{title, content, quality, links, structured_data, hints}`.
```

Actual JSON object (from `extract.ts:612–633`) includes additional top-level fields:
- `url` — always present
- `description` — always present (null if empty)
- `mode` — render mode used (static/render/browser)
- `source` — "live" or "wayback"
- `fetched_at` — ISO timestamp
- `fields` — field extraction results (null if not requested)
- `remember` — agent memory hint string
- `output_saved` — file path (added on line 677)
- Conditional: `auto_escalated`, `escalated_to`, `escalation_attempted`, `escalation_failed`, `anti_bot`, `wayback_fallback`, `pdf`

The listed subset (`title, content, quality, links, structured_data, hints`) is valid but misleadingly short. An agent deciding whether to use `format="json"` based on this list would not know that `url`, `mode`, `fetched_at`, `fields`, and `remember` are also present. More critically, `fields` is the primary reason an agent would pick `json` over `markdown` — it's what feeds the `fields=["price","title"]` use case in the common-mistake example — but it's absent from the field list.

**Fix:** Replace the braces list with the fields most relevant to agent decisions:
```
`format="json"`: structured object. Key fields: `url, title, content, quality, links, structured_data, fields, hints`. Use with `fields=["price","title"]` for targeted extraction.
```

---

### [LOW] `format="html"` description says "raw HTML source" — technically accurate but misses the 10K truncation

**Location:** `src/index.ts:176`

The description says "raw HTML source. Best for debugging or custom parsing." The actual implementation (`extract.ts:362–383`) truncates HTML at 10,000 characters and appends `<!-- Content truncated at 10,000 characters -->`. An agent using `format="html"` for a custom parser expecting complete HTML will get a partial document for most real pages.

The Zod schema describe string (`src/tools/types.ts:87`) already says "html: raw HTML (truncated at 10K)" — the tool description should match.

**Fix:** Append "(truncated at 10K — use novada_unblock for full HTML)" to the `html` line in the CRITICAL block. This also naturally redirects agents to the right tool.

---

### [PASS] Auto-save path is accurate

`src/utils/output.ts:39` confirms: `~/Downloads/novada-mcp/YYYY-MM-DD/`. Description says exactly this. Verified.

### [PASS] Common-mistake example is correct and useful

"using markdown when you need specific data — use `format="json"` + `fields=["price","title"]`" matches the fields param behavior in `extract.ts:582–584` and `types.ts:92–93`. Example is actionable.

### [PASS] `clean=true` description is accurate

Description says "strip nav/sidebar, return main content only (~15K chars vs ~100K full page)." Code confirms: `clean !== true` → `extractFullPageContent`, `clean === true` → `extractMainContent` (`extract.ts:388–393`). The char estimates are approximate — no hardcoded numbers in code — but acceptable as guidance values.

### [PASS] No contradiction with other tool descriptions

The format guidance is consistent with `novada_scrape` (which also uses markdown/json) and `novada_unblock` (which explicitly notes it returns raw HTML). The auto-save notice does not appear in other tools — this is intentional per the pipeline-fix context.

### [PASS] `render="auto"` key rule is accurate

Description says "15-100x faster on static sites." Code uses `Promise.any([direct_fetch (3s timeout), proxy_fetch])` in auto mode (`extract.ts:255–265`). Direct wins on clean static HTML; proxy path is used when bot challenge detected. The speed claim is reasonable.

---

## Summary

| Check | Status |
|---|---|
| CRITICAL block placement | FAIL — must move to top |
| JSON field list accuracy | FAIL — missing `fields`, `url`, undersells the format |
| HTML truncation disclosure | WARN — Zod schema says 10K, description does not |
| Auto-save path | PASS |
| Common-mistake example | PASS |
| clean=true accuracy | PASS |
| No cross-tool contradiction | PASS |
| render=auto accuracy | PASS |

**Required before merge:** Fix CRITICAL block placement + JSON field list. HTML truncation is low severity but simple to fix — recommend bundling it with the other two changes.

