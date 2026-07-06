# Product Verification: Dual-Output Structure

**Reviewer:** product-verification-agent
**Date:** 2026-06-25
**Scope:** Evaluate proposed `output_formats` design from a user perspective

---

## What The Code Actually Does Today

Before evaluating the proposal, the ground truth from reading the source:

- `output.ts` supports exactly 3 formats: `"json" | "csv" | "md"`. No `"html"` format exists.
- `novada_extract` calls `saveOutput` once: `format: "json"` when `params.format === "json"`, `format: "md"` otherwise. One file per call, always.
- `novada_research` calls `saveOutput` once: always `format: "md"`. One file per call.
- `novada_scrape` calls `saveOutput` once: `format: "json"` if json requested, `format: "csv"` otherwise. One file per call.
- There is no `output_formats` parameter anywhere in the codebase. The proposal is purely additive — nothing currently implements it.
- The proposal adds NEW behavior: saving multiple files per single tool call.

---

## Q1: Is `output_formats` the right UX?

**VERDICT: NEEDS_CHANGE**

The current default (save one file matching the requested output format) is correct. The proposal to save multiple files by default is wrong.

**Why the current single-file behavior works:**
- User asked for `format="markdown"` → they get one `.md` file. Zero surprise.
- File name matches what was requested. No orphan files accumulate.
- The agent already receives the full content inline — the file save is a secondary convenience for the human, not the primary output path.

**Problem with `output_formats=["md", "html", "json"]` as default:**
- A developer runs `novada_extract` 10 times → 30 files appear in `~/Downloads/novada-mcp/`. Discovery cost: they now have to figure out which file they want.
- The HTML file is raw — it's not what `novada_extract` is designed to return (the tool deliberately strips, cleans, and scores HTML). Saving raw HTML alongside the cleaned markdown output sends contradictory signals.
- JSON for extract already exists (`format="json"` returns a structured object and saves it). Saving it again as a second file when the user requested markdown is redundant.

**Correct design:**
- Default: save one file matching the format the user explicitly requested (current behavior).
- Optional: add a `filePath` parameter (explicit path override) for users who want a specific save location. Do NOT add `output_formats`.
- If a user genuinely wants both MD and HTML, they should call the tool twice with different `format` params. That is not a UX problem — it is the right abstraction boundary.

**Least-friction default for a new user:** single file, format matches what they asked for, saved to `~/Downloads/novada-mcp/YYYY-MM-DD/`. This is already what the code does. Do not change it.

---

## Q2: Is the JSON schema `{title, content, links, images, metadata}` useful for humans?

**VERDICT: NEEDS_CHANGE**

The current `format="json"` output from `novada_extract` already returns a richer schema than the proposal:
```
{ url, title, description, mode, source, fetched_at, quality, content, structured_data, fields, links, hints, output_saved, remember }
```

The proposed `{title, content, links, images, metadata}` is a step backward — it strips `quality`, `mode`, `structured_data`, `hints`, and `agent_instruction` that agents depend on.

**On `raw_html` as a field vs separate `.html` file:**
- Neither. Raw HTML inside a JSON field is nearly always the wrong move. The HTML is 10-100x larger than the cleaned content, making the JSON file impractical to read or `jq`-parse.
- If a developer needs raw HTML, they already have `format="html"` (already handled in `extract.ts` lines 362-368) which returns truncated raw HTML inline. That is the right tool.
- A separate `.html` file is marginally better than a field (at least the JSON stays readable), but it is still solving a problem the user can solve themselves with `format="html"`.

**What a developer actually does with the JSON:**
- Pipe to `jq` to extract specific fields (`.content`, `.quality.score`, `.links.same_domain`).
- Feed the `content` field to an LLM for further processing.
- Use `quality.score` to gate downstream processing (skip if `< 40`).
- The `structured_data` field is the high-value addition for e-commerce/schema.org pages.

**Recommendation:** Keep the existing JSON schema. The proposal's schema is a downgrade. Images are currently absent — adding them as a list of `src` URLs is a reasonable enhancement but is independent of the multi-format question.

---

## Q3: Is the naming convention clear?

**VERDICT: GOOD (with one change)**

`extract_quotes_toscrape_com_105415.md` is readable. The format `{tool}_{hint}_{HHmmss}.{ext}` correctly encodes what (tool), where (hint = sanitized domain), and when (time). The `sanitizeHint` function correctly strips the protocol and replaces special chars.

One issue: the current timestamp format is `HHmmssSSS` (9 digits, line 51 in output.ts), not `HHmmss` (6 digits) as shown in the proposal. The SSS milliseconds suffix makes collisions nearly impossible in batch mode — keep it.

**On `_raw` suffix:**
- No. Adding `_raw` implies the paired `.md` is "cooked" — which invites questions about what was removed and whether to trust it. The `.html` extension itself signals raw content. Dual suffixes add noise without clarity.
- If the proposal is adopted (despite Q1 recommending against it), cleaner naming would be separate tool invocations: `extract_xxx.md` from one call, `extract_xxx.html` from a second call with `format="html"`. Same timestamp is not guaranteed and users should not rely on file pairing by name anyway.

---

## Q4: Does this compete with or complement the existing output pipeline?

**VERDICT: BAD (as proposed)**

The existing pipeline is already correct:
- `novada_extract(format="md")` → saves `.md`, returns markdown inline.
- `novada_extract(format="json")` → saves `.json`, returns JSON inline.
- `novada_research` → saves `.md`, returns report inline.
- `novada_scrape(format="json")` → saves `.json`, returns JSON inline; `format="markdown"` → saves `.csv`.

The proposal to add `research_xxx_sources.json` as a second auto-saved file for `novada_research` is the one case with legitimate value: the raw sources list is currently discarded after the synthesis. A developer debugging a bad research result has no way to inspect which sources were used. Saving `research_xxx_sources.json` as an optional companion would be useful.

For `novada_extract` and `novada_scrape`, the proposal adds files without adding value. The agent already has everything inline.

**File accumulation math:**
A developer running 20 `novada_extract` calls per session with `output_formats=["md","html","json"]` generates 60 files. With the current single-file design: 20 files. The current design wins.

---

## Summary of Verdicts

| Question | Verdict | Action |
|---|---|---|
| `output_formats` param as multi-file default | NEEDS_CHANGE | Remove it. Keep single-file matching requested format. |
| JSON schema `{title, content, links, images, metadata}` | NEEDS_CHANGE | Keep existing richer schema. Do not regress. |
| Naming convention `extract_xxx_HHMMSS.ext` | GOOD | Keep as-is. No `_raw` suffix needed. |
| Competing with existing pipeline | BAD | No multi-file per call. Exception: `research_xxx_sources.json` as optional companion has merit. |

## Specific Recommendations

1. Do not add `output_formats` parameter. The current single-file behavior is correct.
2. Do not add `_sources.json` companion file automatically for research — but expose the sources list as a named field in the JSON output if `format="json"` is used for `novada_research`.
3. If developers want HTML output from `novada_extract`, they already have `format="html"`. Document this more prominently rather than auto-saving a second file.
4. Keep `output.ts` as-is. The only legitimate addition is support for `"html"` as a format value in `OutputOptions` so `novada_extract(format="html")` saves a `.html` file instead of returning inline — this aligns save format with requested format, which is the correct invariant.
5. Reject the dual-file design entirely. One tool call, one file saved, format matches what was requested.
