# Fix 1: wait_ms=0 False-Coercion Bug

**Loop:** 1 of 4
**Date:** 2026-06-22
**Status:** DONE — tsc clean (pre-existing unrelated error in http.ts, see below)

---

## Phase 1: What Was Found

### types.ts (line 102-103)
`wait_ms` is declared as `z.number().int().min(0).max(30000).optional()` — `0` is a schema-valid value. The schema contract promises callers that 0 is acceptable.

### browser.ts — two guards with the bug

**Line 117 (session-reuse path):**
```ts
if (options.wait_ms && options.wait_ms > 0) {
```

**Line 160 (new-page path):**
```ts
if (options.wait_ms && options.wait_ms > 0) {
```

Both guards short-circuit via JS falsy coercion: `0 && ...` evaluates to `0` (falsy), so `waitForTimeout` is never called when `wait_ms=0`. The explicit caller instruction is silently dropped.

### extract.ts (line 200)
The call site passes `wait_ms: params.wait_ms` directly to `fetchViaBrowser`. No mutation at this layer — the bug lives entirely in the two guards in browser.ts.

---

## Phase 2: Approach Decision

### Approach A — Fix the guard
Change `options.wait_ms && options.wait_ms > 0`
to    `options.wait_ms !== undefined && options.wait_ms >= 0`

Pros:
- Semantically correct: respects the declared schema contract (`min(0)`)
- `waitForTimeout(0)` is a valid Playwright no-op — harmless
- Zero semantic change for all existing callers that pass values > 0
- 2 lines changed, surgical

### Approach B — Normalize 0 → undefined at entry
Pros:
- Simpler guard (existing logic unchanged)

Cons:
- Changes the caller contract: `wait_ms=0` silently disappears
- Requires mutation in extract.ts param normalization
- Any future caller checking `params.wait_ms !== undefined` would get wrong answer
- More invasive for no benefit

**Chosen: Approach A.** Minimal diff, honest semantics, no side effects.

---

## Phase 3: Exact Diff Applied

File: `/Users/tongwu/Projects/novada-mcp/src/utils/browser.ts`

### Hunk 1 (line 117, session-reuse path)
```diff
-      if (options.wait_ms && options.wait_ms > 0) {
+      if (options.wait_ms !== undefined && options.wait_ms >= 0) {
```

### Hunk 2 (line 160, new-page path)
```diff
-    if (options.wait_ms && options.wait_ms > 0) {
+    if (options.wait_ms !== undefined && options.wait_ms >= 0) {
```

No other files were modified.

---

## Phase 4: tsc Result

```
src/utils/http.ts(93,21): error TS2554: Expected 2 arguments, but got 1.
Exit code 2
```

**This error is pre-existing and unrelated to this fix.** It is in `http.ts` line 93, a `console.warn` call — a file not touched by this change. The fix itself introduced zero new type errors.

**Browser.ts compiles cleanly.** The `wait_ms` type is `number | undefined`; the new guard `options.wait_ms !== undefined` narrows it to `number` before `waitForTimeout(options.wait_ms)`, which expects `number`. TypeScript is satisfied.

---

## Caveats / Follow-Up

1. **http.ts pre-existing error** — `console.warn` signature mismatch at line 93 should be addressed in a separate fix pass. It is not a runtime error (console.warn is variadic) but it blocks `tsc --noEmit` from exiting 0.

2. **`wait_ms=0` semantics** — With this fix, `waitForTimeout(0)` will actually be called for explicit `wait_ms=0`. Playwright handles this as a no-op with negligible overhead. If the intent was "skip the timeout entirely when 0", the guard `options.wait_ms > 0` (without the falsy coercion bug) would suffice. But since `undefined` already means "not set", keeping `0` as a valid no-op is the cleaner semantic choice.

3. **No test coverage exists for this edge case** — A test asserting `waitForTimeout` is called with `0` when `wait_ms=0` is passed would prevent regression.
