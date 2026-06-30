# fix-descriptions status

All 5 fixes applied. tsc --noEmit exit code: 0.

## Fix 1 — CRITICAL block position (R2 HIGH) ✓
`src/index.ts` novada_extract description restructured:
- Line 1: one-sentence what-it-does
- CRITICAL block moved to immediately follow
- Best for / Not for / Key rule / auto-save notice moved after

## Fix 2 — JSON field list accuracy (R2 HIGH) ✓
Old: `{title, content, quality, links, structured_data, hints}`
New: `Key fields: url, title, content, quality, links, structured_data, fields, hints, mode, fetched_at`
`fields` key explicitly called out as the reason to choose format="json".

## Fix 3 — HTML truncation note (R2 LOW) ✓
`format="html"` line updated:
Old: `raw HTML source. Best for debugging or custom parsing.`
New: `raw HTML source (truncated at 10K chars — use novada_unblock for full HTML). Best for debugging or custom parsing.`

## Fix 4 — Remove ghost env vars from setup.ts (R4 HIGH) ✓
`src/tools/setup.ts` Output Pipeline section:
Removed: `To change output directory: set NOVADA_OUTPUT_DIR=/your/path`
Removed: `To disable auto-save: set NOVADA_NO_SAVE=1`
Replaced with: `Output directory is ~/Downloads/novada-mcp/YYYY-MM-DD/ (not yet configurable)`

## Fix 5 — sources count label (R3 HIGH) ✓
`src/tools/research.ts` line 410:
Old: `**sources**: ${totalSources}`
New: `**top_sources**: ${totalSources}`
Note: `totalSources = args.sourceRows.length` (all 15), but the label now correctly says "top_sources"
rather than bare "sources" to distinguish from the extracted count shown on the sources_extracted line.
