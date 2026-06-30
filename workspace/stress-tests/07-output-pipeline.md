# Stress Test 07: Output Pipeline

**Date:** 2026-06-26
**Module:** `src/utils/output.ts` (`saveOutput`)

## Test Matrix

| # | Test | Result | Details |
|---|------|--------|---------|
| 1 | Rapid fire: 5 saves in <1s | FAIL | 5 saves produced 1 unique file path. Only last write (index=4) survived. Indices 0-3 silently overwritten. |
| 2 | Path traversal: `../../../etc/passwd` | PASS | Sanitized to topic `output`, filename `output.json`. No directory escape. |
| 3 | XSS: `<script>alert(1)</script>` | PASS | Sanitized to `script-alert-1-script`. Angle brackets stripped. |
| 4 | Unicode: `中文关键词` | PASS (degraded) | All CJK chars stripped by `/[^a-zA-Z0-9_-]/g`, falls back to `output`. Functional but loses semantic meaning. |
| 5 | Slashes: `path/with/slashes` | PASS | Sanitized to `path-with-slashes`. Slashes converted to hyphens. |
| 6 | Long string: 200x `a` | PASS | Truncated to 25 chars (filename) / 30 chars (topic). No overflow. |
| 7 | Empty data: `undefined` | PASS | Threw error: `refusing to write empty file`. Correctly refused. |

## Summary

**6/7 passed, 1 critical failure.**

### CRITICAL: Rapid-Fire Filename Collision (Data Loss)

`generateFileName()` uses second-level granularity (`HHmmss`). Multiple saves within the same second produce identical filenames, causing silent overwrites.

**Root cause** (line 76):
```ts
const time = now.toTimeString().slice(0, 8).replace(/:/g, ""); // HHmmss
```

**Evidence:**
- 5 sequential saves all mapped to `2026-06-26_182316_rapid-fire.json`
- Only index=4 (last write) survived on disk
- `writeFile` silently overwrites without error

**Fix options (pick one):**
1. Append milliseconds: `HHmmssSSS` (e.g., `182316323`)
2. Append counter or random suffix: `_182316_rapid-fire_a3f2.json`
3. Check existence before write, append `-2`, `-3`, etc.

Option 1 is simplest and sufficient for typical usage. Option 3 is most robust.

### MINOR: CJK / Unicode Hint Degradation

The sanitizer regex `/[^a-zA-Z0-9_-]/g` strips all non-ASCII characters. A hint of `中文关键词` becomes empty string, falling back to `output`. This is safe but loses all semantic information from the hint.

**Possible improvement:** Allow Unicode word characters via `/[^\p{L}\p{N}_-]/gu` or transliterate CJK to pinyin/romaji before sanitizing.

### Security: All Path Traversal Tests Passed

- `../../../etc/passwd` -> sanitized to `output` (dots and slashes stripped)
- Files are always written under `~/Downloads/novada-mcp/YYYY-MM-DD/`
- No directory escape observed
- XSS payloads neutralized in filenames

## Files Created During Test

```
~/Downloads/novada-mcp/2026-06-26/rapid-fire/
  2026-06-26_182316_rapid-fire.json          (1 file, should be 5)

~/Downloads/novada-mcp/2026-06-26/output/
  2026-06-26_182316_output.json              (path traversal + Chinese)
  2026-06-26_182320_output.json              (second Chinese test, different second)

~/Downloads/novada-mcp/2026-06-26/script-alert-1-script/
  2026-06-26_182316_script-alert-1-script.json

~/Downloads/novada-mcp/2026-06-26/path-with-slashes/
  2026-06-26_182316_path-with-slashes.json

~/Downloads/novada-mcp/2026-06-26/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/
  2026-06-26_182316_aaaaaaaaaaaaaaaaaaaaaaaaa.json
```

## Verdict

The output pipeline is **safe** (no security issues) but has a **data-loss bug** under rapid-fire writes. The collision must be fixed before this module is used in any batch/parallel workflow.
