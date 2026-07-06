# Agent 7 — DX & Maintainability Specialist

## 1. Maintainability Cost of the 234-Line Output Section

`extractSingle` runs from line 155 to 783 — roughly 630 lines as a single async function. The output formatting block (lines 550–783) is not a separate concern; it runs inline after ~400 lines of fetch routing, quality scoring, and field extraction. The cost is concrete:

- **No unit boundary.** You cannot test the markdown formatter without executing a full HTTP mock chain. Every output test must set up API responses, anti-bot state, PDF detection, truncation, and wayback flags just to assert a hint string.
- **Hidden state coupling.** The formatter reads 15+ local variables (`usedMode`, `stillJsHeavy`, `renderError`, `isTruncated`, `waybackFallback`, `redditUrl`, `baseDomain`, `extractionQuality`, `fieldResults`, `hasStructuredData`, `antiBotResolved`, `autoEscalated`, `autoEscalatedTo`, `pdfPages`, `metaExtra`) that were set by earlier branches in the same function. None are passed as arguments; all are captured by closure. Adding a new output field means tracing 600 lines of implicit state.
- **SCRAPER_PLATFORMS is defined twice.** The same `Record<string, string>` literal appears at lines 594 and 741 — once for JSON output, once for markdown. This is a direct consequence of the mixed-format branching pattern: the json path returns early, so the shared hint logic is duplicated rather than extracted.

## 2. Test Failures: Structure vs. Configuration

Of the 55 failures, approximately:

- **~8 structural:** Tests for `extract.test.ts` (5 failures) assert on output shape (`mode:render`, `## Extract Failed`, no markdown headers in text format) but the function no longer matches those contracts. The `resources/index.test.ts` failures (2) are a hardcoded count expectation vs. a new resource being added — a classic "test as snapshot of state" problem. The `errors.test.ts` failures (2) are missing `Retryable:` lines in `toAgentString`.
- **~47 configuration/API-contract:** `research`, `crawl`, `scrape`, `health`, `proxy`, `sdk/client`, `http`, `router`, and `schemas` failures are all mismatches between mocked API responses and evolved internal logic (new Zod v4 schemas, proxy username format changes, health output label changes, scraper API response shape). These fail because internal API contracts changed without the tests being updated.

What this tells us about testability: the 8 structural failures expose a real problem — output shape is not an independently testable interface. When the formatter changes (and it does, frequently, given its size), there is no isolated formatter unit to test. The 47 configuration failures are expected churn for a fast-moving API wrapper, not a structural defect.

## 3. Bug Surface Area for a New Engineer

To safely add a feature to `extract.ts`, an engineer must understand:

- **1 public entry point** (`novadaExtract`) that dispatches to batch or single mode
- **1 private function** (`extractSingle`) with ~15 implicit output state variables
- **4 render path branches** (browser / render / auto / static), each with separate escalation and error-capture logic
- **2 format exit paths** (json early-return at line 613, markdown assembly at lines 616–783) with duplicated hint logic between them
- **3 external side effects:** `getCached`/`setCached` on entry/exit, `lookupDomain` pre-populating `detectedAntiBot`, and `fetchViaBrowser`/`fetchWithRender`/`fetchViaProxy` each modifying `usedMode` and `renderError`
- **2 mutation patterns:** `params` is reassigned in-place for reddit rewrite and render alias normalization
- **1 implicit SCRAPER_PLATFORMS duplication** that must be kept in sync manually

Total: 1 entry, 1 god function, ~15 implicit state vars, 4 render branches, 2 format exits, 3 external side effects, 2 mutation points. A new engineer making a change to hints or output will realistically touch both format branches and miss one — that is the most likely bug vector.

## 4. Boilerplate Copy-Paste When Adding a New Tool

The pattern is structural. `novadaExtract` owns: URL normalization, cache get/set, API calls, quality scoring, and output formatting. When `novada_monitor` was added, the output formatter (the `lines: string[]` assembly with `## Agent Hints`, `## Agent Memory`, `## Agent Action` blocks) was replicated in the new tool's file. There is no shared `formatToolOutput(result, hints, actions)` primitive. Each tool is a self-contained island. The structural reason is that output variables are tightly coupled to mid-function state — there is no `ExtractionResult` value type that could be passed to a shared formatter.

## 5. The One Change That Would Most Improve Maintainability

**Extract the output formatter into a pure function.** Define an `ExtractionResult` interface capturing all post-fetch state (`usedMode`, `quality`, `fieldResults`, `structuredData`, `links`, flags, etc.) and move the entire lines-assembly and JSON-assembly logic into `formatExtractionResult(result: ExtractionResult, format: string): string`. This is the single change with the highest leverage:

- It eliminates the SCRAPER_PLATFORMS duplication immediately
- It makes the formatter independently unit-testable without HTTP mocks
- It creates a natural seam for other tools to share the `## Agent Hints / ## Agent Action` pattern
- It does not require touching any fetch logic, routing, or API calls

This is a localized extraction (one new file, one new type, one function refactored to call it) — not a full refactor.

## 6. Ratings

**Testability: 4/10.** The 55-failure suite against 638 total tests (8.6% failure rate) understates the real issue: the extract tests that do pass are brittle string-contains assertions against a 600-line function's string output. There is no way to test the formatter in isolation. Mocking the entire HTTP stack to test a hint string is disproportionate setup cost.

**Readability: 5/10.** The fetch routing section (lines 155–550) is reasonably well-commented with P1-/P2-/P3- markers. The output section reads as accumulated feature additions: each hint condition was appended in order with no grouping, making it hard to identify what fires under which render state. The duplication of SCRAPER_PLATFORMS is the most obvious signal.

**Extension Safety: 3/10.** The 2-format divergence (json early-return vs markdown assembly) is an active trap. Any new output field must be added in both branches. The implicit state means a new engineer cannot identify all the conditions that affect output without reading the entire function. The `params` mutation pattern is a second trap: if a caller passes params by reference expecting them unchanged, reddit rewrites and render-alias normalization silently modify them upstream of the output.
