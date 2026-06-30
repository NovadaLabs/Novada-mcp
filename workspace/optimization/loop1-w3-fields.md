# W3: Field Extraction Improvement

## Status: DONE

## Changes (src/utils/fields.ts only + 1-line call-site update)

### 3 new extraction layers added between JSON-LD and regex patterns:

1. **`extractFromInfobox`** — Parses Wikipedia-style `table.infobox` and `table.vcard` rows, matching `<th>` labels against field names.

2. **`extractFromTableHeaders`** — Scans all `<table>` elements for `<th>` columns matching the field name, returns the first data row's value at that column index.

3. **`extractFromMicrodata`** — Extracts Schema.org microdata via `[itemprop]` attribute matching (reads `content` attr or text content).

### Pipeline order (7 layers, was 4):

| # | Layer | Source | New? |
|---|-------|--------|------|
| 1 | JSON-LD structured data | `structured_data` | existing |
| 2 | Wikipedia infobox | `infobox` | NEW |
| 3 | Table header matching | `table_header` | NEW |
| 4 | Microdata (itemprop) | `microdata` | NEW |
| 5 | Regex patterns | `pattern` | existing |
| 6 | Generic inline | `pattern` | existing |
| 7 | Heading section | `heading` | existing |

### Type changes:
- `FieldResult.source` union expanded: added `"infobox" | "table_header" | "microdata"`
- `DiagnosticMethod` union expanded: added `"infobox" | "table-header" | "microdata"`
- Both `extractFields` and `extractFieldsWithDiagnostics` accept optional `html?: string` parameter (backward compatible)

### Call-site update:
- `src/tools/extract.ts:591` — passes `html` as 4th argument to `extractFields`

## Verification
- `npx tsc --noEmit` — clean, zero errors
