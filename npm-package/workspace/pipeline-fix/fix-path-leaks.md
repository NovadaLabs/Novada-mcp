# fix-path-leaks status

## BUG-A (R5 CRITICAL) — research.ts
File: src/tools/research.ts line ~168
Fix: added `strippedContent = content.replace(/^📁[^\n]*\n\n/, "")` before the Agent Hints split.
Status: DONE

## BUG-B (R1 HIGH) — search.ts
File: src/tools/search.ts line ~499
Fix: added `extractedText = content.replace(/^📁[^\n]*\n\n/, "")` before returning from the extract map.
Status: DONE

## tsc --noEmit
Pre-existing errors only (extract.ts:169, 681, 881 — unrelated TS2345). No new errors introduced.
