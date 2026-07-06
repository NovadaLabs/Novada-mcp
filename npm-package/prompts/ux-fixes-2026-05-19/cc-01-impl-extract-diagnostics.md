# CC-01-IMPL — extract: add extraction diagnostics

## Role
Claude Code implementer. You modify TypeScript source only. No planning docs, no READMEs.

## Repo
/Users/tongwu/Projects/novada-mcp

## Problem
When `novada_extract` is called with `fields: ["stars", "license", "installation"]`, fields that
fail to match return silently as null. The agent calling the tool has no idea WHY the field is null
or what to do about it. Example: scrapy/scrapy has license=null because BSD-2-Clause appears only
in a linked badge, not inline. The agent can't recover.

## Required Change — src/tools/extract.ts

After the `extractFields()` call (or wherever individual field results are assembled), add two new
output sections to the returned markdown string:

### 1. extraction_quality header line
Add near the top of the output (after `url:` and `mode:` lines):
```
extraction_quality: high | partial | low | none
```
- `high`    — all requested fields returned non-null values
- `partial` — at least one field returned a value, at least one returned null
- `low`     — only one field returned a value
- `none`    — all requested fields returned null

If no `fields` param was provided (free extraction mode), emit `extraction_quality: n/a`.

### 2. ## Extraction Diagnostics section
Add before `## Agent Hints`. Only emit this section when at least one field is null.
Format:
```
## Extraction Diagnostics
- stars: matched ✓ (via heading-match)
- license: null — reason: no_heading_match (no "## License" or "# License" heading found in page)
- installation: null — reason: section_empty (heading found but section had no non-fence content)
```

Each field entry:
- If value returned: `- <field>: matched ✓ (via <method>)` where method = "heading-match" | "pattern-match" | "meta-tag"
- If null: `- <field>: null — reason: <reason_code> (<human explanation>)`

Reason codes:
- `no_heading_match` — `matchHeadingSection` returned null (no matching heading found)
- `section_empty` — heading found but content was empty or only fences
- `no_pattern_match` — fallback pattern search found no match
- `page_too_short` — page HTML < 500 chars, likely blocked or empty response

You need to instrument `matchHeadingSection` in src/utils/fields.ts to return a reason alongside
the value. A minimal approach: make it return `{ value: string | null, reason: string }` or add
an overload. Keep backward compat with existing callers.

## Constraints
- TypeScript strict — no `any` without justification
- Build must pass: `npm run build` with zero errors after your change
- Do NOT change the schema (Zod) or tool description strings
- Do NOT modify files other than src/tools/extract.ts and src/utils/fields.ts
- Do NOT add new npm dependencies

## Verify
Run `npm run build` at the end. Report: build result + which lines you changed.
