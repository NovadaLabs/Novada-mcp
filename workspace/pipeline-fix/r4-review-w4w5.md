# R4 Review — W4 (setup/health) + W5 (html output)

Reviewer: R4
Date: 2026-06-25
Files reviewed: src/tools/setup.ts, src/tools/health.ts, src/utils/output.ts, src/tools/extract.ts

---

## W4 — Output Pipeline Documentation

### [HIGH] Ghost env vars documented as real: NOVADA_OUTPUT_DIR and NOVADA_NO_SAVE

**File:** `src/tools/setup.ts:136-137`

```
lines.push("   To change output directory: set NOVADA_OUTPUT_DIR=/your/path");
lines.push("   To disable auto-save: set NOVADA_NO_SAVE=1");
```

Neither env var is read anywhere in the codebase. Confirmed via global grep across all `.ts`/`.js` source
files — the only hits are the two documentation lines in `setup.ts` itself and their compiled output in
`build/tools/setup.js`. `src/utils/output.ts:getOutputDir()` hardcodes `~/Downloads/novada-mcp/YYYY-MM-DD/`
with no branch for `NOVADA_OUTPUT_DIR`. `saveOutput()` has no guard for `NOVADA_NO_SAVE`.

This is a silent lie to the user: they will set `NOVADA_NO_SAVE=1`, get no error, and files keep
appearing. Setting `NOVADA_OUTPUT_DIR` also has zero effect.

**Fix options (pick one):**
- Implement the env vars in `output.ts` before this documentation ships, OR
- Change lines 136-137 to "(coming soon)" language until implemented, OR
- Remove lines 136-137 entirely.

### [MEDIUM] Static health.ts row — always active, never dynamic

**File:** `src/tools/health.ts:198`

```ts
lines.push(`| Output Pipeline | ✅ active — ~/Downloads/novada-mcp/ | — |`);
```

This row is hardcoded regardless of whether `~/Downloads/novada-mcp/` was ever written to or whether
the directory even exists. Every other row in the table reflects a real probe result. This one does not.

The mismatch is low-severity because the output pipeline genuinely activates on first use (no config
required), so "always active" is mostly correct. However it cannot account for environments where the
home `Downloads/` path does not exist (Linux servers, Docker containers, CI) or where permissions prevent
directory creation — in those cases the output silently fails in `saveOutput()` while health claims active.

**Acceptable as-is if:** the decision is that this tool targets only desktop MCP clients where
`~/Downloads` always exists. Otherwise a lightweight dynamic check (does the dir exist?) would be more
accurate.

### Path accuracy in setup.ts — OK

`~/Downloads/novada-mcp/YYYY-MM-DD/` matches the hardcoded path in `output.ts:getOutputDir()`. Correct.

---

## W5 — HTML Output Side-Channel

### HTML comment placement — VALID but cosmetically odd

**File:** `src/tools/extract.ts:381`

```ts
htmlOutput += `\n<!-- Output saved: ${outputResult.filePath} -->`;
```

Live test confirmed:
```
response tail: "...body></html>\n\n<!-- Output saved: /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_example_com_111123413.html -->"
```

The comment appears **after** `</html>`. Technically invalid HTML (the root element should be the last
node), but browsers and HTML parsers universally tolerate trailing comments. No existing parser will
choke on this. Not a bug.

Edge case from brief: "what if HTML contains `</html>` and then our comment appears after?" — this is
exactly what happens and it is fine. All browsers and parsers handle post-`</html>` nodes gracefully.
HTML5 spec allows them.

### Saved file content — CORRECT

Disk file contains raw untruncated HTML (`html` variable, not `htmlOutput`). The `saveOutput()` call
passes `data: html` (the full string) while `htmlOutput` is the 10,000-char-capped version returned
to the agent. This is intentional and correct: full content on disk, truncated content in the MCP
response.

File size confirmed: 559 bytes raw HTML, no comment appended to file. Comment only exists in the return
value. Correct.

### format="html" case — no regression to other paths

The `format === "html"` block returns early at line 383 (`return htmlOutput`). It does not reach the
json/md paths. The `saveOutput` call for `format: "html"` in `output.ts:case "html"` correctly uses
`typeof data === "string" ? data : String(data)`. No regression to csv/json/md handling.

### Live test results

```
has html: true           (pass)
has save comment: true   (pass)
chars: 663               (base 559 bytes + comment ~104 chars — correct)
html files today: 3      (file written — pass)
```

All four test assertions passed.

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 1     | warn   |
| MEDIUM   | 1     | info   |
| LOW      | 0     | pass   |

**Verdict: REQUEST_CHANGES**

The HIGH issue must be resolved before merge. Documenting `NOVADA_OUTPUT_DIR` and `NOVADA_NO_SAVE` as
real, working env vars when they are not implemented will create user-facing support noise. Either
implement them in `output.ts` (preferred — the feature is obviously useful) or remove the documentation.
W5 is clean and approved as-is.
