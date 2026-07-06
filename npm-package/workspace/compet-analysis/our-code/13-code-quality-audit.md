# novada-mcp — TypeScript Code Quality Audit

## 1. TypeScript Strictness Level

**tsconfig.json settings:**
- `strict: true` — enables all strict flags: `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictPropertyInitialization`, `strictBindCallApply`, `strictBuiltinIteratorReturn`
- `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- `forceConsistentCasingInFileNames: true`
- `skipLibCheck: true`

**Missing stricter flags:**
- `noUncheckedIndexedAccess` — NOT enabled (array/object index access returns `T`, not `T | undefined`)
- `noImplicitReturns` — NOT enabled
- `exactOptionalPropertyTypes` — NOT enabled
- `noUnusedLocals` / `noUnusedParameters` — NOT enabled

**TSC result:** `npx tsc --noEmit` exits clean — zero type errors.

---

## 2. `any` Type Inventory

**Total `any` annotations/casts: 18 occurrences across 3 files.**

### `src/utils/html.ts` — 13 occurrences (justified)

All `any` uses here wrap cheerio's untyped DOM API. Cheerio's `$()`, `.each()`, `.map()`, `.contents()`, `.find()`, `.filter()` callbacks use untyped node/element parameters at runtime. The `@types/cheerio` typings for these callbacks are incomplete/absent for the version in use.

| Line | Usage | Justification |
|------|-------|---------------|
| 53 | `$: any, el: any` | Cheerio root and element — no typed alternative |
| 61 | `a: any` in `.map()` | Cheerio element callback |
| 96 | `let $content: any = null` | Uninitialized cheerio wrapped element |
| 110 | `let bestEl: any = null` | Same |
| 113, 146, 173, 176, 205, 220 | Cheerio `.each()` / `.filter()` callbacks | DOM traversal |
| 314 | `value: any` | JSON-LD field coercion — intentionally accepts `unknown` shape |
| 332 | `value: any` | Internal utility, accepts arbitrary JSON values |

**Verdict: semi-justified.** The cheerio `any` use is a known gap from weak third-party typings. The `coerceToString(value: any)` and `set(key, value: any)` at lines 314 and 332 should be `unknown` with proper narrowing — that is the only lazy typing here.

### `src/index.ts` — 5 occurrences (MCP SDK workaround)

| Line | Usage | Notes |
|------|-------|-------|
| 139 | `zodToMcpSchema(schema: any)` | Zod v4 `toJSONSchema()` is not typed on the generic `ZodSchema` base — `ZodTypeAny` would be better |
| 674 | `listPrompts() as any` | MCP SDK return type mismatch — SDK's `ListPromptsRequestSchema` handler type does not match `listPrompts()` return type. Acknowledged with eslint-disable. |
| 679 | `getPrompt(...) as any` | Same SDK return type incompatibility |
| 683 | `listResources() as any` | Same |
| 687 | `readResource(...) as any` | Same |

**Verdict: justified SDK workaround.** All 5 are marked with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments, indicating conscious suppression. The root cause is a type mismatch between the local response shape and what the `@modelcontextprotocol/sdk` handler types expect. Fixing requires either overriding the MCP SDK types or aligning return shapes.

---

## 3. `as unknown as X` Casts

**2 occurrences found:**

### `src/tools/scrape.ts:304`
```ts
.map(item => item as unknown as Record<string, unknown>);
```
`item` comes from `resultItems` which is typed as `unknown[]`. This cast is safe: the items are already guarded by a `.filter()` on `error` being absent, and then passed to `flattenRecord()` which re-casts internally. Not a bug risk, but the type narrowing could be explicit with a type guard.

### `src/tools/account_summary.ts:36`
```ts
catch { return { _parse_error: true, raw: jsonText.slice(0, 200) } as unknown as T; }
```
This is a legitimate concern. `tryParse<T>()` uses `T` as a return type but can return `{ _parse_error: true, raw: string }` on parse failure. The caller (`runSection<WalletPayload>`) receives what it believes is a `WalletPayload` but may be a parse-error sentinel. Downstream code accesses `data.balance` without checking for `_parse_error`. This is a **latent bug path** if JSON parsing fails — the error would surface as `undefined` reads rather than a proper error.

---

## 4. Duplicated Types

### Critical: `NovadaSearchResult` and `NovadaApiResponse` defined twice

- `src/_core/types.ts` — proper canonical definitions (with `[key: string]: unknown` on `data`)
- `src/tools/types.ts` — duplicate definitions, simpler shape (no `[key: string]: unknown`)

Tools (`search.ts`, `verify.ts`, `research.ts`) import from `tools/types.ts`. The `_core/types.ts` versions are defined but **not imported by any tool file** — only `src/_core/types.ts` uses them internally. This means `_core/types.ts` is an orphaned canonical definition.

### `ProbeResult` / `ProbeStatus` defined 3 times

- `src/_core/types.ts:125` — `ProbeResult` (4 status values: `"active" | "not_activated" | "not_configured" | "error"`)
- `src/tools/health.ts:6` — local `ProbeResult` (same 4 values, but different shape: no `activationUrl`)
- `src/tools/health_all.ts:17` — local `ProbeStatus` with **5 values** (adds `"misconfigured"`)

The `_core` version is never imported by either health tool — both define their own. The `health_all.ts` version is a superset of `_core/types.ts` with a divergent status value.

### `RenderMode` defined twice

- `src/_core/types.ts:138` — `"auto" | "static" | "render" | "browser"`
- `src/utils/router.ts:25` — identical definition

`router.ts` does not import from `_core/types.ts` despite defining the identical type. The `_core` version is unused.

### `VerifyResult` defined twice

- `src/_core/types.ts:144` — `{ verdict, confidence, summary, sources }`
- `src/sdk/types.ts:81` — `{ claim, verdict, confidence, raw }` — **different shape**

These are legitimately different (SDK vs internal), but the name clash will confuse future contributors.

### `AiMonitorParams` defined twice

- `src/tools/ai_monitor.ts:7` — manual `export interface AiMonitorParams { brand, models?, topics? }`
- `src/tools/types.ts:419` — `export type AiMonitorParams = z.infer<typeof AiMonitorParamsSchema>`

The `AiMonitorParamsSchema` and its inferred type live in `types.ts`, yet `ai_monitor.ts` defines an independent interface with the same name. `ai_monitor.ts` imports from neither — it uses its own hand-written definition. This is inconsistent with every other tool that uses Zod-inferred types.

---

## 5. Zod Schema Coverage

**Consistent pattern:** Every public tool function has a corresponding Zod schema in either `tools/types.ts` (core tools) or the tool's own file (extended tools). Validation functions follow the pattern `validateXParams(args: Record<string, unknown> | undefined): XParams`.

**Schema location split:** Core tools (`search`, `extract`, `crawl`, `research`, `map`, `verify`, `proxy`, `scrape`, `unblock`, `browser`, `health`) have schemas in centralized `tools/types.ts`. Extended tools (`browser_flow`, `monitor`, `scraper_*`, `proxy_*`, `wallet_*`, etc.) define schemas inline in their own files. This is intentional and consistent.

**Input safety:** All schemas validate at the boundary via `.parse()`. No tool function accepts raw `unknown` input without validation first.

**One gap:** `CrawlParamsSchema` includes `limit` and `mode` as alias fields that are never normalized into the canonical `max_pages` / `strategy` before being forwarded to the API. If the caller provides only `limit`, the canonical `max_pages` will be `5` (its default) and `limit` will be ignored unless the tool implementation manually resolves it. This is a silent alias that may not work as documented.

---

## 6. Inline Type Intersection Casts in search.ts

```ts
(result as NovadaSearchResult & { extracted_content?: string | null }).extracted_content = er.content;
(result as NovadaSearchResult & { extract_error?: string }).extract_error = er.extract_error;
```

`NovadaSearchResult` is declared as an interface. These casts mutate the object in-place by adding extra properties not in the base type. The pattern works at runtime but bypasses type safety: TypeScript cannot verify that `result` actually holds these intersection fields after mutation. A proper fix would be a discriminated union or an extended interface `EnrichedSearchResult` exported from `types.ts`.

---

## 7. `_core/types.ts` Usage Gap

`src/_core/types.ts` defines: `NovadaSearchResult`, `NovadaApiResponse`, `ProbeResult`, `RenderMode`, `ResearchDepth`, `VerifyResult`, `VerifyVerdict`, `BrowserSessionInfo`, `ScraperTask`, `ResearchSource`.

Of these, **only** `BrowserSessionInfo`, `ScraperTask`, and `ResearchSource` appear to be used exclusively in `_core`. The API response types (`NovadaSearchResult`, `NovadaApiResponse`) and domain types (`RenderMode`, `VerifyResult`, `ProbeResult`) are all re-defined elsewhere, making `_core/types.ts` largely decorative. Tools that should import from it import from local copies instead.

---

## Top 5 Type Safety Issues

### Issue 1 — MEDIUM: `as unknown as T` hiding parse failures in account_summary.ts
**File:** `src/tools/account_summary.ts:36`
`tryParse<T>()` returns a parse-error sentinel object cast to `T`. Callers (`runSection<WalletPayload>`) receive what TypeScript believes is a `WalletPayload` but may be `{ _parse_error: true, raw: string }`. Property accesses like `data.balance` silently return `undefined` without any error signal. Fix: make `tryParse` return `T | { _parse_error: true; raw: string }` as a union, and check the discriminant before accessing typed fields.

### Issue 2 — MEDIUM: Duplicate `NovadaSearchResult` / `NovadaApiResponse` with divergent shapes
**Files:** `src/_core/types.ts` vs `src/tools/types.ts`
`_core/types.ts` has `data?: { organic_results?: ...; [key: string]: unknown }` (index signature allows unknown keys). `tools/types.ts` has `data?: { organic_results?: ... }` (no index signature). Tools import from `tools/types.ts`. Any access to keys beyond `organic_results` on the `data` property is untyped in the tool layer. Fix: remove the duplicate from `tools/types.ts` and import from `_core/types.ts`.

### Issue 3 — LOW: `ProbeStatus` union divergence between health tools and `_core`
**Files:** `src/_core/types.ts:125` vs `src/tools/health.ts:6` vs `src/tools/health_all.ts:17`
Three independent definitions. `health_all.ts` adds `"misconfigured"` not present in `_core`. If a future component imports `ProbeStatus` from `_core` and receives `"misconfigured"` from `health_all`, it is a type error at runtime invisible to TypeScript. Fix: move to `_core`, add `"misconfigured"`, import everywhere.

### Issue 4 — LOW: `AiMonitorParams` double definition
**Files:** `src/tools/ai_monitor.ts:7` and `src/tools/types.ts:419`
`ai_monitor.ts` exports a hand-written interface while `types.ts` exports a Zod-inferred type with the same name. `ai_monitor.ts` uses its own definition; it never imports the Zod-inferred version. This breaks the invariant that all param types are derived from validated schemas. If the schema in `types.ts` is updated (e.g., adding a field with `.min()`), the interface in `ai_monitor.ts` will silently diverge. Fix: delete the manual interface, import from `types.ts`.

### Issue 5 — LOW: `html.ts` `coerceToString(value: any)` and `set(..., value: any)`
**File:** `src/utils/html.ts:314, 332`
Unlike the cheerio callback `any` uses (which have no good alternative), these two internal utility functions accept `any` where `unknown` with narrowing is appropriate. `coerceToString` tests for `null`, string, number, boolean, array — all branches are already there, the parameter just needs to be `unknown`. This is the only genuinely lazy `any` in the codebase.

---

## Recommended tsconfig Additions

```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true
  }
}
```

**Impact assessment:**
- `noUncheckedIndexedAccess` — will surface array index reads in `scrape.ts`, `search.ts`, `format.ts`. Expect 10-20 errors to fix.
- `noImplicitReturns` — likely zero or few errors given current function structure.
- `noUnusedLocals` / `noUnusedParameters` — may surface unused private fields or function params.
- `exactOptionalPropertyTypes` — will require explicit `undefined` on optional property assignments. Could surface 5-15 issues in Zod `.optional()` consumers.

Recommend enabling `noUncheckedIndexedAccess` first as it has the most security and runtime correctness value.

---

## Summary

| Dimension | Score | Notes |
|-----------|-------|-------|
| Zero TSC errors | Pass | Clean build |
| `any` count | 18 total | 13 cheerio (justified), 5 MCP SDK (workaround), 2 fixable |
| `as unknown as` count | 2 | 1 safe, 1 latent bug |
| Zod schema coverage | High | All public tool APIs validated |
| Type centralization | Partial | `_core/types.ts` defined but largely orphaned |
| Duplicate types | 5 sets | `NovadaSearchResult`, `ProbeResult/Status`, `RenderMode`, `VerifyResult`, `AiMonitorParams` |
| Strictness flags | Moderate | `strict: true` but 4 additional flags missing |
