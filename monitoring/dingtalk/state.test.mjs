// monitoring/dingtalk/state.test.mjs
//
// node:test coverage for the PURE dedupe/heartbeat/recovery state machine
// (computeNextAlertState / advanceCheckState) — exactly the scenario matrix
// this task specifies: 1 failure -> no alert, 2 -> alert, pass -> recovery,
// heartbeat at 2h. Plus a genuine (not stubbed) git-plumbing round trip for
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

test("advanceCheckState: 1st consecutive failure -> no alert", () => {
  const { nextEntry, actions } = advanceCheckState({}, "initialize", false, T0, "P0");
  assert.equal(actions.length, 0);
  assert.equal(nextEntry.consecutiveFailures, 1);
  assert.equal(nextEntry.alerted, false);
});

test("advanceCheckState: 2nd consecutive failure -> exactly one alert action", () => {
  const prevChecks = { initialize: { consecutiveFailures: 1, failingSince: T0, lastAlertAt: null, lastHeartbeatAt: null, alerted: false } };
  const { nextEntry, actions } = advanceCheckState(prevChecks, "initialize", false, T0 + 60_000, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "alert");
  assert.equal(actions[0].severity, "P0");
  assert.equal(nextEntry.alerted, true);
  assert.equal(nextEntry.consecutiveFailures, 2);
});

test("advanceCheckState: a pass after alerting -> exactly one recovery action, state resets", () => {
  const prevChecks = {
    initialize: { consecutiveFailures: 2, failingSince: T0, lastAlertAt: T0 + 60_000, lastHeartbeatAt: T0 + 60_000, alerted: true },
  };
  const now = T0 + 5 * 60_000;
  const { nextEntry, actions } = advanceCheckState(prevChecks, "initialize", true, now, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "recovery");
  assert.equal(actions[0].outageMs, now - T0);
  assert.deepEqual(nextEntry, { consecutiveFailures: 0, failingSince: null, lastAlertAt: null, lastHeartbeatAt: null, alerted: false });
});

test("advanceCheckState: a pass with zero prior failures -> no action, no-op", () => {
  const { nextEntry, actions } = advanceCheckState({}, "initialize", true, T0, "P0");
  assert.equal(actions.length, 0);
  assert.equal(nextEntry.consecutiveFailures, 0);
});

test("advanceCheckState: still failing, already alerted, before 2h -> no new action", () => {
  const prevChecks = {
    initialize: { consecutiveFailures: 5, failingSince: T0, lastAlertAt: T0 + 60_000, lastHeartbeatAt: T0 + 60_000, alerted: true },
  };
  const now = T0 + 60_000 + 30 * 60_000; // 30 minutes after last heartbeat — well under 2h
  const { actions } = advanceCheckState(prevChecks, "initialize", false, now, "P0");
  assert.equal(actions.length, 0);
});

test("advanceCheckState: still failing, already alerted, >=2h since last heartbeat -> heartbeat action", () => {
  const prevChecks = {
    initialize: { consecutiveFailures: 5, failingSince: T0, lastAlertAt: T0 + 60_000, lastHeartbeatAt: T0 + 60_000, alerted: true },
  };
  const now = T0 + 60_000 + 2 * HOUR;
  const { nextEntry, actions } = advanceCheckState(prevChecks, "initialize", false, now, "P0");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "heartbeat");
  assert.equal(nextEntry.lastHeartbeatAt, now);
});

test("advanceCheckState: a second heartbeat only fires after another full 2h from the first heartbeat", () => {
  let prevChecks = {
    initialize: { consecutiveFailures: 5, failingSince: T0, lastAlertAt: T0 + 60_000, lastHeartbeatAt: T0 + 60_000, alerted: true },
  };
  const firstHeartbeatAt = T0 + 60_000 + 2 * HOUR;
  let step = advanceCheckState(prevChecks, "initialize", false, firstHeartbeatAt, "P0");
  assert.equal(step.actions.length, 1);
  assert.equal(step.actions[0].type, "heartbeat");

  prevChecks = { initialize: step.nextEntry };
  // Only 1h after the first heartbeat — too soon for a second one.
  step = advanceCheckState(prevChecks, "initialize", false, firstHeartbeatAt + HOUR, "P0");
  assert.equal(step.actions.length, 0);

  prevChecks = { initialize: step.nextEntry };
  // A further 1h later (2h total since the first heartbeat) -> second heartbeat.
  step = advanceCheckState(prevChecks, "initialize", false, firstHeartbeatAt + 2 * HOUR, "P0");
  assert.equal(step.actions.length, 1);
  assert.equal(step.actions[0].type, "heartbeat");
});

test("computeNextAlertState: drives multiple independent checks through one state object without cross-talk", () => {
  const results = [
    { id: "initialize", ok: false, severity: "P0" },
    { id: "tools_list", ok: true, severity: "P0" },
  ];
  const { nextState, actions } = computeNextAlertState({}, results, T0);
  assert.equal(actions.length, 0); // 1st failure for initialize, tools_list passes cleanly
  assert.equal(nextState.checks.initialize.consecutiveFailures, 1);
  assert.equal(nextState.checks.tools_list.consecutiveFailures, 0);
});

test("computeNextAlertState: end-to-end 1-fail / 2-fail / pass sequence across real calls", () => {
  let state = {};
  const sev = "P1";

  let step = computeNextAlertState(state, [{ id: "novada_setup", ok: false, severity: sev }], T0);
  assert.equal(step.actions.length, 0, "1st failure: no alert");
  state = step.nextState;

  step = computeNextAlertState(state, [{ id: "novada_setup", ok: false, severity: sev }], T0 + 15 * 60_000);
  assert.equal(step.actions.length, 1, "2nd failure: alert");
  assert.equal(step.actions[0].type, "alert");
  state = step.nextState;

  step = computeNextAlertState(state, [{ id: "novada_setup", ok: true, severity: sev }], T0 + 30 * 60_000);
  assert.equal(step.actions.length, 1, "pass after alert: recovery");
  assert.equal(step.actions[0].type, "recovery");
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
