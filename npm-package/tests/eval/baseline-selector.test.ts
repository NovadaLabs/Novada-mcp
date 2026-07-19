/**
 * Layer 5 (tool-selection eval) — always-on regression gate for the free,
 * deterministic Tier A baseline selector, wired into `npm test` itself so it
 * runs on literally every CI invocation of this repo's existing, already-
 * required test job (ci.yml's `npm test` step) — not just on a separately
 * triggered workflow.
 *
 * Deliberately duplicates the small (~15-line) tokenize/scoreTool/selectTool
 * algorithm from ../../eval/baseline-selector.mjs rather than importing it,
 * for the same reason discover.test.ts / collision-matrix.test.ts in this repo
 * import TOOLS/TOOL_REGISTRY from src/*.ts directly instead of build/*.js:
 * this suite must never depend on a prior `npm run build` having succeeded, so
 * a bare `npm test` (no build step) on a clean checkout stays green and
 * reflects the CURRENT source, not a possibly-stale or missing build/
 * artifact. eval/baseline-selector.mjs is a plain .mjs CLI script (matching
 * the repo's tests/live/*.mjs convention) that DOES import from build/ — see
 * its own header for why that's the right tradeoff for a script that's always
 * invoked after an explicit build step (both in eval-harness.yml and in
 * run-eval.mjs). Keeping the two tiny implementations in sync is a low-risk,
 * low-frequency manual duty (the algorithm hasn't changed since it was
 * authored) — same category of accepted, documented duplication as
 * hosted-server/vercel/api/mcp.ts's standalone TOOLS curation, which
 * scripts/check-hosted-drift.mjs guards against drifting silently. If this
 * algorithm ever needs a THIRD copy, that's the signal to extract a shared,
 * zero-dependency module both the src-grounded test and the build-grounded
 * script can import unchanged (an .mjs file with no imports of its own can be
 * imported identically by both a vitest .ts file and a plain node .mjs
 * script) — not worth doing for one duplicate.
 *
 * Recorded floor: 50% (5/10), measured 2026-07-19 against the live 23-tool
 * registry — see eval/baseline-selector.mjs's BASELINE_FLOOR doc comment for
 * the full provenance. This suite's gate is REGRESSION-vs-floor, not an
 * absolute quality bar: a green run means "no NEW description collision was
 * introduced," not "tool selection is correct." The model-in-the-loop runner
 * (eval/model-eval-runner.mjs, gated on ANTHROPIC_API_KEY, never auto-run by
 * `npm test`) is the actual quality/correctness signal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ToolMeta {
  name: string;
  description: string;
}

interface Task {
  id: string;
  prompt: string;
  expected_tool: string;
  acceptable_tools?: string[];
  unacceptable_tools?: string[];
  sibling_watch?: string[];
  surfaces?: string[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "for", "and", "or", "this",
  "that", "it", "i", "me", "my", "you", "your", "at", "with", "as", "be", "do", "does", "did",
  "what", "whats", "tell", "give", "get", "need", "want", "just", "not", "no", "has", "have",
  "since", "before", "right", "now", "up", "down", "out", "into", "from", "if", "then",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) || []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w),
  );
}

function scoreTool(promptTokens: string[], tool: ToolMeta): number {
  const descTokens = new Set(tokenize(tool.description));
  const nameTokens = new Set(tool.name.replace("novada_", "").split("_"));
  let score = 0;
  for (const t of promptTokens) {
    if (descTokens.has(t)) score += 1;
    if (nameTokens.has(t)) score += 2;
  }
  return score;
}

function selectTool(promptTokens: string[], registry: readonly ToolMeta[]): { picked: string | null } {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const tool of registry) {
    const s = scoreTool(promptTokens, tool);
    if (s > bestScore) {
      bestScore = s;
      best = tool.name;
    }
  }
  return { picked: best };
}

/**
 * Same fail-loud contract as eval/baseline-selector.mjs's validateTaskSet():
 * an unknown tool name referenced by a task is a broken eval, not a routing
 * miss, and must surface as an explicit, itemized failure — never a silent
 * skip or a false "0/N" miss folded into the accuracy number.
 */
function validateTaskSet(tasks: readonly Task[], registryNames: readonly string[]): string[] {
  const known = new Set(registryNames);
  const problems: string[] = [];
  for (const task of tasks) {
    const refs: [string, string[]][] = [
      ["expected_tool", [task.expected_tool]],
      ["acceptable_tools", task.acceptable_tools || []],
      ["unacceptable_tools", task.unacceptable_tools || []],
      ["sibling_watch", task.sibling_watch || []],
    ];
    for (const [field, names] of refs) {
      for (const name of names) {
        if (!known.has(name)) {
          problems.push(`task '${task.id}' field '${field}' references unknown tool '${name}'`);
        }
      }
    }
  }
  return problems;
}

const BASELINE_FLOOR = 5 / 10;

interface BaselineTierA {
  recorded_date: string;
  exact_accuracy: number;
  forbidden_hits: string[];
  per_task: Record<string, { correct: boolean }>;
}

interface CurrentRunLike {
  exact_accuracy: number;
  forbidden_hits: string[];
  results: Array<{ id: string; correct: boolean }>;
}

/**
 * Duplicated here on purpose, same pattern (and same rationale) as this file's
 * existing tokenize/scoreTool/selectTool/validateTaskSet copies: this suite
 * must never depend on a prior `npm run build`, and duplicating a small, rarely
 * -changed pure function is the accepted low-risk tradeoff already documented
 * in this file's header. Kept byte-for-byte equivalent to
 * eval/baseline-selector.mjs's evaluateRegressionGate (FIX 2).
 */
function evaluateRegressionGate(current: CurrentRunLike, baseline: BaselineTierA) {
  const failReasons: string[] = [];

  if (current.exact_accuracy < baseline.exact_accuracy) {
    failReasons.push(
      `exact_accuracy regressed: ${current.exact_accuracy} < committed baseline ${baseline.exact_accuracy}`,
    );
  }

  const baselineForbiddenSet = new Set(baseline.forbidden_hits);
  const newForbiddenHits = current.forbidden_hits.filter((id) => !baselineForbiddenSet.has(id));
  if (newForbiddenHits.length > 0) {
    failReasons.push(`NEW forbidden-tool hit(s): ${newForbiddenHits.join(", ")}`);
  }

  const regressedTasks: string[] = [];
  for (const r of current.results) {
    if (baseline.per_task[r.id]?.correct === true && r.correct === false) {
      regressedTasks.push(r.id);
    }
  }
  if (regressedTasks.length > 0) {
    failReasons.push(`previously-passing task(s) now FAIL: ${regressedTasks.join(", ")}`);
  }

  return {
    gate_pass: failReasons.length === 0,
    fail_reasons: failReasons,
    new_forbidden_hits: newForbiddenHits,
    regressed_tasks: regressedTasks,
  };
}

describe("Layer 5 eval harness — Tier A baseline selector (src-grounded, no build required)", () => {
  const tasksPath = resolve(__dirname, "../../eval/eval-tasks.json");
  const { tasks } = JSON.parse(readFileSync(tasksPath, "utf8")) as { tasks: Task[] };
  const baselineTierAPath = resolve(__dirname, "../../eval/baseline-tier-a.json");
  const baselineTierA = JSON.parse(readFileSync(baselineTierAPath, "utf8")) as BaselineTierA;

  it("sanity: task set and live registry both loaded", () => {
    expect(tasks.length).toBe(11);
    expect(TOOL_REGISTRY.length).toBeGreaterThan(20);
  });

  it("HARD (fail loud): every task's expected_tool/acceptable_tools/unacceptable_tools/sibling_watch name exists in the live TOOL_REGISTRY", () => {
    const problems = validateTaskSet(tasks, TOOL_REGISTRY.map((t) => t.name));
    expect(
      problems,
      `eval-tasks.json references tool name(s) absent from the live registry — this is a ` +
        `broken eval (fix the task set or the registry), NOT a routing miss:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it(`sanity: today's live accuracy has not dropped below the recorded historical floor (${BASELINE_FLOOR * 100}%)`, () => {
    let correct = 0;
    const rows: string[] = [];
    for (const task of tasks) {
      const { picked } = selectTool(tokenize(task.prompt), TOOL_REGISTRY);
      const isCorrect = picked === task.expected_tool;
      if (isCorrect) correct++;
      rows.push(`${isCorrect ? "PASS" : "FAIL"} ${task.id}: expected=${task.expected_tool} picked=${picked}`);
    }
    const accuracy = correct / tasks.length;
    expect(
      accuracy,
      `Tier A baseline accuracy regressed below the recorded floor (${BASELINE_FLOOR * 100}%). ` +
        `This is a REGRESSION gate, not a quality bar — see file header. Per-task detail:\n${rows.join("\n")}`,
    ).toBeGreaterThanOrEqual(BASELINE_FLOOR);
  });

  /**
   * FIX 2 — regression-vs-committed-baseline gate. Tier A is fully
   * deterministic (bag-of-words, no key, no network, no sampling), so a
   * committed per-task snapshot (eval/baseline-tier-a.json) is exact and can be
   * diffed byte-for-byte, not just compared as a scalar floor. This is the SAME
   * gate eval/baseline-selector.mjs's main() now runs (see its
   * evaluateRegressionGate) — duplicated here so it's exercised by `npm test`
   * without a build, exactly like the rest of this file's Tier A coverage.
   */
  describe("gate: regression-vs-committed-baseline (eval/baseline-tier-a.json)", () => {
    function todaysCurrentResult(): CurrentRunLike {
      const picks = tasks.map((task) => {
        const { picked } = selectTool(tokenize(task.prompt), TOOL_REGISTRY);
        return {
          id: task.id,
          correct: picked === task.expected_tool,
          forbidden: (task.unacceptable_tools || []).includes(picked as string),
        };
      });
      const correctCount = picks.filter((p) => p.correct).length;
      const forbiddenHits = picks.filter((p) => p.forbidden).map((p) => p.id);
      return {
        exact_accuracy: correctCount / tasks.length,
        forbidden_hits: forbiddenHits,
        results: picks.map((p) => ({ id: p.id, correct: p.correct })),
      };
    }

    it("green today: the REAL current run against the REAL committed registry passes the regression gate against the REAL committed baseline", () => {
      const current = todaysCurrentResult();
      const gate = evaluateRegressionGate(current, baselineTierA);
      expect(
        gate.gate_pass,
        `Tier A regression gate failed against the committed baseline (recorded ${baselineTierA.recorded_date}):\n` +
          gate.fail_reasons.join("\n"),
      ).toBe(true);
    });

    it("NOT inert: FAILS when exact_accuracy drops below the committed baseline (synthetic worse current)", () => {
      const worse: CurrentRunLike = {
        exact_accuracy: baselineTierA.exact_accuracy - 0.1,
        forbidden_hits: baselineTierA.forbidden_hits,
        results: Object.keys(baselineTierA.per_task).map((id) => ({ id, correct: baselineTierA.per_task[id]!.correct })),
      };
      const gate = evaluateRegressionGate(worse, baselineTierA);
      expect(gate.gate_pass).toBe(false);
      expect(gate.fail_reasons.some((r) => r.includes("regressed"))).toBe(true);
    });

    it("NOT inert: FAILS when a NEW forbidden hit appears beyond the committed set", () => {
      const current: CurrentRunLike = {
        exact_accuracy: baselineTierA.exact_accuracy,
        forbidden_hits: [...baselineTierA.forbidden_hits, "T05-url-discovery-only"],
        results: Object.keys(baselineTierA.per_task).map((id) => ({ id, correct: baselineTierA.per_task[id]!.correct })),
      };
      const gate = evaluateRegressionGate(current, baselineTierA);
      expect(gate.gate_pass).toBe(false);
      expect(gate.new_forbidden_hits).toEqual(["T05-url-discovery-only"]);
    });

    it("does NOT gate on forbidden_hits.length===0 — matching the committed forbidden set exactly still passes", () => {
      const current: CurrentRunLike = {
        exact_accuracy: baselineTierA.exact_accuracy,
        forbidden_hits: baselineTierA.forbidden_hits, // identical set, non-empty (T03, T04)
        results: Object.keys(baselineTierA.per_task).map((id) => ({ id, correct: baselineTierA.per_task[id]!.correct })),
      };
      expect(baselineTierA.forbidden_hits.length).toBeGreaterThan(0);
      const gate = evaluateRegressionGate(current, baselineTierA);
      expect(gate.gate_pass).toBe(true);
    });

    it("NOT inert: FAILS when a task the committed baseline marks correct:true now scores correct:false (per-task identity regression)", () => {
      const results = Object.keys(baselineTierA.per_task).map((id) => ({ id, correct: baselineTierA.per_task[id]!.correct }));
      const previouslyPassingId = Object.entries(baselineTierA.per_task).find(([, v]) => v.correct === true)?.[0];
      expect(previouslyPassingId).toBeDefined();
      const flipped = results.map((r) => (r.id === previouslyPassingId ? { ...r, correct: false } : r));
      const current: CurrentRunLike = {
        exact_accuracy: baselineTierA.exact_accuracy,
        forbidden_hits: baselineTierA.forbidden_hits,
        results: flipped,
      };
      const gate = evaluateRegressionGate(current, baselineTierA);
      expect(gate.gate_pass).toBe(false);
      expect(gate.regressed_tasks).toContain(previouslyPassingId);
    });

    it("PASSES when a previously-FAILING task now passes (improvement, not a regression)", () => {
      const results = Object.keys(baselineTierA.per_task).map((id) => ({ id, correct: baselineTierA.per_task[id]!.correct }));
      const previouslyFailingId = Object.entries(baselineTierA.per_task).find(([, v]) => v.correct === false)?.[0];
      expect(previouslyFailingId).toBeDefined();
      const improved = results.map((r) => (r.id === previouslyFailingId ? { ...r, correct: true } : r));
      const correctCount = improved.filter((r) => r.correct).length;
      const current: CurrentRunLike = {
        exact_accuracy: correctCount / improved.length,
        forbidden_hits: baselineTierA.forbidden_hits,
        results: improved,
      };
      const gate = evaluateRegressionGate(current, baselineTierA);
      expect(gate.gate_pass).toBe(true);
    });
  });

  it("error-path safety: validateTaskSet flags every distinct bad reference and does not silently drop a task", () => {
    const scratch: Task[] = [
      {
        id: "zz-scratch-missing-tool",
        prompt: "irrelevant",
        expected_tool: "novada_this_tool_does_not_exist",
        acceptable_tools: ["novada_this_tool_does_not_exist"],
        sibling_watch: ["novada_also_missing"],
      },
      { id: "zz-scratch-ok", prompt: "irrelevant", expected_tool: "novada_search", acceptable_tools: ["novada_search"] },
    ];
    const problems = validateTaskSet(scratch, ["novada_search", "novada_extract"]);
    // Three distinct bad references on the first task (expected_tool, acceptable_tools,
    // sibling_watch each name an unknown tool) must ALL surface — not just the first hit.
    expect(problems.length).toBe(3);
    expect(problems.every((p) => p.includes("zz-scratch-missing-tool"))).toBe(true);
    expect(problems.some((p) => p.includes("novada_this_tool_does_not_exist"))).toBe(true);
    expect(problems.some((p) => p.includes("novada_also_missing"))).toBe(true);
  });
});
