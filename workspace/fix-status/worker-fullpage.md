# worker-fullpage completion

status: DONE
tsc: exit 0

## Changes made

### src/tools/types.ts
- Added `clean: z.boolean().optional()` to `ExtractParamsSchema`
- Updated `max_chars` description to reflect new default of 100000

### src/utils/html.ts
- Added `extractFullPageContent(html, baseUrl?)` — strips only script/style/noscript/iframe/svg/canvas, keeps all structural elements (nav, header, footer, aside, form). Uses same inlineMarkdown walker as extractMainContent.

### src/utils/index.ts
- Added `extractFullPageContent` to the export list from html.js

### src/tools/extract.ts
- Imported `extractFullPageContent` from utils
- `MAX_CHARS_DEFAULT` changed from 50000 → 100000
- `useFullPage = params.clean !== true` (default: full page)
- All `extractMainContent` callsites in extractSingleInner now branch on `useFullPage`: initial extraction, render escalation re-extraction, browser escalation re-extraction, wayback fallback re-extraction

### src/index.ts
- Updated `novada_extract` tool description to mention full page default and clean=true option

## Behavior change
- Default: full page content (~50–100K chars), all nav/footer/aside kept
- `clean=true`: existing aggressive main-content extraction (unchanged logic)
- Internal callers (ai_monitor, research, search, monitor, sdk) omit `clean` → treated as `undefined` → `useFullPage = true` (full page)
