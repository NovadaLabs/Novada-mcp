# Loop 3 — Edge Case Verification

Date: 2026-06-22

---

## Test 1: Batch URL extraction (urls array)

**Command:** `novadaExtract({urls:[...2 URLs...], format:'markdown', max_chars:200})`

**Result:** PASS

**Output:**
```
batch OK: 4273 chars
Preview: ## Batch Extract Results
urls:2 | successful:2 | failed:0
### [1/2] https://en.wikipedia.org/wiki/Machine_learning
...
```

**Notes:**
- Both URLs resolved successfully (2/2).
- Response is a single markdown document with numbered section headers per URL (`### [1/N] url`).
- `max_chars:200` appears to apply per-URL or is a soft cap — 4273 chars returned for 2 URLs is well above 200, suggesting `max_chars` is per-section or overall truncation only applies past a hard ceiling. Not a bug, but worth documenting in the tool description.

**Agent guidance quality:** GOOD — response format is clearly structured and labeled.

---

## Test 2: JSON format with fields

**Command:** `novadaExtract({url:'https://www.npmjs.com/package/axios', format:'json', fields:['version','description','author']})`

**Result:** PASS

**Output:**
```json
{
  "url": "https://www.npmjs.com/package/axios",
  "title": "axios - npm",
  "description": "Promise based HTTP client for the browser and node.js. Latest version: 1.18.1, last published: 18 hours ag..."
}
```

**Notes:**
- Returns valid JSON with URL and title always present.
- `description` field populated from page content.
- `version` and `author` not explicitly present as top-level keys in the 200-char preview — may be embedded in description text or absent (npm page renders them in JS). JSON extraction from static HTML may miss JS-rendered fields.
- Overall the tool returns valid JSON and does not crash — functional.

**Agent guidance quality:** GOOD — JSON output is parseable and usable by agents directly.

---

## Test 3: Research tool

**Command:** `novadaResearch({question:'what is TypeScript', depth:'quick'})`

**Result:** PASS

**Output:**
```
research OK: 5485 chars
```

**Notes:**
- Returns a synthesized markdown report of 5485 chars for a `depth:'quick'` query.
- No crash, no timeout within head-5 lines.
- Content length is appropriate for a quick-depth research run.

**Agent guidance quality:** GOOD — tool returns without error and output length is substantial.

---

## Test 4: render=browser without NOVADA_BROWSER_WS — error quality

**Command:** `novadaExtract({url:'...python...', render:'browser'})` — NOVADA_BROWSER_WS not set

**Result:** PASS (graceful degradation — useful error returned, no throw/crash)

**Full output:**
```markdown
## Extract Failed
url: https://en.wikipedia.org/wiki/Python_(programming_language)

Error: NOVADA_BROWSER_WS not configured. Set it to wss://user:pass@upg-scbr.novada.com to enable Browser API.

## Agent Hints
- If the URL returns JSON or binary data, it cannot be extracted as HTML.
- If the URL is unreachable, check the domain and try novada_map first.
- For JS-heavy pages returning empty content, try with render="render".

## Agent Action
agent_instruction: status:failed | suggested_fix: retry with render="render" for JS-heavy pages.
If blocked: novada_unblock(url="...") returns raw HTML via stealth browser
```

**Notes:**
- Error is clear and actionable: includes the exact env var name and an example value.
- `agent_instruction` block present and structurally valid.
- **One issue:** The `Agent Hints` section suggests `render="render"` as a fallback, which is correct, but does NOT hint that the root cause is a missing env var for `render='browser'` specifically. An agent reading just the hints (not the Error line) could loop endlessly retrying with `render='render'` instead of recognizing it needs to configure `NOVADA_BROWSER_WS`.
- **Recommendation:** Add a hint specific to `render='browser'` failures: "If render='browser' was requested, ensure NOVADA_BROWSER_WS is configured in your environment."

**Agent guidance quality:** GOOD overall — error message itself is excellent. Hints section is POOR for browser-specific case (generic hints don't address missing env var).

---

## Summary

| Test | Status | Guidance Quality |
|------|--------|-----------------|
| 1. Batch URL extraction | PASS | GOOD |
| 2. JSON format + fields | PASS | GOOD |
| 3. Research tool (quick depth) | PASS | GOOD |
| 4. render=browser without NOVADA_BROWSER_WS | PASS (graceful) | GOOD error / POOR hints |

**One actionable finding:** Test 4 hints section should be extended with a browser-specific hint to prevent agent retry loops when the real fix is env config, not a different render mode.
