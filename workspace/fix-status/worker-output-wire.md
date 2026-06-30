# Worker: Output Pipeline Wiring

## Status: DONE

## tsc: PASS (exit 0, zero errors)

## Files Modified

1. **src/tools/scrape.ts** — Added `import { saveOutput }` from `../utils/output.js`. Refactored switch/case from `return` to `output = ...; break;` so save logic runs after the switch. Save appends `## Output Saved` section with summary.

2. **src/tools/extract.ts** — Added `import { saveOutput }`. Two save points:
   - JSON format path (early return): saves JSON data, appends `// Output saved: <path>` comment.
   - Markdown format path (end of function): saves markdown, appends `Output saved: <path>` line.

3. **src/tools/search.ts** — Added `import { saveOutput }`. Two save points:
   - JSON output: saves `{query, engine, results}` object, appends path comment.
   - Markdown output: saves same data object, appends path line.

4. **src/tools/research.ts** — Added `import { saveOutput }`. Captures `formatResearchOutput()` into `finalReport` variable, saves as `.md`, appends `Research saved: <path>`.

5. **src/tools/scraper_result.ts** — Added `import { saveOutput }`. Refactored switch/case from `return` to `output = ...; break;`. Save runs after records extracted, before format switch. Appends `## Output Saved` section if save succeeded.

## Design Notes

- All save calls wrapped in try/catch with empty catch — file save never breaks the tool.
- Save runs AFTER main result is computed, BEFORE returning to caller.
- scrape.ts and scraper_result.ts required refactoring switch/case from direct returns to variable assignment + break, so the save logic is reachable.
- extract.ts has two return paths (JSON early return + markdown end), both wired independently.
- search.ts has two return paths (JSON + markdown), both wired independently.
