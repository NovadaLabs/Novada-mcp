// monitoring/dingtalk/state.test.mjs
//
// node:test coverage for the PURE dedupe/heartbeat/recovery state machine
// (computeNextAlertState / advanceCheckState) — the scenario matrix this
// task specifies (2026-10-25 cadence change, alert-check moved to 4x/day):
// `resultOk` passed in is already the CONFIRMED result (checks.mjs's
// runChecksWithConfirmation has already re-probed any failure once inside
// the same run before this function ever sees it) — so a 1st confirmed
// failure alerts immediately, a later failing run reminds (replacing the
// old fixed 2h heartbeat timer, which doesn't fit a 6h-apart cadence), and
// a pass recovers. Plus a genuine (not stubbed) git-plumbing round trip for
// loadState/saveState against a local scratch bare repo, so the
// persistence layer is proven correct too, not merely never exercised.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { advanceCheckState, computeNextAlertState, loadState, saveState } from "./state.mjs";

const T0 = 1_700_000_000_000; // arbitrary fixed epoch ms
const HOUR = 60 * 60 * 1000;

test("advanceCheckState: 1st confirmed failure -> exactly one alert action, fired immediately (no 2nd-run wait)", () => {
  const { nextEntry, actions } = advanceCheckState({}, "initialize", false, T0, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "alert");
  assert.equal(actions[0].severity, "P0");
  assert.equal(nextEntry.consecutiveFailures, 1);
  assert.equal(nextEntry.alerted, true);
});

test("advanceCheckState: a pass after alerting -> exactly one recovery action, state resets", () => {
  const prevChecks = {
    initialize: { consecutiveFailures: 1, failingSince: T0, alerted: true },
  };
  const now = T0 + 5 * 60_000;
  const { nextEntry, actions } = advanceCheckState(prevChecks, "initialize", true, now, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "recovery");
  assert.equal(actions[0].outageMs, now - T0);
  assert.deepEqual(nextEntry, { consecutiveFailures: 0, failingSince: null, alerted: false });
});

test("advanceCheckState: a pass with zero prior failures -> no action, no-op", () => {
  const { nextEntry, actions } = advanceCheckState({}, "initialize", true, T0, "P0");
  assert.equal(actions.length, 0);
  assert.equal(nextEntry.consecutiveFailures, 0);
});

test("advanceCheckState: still failing on a LATER run, already alerted -> one heartbeat (still-failing reminder) action", () => {
  const prevChecks = {
    initialize: { consecutiveFailures: 1, failingSince: T0, alerted: true },
  };
  // At the current 4x/day (~6h-apart) cadence, "a later run" is the only
  // signal — there is no 2h timer to wait out anymore.
  const now = T0 + 6 * HOUR;
  const { nextEntry, actions } = advanceCheckState(prevChecks, "initialize", false, now, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "heartbeat");
  assert.equal(actions[0].outageMs, now - T0);
  assert.equal(nextEntry.consecutiveFailures, 2);
});

test("advanceCheckState: a heartbeat fires on EVERY subsequent failing run (bounded to at most 1/run -> at most 4/day at this cadence)", () => {
  let prevChecks = {
    initialize: { consecutiveFailures: 1, failingSince: T0, alerted: true },
  };
  let now = T0 + 6 * HOUR;
  let step = advanceCheckState(prevChecks, "initialize", false, now, "P0");
  assert.equal(step.actions.length, 1);
  assert.equal(step.actions[0].type, "heartbeat");

  // The very next run, still failing -> another heartbeat (no timer gate).
  prevChecks = { initialize: step.nextEntry };
  now += 6 * HOUR;
  step = advanceCheckState(prevChecks, "initialize", false, now, "P0");
  assert.equal(step.actions.length, 1);
  assert.equal(step.actions[0].type, "heartbeat");
  assert.equal(step.nextEntry.consecutiveFailures, 3);
});

test("computeNextAlertState: drives multiple independent checks through one state object without cross-talk", () => {
  const results = [
    { id: "initialize", ok: false, severity: "P0" },
    { id: "tools_list", ok: true, severity: "P0" },
  ];
  const { nextState, actions } = computeNextAlertState({}, results, T0);
  assert.equal(actions.length, 1, "1st confirmed failure for initialize alerts immediately; tools_list passes cleanly");
  assert.equal(actions[0].id, "initialize");
  assert.equal(actions[0].type, "alert");
  assert.equal(nextState.checks.initialize.consecutiveFailures, 1);
  assert.equal(nextState.checks.tools_list.consecutiveFailures, 0);
});

test("computeNextAlertState: end-to-end alert / reminder / recovery sequence across real calls", () => {
  let state = {};
  const sev = "P1";

  // 1st confirmed-failing run (checks.mjs's runChecksWithConfirmation has
  // already re-probed and confirmed this before it ever reaches here).
  let step = computeNextAlertState(state, [{ id: "novada_setup", ok: false, severity: sev }], T0);
  assert.equal(step.actions.length, 1, "1st confirmed failure: alert");
  assert.equal(step.actions[0].type, "alert");
  state = step.nextState;

  // Next scheduled run (~6h later at the current cadence), still failing.
  step = computeNextAlertState(state, [{ id: "novada_setup", ok: false, severity: sev }], T0 + 6 * HOUR);
  assert.equal(step.actions.length, 1, "still failing on a later run: heartbeat reminder");
  assert.equal(step.actions[0].type, "heartbeat");
  state = step.nextState;

  step = computeNextAlertState(state, [{ id: "novada_setup", ok: true, severity: sev }], T0 + 12 * HOUR);
  assert.equal(step.actions.length, 1, "pass after alert: recovery");
  assert.equal(step.actions[0].type, "recovery");
});

test("advanceCheckState: first-ever run (empty prior state), confirmed-failing -> alert, with a fresh failingSince", () => {
  const { nextEntry, actions } = advanceCheckState({}, "initialize", false, T0, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "alert");
  assert.equal(actions[0].failingSince, T0);
  assert.equal(nextEntry.failingSince, T0);
});

// ── Git-branch persistence: genuine round trip against a local bare repo ────
// No network — "origin" is a throwaway `git init --bare` directory. Proves
// loadState()/saveState() actually work (plumbing commands, branch
// creation, push, re-fetch), not merely that they're never exercised.

test("loadState/saveState: real round trip against a local bare-repo remote", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "dingtalk-state-test-"));
  const bareDir = path.join(scratch, "origin.git");
  const workDir = path.join(scratch, "work");
  try {
    execFileSync("git", ["init", "--quiet", "--bare", bareDir]);
    execFileSync("git", ["init", "--quiet", workDir]);
    execFileSync("git", ["remote", "add", "origin", bareDir], { cwd: workDir });

    // Branch doesn't exist yet -> fresh/default state.
    const initial = loadState({ cwd: workDir });
    assert.deepEqual(initial, {});

    const stateA = { checks: { initialize: { consecutiveFailures: 2, alerted: true } } };
    const commit1 = saveState(stateA, { cwd: workDir });
    assert.ok(commit1 && commit1.length === 40, "saveState must return a real commit SHA");

    const reloaded = loadState({ cwd: workDir });
    assert.deepEqual(reloaded, stateA);

    // Second save must build on the first (parent commit), not orphan it.
    const stateB = { checks: { initialize: { consecutiveFailures: 0, alerted: false } } };
    saveState(stateB, { cwd: workDir });
    const reloadedB = loadState({ cwd: workDir });
    assert.deepEqual(reloadedB, stateB);

    const log = execFileSync("git", ["log", "--oneline", `origin/dingtalk-health-state`], { cwd: workDir, encoding: "utf8" });
    assert.equal(log.trim().split("\n").length, 2, "two commits on the state branch (one per saveState call)");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
