# V4 Cross-Tool Project Folder Verification

**Date:** 2026-06-26
**Test:** When multiple tools use the SAME `project` name, all outputs land in the same folder.

## Test Setup

- **Project name:** `cross-tool-test`
- **API Key:** `1f35b477c9e1802778ec64aee2a6adfa`
- **Tools invoked:**
  1. `novadaSearch` — query `"proxy api test"`, engine `google`, num `3`
  2. `novadaExtract` — `https://example.com`, format `markdown`
  3. `novadaExtract` — `https://example.com`, format `json`
  4. `novadaExtract` — `https://example.com`, format `html`

## Results

### Project directory

```
~/Downloads/novada-mcp/2026-06-26/cross-tool-test/
├── example-com/
│   ├── 2026-06-26_195930325_example-com.md     (991 bytes)
│   ├── 2026-06-26_195930348_example-com.json   (704 bytes)
│   └── 2026-06-26_195930371_example-com.html   (559 bytes)
└── proxy-api-test/
    └── 2026-06-26_195930214_proxy-api-test.json (1737 bytes)
```

### Assertions

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| All files in same project folder | `cross-tool-test/` | `cross-tool-test/` | PASS |
| Total files saved | >= 4 | 4 | PASS |
| Topic subfolders created | >= 1 | 2 (`example-com`, `proxy-api-test`) | PASS |
| No empty files | All > 0 bytes | Smallest = 559 bytes | PASS |
| Search output saved | 1 JSON file | `proxy-api-test.json` (1737 bytes) | PASS |
| Extract MD saved | 1 MD file | `example-com.md` (991 bytes) | PASS |
| Extract JSON saved | 1 JSON file | `example-com.json` (704 bytes) | PASS |
| Extract HTML saved | 1 HTML file | `example-com.html` (559 bytes) | PASS |

## How It Works

`saveOutput()` in `build/utils/output.js` builds the directory path as:

```
~/Downloads/novada-mcp/{YYYY-MM-DD}/{project}/{topic}/
```

- `{project}` comes from `params.project`, sanitized to max 30 chars
- `{topic}` is derived from the URL domain or query words via `topicSlug()`
- Both `novadaSearch` and `novadaExtract` pass `params.project` through to `saveOutput`

When multiple tools share the same `project` value, the `{project}` segment is identical, so all outputs land under the same date+project directory. Different topic slugs create subfolders within that project directory.

## Verdict

**PASS** — Cross-tool project isolation works correctly. All 4 tool invocations with `project: "cross-tool-test"` wrote their outputs into `~/Downloads/novada-mcp/2026-06-26/cross-tool-test/`, organized by topic subfolder.
