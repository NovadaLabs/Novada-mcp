#!/usr/bin/env node
/**
 * run-eval.mjs — CI entry point for the Layer 5 (tool-selection) eval harness.
 * Ported from reports/phase1-net-design/B/prototype/run-eval.mjs, scoped down
 * to Layer 5 only: the prototype's run-eval.mjs also drove Layer 4's
 * collision-matrix.mjs, but that layer has since been separately promoted into
 * npm-package/tests/tools/collision-matrix.test.ts (a real vitest suite, part
 * of `npm test`) by a different, already-landed change — re-invoking it here
 * would duplicate that gate rather than extend it, so this file's scope is
 * strictly the two Layer 5 scripts in this directory.
 *
 * Always runs the free, deterministic check (baseline-selector.mjs) — zero
 * cost, zero flakiness, safe on every PR including forks with no secrets. Runs
 * the model-in-the-loop eval (model-eval-runner.mjs) ONLY when both:
 *   (a) --full is passed, which CI sets only when the diff touches
 *       src/tools/registry.ts, src/core.ts, or src/tools/*.ts (see
 *       .github/workflows/eval-harness.yml's path filter), and
 *   (b) ANTHROPIC_API_KEY is present.
 * Missing (b) is a SKIP, not a FAIL — see model-eval-runner.mjs's own guard,
 * which this script's --full branch defers to rather than duplicating.
 *
 * Exit code 0 = all executed gates passed (or were skipped for lack of a key).
 * Non-zero = at least one executed gate failed.
 *
 * Usage:
 *   npm run build && node eval/run-eval.mjs                # baseline only
 *   npm run build && node eval/run-eval.mjs --full          # + model-in-the-loop, if keyed
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runFull = process.argv.includes("--full");

function run(label, script, args = []) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync("node", [resolve(__dirname, script), ...args], { stdio: "inherit" });
  return { label, code: res.status ?? 1 };
}

const results = [];
results.push(run("Layer 5 (free floor): baseline tool-selector", "baseline-selector.mjs"));

if (runFull) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\n=== Layer 5 (model-in-the-loop) ===");
    console.log("SKIPPED: --full requested but ANTHROPIC_API_KEY not set. In real CI this would");
    console.log("be a configured repo secret; locally it's an opt-in cost, so we skip, not fail.");
  } else {
    results.push(run("Layer 5: model-in-the-loop eval", "model-eval-runner.mjs"));
  }
} else {
  console.log("\n(Skipping model-in-the-loop eval — pass --full to run it. CI sets --full only");
  console.log(" when the diff touches src/tools/registry.ts, src/core.ts, or src/tools/*.ts.)");
}

console.log("\n=== summary ===");
let hardFail = false;
for (const r of results) {
  console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.label}`);
  if (r.code !== 0) hardFail = true;
}
process.exit(hardFail ? 1 : 0);
