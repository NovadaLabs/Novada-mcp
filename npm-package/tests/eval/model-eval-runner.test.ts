/**
 * Layer 5 (tool-selection eval) — Tier B validator + unconditional-gate coverage.
 *
 * Two things this suite closes, both found by an independent gate audit of the
 * eval harness (2026-07-19 gate-hardening pass):
 *
 * 1. FIX 3 — validator coverage. validateTaskSet / validateTaskSurfaces /
 *    loadSurfaceFilter (all exported from eval/model-eval-runner.mjs and
 *    eval/baseline-selector.mjs) protect the T06/T10 class of bug: a task
 *    tagged for a surface whose OWN expected_tool isn't actually exposed on
 *    that surface (config/surfaces.json) is a structurally guaranteed miss,
 *    not a real routing signal — see eval-tasks.json's porting_notes point (2),
 *    where wiring model-eval-runner.mjs to the REAL surfaces manifest caught
 *    exactly this for novada_site_copy (T06) and novada_verify (T10) on
 *    hosted-15. That protection previously lived ONLY inside
 *    model-eval-runner.mjs's main(), which requires ANTHROPIC_API_KEY and is
 *    never invoked by `npm test` or by CI without a live key — so a
 *    regression here (e.g. a future task's surfaces[] drifting out of sync
 *    with config/surfaces.json) could sit undetected on every fork/PR
 *    indefinitely. This suite imports the pure validator functions directly
 *    and runs them against the REAL, committed config/surfaces.json plus
 *    synthetic bad-task fixtures, so `npm test` enforces it on every run —
 *    mirroring tests/eval/baseline-selector.test.ts's existing pattern.
 *
 *    Safe to import model-eval-runner.mjs/baseline-selector.mjs directly here:
 *    neither module touches the filesystem or the network at import time (only
 *    inside their guarded `main()`, which only auto-runs when the file is
 *    executed directly via `node <file>.mjs` — vitest never does that, so
 *    importing their named exports is exactly as side-effect-free as the
 *    existing baseline-selector.test.ts already assumes for its duplicated
 *    copy of the same functions).
 *
 * 2. FIX 1 — Tier B unconditional hard gate. evaluateGate (also exported from
 *    model-eval-runner.mjs) previously only produced a `gate_pass` decision
 *    inside an `if (--baseline=...)` branch that no CI invocation populates
 *    (no prior run's JSON artifact has ever existed) — meaning
 *    model-eval-runner.mjs exited 0 for ANY accuracy/forbidden/error outcome,
 *    every single time it actually ran. evaluateGate is now a pure function
 *    (no network, no filesystem, no process.exit) that takes a synthetic
 *    `summary` object of exactly the shape runLive() produces. This suite
 *    feeds it 100%/50%/0%-accuracy summaries, with/without forbidden hits,
 *    with errors, and with a dropped sibling, and asserts the resulting
 *    gate_pass/fail-reason decision each time — WITHOUT ever calling the real
 *    Anthropic API (no ANTHROPIC_API_KEY is read, set, or required by this
 *    file; no `fetch` call is made).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadSurfaceFilter,
  validateTaskSurfaces,
  evaluateGate,
  ABSOLUTE_ACCURACY_FLOOR,
  SIBLING_ACCURACY_FLOOR,
  MAX_ERROR_RATE,
} from "../../eval/model-eval-runner.mjs";
import { validateTaskSet } from "../../eval/baseline-selector.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Task {
  id: string;
  prompt: string;
  expected_tool: string;
  acceptable_tools?: string[];
  unacceptable_tools?: string[];
  sibling_watch?: string[];
  surfaces?: string[];
}

describe("Layer 5 eval harness — Tier B validators (surface + task-set fail-loud guards, FIX 3)", () => {
  const tasksPath = resolve(__dirname, "../../eval/eval-tasks.json");
  const { tasks } = JSON.parse(readFileSync(tasksPath, "utf8")) as { tasks: Task[] };

  it("sanity: task set loaded from the real, committed eval-tasks.json", () => {
    expect(tasks.length).toBe(20);
  });

  it("loadSurfaceFilter: 'default' surface (real config/surfaces.json) has no filter (tools: '*')", () => {
    expect(loadSurfaceFilter("default")).toBeNull();
  });

  it("loadSurfaceFilter: 'hosted-15' surface returns the real committed 15-tool set from config/surfaces.json", () => {
    const filter = loadSurfaceFilter("hosted-15");
    expect(filter).not.toBeNull();
    expect((filter as Set<string>).size).toBe(15);
    expect((filter as Set<string>).has("novada_search")).toBe(true);
    // These are exactly the two tools eval-tasks.json's porting_notes documents as
    // dropped from hosted-15's surfaces[] (T06/T10) — confirming the manifest still
    // excludes them is what makes the next test's "bad task" synthetic actually bad.
    expect((filter as Set<string>).has("novada_site_copy")).toBe(false);
    expect((filter as Set<string>).has("novada_verify")).toBe(false);
  });

  it("loadSurfaceFilter: an unknown surface name fails loud (a typo is not silently 'no filter')", () => {
    expect(() => loadSurfaceFilter("does-not-exist-surface")).toThrow(/Unknown --surface/);
  });

  it("validateTaskSurfaces: the REAL committed eval-tasks.json has ZERO surface mismatches on hosted-15 today", () => {
    const filter = loadSurfaceFilter("hosted-15") as Set<string>;
    const hosted15Tasks = tasks.filter((t) => !t.surfaces || t.surfaces.includes("hosted-15"));
    const problems = validateTaskSurfaces(hosted15Tasks, "hosted-15", filter, filter);
    expect(problems).toEqual([]);
  });

  it("validateTaskSurfaces: HARD fail-loud — catches the exact T06/T10 class of bug (a task tagged for hosted-15 whose expected_tool hosted-15 does not expose)", () => {
    const filter = loadSurfaceFilter("hosted-15") as Set<string>;
    const badTask: Task = {
      id: "zz-scratch-site-copy-on-hosted-15",
      prompt: "irrelevant",
      expected_tool: "novada_site_copy", // confirmed above: NOT in hosted-15's tool set
      surfaces: ["hosted-15"],
    };
    const problems = validateTaskSurfaces([badTask], "hosted-15", filter, filter);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("zz-scratch-site-copy-on-hosted-15");
    expect(problems[0]).toContain("novada_site_copy");
  });

  it("validateTaskSurfaces: filter===null (e.g. 'default', unfiltered) never reports a mismatch — every tool is exposed", () => {
    const badTask: Task = {
      id: "zz-scratch-anything",
      prompt: "irrelevant",
      expected_tool: "novada_this_tool_does_not_even_exist",
      surfaces: ["default"],
    };
    expect(validateTaskSurfaces([badTask], "default", null, new Set())).toEqual([]);
  });

  it("validateTaskSet (shared with Tier A via baseline-selector.mjs): flags a synthetic task referencing an unknown tool name", () => {
    const problems = validateTaskSet(
      [{ id: "zz-scratch", prompt: "irrelevant", expected_tool: "novada_totally_made_up" }],
      ["novada_search", "novada_extract"],
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("novada_totally_made_up");
  });
});

describe("Layer 5 eval harness — Tier B unconditional hard gate (evaluateGate, synthetic inputs, ZERO Anthropic calls, FIX 1)", () => {
  interface SyntheticSummary {
    accuracy: number;
    error_rate?: number;
    sibling_accuracy?: Record<string, number>;
    errors?: Array<{ id: string; error: string }>;
    forbidden_hits?: string[];
  }

  function makeSummary(overrides: Partial<SyntheticSummary> = {}): SyntheticSummary {
    return {
      accuracy: 1,
      error_rate: 0,
      sibling_accuracy: {},
      errors: [],
      forbidden_hits: [],
      ...overrides,
    };
  }

  it("PASSES at 100% accuracy, no forbidden hits, no errors, no siblings below floor", () => {
    const result = evaluateGate(makeSummary());
    expect(result.gate_pass).toBe(true);
    expect(result.unconditional_gate_pass).toBe(true);
    expect(result.unconditional_gate_fail_reasons).toEqual([]);
  });

  it(`PASSES exactly AT the absolute floor (${ABSOLUTE_ACCURACY_FLOOR})`, () => {
    const result = evaluateGate(makeSummary({ accuracy: ABSOLUTE_ACCURACY_FLOOR }));
    expect(result.gate_pass).toBe(true);
  });

  it("FAILS at 0% accuracy — the exact 'no --baseline configured' hole this fix closes (previously exited 0 unconditionally)", () => {
    const result = evaluateGate(makeSummary({ accuracy: 0 }));
    expect(result.gate_pass).toBe(false);
    expect(result.unconditional_gate_pass).toBe(false);
    expect(result.unconditional_gate_fail_reasons.some((r) => r.includes("sanity floor"))).toBe(true);
  });

  it(`FAILS just under the absolute floor (${ABSOLUTE_ACCURACY_FLOOR} - epsilon)`, () => {
    const result = evaluateGate(makeSummary({ accuracy: ABSOLUTE_ACCURACY_FLOOR - 0.01 }));
    expect(result.gate_pass).toBe(false);
  });

  it("FAILS on ANY forbidden-tool hit even at 100% aggregate accuracy", () => {
    const result = evaluateGate(makeSummary({ accuracy: 1, forbidden_hits: ["T03-multi-source-synthesis"] }));
    expect(result.gate_pass).toBe(false);
    expect(result.unconditional_gate_fail_reasons.some((r) => r.includes("forbidden"))).toBe(true);
  });

  it("FAILS when the task-level error rate exceeds MAX_ERROR_RATE, even if the surviving-task accuracy would otherwise pass", () => {
    const result = evaluateGate(
      makeSummary({
        accuracy: 1,
        error_rate: MAX_ERROR_RATE + 0.01,
        errors: [{ id: "T02-single-url-read", error: "Anthropic API 500: internal error" }],
      }),
    );
    expect(result.gate_pass).toBe(false);
    expect(result.unconditional_gate_fail_reasons.some((r) => r.includes("error rate"))).toBe(true);
  });

  it("PASSES when the error rate is at or below MAX_ERROR_RATE", () => {
    const result = evaluateGate(makeSummary({ error_rate: MAX_ERROR_RATE }));
    expect(result.gate_pass).toBe(true);
  });

  it(`FAILS when a watched sibling's accuracy is below its floor (${SIBLING_ACCURACY_FLOOR}), even though aggregate accuracy is fine`, () => {
    const result = evaluateGate(
      makeSummary({ accuracy: 1, sibling_accuracy: { novada_extract: SIBLING_ACCURACY_FLOOR - 0.1, novada_search: 1 } }),
    );
    expect(result.gate_pass).toBe(false);
    expect(result.unconditional_gate_fail_reasons.some((r) => r.includes("sibling"))).toBe(true);
  });

  it("PASSES when every watched sibling is at or above its floor", () => {
    const result = evaluateGate(makeSummary({ sibling_accuracy: { novada_extract: SIBLING_ACCURACY_FLOOR, novada_search: 1 } }));
    expect(result.gate_pass).toBe(true);
  });

  it("--baseline mode: FAILS when a sibling present in the prior run's dict DROPS OUT of the current run's dict (surfaced as regressed, not silently skipped)", () => {
    const prior = makeSummary({ sibling_accuracy: { novada_extract: 1, novada_crawl: 1 } });
    const current = makeSummary({ sibling_accuracy: { novada_extract: 1 } }); // novada_crawl missing entirely
    const result = evaluateGate(current, prior);
    expect(result.gate_pass).toBe(false);
    expect(result.dropped_siblings).toContain("novada_crawl");
    expect(result.regressed_siblings).toContain("novada_crawl");
  });

  it("--baseline mode: FAILS when aggregate accuracy regresses vs the prior run", () => {
    const prior = makeSummary({ accuracy: 1 });
    const current = makeSummary({ accuracy: 0.8 });
    const result = evaluateGate(current, prior);
    expect(result.gate_pass).toBe(false);
    expect(result.baseline_gate_pass).toBe(false);
    // Unconditional gate alone would have passed at 80% (above the absolute floor) —
    // proving the baseline comparison is a genuinely ADDITIONAL, stricter check.
    expect(result.unconditional_gate_pass).toBe(true);
  });

  it("--baseline mode: FAILS when a named sibling's accuracy regresses vs the prior run even though aggregate accuracy holds steady", () => {
    const prior = makeSummary({ accuracy: 0.9, sibling_accuracy: { novada_extract: 1 } });
    const current = makeSummary({ accuracy: 0.9, sibling_accuracy: { novada_extract: 0.5 } });
    const result = evaluateGate(current, prior);
    expect(result.gate_pass).toBe(false);
    expect(result.regressed_siblings).toContain("novada_extract");
  });

  it("--baseline mode: PASSES when nothing regressed (accuracy steady, no sibling drop, no forbidden, above floor)", () => {
    const prior = makeSummary({ accuracy: 0.9, sibling_accuracy: { novada_extract: 0.8 } });
    const current = makeSummary({ accuracy: 0.9, sibling_accuracy: { novada_extract: 0.8 } });
    const result = evaluateGate(current, prior);
    expect(result.gate_pass).toBe(true);
  });

  it("--baseline mode does NOT bypass the unconditional floor — an improving-but-still-below-floor run still fails", () => {
    const prior = makeSummary({ accuracy: 0.1 });
    const current = makeSummary({ accuracy: 0.2 }); // improved vs prior, but still below ABSOLUTE_ACCURACY_FLOOR
    const result = evaluateGate(current, prior);
    expect(result.unconditional_gate_pass).toBe(false);
    expect(result.gate_pass).toBe(false);
  });
});
