# W5 Status: HTML Output Save

## Done

### output.ts
- Added `"html"` to `OutputOptions.format` union type (`"json" | "csv" | "md" | "html"`)
- Added `case "html"` in `saveOutput()` switch: `content = typeof data === "string" ? data : String(data)`

### extract.ts
- `format === "html"` early-return block: refactored to build `htmlOutput` string, then call `saveOutput({ format: "html", data: html })` with the **full untruncated HTML**
- Save path appended as HTML comment: `<!-- Output saved: /path/to/file.html -->`
- `format === "json"` save already existed (line 655) — no change needed

### tsc
- Only pre-existing errors in `src/tools/research.ts` (unrelated, 2 errors). Our files: 0 errors.

## Verify Result (live run against example.com)

```
has html tag: true
chars: 663
has save comment: true
saved file: /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_example_com_110759034.html
file on disk: 559 bytes
```

Response tail: `<!-- Output saved: /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_example_com_110759034.html -->`

## Files Changed
- `/Users/tongwu/Projects/novada-mcp/src/utils/output.ts`
- `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts`
