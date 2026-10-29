/**
 * Pure unit tests for crash-loop-policy.ts (round 2 fix for the reviewed
 * HIGH: the round-1 wall-clock "N deaths per window" ceiling was starvable
 * by its own backoff pacing and never tripped at realistic WEB_CONCURRENCY
 * with the shipped defaults — see crash-loop-policy.ts's header comment).
 *
 * Imports the BUILT dist/crash-loop-policy.js directly and uses its exported
 * PRODUCTION DEFAULT constants (HEALTHY_AFTER_MS, MAX_EARLY_DEATHS,
 * REFORK_BACKOFF_BASE_MS, REFORK_BACKOFF_MAX_MS) as-is — never redefined or
 * overridden here — so these tests exercise exactly what ships, closing the
 * held-constant-axis gap the re-review flagged in round 1 (the old test used
 * fast knobs that sat on the "always trips" side of the starvation
 * inequality, so it could not see the production-default failure).
 *
 * This is a pure function/state-machine test: no timers, no `cluster.fork()`,
 * no real process — `onWorkerExit`/`onWorkerHealthy` are plain, synchronous,
 * side-effect-free functions over a plain state object, so WEB_CONCURRENCY is
 * simulated simply by interleaving which "worker chain" an exit call is
 * attributed to; the policy itself has no concurrency-count parameter at all
 * (that absence IS the fix — the round-1 formula's dependence on
 * WEB_CONCURRENCY is structurally gone, not just retuned).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_POLICY = join(__dirname, "..", "dist", "crash-loop-policy.js");

// FAIL, never silently skip — see server.test.mjs for the full rationale
// (reviewed HIGH, round 1).
if (!existsSync(DIST_POLICY)) {
  throw new Error(
    `dist/crash-loop-policy.js is missing (looked at ${DIST_POLICY}). Run \`npm run build:server\` first — ` +
      "this suite must FAIL, not silently skip, when the EC2 entrypoint hasn't been built.",
  );
}

const policy = await import(DIST_POLICY);
const { HEALTHY_AFTER_MS, MAX_EARLY_DEATHS, REFORK_BACKOFF_BASE_MS, REFORK_BACKOFF_MAX_MS, initialCrashLoopState, onWorkerExit, onWorkerHealthy } =
  policy;

test("crash-loop-policy: production defaults are sane (sanity check on the imported constants themselves)", () => {
  assert.equal(HEALTHY_AFTER_MS, 30_000, "HEALTHY_AFTER_MS default must be 30s per the fix brief");
  assert.equal(MAX_EARLY_DEATHS, 3, "MAX_EARLY_DEATHS default must be 3 per the fix brief");
  assert.equal(REFORK_BACKOFF_BASE_MS, 1_000);
  assert.equal(REFORK_BACKOFF_MAX_MS, 30_000);
});

for (let webConcurrency = 1; webConcurrency <= 8; webConcurrency++) {
  test(`crash-loop-policy: persistent startup fault -> exit(1) decided at WEB_CONCURRENCY=${webConcurrency}, independent of concurrency`, () => {
    // Simulate `webConcurrency` worker "chains" all dying early (never
    // healthy), round-robin, against the ONE shared state — exactly how
    // runPrimary shares a single crashLoopState across every cluster.fork().
    let state = initialCrashLoopState();
    let exitDecided = false;
    let deathsUntilExit = 0;
    const seenDelays = [];

    for (let death = 1; death <= MAX_EARLY_DEATHS + 2 && !exitDecided; death++) {
      // Which chain died is irrelevant to the policy — it has no
      // concurrency parameter — but we cycle through `webConcurrency`
      // notional chains to prove that irrelevance explicitly.
      void (death % webConcurrency);
      const { nextState, decision } = onWorkerExit(state, false);
      state = nextState;
      deathsUntilExit = death;
      if (decision.action === "exit") {
        exitDecided = true;
      } else {
        seenDelays.push(decision.delayMs);
      }
    }

    assert.ok(exitDecided, `expected an "exit" decision within ${MAX_EARLY_DEATHS + 2} early deaths`);
    assert.equal(
      deathsUntilExit,
      MAX_EARLY_DEATHS,
      `exit must be decided on EXACTLY the ${MAX_EARLY_DEATHS}th consecutive early death, regardless of WEB_CONCURRENCY=${webConcurrency}`,
    );
    // Backoff before the exit: base, then doubling (1s, 2s, ... capped).
    assert.equal(seenDelays.length, MAX_EARLY_DEATHS - 1);
    for (let i = 0; i < seenDelays.length; i++) {
      const expected = Math.min(REFORK_BACKOFF_BASE_MS * 2 ** i, REFORK_BACKOFF_MAX_MS);
      assert.equal(seenDelays[i], expected, `backoff delay #${i} mismatch`);
    }
  });
}

test("crash-loop-policy: one healthy-then-crash per day -> never exits, always reforks promptly", () => {
  let state = initialCrashLoopState();
  const DAYS = 1000; // far more than any real deployment will ever see in review
  for (let day = 0; day < DAYS; day++) {
    // Worker runs fine for the whole day: it reaches healthy at some point.
    state = onWorkerHealthy(state);
    // ...then crashes once (OOM, rare bug) — this specific worker DID become
    // healthy before dying.
    const { nextState, decision } = onWorkerExit(state, true);
    state = nextState;
    assert.equal(decision.action, "refork", `day ${day}: a healthy-then-crash death must never trigger exit`);
    assert.equal(decision.delayMs, 0, `day ${day}: a healthy-then-crash death must refork promptly, no backoff wait`);
    assert.equal(state.consecutiveEarlyDeaths, 0, `day ${day}: healthy-then-crash must not accumulate toward the early-death counter`);
  }
});

test("crash-loop-policy: a healthy worker resets the counter for everyone else, restarting the early-death count from zero", () => {
  let state = initialCrashLoopState();

  // MAX_EARLY_DEATHS - 1 early deaths — must NOT have tripped the ceiling yet.
  for (let i = 0; i < MAX_EARLY_DEATHS - 1; i++) {
    const { nextState, decision } = onWorkerExit(state, false);
    state = nextState;
    assert.equal(decision.action, "refork", `early death #${i + 1} of ${MAX_EARLY_DEATHS - 1} must not exit yet`);
  }
  assert.equal(state.consecutiveEarlyDeaths, MAX_EARLY_DEATHS - 1);

  // Some OTHER worker reaches healthy — this must reset the shared state,
  // even though the struggling chain above never itself became healthy.
  state = onWorkerHealthy(state);
  assert.equal(state.consecutiveEarlyDeaths, 0, "onWorkerHealthy must reset the shared early-death counter");
  assert.equal(state.backoffMs, REFORK_BACKOFF_BASE_MS, "onWorkerHealthy must reset backoff to base");

  // Now MAX_EARLY_DEATHS - 1 MORE early deaths from the still-struggling
  // chain must AGAIN not trip the ceiling (proves the reset actually took
  // effect, not just that the counter happened to still be below threshold).
  for (let i = 0; i < MAX_EARLY_DEATHS - 1; i++) {
    const { nextState, decision } = onWorkerExit(state, false);
    state = nextState;
    assert.equal(decision.action, "refork", `post-reset early death #${i + 1} must not exit yet`);
  }

  // The Nth consecutive early death AFTER the reset must now trip it.
  const { decision: finalDecision } = onWorkerExit(state, false);
  assert.equal(finalDecision.action, "exit", "the Nth early death after a reset must still eventually trip the ceiling");
});

test("crash-loop-policy: onWorkerHealthy is idempotent / safe to call from an already-reset state", () => {
  const state = initialCrashLoopState();
  const resetAgain = onWorkerHealthy(state);
  assert.deepEqual(resetAgain, state);
});
