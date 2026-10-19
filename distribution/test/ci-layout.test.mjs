// distribution/test/ci-layout.test.mjs — brief-K (2026-10-15, K3 CRITICAL): proves
// .github/workflows/ci.yml's two-job layout actually closes the bug it was redesigned for.
//
// THE BUG (before this round): "Distribution tests" and "Distribution gate" ran as two STEPS
// inside the SAME "build" job, ahead of "Test (with coverage thresholds)"/"Lint". GitHub Actions
// skips every REMAINING step in a job once any earlier step in that job fails (no
// continue-on-error anywhere in this workflow) — so once "Distribution gate" failed (which it is
// DESIGNED to do today: hosted-server/landing/tools.html's claims_consistent mismatch is
// deliberately left red, see distribution/README.md), the product job's own Test/Lint steps
// never ran at all, on every single CI run, with zero signal that they'd silently stopped
// executing.
//
// THE FIX: "Distribution tests"/"Distribution gate" moved into a separate `distribution` job.
// GitHub Actions jobs run independently (in parallel, by default, with no `needs:` between them
// here) — a failure in one job can never skip a step in ANOTHER job. This file verifies that
// property structurally (parsing ci.yml's own job/step layout) AND operationally (a small,
// GitHub-Actions-semantics-accurate simulator over the parsed step list, given a forced
// per-step pass/fail outcome), plus a cheap bash syntax-check of every extracted `run:` script so
// a quoting/escaping bug in the YAML text itself is never papered over by an un-exercised
// extractor. No dependency: this file hand-parses ci.yml's own narrow, known-stable shape
// (jobs: -> <job>: -> steps: -> "- ..." items, each item's own nested one-level-deeper keys) —
// it does not attempt to be a general YAML/GitHub-Actions parser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { yamlLooksValid } from "../check.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_YML_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");

/** Hand-rolled, line-indentation-based extractor for ci.yml's own known-stable shape:
 *  `jobs:` (column 0) -> one job name per 2-space-indented `<name>:` line -> that job's `steps:`
 *  list, each item a `      - ` (6-space-indented) list entry whose own nested keys
 *  (`name`/`run`/`uses`/`working-directory`) sit exactly one level deeper (8-space indent). Not a
 *  general YAML parser — deliberately scoped to this exact, verified file shape, mirroring
 *  distribution/generate.mjs's/check.mjs's own "small, line-level, no dependency" extractors
 *  (e.g. check.mjs's extractYamlListsAfterKey) rather than introducing a YAML library. */
function parseJobs(raw) {
  const lines = raw.split("\n");
  const jobsStart = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsStart === -1) throw new Error("ci.yml: no top-level 'jobs:' key found");
  const jobs = {};
  let i = jobsStart + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // dedented back to column 0 -> jobs: block ended
    const jobMatch = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (!jobMatch) {
      i++;
      continue;
    }
    const jobName = jobMatch[1];
    const steps = [];
    let j = i + 1;
    while (j < lines.length) {
      const l2 = lines[j];
      if (/^\s*$/.test(l2)) {
        j++;
        continue;
      }
      const indent2 = l2.match(/^(\s*)/)[1].length;
      if (indent2 <= 2) break; // dedented back to job-name level (or column 0) -> this job ended
      const stepMatch = l2.match(/^ {6}- (.*)$/);
      if (!stepMatch) {
        j++;
        continue;
      }
      const step = { name: null, run: null, workingDirectory: null, uses: null };
      const firstKV = stepMatch[1].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (firstKV) applyStepKeyValue(step, firstKV[1], firstKV[2]);
      let k = j + 1;
      while (k < lines.length) {
        const l3 = lines[k];
        if (/^\s*$/.test(l3)) {
          k++;
          continue;
        }
        const indent3 = l3.match(/^(\s*)/)[1].length;
        if (indent3 < 8) break; // dedented out of this step item's own nested-key level
        const kv = l3.match(/^ {8}([A-Za-z_][\w-]*):\s*(.*)$/);
        if (kv) applyStepKeyValue(step, kv[1], kv[2]);
        k++;
      }
      steps.push(step);
      j = k;
    }
    jobs[jobName] = steps;
    i = j;
  }
  return jobs;
}

/** brief-L (2026-10-15, L4 LOW): parses each job's own DIRECT (4-space-indented) key names
 *  structurally — distinct from parseJobs' step-level (6/8-space-indented) extraction above.
 *  Returns `{jobName: Set<key>}`. Used to assert a job-level directive (e.g. `needs:`) is absent
 *  without a prose-text grep across the whole file, which could both false-positive on a comment
 *  mentioning the word (this file's own K3 comments literally say "no `needs:` between them" and
 *  "unless one `needs:` the other") and false-negative on a `needs:` key hidden inside an
 *  unrelated `run:` script body — neither of which is a real job-level YAML key. Comment lines
 *  (`^\s*#`) are skipped the same way test.before()'s own continue-on-error/if: assertion already
 *  does, so this walks the actual YAML structure, not the prose around it. */
function parseJobTopLevelKeys(raw) {
  const lines = raw.split("\n");
  const jobsStart = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsStart === -1) throw new Error("ci.yml: no top-level 'jobs:' key found");
  const jobKeys = {};
  let i = jobsStart + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // dedented back to column 0 -> jobs: block ended
    const jobMatch = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (!jobMatch) {
      i++;
      continue;
    }
    const jobName = jobMatch[1];
    const keys = new Set();
    let j = i + 1;
    while (j < lines.length) {
      const l2 = lines[j];
      if (/^\s*$/.test(l2) || /^\s*#/.test(l2)) {
        j++;
        continue;
      }
      const indent2 = l2.match(/^(\s*)/)[1].length;
      if (indent2 <= 2) break; // dedented back to job-name level (or column 0) -> this job ended
      const keyMatch = l2.match(/^ {4}([A-Za-z_][\w-]*):/);
      if (keyMatch) keys.add(keyMatch[1]);
      j++;
    }
    jobKeys[jobName] = keys;
    i = j;
  }
  return jobKeys;
}

function applyStepKeyValue(step, key, rawVal) {
  let v = rawVal.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
  if (key === "name") step.name = v;
  else if (key === "run") step.run = v;
  else if (key === "working-directory") step.workingDirectory = v;
  else if (key === "uses") step.uses = v;
}

/** GitHub-Actions-accurate step-execution simulator: given this job's parsed step list (in
 *  declared order) and a map of {stepName: "pass"|"fail"} (steps not named in the map default to
 *  "pass" — e.g. `uses:`-only steps that never declared a name), returns the ordered list of
 *  step names that WOULD actually run. Mirrors GitHub Actions' real default semantics exactly:
 *  no `continue-on-error`/`if:` anywhere in this workflow (verified: neither key appears in
 *  ci.yml at all — grepped before writing this simulator, not assumed), so the FIRST failing
 *  step stops every step after it in THAT SAME job; a job's own outcome never affects any other
 *  job's steps (jobs are independent processes/runners by default). */
function simulateJobRun(steps, outcomes = {}) {
  const ran = [];
  for (const step of steps) {
    if (step.name) ran.push(step.name); // unnamed `uses:`-only steps (e.g. actions/checkout) still RUN, they just have nothing to report by name
    const outcome = step.name && Object.prototype.hasOwnProperty.call(outcomes, step.name) ? outcomes[step.name] : "pass";
    if (outcome === "fail") break;
  }
  return ran;
}

let JOBS;
test.before(() => {
  const raw = readFileSync(CI_YML_PATH, "utf8");
  const valid = yamlLooksValid(raw);
  assert.ok(valid.ok, `ci.yml must parse as syntactically sane YAML: ${JSON.stringify(valid.issues)}`);
  // simulateJobRun()'s fail-fast-within-a-job model assumes no step declares continue-on-error
  // or a conditional `if:` gate anywhere in this workflow — checked against actual YAML
  // DIRECTIVE lines only (not this file's own prose, which legitimately discusses
  // "continue-on-error" by name in several comments above).
  const nonCommentLines = raw.split("\n").filter((l) => !/^\s*#/.test(l));
  assert.doesNotMatch(
    nonCommentLines.join("\n"),
    /^\s*(continue-on-error|if):\s/m,
    "this test's simulateJobRun() assumes no continue-on-error/if: gating exists anywhere in ci.yml — if one is ever added, this assumption (and the simulator) must be revisited"
  );
  JOBS = parseJobs(raw);
});

test("ci.yml structure: exactly the two expected jobs exist (build, distribution)", () => {
  assert.deepEqual(Object.keys(JOBS).sort(), ["build", "distribution"]);
});

test("ci.yml structure: the 'build' job no longer contains ANY distribution step — restored to its exact pre-brief-J shape", () => {
  const names = JOBS.build.map((s) => s.name).filter(Boolean);
  assert.deepEqual(names, ["Setup Node.js ${{ matrix.node-version }}", "Install dependencies", "Build", "Test (with coverage thresholds)", "Lint"]);
  for (const forbidden of ["Distribution tests", "Distribution gate"]) {
    assert.ok(!names.includes(forbidden), `'build' job must not contain a step named "${forbidden}" — that step's own job moved`);
  }
});

test("ci.yml structure: the 'distribution' job builds npm-package/ before running its own tests/gate, with 'Distribution tests' preceding 'Distribution gate' (brief-J J2's ordering, preserved)", () => {
  const names = JOBS.distribution.map((s) => s.name).filter(Boolean);
  assert.deepEqual(names, ["Setup Node.js", "Install dependencies", "Build", "Distribution tests", "Distribution gate"]);
  const testsIdx = names.indexOf("Distribution tests");
  const gateIdx = names.indexOf("Distribution gate");
  assert.ok(testsIdx >= 0 && gateIdx >= 0 && testsIdx < gateIdx, "Distribution tests must run before Distribution gate");
  const buildIdx = names.indexOf("Build");
  assert.ok(buildIdx >= 0 && buildIdx < testsIdx, "this job must build npm-package/ before running distribution tests/gate (claims_consistent reads build/ output)");
});

test("ci.yml structure: 'Distribution tests'/'Distribution gate' run at the REPO ROOT (working-directory override), not the workflow's npm-package/ default", () => {
  for (const name of ["Distribution tests", "Distribution gate"]) {
    const step = JOBS.distribution.find((s) => s.name === name);
    assert.ok(step, `expected a step named "${name}" in the distribution job`);
    assert.equal(step.workingDirectory, "${{ github.workspace }}", `"${name}" must override working-directory to the repo root`);
  }
});

test("GitHub Actions semantics simulation: a failing 'Distribution gate' (today's real, by-design state) never skips a single step in the 'build' job", () => {
  // Simulate the REAL, EXPECTED-TO-FAIL state: "Distribution gate" fails in the distribution job.
  const distributionRan = simulateJobRun(JOBS.distribution, { "Distribution gate": "fail" });
  assert.deepEqual(distributionRan, ["Setup Node.js", "Install dependencies", "Build", "Distribution tests", "Distribution gate"], "every step up to and including the failing gate itself should still have run");

  // The 'build' job is simulated INDEPENDENTLY — no outcome from the distribution job feeds into
  // it, because GitHub Actions jobs do not share step-skip state. This is the actual assertion
  // K3 exists to make true: Test/Lint are unconditionally reached.
  const buildRan = simulateJobRun(JOBS.build);
  assert.ok(buildRan.includes("Test (with coverage thresholds)"), "'build' job must reach its Test step regardless of the distribution job's own (failing) gate");
  assert.ok(buildRan.includes("Lint"), "'build' job must reach its Lint step regardless of the distribution job's own (failing) gate");
});

test("GitHub Actions semantics simulation: a hypothetical failing product step ('Build') in the 'build' job still stops its OWN remaining steps (sanity check that the simulator isn't vacuously permissive)", () => {
  const ran = simulateJobRun(JOBS.build, { Build: "fail" });
  assert.deepEqual(ran, ["Setup Node.js ${{ matrix.node-version }}", "Install dependencies", "Build"], "a real failure must still stop later steps IN THE SAME JOB — the fix only isolates CROSS-job skipping, not normal within-job fail-fast semantics");
});

test("ci.yml structure (brief-L L4): neither 'build' nor 'distribution' declares a job-level `needs:` key — the two-job split stays genuinely independent/parallel, not sequential", () => {
  const jobKeys = parseJobTopLevelKeys(readFileSync(CI_YML_PATH, "utf8"));
  for (const jobName of ["build", "distribution"]) {
    assert.ok(jobKeys[jobName], `expected a parsed job named "${jobName}"`);
    assert.ok(
      !jobKeys[jobName].has("needs"),
      `'${jobName}' job must not declare a 'needs:' key — a needs: dependency would make GitHub Actions run these two jobs sequentially (and would let the upstream job's failure skip the downstream job's steps entirely), reintroducing a variant of the exact cross-job-skip bug K3 redesigned this workflow to avoid`
    );
  }
});

test("ci.yml structure (brief-L L4) mutation probe: parseJobTopLevelKeys DOES detect a job-level 'needs:' key when one is injected into a synthetic jobs: block — proves the guard above is not vacuously passing", () => {
  const synthetic = [
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "  distribution:",
    "    runs-on: ubuntu-latest",
    "    needs: build",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "",
  ].join("\n");
  const jobKeys = parseJobTopLevelKeys(synthetic);
  assert.ok(jobKeys.distribution.has("needs"), "expected parseJobTopLevelKeys to detect an injected job-level 'needs:' key on the synthetic 'distribution' job");
  assert.ok(!jobKeys.build.has("needs"), "control: the synthetic 'build' job (no needs: key) must not be falsely flagged");
});

test("bash syntax check: every extracted run: script in both jobs is syntactically valid under bash --noprofile --norc -eo pipefail", () => {
  const allSteps = [...JOBS.build, ...JOBS.distribution];
  const runSteps = allSteps.filter((s) => s.run);
  assert.ok(runSteps.length >= 7, `expected at least 7 run: steps across both jobs, found ${runSteps.length}`);
  for (const step of runSteps) {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-n", "-c", step.run], { encoding: "utf8" });
    assert.equal(result.status, 0, `step "${step.name}"'s run: script failed bash syntax check (-n):\n  script: ${step.run}\n  stderr: ${result.stderr}`);
  }
});
