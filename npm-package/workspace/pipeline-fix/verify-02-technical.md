# Technical Architecture Verification: Dual-Output Structure

**Reviewer:** Architecture Verification Agent
**Date:** 2026-06-25
**Scope:** `output_formats` param for novada_extract + `include_sources` for novada_research

---

## Q1 — Can we get raw HTML from the current pipeline?

**VERDICT: NEEDS_CHANGE — html is available, but requires a structural adjustment to surface it.**

The `html` variable is a live local in `extractSingleInner` (extract.ts:184). It holds the final, best-quality HTML after all escalation steps (static → render → browser → wayback). It is never returned to the caller in normal flow; instead it is consumed by `extractMainContent`/`extractFullPageContent` and then the string goes out of scope.

The `format === "html"` branch (line 362–368) does return raw HTML, but it caps at 10,000 chars with a truncation comment — this is a deliberately lossy response path, not a file-save path.

**There is no `result.html` or `result.raw` surface** at the callsite. `extractSingle` and `novadaExtract` only return `string` (the markdown/JSON/text output). The raw HTML string never escapes `extractSingleInner`.

**What is needed:**

The cleanest approach is to make `extractSingleInner` return a richer object when `output_formats` includes `"html"`, rather than a plain `string`. This is a breaking internal change to the function signature — callers (`extractSingle`, the batch loop) would need updating too.

**Least-invasive option:** Pass an `outputCollector` object by reference into `extractSingleInner`, populated with `{ html, md, json }` before the function returns. The function signature stays `string`-returning for backward compat; the collector is a side-channel for file saves only.

```typescript
// New internal type (not exposed in MCP schema)
interface ExtractionArtifacts {
  html?: string;       // raw HTML string, set only when output_formats includes "html"
  md?: string;         // the markdown output (already built)
  json?: object;       // the json result object (already built at line 596)
}
```

The `html` variable at line 184 IS the right value to save — it is post-escalation, post-redirect-rewrite, and correctly populated for PDF paths (which replace html with text). For PDF inputs, `html` at the save point will contain extracted text, not HTML markup — acceptable for an `.html` file labeled accordingly.

**Edge case:** When `formatJsonExtract` returns early (lines 222–224, 280–282) for JSON-content-type responses, there is no real HTML to save. The early-return guard should skip HTML file save for those paths.

---

## Q2 — What should the JSON structure be?

**VERDICT: GOOD — reuse the existing jsonResult object already built at line 596.**

When `format === "json"`, the code already constructs a rich `jsonResult` object (lines 596–650) with all fields the proposed design would want:

| Field | Source in existing code |
|---|---|
| `url` | `params.url` |
| `title` | `extractTitle(html)` |
| `description` | `extractDescription(html)` |
| `mode` | `usedMode` ("static"/"render"/"browser") |
| `source` | `waybackFallback ? "wayback" : "live"` |
| `fetched_at` | `fetchedAt` (line 182) |
| `quality` | `{ score, label, content_ok }` |
| `content` | `displayContent` (markdown, truncation-aware) |
| `structured_data` | `extractStructuredData(html)` |
| `fields` | `fieldResults` from `extractFields()` |
| `links` | `{ same_domain, total }` |
| `hints` | built hint array |
| `pdf` | conditional, when applicable |

**No new type interface is needed for file-save purposes.** The existing shape is well-defined. A new exported `ExtractJsonOutput` type would only be needed if external consumers need to type-check against it — unnecessary for now.

The only addition for the file-save JSON that is NOT in the current shape is `raw_html_path` (a backlink to the .html file, if saved). Add it conditionally after parallel saves complete.

**For `_sources.json` in research:** the `sources` array at research.ts:148 is already populated with `{ title, url, snippet }` for all sources (up to 15). The `extractedContents` array adds `content` for fully-fetched sources. A suitable structure:

```typescript
interface ResearchSourcesJson {
  question: string;
  depth: string;
  timestamp: string;
  sources: Array<{
    url: string;
    title: string;
    snippet: string;
    extracted: boolean;   // true = full content was fetched
  }>;
}
```

This can be built entirely from existing local variables in `novadaResearch` without any upstream changes.

---

## Q3 — Performance impact of saving 3 files?

**VERDICT: GOOD — parallel saves are already the right approach; 3 files adds negligible overhead.**

`saveOutput` calls `writeFile` (Node.js `fs/promises`) which is async I/O. The current code calls it once sequentially at the end of `extractSingleInner` (line 854–861 for md, line 655–662 for json). Both are wrapped in `try/catch { /* best-effort */ }` so they never block the return value.

**For multi-format saves**, use `Promise.allSettled` on all three writes simultaneously — all three files share the same timestamp-based name stem, differing only in extension:

```typescript
// All three saves run in parallel — total wall time = slowest single write
const [mdResult, htmlResult, jsonResult_] = await Promise.allSettled([
  formats.includes("md")   ? saveOutput({ tool, hint, format: "md",   data: mdOutput }) : Promise.resolve(null),
  formats.includes("html") ? saveOutput({ tool, hint, format: "html", data: rawHtml  }) : Promise.resolve(null),
  formats.includes("json") ? saveOutput({ tool, hint, format: "json", data: jsonObj  }) : Promise.resolve(null),
]);
```

Typical page content is 10–200KB. Three parallel writes at that size: ~5–15ms on any modern SSD. The network fetch (static: 200–3000ms, render: 3–10s) dominates by 2–3 orders of magnitude. The I/O overhead is not measurable in practice.

**One real concern:** `saveOutput` currently calls `getOutputDir()` once per call, which calls `mkdir({ recursive: true })` each time. With 3 parallel calls, you get 3 concurrent `mkdir` calls on the same path. `recursive: true` makes this idempotent (no EEXIST throw), so it is safe — but mildly wasteful. Optimization: call `getOutputDir()` once and pass the resolved path to all three saves. This is a micro-optimization, not a blocker.

---

## Q4 — Backward compatibility?

**VERDICT: GOOD — fully backward compatible with the proposed default.**

**For `output_formats` on novada_extract:**

The existing `ExtractParamsSchema` (types.ts:74) is a Zod schema. Adding a new optional field with a default is non-breaking:

```typescript
output_formats: z.array(z.enum(["md", "html", "json"])).default(["md"]).optional()
  .describe("File formats to save locally. Default [\"md\"]. Add \"html\" for raw HTML, \"json\" for structured data.")
```

Default `["md"]` preserves current behavior exactly — one `.md` file saved, as today. Agents that don't pass `output_formats` see no change in output or behavior.

The `format` param (line 86 of types.ts) controls what the tool *returns* to the agent (text/markdown/html/json). `output_formats` controls what gets *saved to disk*. These are orthogonal concerns — no naming collision.

**For `include_sources` on novada_research:**

`ResearchParamsSchema` (types.ts:128) similarly takes a new optional boolean:

```typescript
include_sources: z.boolean().default(false).optional()
  .describe("When true, saves a _sources.json file alongside the .md report with all source URLs and snippets.")
```

Default `false` means zero behavior change for existing callers.

**Test file check:** No test files reference specific output file naming patterns.

```
grep -r "output_formats\|_sources\.json\|\.html\|\.md\|filePath" /Users/tongwu/Projects/novada-mcp/src/
```

The `filePath` field in `OutputResult` is used only to append `Output saved: ...` to the tool response string. No test asserts the exact file path value.

**Batch mode consideration:** `novadaExtract` in batch mode calls `extractSingle` per URL (lines 34–41). If `output_formats` includes `"html"`, each URL would produce up to 3 files. For a 10-URL batch, that is up to 30 files in one call. This is acceptable but should be documented.

---

## Summary Table

| Question | Verdict | Key Finding |
|---|---|---|
| Raw HTML availability | NEEDS_CHANGE | `html` var exists inside `extractSingleInner` but never surfaces; needs side-channel collector or return-type change |
| JSON structure | GOOD | Existing `jsonResult` at line 596 already has all needed fields; reuse it directly |
| Performance | GOOD | 3 parallel `writeFile` calls add ~5–15ms; network fetch dominates; safe with `Promise.allSettled` |
| Backward compatibility | GOOD | Optional params with correct defaults preserve all existing behavior; no test breakage |

---

## Concrete Code Plan

### Step 1 — Add `output_formats` to types.ts

In `ExtractParamsSchema` (after line 104):
```typescript
output_formats: z.array(z.enum(["md", "html", "json"])).default(["md"]).optional()
```

In `ResearchParamsSchema` (after line 135):
```typescript
include_sources: z.boolean().default(false).optional()
```

### Step 2 — Collect artifacts in extractSingleInner (extract.ts)

At the top of `extractSingleInner`, declare a side-channel collector:
```typescript
const artifacts: { html?: string; jsonObj?: Record<string, unknown> } = {};
```

After the final `html` value is settled (after all escalation, after wayback fallback — approximately line 549), assign:
```typescript
// Only collect if caller wants html file output
if (params.output_formats?.includes("html")) {
  artifacts.html = html.startsWith("pdf_pages:") ? undefined : html;
}
```

After the `jsonResult` object is built (line ~617), assign:
```typescript
if (params.output_formats?.includes("json")) {
  artifacts.jsonObj = jsonResult;
}
```

### Step 3 — Replace single saveOutput call with parallel saves (extract.ts)

Replace the single save block at lines 851–861 (markdown path) with:
```typescript
try {
  const domain = new URL(params.url).hostname.replace("www.", "");
  const formats = params.output_formats ?? ["md"];
  const dir = await getOutputDir(); // call once, reuse for all saves

  const saves = await Promise.allSettled([
    formats.includes("md")   ? saveOutput({ tool: "extract", hint: domain, format: "md",   data: mdOutput }) : Promise.resolve(null),
    formats.includes("html") && artifacts.html
      ? saveOutput({ tool: "extract", hint: domain, format: "html", data: artifacts.html }) : Promise.resolve(null),
    formats.includes("json") && artifacts.jsonObj
      ? saveOutput({ tool: "extract", hint: domain, format: "json", data: artifacts.jsonObj }) : Promise.resolve(null),
  ]);

  const savedPaths = saves
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => (r as PromiseFulfilledResult<OutputResult | null>).value?.filePath)
    .filter(Boolean);

  if (savedPaths.length > 0) {
    mdOutput += `\n\n---\nOutput saved: ${savedPaths.join(", ")}`;
  }
} catch { /* best-effort */ }
```

Note: `saveOutput` in output.ts does not accept a pre-resolved `dir`. Either export `getOutputDir` from output.ts for reuse, or accept the 3x `mkdir` overhead (it is safe).

### Step 4 — Add _sources.json save in research.ts

After `finalReport` is built (line ~266), before the existing save block:
```typescript
if (params.include_sources) {
  try {
    const sourcesData = {
      question: params.question ?? params.query ?? "",
      depth: resolvedDepth,
      timestamp: new Date().toISOString(),
      sources: [
        ...extractedContents.map(s => ({ url: s.url, title: s.title, snippet: "", extracted: true })),
        ...extractFailedSources.map(s => ({ url: s.url, title: s.title, snippet: s.snippet, extracted: false })),
        ...sources
          .filter(s => !extractedContents.some(e => e.url === s.url) && !extractFailedSources.some(f => f.url === s.url))
          .map(s => ({ url: s.url, title: s.title, snippet: s.snippet, extracted: false })),
      ],
    };
    const sourcesResult = await saveOutput({
      tool: "research",
      hint: (params.question?.slice(0, 30) || "research") + "_sources",
      format: "json",
      data: sourcesData,
    });
    finalReport += `\n\n---\nSources index saved: ${sourcesResult.filePath}`;
  } catch { /* best-effort */ }
}
```

### Step 5 — Export getOutputDir from output.ts (optional optimization)

Change line 38:
```typescript
// was: async function getOutputDir()
export async function getOutputDir(): Promise<string>
```

This allows callers to resolve the dir once before parallel saves, eliminating redundant `mkdir` calls.

---

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| `html` var contains PDF text when input is a PDF URL | LOW | Guard: `artifacts.html = html.startsWith("pdf_pages:") ? undefined : html` |
| `formatJsonExtract` early-return has no `html` to save | LOW | Collector is only assigned after escalation; early returns skip the collector entirely |
| Batch mode generates up to 30 files for 10-URL batch | INFO | Document in param description; no functional risk |
| `getOutputDir()` called 3× concurrently | LOW | `mkdir({ recursive: true })` is safe; optimize with export if needed |
