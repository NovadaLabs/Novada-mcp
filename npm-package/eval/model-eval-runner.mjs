#!/usr/bin/env node
/**
 * model-eval-runner.mjs — the model-in-the-loop half of the Layer 5 (tool-selection)
 * eval harness. Ported from
 * reports/phase1-net-design/B/prototype/model-eval-runner.mjs — logic kept, two
 * concrete upgrades made while porting (both noted inline below): surface
 * filtering now reads the REAL config/surfaces.json instead of a hand-rolled,
 * partially-fictional SURFACE_FILTERS map, and a fail-loud task-set validation
 * pass was added (see validateTaskSet, shared conceptually with
 * baseline-selector.mjs's copy of the same check).
 *
 * *** THIS SCRIPT MAKES A REAL, BILLED CALL TO THE ANTHROPIC API WHEN RUN. ***
 * *** It was NOT executed while building this harness — no ANTHROPIC_API_KEY  ***
 * *** was exported in this session, and even if one had been, invoking it     ***
 * *** would be an external, billed third-party effect requiring explicit     ***
 * *** owner sign-off (REDLINE), which this task does not have. Point         ***
 * *** ANTHROPIC_API_KEY at it and it runs today, unmodified, for real. ***
 *
 * What this does differently from a naive tool-choice smoke test:
 *   - Uses the REAL tool schemas from the REAL build (imported live, same as
 *     baseline-selector.mjs) — not a hand-copied subset. If a tool's description
 *     or schema drifts, the eval sees exactly what a production agent would see.
 *   - Surface-aware via config/surfaces.json (the repo's actual, committed
 *     surface manifest — see the SURFACE loader below), matching what
 *     mcp.novada.com's hosted-15 curation and the local stdio server's "default"
 *     (unfiltered) surface actually expose. UPGRADE FROM PROTOTYPE: B's original
 *     had a hand-rolled SURFACE_FILTERS map with a third "rapid" bucket that
 *     doesn't exist in config/surfaces.json — reading the committed manifest
 *     directly means this script can never invent a surface nobody configured,
 *     and any future edit to config/surfaces.json is picked up automatically
 *     with zero code change here.
 *   - Reports SIBLING accuracy, not just aggregate accuracy: for every tool
 *     named in ANY task's sibling_watch list, accuracy on the tasks where THAT
 *     tool is the expected_tool. This is the number the orchestration brief
 *     calls out explicitly: "加了 X 之后，同胞工具的路由准确率必须 ≥ 基线" (after
 *     adding tool X, sibling tools' routing accuracy must not drop below
 *     baseline). Aggregate accuracy can hide a regression concentrated in 2-3
 *     tasks; sibling accuracy surfaces it directly.
 *   - An UNCONDITIONAL hard gate (see evaluateGate + ABSOLUTE_ACCURACY_FLOOR /
 *     SIBLING_ACCURACY_FLOOR / MAX_ERROR_RATE below) that fires WHENEVER this
 *     script actually runs with a key present — independent of whether a
 *     --baseline artifact happens to exist. FIX (gate-hardening pass,
 *     2026-07-19): previously gate_pass/process.exit(1) only fired inside the
 *     `if (BASELINE_PATH)` branch, which no CI invocation populates (no prior
 *     run's JSON is ever passed) and no baseline artifact exists for — meaning
 *     this script exited 0 for ANY accuracy/forbidden/error outcome the very
 *     first time (and every time) it was actually run. The unconditional gate
 *     hard-fails on: aggregate accuracy below the absolute sanity floor, ANY
 *     forbidden-tool hit, a watched sibling below its own floor, or a
 *     task-level API error rate above a small ceiling (errors now COUNT AS
 *     FAILURES in the accuracy denominator too — see runLive — instead of being
 *     excluded from the sample, which previously let a partial outage shrink
 *     the measured population rather than fail it).
 *   - A --baseline=<prior-run.json> comparison mode that remains available as
 *     an ADDITIONAL, STRICTER regression gate on top of the unconditional one:
 *     hard-fails if aggregate accuracy regresses vs the prior run, if any
 *     sibling's accuracy drops vs the prior run, OR if a sibling present in
 *     the prior run's dict is missing from this run's (dropped out, e.g. its
 *     owning task got filtered out by a --surface change) — a dropped sibling
 *     is treated as unmeasured/regressed, surfaced explicitly rather than
 *     silently absent from the comparison.
 *
 * Cost model (Claude Haiku, ~23 tools * ~120 tokens/description in the tool-use
 * request + prompt + short output):
 *   ~10 tasks * 1 request each * ~4-6K input tokens + ~30 output tokens
 *   ~= 40-60K input tokens + 300 output tokens per full run
 *   ~= $0.04-0.06 input + negligible output at Haiku list pricing.
 *   Cheap enough to run on every PR that touches src/tools/registry.ts or
 *   src/core.ts; NOT cheap enough (nor necessary) to run on every commit to an
 *   unrelated file — see the eval-harness.yml workflow's path filter.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npm run build && node eval/model-eval-runner.mjs                       # default surface, Haiku
 *   npm run build && node eval/model-eval-runner.mjs --surface=hosted-15
 *   npm run build && node eval/model-eval-runner.mjs --model=claude-haiku-4-5
 *   npm run build && node eval/model-eval-runner.mjs --baseline=./run-default-<ts>.json
 *
 * Without ANTHROPIC_API_KEY: prints a message and exits 0 (SKIP, not FAIL —
 * this is the contract eval-harness.yml's live job and run-eval.mjs rely on).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateTaskSet } from "./baseline-selector.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = resolve(__dirname, "../build");
const SURFACES_MANIFEST_PATH = resolve(__dirname, "../../config/surfaces.json");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1] || "claude-haiku-4-5";
const SURFACE = process.argv.find((a) => a.startsWith("--surface="))?.split("=")[1] || "default";
const BASELINE_PATH = process.argv.find((a) => a.startsWith("--baseline="))?.split("=")[1];

/**
 * ABSOLUTE_ACCURACY_FLOOR — hard sanity floor for Tier B (real model) routing
 * accuracy, enforced UNCONDITIONALLY every time this script runs with a key,
 * independent of whether a --baseline artifact is supplied. Deliberately set
 * to the SAME value as Tier A's deterministic BASELINE_FLOOR
 * (eval/baseline-selector.mjs) as the MINIMUM acceptable value — this is
 * DESIGN-B's own rationale verbatim: "a real model must beat bag-of-words."
 * If a paid, real model call scores below what a $0 lexical-overlap heuristic
 * already achieves, that is not a subtle quality regression to shrug off — it
 * is very likely a broken integration (wrong tool schemas sent, wrong model
 * id, malformed request, tool_choice misconfigured, etc.) and must hard-fail
 * regardless of whether a prior run exists to diff against.
 */
export const ABSOLUTE_ACCURACY_FLOOR = 0.5; // == eval/baseline-selector.mjs BASELINE_FLOOR (5/10), recorded 2026-07-19

/**
 * SIBLING_ACCURACY_FLOOR — same absolute floor applied per watched sibling: a
 * sibling tool's own routing accuracy (measured on the tasks where THAT tool
 * is the expected_tool) must not fall below this either, even on a first-ever
 * run with no --baseline to compare against. Kept equal to
 * ABSOLUTE_ACCURACY_FLOOR for now — no sibling has a documented different bar
 * today; split this into a per-tool map the day one does.
 */
export const SIBLING_ACCURACY_FLOOR = ABSOLUTE_ACCURACY_FLOOR;

/**
 * MAX_ERROR_RATE — task-level Anthropic API errors (network blip, 5xx,
 * malformed response body) are now COUNTED AS FAILURES in the accuracy
 * denominator itself (see runLive: accuracy = correct / results.length, not
 * correct / non-errored.length) so a partial outage tanks the score instead
 * of silently shrinking the sample it's measured against. This constant is a
 * defense-in-depth backstop for the edge case where a handful of errors still
 * leave the surviving-task accuracy at or above ABSOLUTE_ACCURACY_FLOOR by
 * chance — a >10% task-level error rate is itself an infra failure worth
 * failing loud on, independent of the resulting accuracy number.
 */
export const MAX_ERROR_RATE = 0.1;

/**
 * evaluateGate — pure gate-evaluation function, no I/O, no process.exit. Takes
 * the `summary` object runLive() produces (accuracy, error_rate, sibling_accuracy,
 * forbidden_hits, errors) and an OPTIONAL `priorSummary` (the `summary` field of
 * a --baseline artifact). This separation is exactly what makes the gate
 * decision independently unit-testable with synthetic inputs — see
 * tests/eval/model-eval-runner.test.ts — without ever calling the real
 * Anthropic API.
 *
 * Always computes the UNCONDITIONAL gate (fires on every call, baseline or
 * not). When priorSummary is supplied, ALSO computes the additional, stricter
 * baseline-regression gate; overall gate_pass requires BOTH to pass.
 */
export function evaluateGate(summary, priorSummary) {
  const failReasons = [];

  if (summary.accuracy < ABSOLUTE_ACCURACY_FLOOR) {
    failReasons.push(
      `aggregate accuracy ${(summary.accuracy * 100).toFixed(0)}% is below the absolute sanity floor ` +
        `${(ABSOLUTE_ACCURACY_FLOOR * 100).toFixed(0)}% (a real model must beat the $0 bag-of-words baseline)`,
    );
  }

  const forbiddenHits = summary.forbidden_hits || [];
  if (forbiddenHits.length > 0) {
    failReasons.push(
      `forbidden-tool hit(s) on task(s): ${forbiddenHits.join(", ")} (a real model picking an ` +
        `unacceptable_tools entry on a clear prompt is a genuine failure, not noise)`,
    );
  }

  const errorRate = summary.error_rate ?? 0;
  if (errorRate > MAX_ERROR_RATE) {
    const errorIds = (summary.errors || []).map((e) => e.id).join(", ");
    failReasons.push(
      `task-level API error rate ${(errorRate * 100).toFixed(0)}% exceeds the ${(MAX_ERROR_RATE * 100).toFixed(0)}% ` +
        `ceiling (errored tasks: ${errorIds || "(unknown)"})`,
    );
  }

  const siblingAccuracy = summary.sibling_accuracy || {};
  const belowFloorSiblings = Object.entries(siblingAccuracy).filter(([, acc]) => acc < SIBLING_ACCURACY_FLOOR);
  if (belowFloorSiblings.length > 0) {
    failReasons.push(
      `watched sibling(s) below the ${(SIBLING_ACCURACY_FLOOR * 100).toFixed(0)}% floor: ` +
        belowFloorSiblings.map(([name, acc]) => `${name}=${(acc * 100).toFixed(0)}%`).join(", "),
    );
  }

  const unconditional_gate_pass = failReasons.length === 0;

  const gateResult = {
    unconditional_gate_pass,
    unconditional_gate_fail_reasons: failReasons,
    gate_pass: unconditional_gate_pass,
  };

  if (priorSummary) {
    const priorSiblingAccuracy = priorSummary.sibling_accuracy || {};
    const priorSiblingNames = Object.keys(priorSiblingAccuracy);
    // A sibling present in the PRIOR run's dict but absent from THIS run's dict
    // (e.g. its owning task got filtered out by a --surface change, or the task
    // set changed) must be treated as unmeasured/regressed — surfaced
    // explicitly, never silently skipped from the comparison.
    const droppedSiblings = priorSiblingNames.filter((name) => !(name in siblingAccuracy));
    const regressedSiblings = Object.entries(siblingAccuracy)
      .filter(([name, acc]) => priorSiblingAccuracy[name] !== undefined && acc < priorSiblingAccuracy[name])
      .map(([name]) => name);
    const allRegressedSiblings = [...regressedSiblings, ...droppedSiblings];

    const baseline_gate_pass =
      summary.accuracy >= (priorSummary.accuracy ?? 0) && allRegressedSiblings.length === 0;

    gateResult.baseline_gate_pass = baseline_gate_pass;
    gateResult.regressed_siblings = allRegressedSiblings;
    gateResult.dropped_siblings = droppedSiblings;
    gateResult.gate_pass = unconditional_gate_pass && baseline_gate_pass;
  }

  return gateResult;
}

/**
 * Reads config/surfaces.json (the repo's real, committed surface manifest —
 * also consumed by scripts/check-hosted-drift.mjs) and returns either `null`
 * (surface exposes every registry tool, i.e. `"tools": "*"`, e.g. "default")
 * or a `Set<string>` of the exact tool names that surface exposes.
 *
 * Fails loud if the requested surface name isn't a key in the manifest at all
 * — an unknown --surface value is a typo or a stale reference, not "no filter."
 */
export function loadSurfaceFilter(surfaceName) {
  const manifest = JSON.parse(readFileSync(SURFACES_MANIFEST_PATH, "utf8"));
  const surface = manifest.surfaces?.[surfaceName];
  if (!surface) {
    throw new Error(
      `Unknown --surface='${surfaceName}' — not a key in ${SURFACES_MANIFEST_PATH}. ` +
        `Known surfaces: ${Object.keys(manifest.surfaces || {}).join(", ") || "(none found)"}`,
    );
  }
  if (surface.tools === "*") return null;
  if (!Array.isArray(surface.tools)) {
    throw new Error(`config/surfaces.json surface '${surfaceName}' has a malformed 'tools' field (expected "*" or an array)`);
  }
  return new Set(surface.tools);
}

export function foundNamesForSurface(surfaceTools) {
  return new Set(surfaceTools.map((t) => t.name));
}

/**
 * A task tagged with a surface (via its surfaces[] list) implicitly claims "the model,
 * shown only this surface's tools, should still pick expected_tool" — which is only a
 * meaningful claim if expected_tool is actually IN that surface's tool set. If it isn't,
 * the model literally cannot pick it (it was never in the `tools:` array sent to
 * Anthropic), so the task is a guaranteed miss regardless of routing quality — a false
 * regression signal, not a real one. `filter === null` means the surface exposes every
 * tool (e.g. "default"), so nothing can ever be missing in that case.
 */
export function validateTaskSurfaces(tasks, surfaceName, filter, availableNames) {
  if (filter === null) return [];
  const problems = [];
  for (const task of tasks) {
    if (!availableNames.has(task.expected_tool)) {
      problems.push(
        `task '${task.id}' is tagged for surface '${surfaceName}' but its expected_tool ` +
          `'${task.expected_tool}' is not exposed on that surface (config/surfaces.json ` +
          `'${surfaceName}'.tools) — the model can never pick it there`,
      );
    }
  }
  return problems;
}

export function toolToAnthropicSchema(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

async function callModel(tools, prompt, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      tools: tools.map(toolToAnthropicSchema),
      tool_choice: { type: "any" }, // force a tool pick — we're testing selection, not whether it calls a tool at all
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const toolUse = data.content?.find((b) => b.type === "tool_use");
  return { picked: toolUse?.name ?? null, raw_input: toolUse?.input ?? null };
}

export async function runLive({ tasks, tools, model }) {
  const results = [];
  for (const task of tasks) {
    try {
      const { picked, raw_input } = await callModel(tools, task.prompt, model);
      results.push({
        id: task.id,
        expected: task.expected_tool,
        picked,
        correct: picked === task.expected_tool,
        acceptable: (task.acceptable_tools || [task.expected_tool]).includes(picked),
        forbidden_hit: (task.unacceptable_tools || []).includes(picked),
        raw_input,
      });
    } catch (e) {
      results.push({ id: task.id, error: String(e.message || e) });
    }
  }

  // Task-level API errors COUNT AS FAILURES in the accuracy denominator — an
  // errored task is not "unmeasured," it is a failed pick. Previously
  // `results.filter(r => !r.error)` excluded errors from BOTH numerator and
  // denominator, which let a partial outage shrink the sample instead of
  // failing it (a run where 4 of 10 tasks errored and the other 6 all scored
  // correctly reported 100% accuracy). `r.correct` is `undefined` (falsy) on
  // an errored result, so it naturally contributes 0 to the numerator while
  // `results.length` (not a filtered subset) is always the full denominator.
  const errors = results.filter((r) => r.error);
  const accuracy = results.length ? results.filter((r) => r.correct).length / results.length : 0;
  const errorRate = results.length ? errors.length / results.length : 0;

  // Sibling accuracy: for every tool named in ANY task's sibling_watch list, accuracy
  // on the tasks where THAT tool is the expected_tool. This is the number that must not
  // regress when a new tool is added — see DESIGN-B.md Layer 5.
  const siblingNames = new Set(tasks.flatMap((t) => t.sibling_watch || []));
  const siblingAccuracy = {};
  const unmeasuredSiblings = [];
  for (const name of siblingNames) {
    const relevant = results.filter((r) => {
      const task = tasks.find((t) => t.id === r.id);
      return task?.expected_tool === name;
    });
    if (relevant.length) {
      siblingAccuracy[name] = relevant.filter((r) => r.correct).length / relevant.length;
    } else {
      // A sibling watched by some task's sibling_watch[] but with ZERO tasks in
      // THIS run measuring it (e.g. its owning task got filtered out by
      // --surface) must be surfaced, not silently dropped from the dict — the
      // --baseline comparison in evaluateGate treats a name that later
      // disappears entirely from a future run's dict as dropped/regressed.
      unmeasuredSiblings.push(name);
    }
  }

  return {
    summary: {
      model,
      task_count: tasks.length,
      accuracy,
      error_rate: errorRate,
      sibling_accuracy: siblingAccuracy,
      unmeasured_siblings: unmeasuredSiblings,
      forbidden_hits: results.filter((r) => r.forbidden_hit).map((r) => r.id),
      errors,
    },
    results,
  };
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY not set — this is the model-in-the-loop half of Layer 5.\n" +
        "It is built and ready to run but was NOT executed while building this harness\n" +
        "(a billed third-party API call is an external effect requiring explicit owner\n" +
        "sign-off — REDLINE). Set ANTHROPIC_API_KEY and re-run to get real numbers.\n" +
        "eval/baseline-selector.mjs (same directory) runs for free and WAS executed.\n" +
        "SKIP, not FAIL — exiting 0.",
    );
    process.exit(0);
  }

  const { TOOLS } = await import(resolve(BUILD_DIR, "core.js"));
  const filter = loadSurfaceFilter(SURFACE);
  const surfaceTools = filter ? TOOLS.filter((t) => filter.has(t.name)) : TOOLS;
  if (filter && surfaceTools.length !== filter.size) {
    const foundNames = new Set(surfaceTools.map((t) => t.name));
    const missing = [...filter].filter((n) => !foundNames.has(n));
    console.error(
      `WARNING: surface '${SURFACE}' expects ${filter.size} tools (per config/surfaces.json) but ` +
        `only ${surfaceTools.length} were found in the live TOOLS export. Missing: ${missing.join(", ")}. ` +
        `Either config/surfaces.json or the live registry has drifted — see scripts/check-hosted-drift.mjs, ` +
        `which is the dedicated guard for exactly this drift.`,
    );
  }

  const { tasks } = JSON.parse(readFileSync(resolve(__dirname, "eval-tasks.json"), "utf8"));
  const applicableTasks = tasks.filter((t) => !t.surfaces || t.surfaces.includes(SURFACE));

  const validationProblems = validateTaskSet(applicableTasks, TOOLS.map((t) => t.name));
  if (validationProblems.length > 0) {
    console.error(
      "\nmodel-eval-runner: FAIL LOUD — eval-tasks.json references tool name(s) not present " +
        "in the live TOOLS export. This is a broken eval, not a routing miss; fix the task " +
        "set (or the registry) before spending API budget on it.\n",
    );
    for (const p of validationProblems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // FAIL LOUD (surface dimension): a task tagged for this surface whose OWN expected_tool
  // isn't actually exposed on it is a structurally guaranteed miss, unrelated to routing
  // quality — the model was never even offered that tool as a candidate. This class of bug
  // is easy to introduce silently (a task's surfaces[] list drifting out of sync with
  // config/surfaces.json's actual tool lists) and was caught live while wiring this script
  // to the real manifest — see eval-tasks.json's porting_notes point (2).
  const surfaceProblems = validateTaskSurfaces(applicableTasks, SURFACE, filter, foundNamesForSurface(surfaceTools));
  if (surfaceProblems.length > 0) {
    console.error(
      `\nmodel-eval-runner: FAIL LOUD — task(s) tagged for surface '${SURFACE}' expect a tool ` +
        "that surface does not expose. Fix the task's surfaces[] (or the surface manifest) " +
        "before spending API budget on a guaranteed miss.\n",
    );
    for (const p of surfaceProblems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const { summary, results } = await runLive({ tasks: applicableTasks, tools: surfaceTools, model: MODEL });
  summary.surface = SURFACE;
  summary.surface_tool_count = surfaceTools.length;

  // FIX (gate-hardening pass, 2026-07-19): evaluateGate ALWAYS runs — this is
  // the unconditional hard gate (ABSOLUTE_ACCURACY_FLOOR / forbidden hits /
  // SIBLING_ACCURACY_FLOOR / MAX_ERROR_RATE), independent of --baseline. The
  // prior behavior computed gate_pass ONLY inside `if (BASELINE_PATH)`, so a
  // run with no --baseline argument (every CI invocation, since no baseline
  // artifact exists) always fell through with gate_pass left undefined —
  // treated as falsy by `if (BASELINE_PATH && !summary.gate_pass)`, so the
  // exit check itself was ALSO gated on BASELINE_PATH and never fired. The
  // --baseline comparison (when supplied) is now an ADDITIONAL, stricter gate
  // layered on top via evaluateGate's second argument — see its doc comment.
  const priorSummary = BASELINE_PATH ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")).summary : undefined;
  Object.assign(summary, evaluateGate(summary, priorSummary));

  console.log(JSON.stringify({ summary, results }, null, 2));

  const outPath = resolve(__dirname, `run-${SURFACE}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
  console.error(`\nWrote ${outPath}`);

  if (!summary.gate_pass) {
    console.error(
      "\nTier B gate FAILED — see summary.unconditional_gate_fail_reasons" +
        (BASELINE_PATH ? " and/or summary.regressed_siblings / summary.dropped_siblings" : "") +
        " in the JSON output above.",
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("model-eval-runner failed:", e);
    process.exit(1);
  });
}
