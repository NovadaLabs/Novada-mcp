#!/usr/bin/env node
/**
 * baseline-selector.mjs — the FREE, always-on half of the Layer 5 (tool-selection)
 * eval harness. Ported from reports/phase1-net-design/B/prototype/baseline-selector.mjs
 * (already executed there against the live build, scoring 50%) — logic kept verbatim,
 * only the home and import paths changed to fit npm-package/eval/ (see README note
 * at the bottom of this header for why this directory).
 *
 * Deterministic, zero-dependency, zero-API-cost tool selector. Given a task prompt,
 * scores every tool in the REAL, currently-built TOOL_REGISTRY (imported live from
 * npm-package/build/tools/registry.js — never a hand-copied snapshot) by lexical
 * overlap between the prompt and the tool's short catalog description, and picks
 * the argmax.
 *
 * This is intentionally crude (bag-of-words overlap, no embeddings, no model call).
 * Its job is NOT to be a great tool-selector — it is to be a cheap, deterministic,
 * always-green-or-red REGRESSION SENTINEL that runs on every CI invocation for
 * $0 and 0 third-party-API calls, so a routing regression is caught even on
 * forks/PRs that have no ANTHROPIC_API_KEY configured. The model-in-the-loop
 * runner (model-eval-runner.mjs, same directory) is the higher-fidelity, real-cost
 * complement — built, but NEVER executed by this script or its CI job.
 *
 * A green run of THIS script means "no NEW description collision was introduced
 * since the recorded floor" — NOT "tool selection is correct." Read the accuracy
 * number as a regression floor, not a quality bar; see BASELINE_FLOOR below.
 *
 * Why npm-package/build/ (compiled JS) and not npm-package/src/ (TypeScript) here:
 * this file is a plain, dependency-free .mjs script in the same family as
 * tests/live/bing-reliability.mjs and tests/live/integration.mjs, which already
 * establish the repo's convention for standalone (non-vitest) CLI scripts: import
 * from build/, run with plain `node`, no tsx/ts-node, no new devDependency. The
 * CI workflow that invokes this script always runs `npm run build` first (same as
 * the existing ci.yml job), so build/ is guaranteed fresh at invocation time. The
 * companion regression gate at ../tests/eval/baseline-selector.test.ts imports the
 * SAME logic against src/tools/registry.ts directly (vitest transpiles TS on the
 * fly, no build needed) precisely so `npm test` never has a build-freshness
 * dependency — that file is the one that's truly wired into every single
 * `npm test` invocation; this file is the standalone reporting/CI-workflow tool.
 *
 * Usage:
 *   npm run build && node eval/baseline-selector.mjs          # human-readable report
 *   npm run build && node eval/baseline-selector.mjs --json    # machine-readable output
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = resolve(__dirname, "../build");

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "for", "and", "or", "this",
  "that", "it", "i", "me", "my", "you", "your", "at", "with", "as", "be", "do", "does", "did",
  "what", "whats", "tell", "give", "get", "need", "want", "just", "not", "no", "has", "have",
  "since", "before", "right", "now", "up", "down", "out", "into", "from", "if", "then",
]);

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) || [])
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Score a tool against a prompt: overlap between prompt tokens and description
 * tokens, with a bonus for a prompt token literally matching a token in the
 * tool's own name (e.g. "proxy" in the prompt scoring novada_proxy higher). */
export function scoreTool(promptTokens, tool) {
  const descTokens = new Set(tokenize(tool.description));
  const nameTokens = new Set(tool.name.replace("novada_", "").split("_"));
  let score = 0;
  for (const t of promptTokens) {
    if (descTokens.has(t)) score += 1;
    if (nameTokens.has(t)) score += 2; // name match is a stronger signal
  }
  return score;
}

export function selectTool(promptTokens, registry) {
  let best = null;
  let bestScore = -Infinity;
  const ranked = [];
  for (const tool of registry) {
    const s = scoreTool(promptTokens, tool);
    ranked.push({ name: tool.name, score: s });
    if (s > bestScore) {
      bestScore = s;
      best = tool.name;
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return { picked: best, score: bestScore, ranked };
}

/**
 * Error path: a task's expected_tool (or any acceptable/unacceptable/sibling_watch
 * name) that no longer exists in the live registry is NOT a "0 out of N" miss — it
 * is a broken eval and must fail loud, immediately, before any scoring happens.
 * Silently treating an unknown tool name as "just another wrong pick" would let
 * a renamed/removed tool quietly rot the task set into permanent false failures
 * (or, worse, permanent false passes if the unknown name happens to never get
 * picked). Every referenced name across every task is checked, and ALL problems
 * are reported together (not just the first) so a single registry rename doesn't
 * require N separate failed-run/fix/rerun cycles to surface every affected task.
 */
export function validateTaskSet(tasks, registryNames) {
  const known = new Set(registryNames);
  const problems = [];
  for (const task of tasks) {
    const refs = [
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

/**
 * Recorded floor, not a quality bar: measured on 2026-07-19 against the live
 * 23-tool registry with this exact eval-tasks.json (v2, ported verbatim from
 * B's prototype apart from dropping the non-existent 'rapid' surface tag — see
 * eval-tasks.json's porting_notes). The prototype's own 2026-07-18 run against
 * v1 of this task set scored the same 50% (5/10) — the registry's relevant
 * descriptions did not change between the two runs. Update this constant
 * deliberately (with a comment + date) whenever the task set changes on purpose
 * or the registry's descriptions legitimately improve/regress — never let it
 * silently drift, and never lower it just to make a red run go green.
 *
 * 2026-07-20 UPDATE (Tools-v2 search-engine platform-scraper pass): eval-tasks.json
 * grew 11->15 tasks (T12-T15, one per new novada_scrape_<google|bing|duckduckgo|yandex>
 * tool). The crude Tier-A bag-of-words scorer gets 2 of the 4 new tasks wrong in a way
 * that adds NEW forbidden hits (T12, T13 both argmax to novada_search) — an honest,
 * expected consequence of harder/more-specific prompts, not a defect masked by lowering
 * this floor; see eval/baseline-tier-a.json's own dated comment for the full accounting.
 * Lowered 50%->46.67% (5/10->7/15) to match the honestly-regenerated committed snapshot.
 *
 * 2026-07-20 UPDATE 2 (Tools-v2 SOCIAL/VIDEO platform-scraper pass): eval-tasks.json
 * grew 15->20 tasks (T16-T20, one per new novada_scrape_<youtube|instagram|facebook|
 * tiktok|x> tool). Unlike the prior update, all 5 new tasks score correct:true — each
 * new platform's name/operation tokens are distinctive enough for Tier A's bag-of-words
 * argmax to pick cleanly, with no new forbidden hits; see eval/baseline-tier-a.json's own
 * dated comment for the full accounting. Raised 46.67%->60% (7/15->12/20) to match the
 * honestly-regenerated committed snapshot.
 *
 * Kept for reporting/back-compat and as a human-readable summary of what
 * baseline-tier-a.json (below) records precisely, per-task. The actual gate
 * (FIX 2) no longer compares against this bare number — it compares against
 * the committed baseline-tier-a.json snapshot, which is exact (Tier A is fully
 * deterministic: no key, no network, no sampling) and catches per-task
 * identity regressions this scalar alone cannot (see evaluateRegressionGate).
 */
export const BASELINE_FLOOR = 12 / 20;

const BASELINE_TIER_A_PATH = resolve(__dirname, "baseline-tier-a.json");

/** Loads the committed Tier A snapshot (see baseline-tier-a.json's own header). */
export function loadBaselineTierA(path = BASELINE_TIER_A_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * FIX 2 — regression-vs-committed-baseline gate. Tier A is fully deterministic
 * (bag-of-words, no key, no network, no model sampling), so unlike Tier B a
 * committed snapshot of "today's" result is exact and can be compared
 * byte-for-byte forever, not just as a scalar floor. Three independent
 * regression conditions, ALL must hold for the gate to pass:
 *
 *   1. exact_accuracy must not drop below the committed baseline's accuracy.
 *   2. No NEW forbidden-tool hit may appear — i.e. current.forbidden_hits must
 *      be a subset of baseline.forbidden_hits. Deliberately NOT gated on
 *      forbidden_hits.length === 0: the 2 hits recorded in baseline-tier-a.json
 *      (T03, T04) are expected weak-selector noise, not a defect to chase to
 *      zero — see that file's header. Only a NEW, previously-unseen forbidden
 *      hit is a regression signal.
 *   3. No task that was correct:true in the committed baseline may score
 *      correct:false now (per-task identity regression) — this catches a
 *      regression localized to one or two tasks that a moving aggregate
 *      accuracy could mask (e.g. one task breaking while another coincidentally
 *      starts passing, netting to the same scalar accuracy).
 *
 * Pure function — no I/O, no process.exit — so it is directly unit-testable
 * with synthetic `current`/`baseline` objects (see
 * tests/eval/baseline-selector.test.ts), independent of the live registry.
 */
export function evaluateRegressionGate(current, baseline) {
  const failReasons = [];

  if (current.exact_accuracy < baseline.exact_accuracy) {
    failReasons.push(
      `exact_accuracy regressed: ${current.exact_accuracy} < committed baseline ${baseline.exact_accuracy} ` +
        `(baseline-tier-a.json, recorded ${baseline.recorded_date})`,
    );
  }

  const baselineForbiddenSet = new Set(baseline.forbidden_hits);
  const newForbiddenHits = current.forbidden_hits.filter((id) => !baselineForbiddenSet.has(id));
  if (newForbiddenHits.length > 0) {
    failReasons.push(
      `NEW forbidden-tool hit(s) not present in the committed baseline: ${newForbiddenHits.join(", ")} ` +
        `(committed set: ${[...baselineForbiddenSet].join(", ") || "(none)"})`,
    );
  }

  const regressedTasks = [];
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

export async function main() {
  const asJson = process.argv.includes("--json");

  const { TOOL_REGISTRY } = await import(resolve(BUILD_DIR, "tools/registry.js"));
  const tasksPath = resolve(__dirname, "eval-tasks.json");
  const { tasks, generated_from } = JSON.parse(readFileSync(tasksPath, "utf8"));

  const validationProblems = validateTaskSet(tasks, TOOL_REGISTRY.map((t) => t.name));
  if (validationProblems.length > 0) {
    console.error(
      "\nbaseline-selector: FAIL LOUD — eval-tasks.json references tool name(s) not present " +
        "in the live TOOL_REGISTRY. This is a broken eval, not a routing miss; fix the task " +
        "set (or the registry) before trusting any score below.\n",
    );
    for (const p of validationProblems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const results = [];
  let correct = 0;
  let acceptable = 0;

  for (const task of tasks) {
    const promptTokens = tokenize(task.prompt);
    const { picked, ranked } = selectTool(promptTokens, TOOL_REGISTRY);
    const isCorrect = picked === task.expected_tool;
    const isAcceptable = (task.acceptable_tools || [task.expected_tool]).includes(picked);
    const isForbidden = (task.unacceptable_tools || []).includes(picked);
    if (isCorrect) correct++;
    if (isAcceptable) acceptable++;

    results.push({
      id: task.id,
      prompt: task.prompt,
      expected: task.expected_tool,
      picked,
      correct: isCorrect,
      acceptable: isAcceptable,
      forbidden_hit: isForbidden,
      top3: ranked.slice(0, 3),
    });
  }

  const exactAccuracy = correct / tasks.length;
  const forbiddenHits = results.filter((r) => r.forbidden_hit).map((r) => r.id);

  const baselineTierA = loadBaselineTierA();
  const regressionGate = evaluateRegressionGate(
    { exact_accuracy: exactAccuracy, forbidden_hits: forbiddenHits, results },
    baselineTierA,
  );

  const summary = {
    registry_source: BUILD_DIR,
    registry_tool_count: TOOL_REGISTRY.length,
    task_set: generated_from,
    task_count: tasks.length,
    exact_accuracy: exactAccuracy,
    acceptable_accuracy: acceptable / tasks.length,
    forbidden_hits: forbiddenHits,
    baseline_floor: BASELINE_FLOOR,
    committed_baseline: {
      path: BASELINE_TIER_A_PATH,
      recorded_date: baselineTierA.recorded_date,
      exact_accuracy: baselineTierA.exact_accuracy,
      forbidden_hits: baselineTierA.forbidden_hits,
    },
    new_forbidden_hits: regressionGate.new_forbidden_hits,
    regressed_tasks: regressionGate.regressed_tasks,
    regression_gate_fail_reasons: regressionGate.fail_reasons,
    // FIX 2: gate is regression-vs-committed-baseline (exact accuracy, forbidden-set
    // growth, per-task identity), NOT a bare floor comparison and NOT forbidden===0.
    // See evaluateRegressionGate's doc comment.
    gate_pass: regressionGate.gate_pass,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(`\nBaseline tool-selector — deterministic, $0, no third-party API calls`);
    console.log(`Registry: ${TOOL_REGISTRY.length} tools (live import from build/)`);
    console.log(`Task set: ${tasks.length} tasks (${generated_from})\n`);
    for (const r of results) {
      const mark = r.correct ? "PASS" : r.acceptable ? "OK  " : "FAIL";
      console.log(`[${mark}] ${r.id}: expected=${r.expected} picked=${r.picked}`);
      if (!r.correct) {
        console.log(`       top3: ${r.top3.map((t) => `${t.name}(${t.score})`).join(", ")}`);
      }
    }
    console.log(`\nExact accuracy:      ${(summary.exact_accuracy * 100).toFixed(0)}% (${correct}/${tasks.length})`);
    console.log(`Acceptable accuracy:  ${(summary.acceptable_accuracy * 100).toFixed(0)}% (${acceptable}/${tasks.length})`);
    if (summary.forbidden_hits.length) {
      console.log(`FORBIDDEN picks hit:  ${summary.forbidden_hits.join(", ")}`);
    }
    console.log(
      `\nCommitted baseline: ${(baselineTierA.exact_accuracy * 100).toFixed(0)}% accuracy, ` +
        `forbidden={${baselineTierA.forbidden_hits.join(", ")}} (recorded ${baselineTierA.recorded_date}, ` +
        `${BASELINE_TIER_A_PATH})`,
    );
    console.log(`Gate: ${summary.gate_pass ? "PASS" : "FAIL"} (regression-vs-committed-baseline, NOT an absolute quality bar and NOT forbidden===0).`);
    if (!summary.gate_pass) {
      console.log(`Regression gate FAILED:`);
      for (const reason of regressionGate.fail_reasons) console.log(`  - ${reason}`);
    }
    console.log(`Note: a green check here means "no NEW description collision or per-task regression" — NOT "selection is correct."`);
    console.log(`The model-in-the-loop runner (model-eval-runner.mjs) is the actual quality signal.`);
  }

  if (!summary.gate_pass) process.exit(1);
}

// Only auto-run when invoked directly (`node baseline-selector.mjs`), not when
// imported (e.g. by tests/eval/baseline-selector.test.ts for its own assertions).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("baseline-selector failed:", e);
    process.exit(1);
  });
}
