# Verification Round 3: Output Formats + Topic Subfolders

**Date:** 2026-06-26
**Status:** ALL PASS

## Format Tests

| Test | Result | Detail |
|------|--------|--------|
| markdown: path in header | PASS | First line `📁 /Users/.../example-com/2026-06-26_143526_example-com.md` |
| markdown: .md extension | PASS | `2026-06-26_143526_example-com.md` |
| html: has HTML content | PASS | Returns raw `<!doctype html>...` (path embedded in HTML comment) |
| json: valid JSON | PASS | Returns valid JSON with `saved_to` field containing full path |

## Path Header Behavior Per Format

- **markdown**: Path as first line `📁 <path>` — agent-visible at top
- **html**: Path embedded as HTML comment near end (`<!-- saved: <path> -->`) — not leading line
- **json**: Path in `saved_to` field in JSON body — parseable by agents

All three formats successfully save files.

## Topic Subfolder Structure

- Base dir: `~/Downloads/novada-mcp/2026-06-26/`
- `example.com` → `example-com/` subfolder: PASS
- New naming pattern `YYYY-MM-DD_HHmmss_source.ext`: PASS

Example files saved in this run:
```
2026-06-26_143526_example-com.md    (markdown)
2026-06-26_143527_example-com.html  (html)
2026-06-26_143528_example-com.json  (json)
```

## Old vs New Naming Pattern

Old files (pre-fix): `extract_example_com_112013183.md`
New files (post-fix): `2026-06-26_143526_example-com.md`

Both coexist in folder — old files from earlier test runs, new files from current build.

## Observation

HTML format does not lead with `📁` path header (unlike markdown). The path is accessible but only via HTML comment. JSON has it in `saved_to` field. This is by design — returning raw HTML as first content makes sense for the html format. No action needed unless spec requires consistent `📁` header across all formats.
