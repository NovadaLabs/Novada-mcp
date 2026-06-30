# W4 Status — Output Pipeline Documentation

## Changes Made

### src/tools/setup.ts
Added "## Output Pipeline" section before "## Agent Action":
- Shows save path: ~/Downloads/novada-mcp/YYYY-MM-DD/
- Lists formats: .md, .json, .html
- Documents NOVADA_OUTPUT_DIR and NOVADA_NO_SAVE env vars (informational)

### src/tools/health.ts
Added output pipeline row to the product status table:
```
| Output Pipeline | ✅ active — ~/Downloads/novada-mcp/ | — |
```
Appended after the probed results loop, before the summary section.

### src/index.ts
Appended to novada_setup tool description (line ~491):
"Also shows output pipeline status (where extracted files are saved)."

## tsc check
PASS — npx tsc --noEmit returned no errors.
