// monitoring/dingtalk/workflow.test.mjs
//
// CRITICAL finding (2026-10-23 review): the alert-check job's step that runs
// run.mjs did not pass NOVADA_TEST_KEY, even though the free checks it runs
// (initialize/tools_list/novada_setup) need it to authenticate — every
// scheduled run 401'd exactly like a real `mcp.novada.com` outage, firing a
// false P0 forever. checks.mjs's requireApiKey() guard (see checks.test.mjs)
// now makes that class of bug impossible to MISREAD as an outage even if it
// recurs — but the wiring gap itself can still recur (someone edits the
// workflow, forgets the env line). This file is the "make the class of bug
// impossible" half of the fix at the WORKFLOW level: it parses
// mcp-health-dingtalk.yml's own actual YAML and asserts, for each job that
// invokes `node monitoring/dingtalk/run.mjs --mode <mode>`, that the step's
// `env:` block provides every env var CHECK_TABLE declares that `<mode>`'s
// rows need (requiredEnvVarsForCosts() — derived from the table, never a
// hardcoded "alert-check needs NOVADA_TEST_KEY" string anywhere in this
// file, so a FUTURE check added with a new requiredEnvVars entry is
// automatically covered by this same test with zero changes here).
//
// Hand-rolled, narrowly-scoped line-indentation parser for THIS file's own
// known-stable shape (jobs: -> 2-space job name -> steps: -> 6-space "- "
// item -> 8-space direct keys, one of which, `env:`, has its own 10-space
// child keys) — same "small, no-dependency, scoped to one file's verified
// shape" convention as distribution/test/ci-layout.test.mjs's parseJobs(),
// not an attempt at a general YAML parser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { requiredEnvVarsForCosts } from "./checks.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "mcp-health-dingtalk.yml");

/** A job's "run.mjs step": which --mode it invokes, and the set of env var
 * NAMES (not values — a repo secret's value isn't checked out) declared in
 * that same step's `env:` block. */
function parseRunMjsSteps(raw) {
  const lines = raw.split("\n");
  const jobsStart = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsStart === -1) throw new Error("mcp-health-dingtalk.yml: no top-level 'jobs:' key found");

  const jobs = {};
  let i = jobsStart + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // dedented back to column 0 -> jobs: block ended
    const jobMatch = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (!jobMatch) {
      i += 1;
      continue;
    }
    const jobName = jobMatch[1];

    // Scan this job's own lines (anything indented > 2 spaces) for a step
    // whose `run:` value contains "run.mjs", and that SAME step's `env:`
    // child-key names.
    let mode = null;
    let envVars = null;
    let j = i + 1;
    let currentStepEnvVars = null;
    while (j < lines.length) {
      const l = lines[j];
      if (/^\s*$/.test(l)) {
        j += 1;
        continue;
      }
      const indent = l.match(/^(\s*)/)[1].length;
      if (indent <= 2) break; // dedented back to job-name level (or column 0) -> this job ended

      if (/^ {6}- /.test(l)) currentStepEnvVars = new Set(); // a new step item started — reset per-step env tracking

      const envHeader = l.match(/^ {8}env:\s*$/);
      if (envHeader) {
        currentStepEnvVars = currentStepEnvVars || new Set();
        let k = j + 1;
        while (k < lines.length) {
          const l2 = lines[k];
          if (/^\s*$/.test(l2)) {
            k += 1;
            continue;
          }
          const indent2 = l2.match(/^(\s*)/)[1].length;
          if (indent2 < 10) break; // dedented out of the env: block
          if (/^\s*#/.test(l2)) {
            k += 1;
            continue;
          } // skip comment lines inside the env: block
          const kv = l2.match(/^ {10}([A-Za-z_][A-Z0-9_a-z]*):/);
          if (kv) currentStepEnvVars.add(kv[1]);
          k += 1;
        }
        j = k;
        continue;
      }

      const runMatch = l.match(/^ {8}run:\s*(.*)$/);
      if (runMatch && /run\.mjs/.test(runMatch[1])) {
        const modeMatch = runMatch[1].match(/--mode\s+(\w+)/);
        if (modeMatch) {
          mode = modeMatch[1];
          envVars = currentStepEnvVars || new Set();
        }
      }

      j += 1;
    }

    jobs[jobName] = { mode, envVars: envVars || new Set() };
    i = j;
  }
  return jobs;
}

let JOBS;
test.before(() => {
  const raw = readFileSync(WORKFLOW_PATH, "utf8");
  JOBS = parseRunMjsSteps(raw);
});

test("mcp-health-dingtalk.yml structure: both expected jobs exist, each invoking run.mjs with a mode", () => {
  assert.deepEqual(Object.keys(JOBS).sort(), ["alert-check", "daily-report"]);
  for (const [jobName, job] of Object.entries(JOBS)) {
    assert.ok(job.mode === "alert" || job.mode === "daily", `job "${jobName}" must invoke run.mjs --mode <alert|daily>, got: ${job.mode}`);
  }
});

test("mcp-health-dingtalk.yml: every job's env: block provides every env var its mode's checks declare they need (derived from CHECK_TABLE, class-level)", () => {
  for (const [jobName, job] of Object.entries(JOBS)) {
    const costs = job.mode === "daily" ? ["free", "billable"] : ["free"];
    const required = requiredEnvVarsForCosts(costs);
    for (const envVar of required) {
      assert.ok(
        job.envVars.has(envVar),
        `job "${jobName}" runs --mode ${job.mode}, whose CHECK_TABLE rows declare requiredEnvVars including "${envVar}", but the job's env: block doesn't provide it — this is exactly the CRITICAL 2026-10-23 wiring gap (alert-check missing NOVADA_TEST_KEY), generalized to any future check/env var`
      );
    }
  }
});

test("mcp-health-dingtalk.yml: the alert-check job specifically provides NOVADA_TEST_KEY (regression pin for the exact CRITICAL finding, in addition to the generalized check above)", () => {
  assert.ok(JOBS["alert-check"], "expected an 'alert-check' job");
  assert.equal(JOBS["alert-check"].mode, "alert");
  assert.ok(JOBS["alert-check"].envVars.has("NOVADA_TEST_KEY"));
});

test("mutation probe: parseRunMjsSteps DOES detect a missing env var when one is stripped from a synthetic job, proving the assertion above isn't vacuously passing", () => {
  const synthetic = [
    "jobs:",
    "  alert-check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - name: Run alert check",
    "        env:",
    "          DINGTALK_WEBHOOK_URL: ${{ secrets.DINGTALK_WEBHOOK_URL }}",
    "        run: node monitoring/dingtalk/run.mjs --mode alert",
    "",
  ].join("\n");
  const jobs = parseRunMjsSteps(synthetic);
  assert.equal(jobs["alert-check"].mode, "alert");
  assert.ok(!jobs["alert-check"].envVars.has("NOVADA_TEST_KEY"), "synthetic job deliberately omits NOVADA_TEST_KEY");
  const required = requiredEnvVarsForCosts(["free"]);
  const missing = [...required].filter((v) => !jobs["alert-check"].envVars.has(v));
  assert.ok(missing.includes("NOVADA_TEST_KEY"), "the parser + requiredEnvVarsForCosts combination must actually flag the synthetic gap");
});
