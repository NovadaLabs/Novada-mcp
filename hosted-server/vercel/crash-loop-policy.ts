/**
 * crash-loop-policy.ts — pure crash-loop decision policy for the EC2 cluster
 * primary (server.mts). Extracted as pure functions over plain state so the
 * decision logic can be unit-tested directly against the PRODUCTION DEFAULT
 * constants (test/crash-loop-policy.test.mjs imports them, never redefines
 * them), independent of real timers, real `cluster.fork()`, or WEB_CONCURRENCY.
 *
 * ── Round 2 fix: the round-1 "N deaths within a rolling window" ceiling was
 * starvable by its OWN backoff pacing ──────────────────────────────────────
 * Once backoff saturated at its cap, concurrent workers settled into a steady
 * inter-death spacing of roughly `REFORK_BACKOFF_MAX_MS / WEB_CONCURRENCY`,
 * and the rolling window evicted old deaths faster than new ones arrived at
 * that rate. The ceiling could only ever trip when
 * `WEB_CONCURRENCY > MAX_DEATHS * BACKOFF_MAX_MS / WINDOW_MS` — with the
 * shipped defaults that threshold was 5, so every realistic deployment
 * (WEB_CONCURRENCY 2-4) sat below it: a persistent bad release (corrupted
 * api/mcp.js, missing vendor file, etc.) converged to a quiet, permanent,
 * low-rate crash loop that NEVER handed off to systemd.
 *
 * New discriminator: not "how many deaths per minute" but "did this worker
 * EVER become healthy" (stayed listening for >= HEALTHY_AFTER_MS). A
 * persistent startup-time fault kills every worker before any of them ever
 * reaches that bar, so MAX_EARLY_DEATHS consecutive pre-healthy deaths — a
 * counter SHARED across every worker, because a bad release kills ALL of
 * them early — trips the ceiling regardless of concurrency, backoff pacing,
 * or wall-clock spacing (no window to starve). A worker that serves normally
 * for a while before dying (OOM, rare bug) never counts as an "early" death
 * at all, so an occasional transient crash never accumulates toward the
 * ceiling, and it resets the whole counter/backoff state for every other
 * worker too — live proof the current release can run.
 *
 * No secondary rolling-window ceiling was kept (see stage1-worker-report.md
 * "Fix round 2" for why: a second window+threshold pair either reintroduces
 * this exact starvation algebra, or — if window-free and "N deaths ever
 * since start" — would eventually false-positive on a long-lived, otherwise
 * healthy process that just accumulates rare OOM kills over weeks of uptime.
 * Neither form was net-positive, so the simpler single mechanism above is
 * the whole guard, per "simpler is better" unless proven otherwise.
 */

function envMs(name: string, fallback: number): number {
  const raw = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** A worker must stay listening this long before it counts as "healthy". */
export const HEALTHY_AFTER_MS = envMs("NOVADA_HEALTHY_AFTER_MS", 30_000);
/** Consecutive pre-healthy deaths (shared across ALL workers) before the
 *  primary gives up and exits(1) instead of forking again. */
export const MAX_EARLY_DEATHS = envMs("NOVADA_MAX_EARLY_DEATHS", 3);
/** Backoff before reforking after an early (pre-healthy) death: starts here,
 *  doubles on each consecutive early death, capped at REFORK_BACKOFF_MAX_MS.
 *  A healthy-then-crash death always reforks promptly (delayMs 0) instead —
 *  see onWorkerExit below. */
export const REFORK_BACKOFF_BASE_MS = envMs("NOVADA_REFORK_BACKOFF_BASE_MS", 1_000);
export const REFORK_BACKOFF_MAX_MS = envMs("NOVADA_REFORK_BACKOFF_MAX_MS", 30_000);

export interface CrashLoopState {
  readonly consecutiveEarlyDeaths: number;
  readonly backoffMs: number;
}

export function initialCrashLoopState(): CrashLoopState {
  return { consecutiveEarlyDeaths: 0, backoffMs: REFORK_BACKOFF_BASE_MS };
}

/**
 * ANY worker reaching HEALTHY (listened for >= HEALTHY_AFTER_MS, still
 * alive) resets BOTH the shared early-death counter and the backoff — it is
 * live proof the current release/environment can run successfully, so
 * lingering trouble in some OTHER worker is no longer presumed to be the
 * same persistent fault. Called the instant a worker crosses the threshold,
 * independent of (and possibly long before) that worker's own eventual exit.
 */
export function onWorkerHealthy(_state: CrashLoopState): CrashLoopState {
  return initialCrashLoopState();
}

export type CrashLoopDecision = { readonly action: "exit" } | { readonly action: "refork"; readonly delayMs: number };

/**
 * Called on every unexpected (non-shutdown) worker exit.
 *
 * @param becameHealthy whether THIS worker ever stayed listening for
 *   >= HEALTHY_AFTER_MS before it died (i.e. whether onWorkerHealthy already
 *   fired for it at some point in its lifetime).
 */
export function onWorkerExit(
  state: CrashLoopState,
  becameHealthy: boolean,
): { nextState: CrashLoopState; decision: CrashLoopDecision } {
  if (!becameHealthy) {
    const consecutiveEarlyDeaths = state.consecutiveEarlyDeaths + 1;
    if (consecutiveEarlyDeaths >= MAX_EARLY_DEATHS) {
      return {
        nextState: { consecutiveEarlyDeaths, backoffMs: state.backoffMs },
        decision: { action: "exit" },
      };
    }
    const delayMs = state.backoffMs;
    const nextBackoffMs = Math.min(state.backoffMs * 2, REFORK_BACKOFF_MAX_MS);
    return {
      nextState: { consecutiveEarlyDeaths, backoffMs: nextBackoffMs },
      decision: { action: "refork", delayMs },
    };
  }
  // Died AFTER becoming healthy: transient (OOM, rare bug), not a boot-time
  // loop. Reset everything and refork promptly — no backoff delay.
  return {
    nextState: initialCrashLoopState(),
    decision: { action: "refork", delayMs: 0 },
  };
}
