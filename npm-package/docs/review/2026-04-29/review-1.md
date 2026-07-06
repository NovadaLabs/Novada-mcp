# Cross-Review 1 — Code & Functionality

Reviewer: Senior engineer, independent pass  
Codebase: novada-search v0.8.3  
Date: 2026-04-29  
Source of truth: direct read of `/Users/tongwu/Projects/novada-mcp/src/`

---

## Validated P0 Issues (confirmed real, must fix)

### [novada_research crashes on wrong param name] — src/tools/research.ts:9,161
Agents found: Agent C, issue C1  
Verification: Line 9 — `resolveDepth(params.depth || "auto", params.question)`. Line 161 — `resolveDepth` body directly calls `question.length` with no null guard: `const isComplex = question.length > 80 || ...`. If `params.question` is `undefined` (which happens when an agent passes `query` instead of `question` — the name every other tool uses), this throws immediately: `TypeError: Cannot read properties of undefined (reading 'length')`. The crash happens before Zod validation at the function level because `validateResearchParams` is only called at the MCP boundary in `index.ts`. Direct SDK calls or any path that skips MCP boundary validation are unprotected.  
Recommended fix: Guard the function argument — `const q = params.question ?? ""; resolveDepth(params.depth || "auto", q)` — and add a null-coalesce at line 13 (`generateSearchQueries(params.question ?? "", ...)`). The naming mismatch (`query` vs `question`) should also be addressed either by aliasing in the Zod schema or by updating tool descriptions to make the non-intuitive name impossible to miss.

---

### [novada_unblock falsely reports mode:"render" when falling back to proxy] — src/utils/http.ts:217-218, src/tools/unblock.ts:13,31
Agents found: Agent D, issue C1  
Verification: `fetchWithRender` at line 217-218 falls back silently to `fetchViaProxy` when `NOVADA_WEB_UNBLOCKER_KEY` is not set. The caller (`router.ts` line 87) receives a proxy-fetched response but returns `{ mode: "render", cost: "medium" }` because the mode label is assigned based on the *requested* render mode, not the *actual* fetch path used. `unblock.ts` at line 31 then prints `method: render` in the output. The Agent Hints block at line 45 confirms: it prints "Rendered via Web Unblocker (JS execution enabled)" — which is false. This is not cosmetic: agents using `novada_unblock` to diagnose why a JS-heavy page returned empty content will believe rendering occurred and will not escalate to `browser` mode.  
Note: The comment at line 211-212 in `http.ts` says "Silently falling back to proxy would give callers a static result while they believe they have a JS-rendered page (wrong mode metadata)" — and then does exactly that fallback at line 218. The comment identifies the risk but the code does not prevent it.  
Recommended fix: In `router.ts`, when `fetchWithRender` is called with `render="render"` and the result was obtained via proxy fallback (detectable if `NOVADA_WEB_UNBLOCKER_KEY` is not set), return `mode: "render-failed"` (already defined in `UsedMode`). Add a note in Agent Hints: "Web Unblocker not configured — JS rendering did not occur; set NOVADA_WEB_UNBLOCKER_KEY to enable."

---

### [novada_extract throws uncaught exceptions — three separate paths] — src/tools/extract.ts:80,97
Agents found: Agent C, issues C2/C3/C4  
Verification: `extractSingle` at lines 79-81 and 96-98 throws `new Error("Response is not HTML...")` when `typeof response.data !== "string"`. In the batch path (lines 9-14), this is caught by a `.catch()` wrapper and becomes a graceful per-URL failure string. In the single-URL path (line 47-48), the call `return extractSingle(params, apiKey)` has no try-catch, so the error propagates as an unhandled exception to the MCP handler. Same applies to DNS errors (`getaddrinfo ENOTFOUND`) from `fetchViaProxy`, and to `new URL("not-a-url")` inside `extractSingle` at `new URL(params.url).hostname` (line 176 for same-domain link filtering). All three paths are live defects — verified by Agent C test results.  
Recommended fix: Wrap the single-URL branch in `novadaExtract` with the same `.catch()` pattern already used in batch mode. The fix is one try-catch with a structured error return string — three bugs resolved together.

---

### [fields extraction silently returns empty for "title" and "description"] — src/utils/fields.ts:40-53
Agents found: Agent C, issue H2  
Verification: `PATTERN_MAP` at lines 40-53 contains entries for `price`, `date`, `author`, `rating`, `availability`, `stock` — but not `title` or `description`. The fallback at lines 91-97 attempts a generic `field: value` pattern in markdown, but `<title>` content and meta descriptions are not rendered into the markdown output as `title: ...` or `description: ...` label-value pairs in a way the regex would capture them. The extract pipeline does populate `extractTitle()` and `extractDescription()` utilities (imported in extract.ts line 1) and emits them in the output header, but `extractFields` does not use these functions. Agent C confirmed both return `—` on example.com despite the page having both.  
Recommended fix: In `extractFields`, add `"title"` and `"description"` (and `"meta description"`) as special cases that fall back to `extractTitle(markdown)` and `extractDescription(markdown)` respectively before the generic pattern. These are the two highest-frequency field requests and both are already parsed elsewhere in the codebase.

---

## Downgraded Issues (agents overcalled)

### [Type casting without narrowing] — src/tools/browser.ts:202, src/index.ts:223-237
Agent A rated this P0. Downgraded to P2.  
Verification: `browser.ts:202` uses `any` for the Playwright `page` object because the `playwright-core` type is not imported in the tools layer (only `playwright` types are used in `utils/browser.ts`). The suppress comment is a known workaround, not an active defect — the underlying Playwright API calls at lines 206-225 are all structurally correct. The `any` casts in `index.ts` lines 224-237 are on MCP SDK handler types for `ListPrompts`, `GetPrompt`, `ListResources`, `ReadResource` responses — the MCP SDK's return types are overly strict and the `as any` casts are a documented compatibility shim, not a logic bug. No production defect has been shown to follow from these casts.  
Verdict: These are code-smell issues. They should be addressed (import `Page` from playwright-core, add proper generic types for MCP SDK handlers) but they are not P0 and there is no evidence of a runtime defect.

### [Missing error category — ZodError not classified] — src/tools/types.ts:160-166
Agent A rated this P0. Downgraded to P1.  
Verification: `classifyError()` exists in types.ts but it is only used by the SDK layer. At the MCP boundary in `index.ts`, Zod validation errors are handled separately before `classifyError` is ever called. The gap is real (ZodError would fall to UNKNOWN) but in practice, agents using the MCP tools see Zod validation errors as clean "Parameter validation failed" strings from `index.ts`. This is a SDK-quality issue, not an MCP tool defect.

### [Missing AbortError handling in probeSearch/probeScraper] — src/tools/health.ts:28-56, 88-119
Agent A rated this P0. Downgraded to P1.  
Verification: The catch block at line 50-53 (`catch (err)`) does catch `AbortError` — it extracts `err.message` and returns `{ status: "error", ..., note: msg }`. AbortController aborts cause the fetch promise to reject with a `DOMException` named `"AbortError"`, and its `message` is "This operation was aborted". The current handler returns a well-formed ProbeResult with that message as the note — it does not crash, it just produces a slightly less precise note string ("This operation was aborted" instead of "timeout after 8000ms"). The fix suggested by Agent A (check `err.name === "AbortError"`) would improve the message quality but the current behavior is not a silent failure or crash.

### [Unsafe type assertion in SDK parser] — src/sdk/index.ts:75
Agent A rated this P0. Downgraded to P2.  
Verification: Line 75 — `const mode = (modeMatch?.[1] as ExtractResult["mode"]) ?? "static"`. If the regex matches an invalid value (e.g. a new mode string added in a future release), the SDK would propagate an unexpected mode value to the caller. But the set of `UsedMode` values is controlled by this same codebase and stable. The more pressing fix is the one Agent A suggested, but in isolation this has never caused a production defect and is lower priority than the three confirmed runtime crashes.

---

## New Issues (not found by any agent)

### [novada_unblock `method` param mismatch with schema] — src/tools/unblock.ts:13
Neither agent noted this: `unblock.ts` line 13 maps `method === "browser"` to `"browser"` and anything else to `"render"`. If `method` is `"static"` (which is a valid value in the `UnblockParamsSchema`), it is silently treated as `"render"`. The schema and the logic disagree on what `"static"` means here. Confirm intended behavior and add an explicit case or schema refinement.

### [novada_research `generateSearchQueries` also accesses `params.question` unsafely] — src/tools/research.ts:13
Agent C identified the crash in `resolveDepth` but missed a second unsafe access: line 13 — `generateSearchQueries(params.question, ...)`. If `params.question` is `undefined`, this passes `undefined` to a function that uses `.toLowerCase()` or string operations on it. The fix for C1 must also cover this call.

### [fetchWithRender silent proxy fallback comment contradicts code] — src/utils/http.ts:211-218
The comment at line 211-212 warns against silent fallback because "callers would believe they have a JS-rendered page." Line 218 then does exactly that. This is a self-contradicting comment — a future developer reading it would assume the behavior was intentional or would misread the fallback as the thing being warned against having already been fixed. Either remove the fallback entirely (require NOVADA_WEB_UNBLOCKER_KEY for `fetchWithRender`) or rename it `fetchWithRenderOrFallback` and document the degraded mode. The current state is both a functional bug (C1 in Agent D report, validated above) and a maintenance hazard.

---

## Compound Issues

### Compound 1: Uncaught extract exceptions + quality:0 on short content = agent retry spiral
**A (extract throws on invalid URL) + B (quality:0 on valid short content):** When an agent encounters `quality:0` on a legitimate extract result (e.g. a short documentation page), it may retry with `render` mode. If the render-mode URL returns JSON (e.g. an API endpoint behind the docs URL), the extract throws an uncaught exception. The agent is now stuck between a score it doesn't trust (quality:0 on a valid page) and a crash on the retry path. Fix: wrap single-URL extract in try-catch (fix for C2/C3/C4 above) AND separate "extraction succeeded" from content richness in the quality score.

### Compound 2: False render mode label + quality scoring on render result = wrong escalation decision
**A (unblock reports mode:"render" when it used proxy) + B (extract quality scoring penalizes high link-density pages):** An agent fetches a JS-heavy page via `novada_unblock`. Gets `mode: render`. Sees content that looks truncated or incomplete (because no JS actually ran). Calls `novada_extract` with `render="render"`. Extract quality score returns 25 (GitHub trending, 1199 links). Agent now believes: "render worked, quality is moderate, the content is what it is." It does not escalate to `browser` mode. In reality, no rendering occurred at any point and the page content was static. The false `render` label at step one removes the agent's ability to correctly diagnose and escalate.

### Compound 3: research crash + param name mismatch = total tool failure for first-time users
**A (research crashes on `query` param) + B (crawl silently ignores `limit`, `mode`, `format`):** Both tools use non-intuitive parameter names (`question` not `query`, `max_pages` not `limit`, `strategy` not `mode`). Research *crashes*; crawl *silently misbehaves*. An agent that fails on research and gets wrong results from crawl has no feedback signal indicating it used the wrong parameter names. These two issues together make the tool suite appear unreliable for a first-time user without producing actionable error messages.

---

## Pattern Analysis

**Root cause behind most issues: the single-URL path in `novadaExtract` is not error-wrapped, while the batch path is.** The batch path was clearly written defensively (each URL wrapped in `.catch()`). The single-URL path at line 47-48 calls `extractSingle` raw, so every exception in the extraction chain — non-HTML content, DNS failure, URL parse errors — propagates as an unhandled exception to the MCP layer. This one structural asymmetry accounts for three of the four confirmed P0 issues.

**Secondary pattern: mode labels are set based on *intended* mode, not *actual* fetch path.** This affects both `novada_unblock` (reports `render` when it used proxy) and would affect extract in any path where `fetchWithRender` silently falls back. The codebase has the `render-failed` mode defined and used correctly in the router's auto-escalation path — but this discipline was not applied to the forced-render path when the key is absent.

**Tertiary pattern: schema param names differ from intuitive names and from the documented brief.** `question` vs `query`, `max_pages` vs `limit`, `strategy` vs `mode`, `select_paths` vs `path_filter`. Each individual deviation is survivable; together they create a vocabulary gap where agents using documentation, examples, or analogy from other tools will systematically pass wrong parameter names. Research crashes on this; crawl silently ignores it.

---

## Top 3 Fixes for Maximum Impact

1. **Wrap single-URL `extractSingle` call in a try-catch returning a structured error string** — `src/tools/extract.ts:47-48`. One change eliminates three P0 crash paths (non-HTML content, DNS failure, invalid URL). This immediately makes `novada_extract` robust for the most common agent error patterns. Effort: ~15 lines.

2. **Return `mode: "render-failed"` (not `"render"`) when `NOVADA_WEB_UNBLOCKER_KEY` is absent and `fetchWithRender` falls back to proxy** — `src/utils/router.ts:87` and `src/tools/unblock.ts`. This fixes the most dangerous silent misinformation issue: agents believe rendering occurred when it did not, which breaks the entire escalation decision tree for JS-heavy pages. Effort: ~5 lines in router.ts, update unblock.ts Agent Hints block.

3. **Fix `resolveDepth` and `generateSearchQueries` to null-guard `params.question`** — `src/tools/research.ts:9,13`. One-line fix for each. The `research` tool is the most powerful tool in the suite (multi-source, deep) and it crashes immediately on the single most common wrong-param pattern (`query` instead of `question`). Consider also adding `query` as a Zod alias in `ResearchParamsSchema` since every other tool uses `query` and the naming inconsistency will recur.

---

*Cross-Review 1 — 2026-04-29 | Reviewer 1 (Senior Engineer, independent) | novada-search v0.8.3*
