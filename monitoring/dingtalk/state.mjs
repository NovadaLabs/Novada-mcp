#!/usr/bin/env node
/**
 * monitoring/dingtalk/state.mjs
 *
 * Two independent things live in this file:
 *
 * 1. `computeNextAlertState()` — a PURE function implementing the dedupe/
 *    heartbeat/recovery state machine for --mode alert. No I/O, no Date.now()
 *    call inside (the caller passes `now`) — fully unit-testable (see
 *    state.test.mjs), exactly like send.mjs's `nextAvailableInMs`.
 *
 * 2. `loadState()`/`saveState()` — persistence for that state ACROSS
 *    scheduled workflow runs (a fresh `actions/checkout` every 15 minutes
 *    has no memory of its own). See the "Why a git branch, not
 *    actions/cache" note below for the reasoning this project was asked to
 *    justify.
 *
 * ── Why a git branch, not actions/cache ──────────────────────────────────────
 * `actions/cache` is designed for build-artifact caching, not a mutable KV
 * store: a cache entry is immutable once created under a given key (the
 * action itself refuses to overwrite one) — the documented workaround is to
 * save under an ever-changing key (e.g. the run id) and restore via a
 * `restore-keys` PREFIX match against "the most recently created matching
 * entry". That's workable but indirect, grows an ever-increasing number of
 * cache entries this project would have no reason to ever clean up, and is
 * subject to GitHub's 7-day-unused eviction + the repo's shared 10GB cache
 * quota (shared with every OTHER workflow in this repo, e.g. ci.yml's own
 * caches) — eviction of OUR entry would silently reset dedupe state and
 * nobody would notice until a flood of duplicate alerts explained why.
 *
 * A dedicated orphan branch (`dingtalk-health-state`, one committed
 * `state.json`) avoids all of that: a normal git ref, never evicted, whose
 * entire history IS a human-readable audit trail of every dedupe-state
 * transition (`git log` on that branch). Writing it uses git PLUMBING
 * commands only (`hash-object`/`mktree`/`commit-tree`/`push`) — this never
 * touches the actual checked-out working tree or its branch (`feat/...`/
 * `main`), so there is no risk of a stray `git checkout` leaving the runner
 * on the wrong ref mid－job. The only new permission required is
 * `contents: write` on the single step that calls `saveState()` (see
 * mcp-health-dingtalk.yml) — same shape of minimal, step-scoped permission
 * nightly-canary.yml already uses for `issues: write`.
 *
 * `loadState`/`saveState` accept an injectable `runGit` so state.test.mjs
 * can stub it out — the PURE state machine above is what every one of this
 * task's required dedupe test cases actually exercises; the git I/O below
 * is exercised for real only by running this script in CI (or manually
 * against a scratch repo), per this project's "node:test" requirement
 * listing the dedupe-machine cases specifically, not the git plumbing.
 */

import { execFileSync } from "node:child_process";

export const STATE_BRANCH = "dingtalk-health-state";
export const STATE_FILE = "state.json";
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours, per design doc §5.1(a)/(b)

/**
 * Advance one check's dedupe/heartbeat/recovery state by one run's result.
 * Pure — `now` (ms epoch) is a parameter, never read from the clock inside.
 *
 * Entry shape (`prevState.checks[id]`, created with defaults when absent):
 *   { consecutiveFailures: number, failingSince: number|null,
 *     lastAlertAt: number|null, lastHeartbeatAt: number|null, alerted: boolean }
 *
 * Rules (exactly what this task's test matrix specifies):
 *   - 1st consecutive failure: no alert (avoid single-blip false positives —
 *     matches design doc §5.1(a)'s "tolerate one scheduling/network blip").
 *   - 2nd consecutive failure: emit an "alert" action.
 *   - still failing after the alert: emit a "heartbeat" action every 2h
 *     (so an unresolved outage doesn't look "already read/handled").
 *   - a pass after `alerted`: emit a "recovery" action carrying the outage
 *     duration, then reset the entry to a clean baseline.
 *   - a pass with 0 prior consecutive failures: no action, no state change.
 *
 * @param {Record<string, object>} prevChecks prior `state.checks` map
 * @param {string} id check id
 * @param {boolean} resultOk this run's probe result for `id`
 * @param {number} now ms epoch
 * @param {string} severity this check's CHECK_TABLE severity, carried into "alert" actions
 * @returns {{nextEntry: object, actions: Array<object>}}
 */
export function advanceCheckState(prevChecks, id, resultOk, now, severity) {
  const entry = prevChecks[id] || {
    consecutiveFailures: 0,
    failingSince: null,
    lastAlertAt: null,
    lastHeartbeatAt: null,
    alerted: false,
  };
  const actions = [];

  if (resultOk) {
    if (entry.alerted) {
      actions.push({
        type: "recovery",
        id,
        failingSince: entry.failingSince,
        recoveredAt: now,
        outageMs: entry.failingSince ? now - entry.failingSince : null,
      });
    }
    return {
      nextEntry: { consecutiveFailures: 0, failingSince: null, lastAlertAt: null, lastHeartbeatAt: null, alerted: false },
      actions,
    };
  }

  const consecutiveFailures = entry.consecutiveFailures + 1;
  const failingSince = entry.failingSince ?? now;
  let lastAlertAt = entry.lastAlertAt;
  let lastHeartbeatAt = entry.lastHeartbeatAt;
  let alerted = entry.alerted;

  if (!alerted && consecutiveFailures >= 2) {
    actions.push({ type: "alert", id, severity, failingSince, consecutiveFailures });
    alerted = true;
    lastAlertAt = now;
    lastHeartbeatAt = now;
  } else if (alerted) {
    const sinceLastHeartbeat = now - (lastHeartbeatAt ?? lastAlertAt ?? now);
    if (sinceLastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      actions.push({ type: "heartbeat", id, severity, failingSince, outageMs: now - failingSince });
      lastHeartbeatAt = now;
    }
  }

  return {
    nextEntry: { consecutiveFailures, failingSince, lastAlertAt, lastHeartbeatAt, alerted },
    actions,
  };
}

/**
 * Advance the WHOLE state for one run across every check result.
 *
 * @param {{checks?: Record<string, object>}} prevState
 * @param {Array<{id: string, ok: boolean, severity: string}>} checkResults
 * @param {number} now ms epoch
 * @returns {{nextState: {checks: Record<string, object>}, actions: Array<object>}}
 */
export function computeNextAlertState(prevState, checkResults, now) {
  const prevChecks = prevState?.checks || {};
  const nextChecks = {};
  const actions = [];
  for (const r of checkResults) {
    const { nextEntry, actions: a } = advanceCheckState(prevChecks, r.id, r.ok, now, r.severity);
    nextChecks[r.id] = nextEntry;
    actions.push(...a);
  }
  return { nextState: { checks: nextChecks }, actions };
}

// ── Git-branch-backed persistence (CI only; see module doc comment) ────────

function defaultRunGit(args, { cwd, input, env } = {}) {
  return execFileSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/**
 * Load `state.json` from the orphan state branch. Returns `{}` (fresh
 * state) when the branch doesn't exist yet (first-ever run) or the fetch
 * fails for any reason — a missing/unreadable state branch must never
 * crash the monitor, it just means "nothing is known to be failing yet".
 *
 * @param {{cwd?: string, branch?: string, file?: string, runGit?: typeof defaultRunGit}} [opts]
 */
export function loadState({ cwd = process.cwd(), branch = STATE_BRANCH, file = STATE_FILE, runGit = defaultRunGit } = {}) {
  try {
    runGit(["fetch", "--quiet", "origin", `${branch}:refs/remotes/origin/${branch}`], { cwd });
  } catch {
    return {};
  }
  try {
    const content = runGit(["show", `origin/${branch}:${file}`], { cwd });
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Commit `state` to the orphan state branch and push it — using git
 * PLUMBING only (hash-object/mktree/commit-tree/push), never `git
 * checkout`, so the caller's actual working tree/branch is never touched.
 *
 * @param {object} state
 * @param {{cwd?: string, branch?: string, file?: string, runGit?: typeof defaultRunGit}} [opts]
 */
export function saveState(state, { cwd = process.cwd(), branch = STATE_BRANCH, file = STATE_FILE, runGit = defaultRunGit } = {}) {
  const json = `${JSON.stringify(state, null, 2)}\n`;

  let parent = null;
  try {
    parent = runGit(["rev-parse", `origin/${branch}`], { cwd }).trim();
  } catch {
    parent = null; // branch doesn't exist yet — first commit on it
  }

  const blobHash = runGit(["hash-object", "-w", "--stdin"], { cwd, input: json }).trim();
  const treeInput = `100644 blob ${blobHash}\t${file}\n`;
  const treeHash = runGit(["mktree"], { cwd, input: treeInput }).trim();

  const commitArgs = ["commit-tree", treeHash, "-m", `chore(state): update ${file} @ ${new Date().toISOString()}`];
  if (parent) commitArgs.push("-p", parent);
  const commitEnv = {
    GIT_AUTHOR_NAME: "dingtalk-health-bot",
    GIT_AUTHOR_EMAIL: "actions@users.noreply.github.com",
    GIT_COMMITTER_NAME: "dingtalk-health-bot",
    GIT_COMMITTER_EMAIL: "actions@users.noreply.github.com",
  };
  const commitHash = runGit(commitArgs, { cwd, env: commitEnv }).trim();

  runGit(["push", "origin", `${commitHash}:refs/heads/${branch}`], { cwd });
  return commitHash;
}
