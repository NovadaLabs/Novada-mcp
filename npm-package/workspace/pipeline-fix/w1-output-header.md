# W1 Status: Output Header — DONE

## Changes

### src/tools/extract.ts (lines 867-881)
- Replaced tail-append `mdOutput += "\n\n---\nOutput saved: ..."` with header-prepend `savePrefix + mdOutput`
- `saveOutput()` still writes the clean markdown (without path) to disk
- Response returned to agent starts with `📁 <filePath>\n\n` before content

### src/tools/search.ts (two blocks)
- JSON format path (was `finalResult += "\n\n// Output saved: ..."`) → now `"// 📁 <filePath>\n" + finalResult`
- Markdown format path (was `finalResult += "\n\nOutput saved: ..."`) → now `"📁 <filePath>\n\n" + finalResult`

## Verification

```
FIRST 3 LINES:
📁 /Users/tongwu/Downloads/novada-mcp/2026-06-26/extract_example_com_110808456.md

## Extracted Content
```

First line is `📁 <path>` as required. tsc clean, build clean.

## Status: PASS
