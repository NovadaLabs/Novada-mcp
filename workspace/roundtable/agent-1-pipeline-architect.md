# Agent 1: Pipeline Architect — Analysis

## 1. Core Structural Problem in extractSingle()

`extractSingle()` spans lines 155–784: a single function that owns fetch strategy selection, content-type routing, anti-bot detection, three escalation tiers, quality scoring, Wayback fallback, field extraction, and every output format. This is not "a big function" — it is a **state machine disguised as sequential code**, with at least seven mutable variables (`html`, `usedMode`, `detectedAntiBot`, `antiBotResolved`, `mainContent`, `quality`, `title`) that are reassigned across non-adjacent sections.

Specific anti-patterns:

**Mutating params in-place (line 161, 175):**
```typescript
if (params.render === "js") params = { ...params, render: "render" };
// ...
if (redditUrl) params = { ...params, url: redditUrl, render: "static" };
```
Callers cannot reason about which `params` are in effect by line 250.

**Duplicated content-type branching (lines 203–229 and 261–286):**
The PDF / JSON / HTML triage block appears verbatim twice — once for `render` mode (lines 204–229) and once for `static/auto` mode (lines 261–286). A fix to one branch will miss the other.

**Duplicated link-recomputation (lines 429–435, 463–468, 500–505):**
Every escalation tier (render, browser, Wayback) manually rebuilds `allLinks` and `sameDomainLinks`. Three identical filter+slice blocks. Each is a new site for divergence.

**Early returns interleaved with side-effects (line 218, 275):**
`formatJsonExtract()` is called mid-fetch before state variables are set, making it impossible to add post-fetch behavior (e.g., caching, field extraction) without auditing every return path.

**`SCRAPER_PLATFORMS` dictionary defined twice (lines 594–599 and 741–747):**
The markdown and JSON output paths each define the same in-function constant. Already diverged in whitespace.

---

## 2. Pipeline Pattern for This Codebase

The function's real shape is a linear pipeline with conditional stage selection. Make that explicit:

```typescript
interface ExtractionContext {
  // Input
  readonly url: string;
  readonly params: ExtractParams;
  readonly apiKey: string | undefined;

  // Stage outputs — populated as pipeline progresses
  html: string | null;
  usedMode: "static" | "render" | "browser" | "render-failed" | null;
  contentType: string | null;
  detectedAntiBot: string | null;
  antiBotResolved: boolean;
  quality: QualityResult | null;
  mainContent: string | null;
  structuredData: StructuredData | null;
  links: LinkSet | null;
  fieldResults: FieldResult[] | null;
  waybackFallback: boolean;
  autoEscalated: boolean;
}

type Stage = (ctx: ExtractionContext) => Promise<void>;

const pipeline: Stage[] = [
  normalizeInputStage,      // param rewrites (js→render, reddit URL)
  cacheCheckStage,          // return cached or continue
  fetchStage,               // resolve effectiveMode, call fetch function
  contentTypeRouterStage,   // PDF / JSON / HTML — once, shared
  antibotEscalationStage,   // render → browser escalation
  qualityEscalationStage,   // score < 40 → render → browser
  waybackFallbackStage,     // score < 20 → archive.org
  contentExtractionStage,   // extractMainContent, links, structuredData
  fieldExtractionStage,     // params.fields
  formatOutputStage,        // markdown / json / text / html
];
```

Each stage reads from `ctx`, mutates only its own slice, and can be tested in isolation with a fake `ctx`.

---

## 3. Three Bugs Directly Caused by the Current Structure

**QW-1 (wait_for dropped in auto escalation):** `wait_for` is passed to `fetchViaBrowser` at the forced-browser path (line 200) but the auto-escalation path at line 302 also calls `fetchViaBrowser` — correctly passing `wait_for`. However, the quality-escalation browser path (line 454) and the render-failed browser path (line 328) also call `fetchViaBrowser` with `wait_for`. With a pipeline, `fetchViaBrowser` is called exactly once in `fetchStage`, and `wait_for` is on the `ctx` — unreachable to miss.

**MT-1 (proxy tier not propagated):** `domainProxyTier` is resolved from `domainHint` at line 249 and threaded into `fetchViaProxy` calls at lines 258–260. The auto-escalation render path (line 295) calls `fetchWithRender` — which has no `proxyTier` parameter — silently dropping the tier. A pipeline `fetchStage` would build a single `FetchOptions` struct from `ctx` (including tier) and pass it to a unified fetch dispatcher, making tier propagation a compile-time guarantee.

**MT-2 (wait_ms void):** `wait_ms` is accepted in `ExtractParams` and passed to `fetchViaBrowser` at lines 200, 233, 302, 316, 328, 454. But when the auto-escalation render path decides to try browser (line 452–482), the second `fetchViaBrowser` call at line 454 does pass `wait_ms`. However because `wait_ms` is typed `number | undefined` and the underlying `fetchViaBrowser` signature treats it as optional with no default, a `0` passed explicitly is treated as falsy in downstream wait logic — behaving as void. A pipeline `normalizeInputStage` would coerce `wait_ms: 0` to `null` or enforce a minimum, ensuring it never silently voids.

---

## 4. Risk of Not Refactoring

At 20+ tools, the codebase will accumulate:

- **Silent parameter drops:** Every new fetch capability (e.g., a `session_id` param, a `country` override) must be threaded through 6+ call sites in `extractSingle`. One missed call site = silent regression, no type error.
- **Test surface collapse:** You cannot unit-test the Wayback fallback without also exercising all upstream fetch logic. The function is monolithically untestable below integration level.
- **Format drift:** The `SCRAPER_PLATFORMS` dict is already defined twice. At 20 tools sharing similar hint logic, you will have 5+ copies with subtle differences — all silently correct from TypeScript's perspective.
- **Escalation logic forking:** A new fetch tier (e.g., a stealth proxy tier) requires modifying 4 escalation branches. The probability of missing one is near 100%.
- **Cache bypass surface:** `setCached` is called only at lines 612 and 782 — the two terminal return paths. Adding a third output format or a third early-return (like `formatJsonExtract` at line 218/275) will silently skip caching.

---

## 5. Engineering Estimate

| Phase | Work | Days |
|-------|------|------|
| Define `ExtractionContext` + stage interfaces; extract `normalizeInputStage` + `cacheCheckStage` | 0.5 |
| Extract `fetchStage` (single fetch dispatcher, unified content-type routing) | 1.0 |
| Extract escalation stages (antibot, quality, wayback) | 1.5 |
| Extract `contentExtractionStage` + `fieldExtractionStage` | 0.5 |
| Extract `formatOutputStage` (unify markdown/json/text) | 1.0 |
| Integration tests per stage + regression pass on benchmark suite | 1.5 |

**Total: 6 engineering days** for a clean pipeline refactor with full test coverage. The duplicate-elimination work (content-type router, link recomputation, SCRAPER_PLATFORMS) is embedded in that estimate. The risk of doing it wrong once is higher than doing it methodically across a week — the benchmark suite (QW/MT series) provides the regression harness.

Zero-risk alternative: extract stages incrementally behind the existing function signature, one stage per PR, never breaking the public interface.
