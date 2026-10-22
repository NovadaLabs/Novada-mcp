/**
 * scrape-transient-2026-10-21 follow-up (MEDIUM — reports/scrape-transient-review-2026-10-21.md):
 * `withSingleTransientRetry` used to be time-unaware — `submitScrapeTask` and
 * `submitSearchScrapeTask` each hardcoded a flat 60s axios timeout regardless of
 * `isHostedEnvironment()`, so a worst case of two ~60s attempts (~120.5s with the
 * retry delay) could exceed `HOSTED_SAFE_CEILING_MS` (50s) and
 * `HOSTED_FUNCTION_LIMIT_MS` (60s) — a platform 504 instead of the structured
 * `NovadaError` this retry exists to surface.
 *
 * This file pins the fix: `withSingleTransientRetry` now takes a
 * `SubmitRetryBudget` (`submitRetryBudget()` on hosted vs local) and
 *   1. skips the retry — rethrowing the ORIGINAL transient error immediately —
 *      once the remaining budget can no longer fit the delay + a next attempt;
 *   2. caps the per-attempt timeout it hands `op` to whatever of the budget
 *      remains, never more than `budget.perAttemptMs`.
 *
 * Tests (a) and (b) below are a deliberate MIRROR PAIR (per
 * feedback_pendulum_find_the_discriminator.md): (a) proves the budget-exhausted
 * guard fires (no retry) and (b) proves it does NOT fire when there is budget
 * left (retry happens) — a mutation that removes the `remainingAfterDelay <= 0`
 * check collapses both into "always retries", which (a) alone would catch, and
 * a mutation that makes the check always true collapses both into "never
 * retries", which (b) alone would catch. Neither mutation survives both.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  withSingleTransientRetry,
  submitRetryBudget,
  SINGLE_TRANSIENT_RETRY_DELAY_MS,
  type SubmitRetryBudget,
} from "../../src/_core/submit-retry.js";
import { HOSTED_SAFE_CEILING_MS, TIMEOUTS } from "../../src/config.js";
import { NovadaError, NovadaErrorCode, makeNovadaError } from "../../src/_core/errors.js";

// NOVADA_* vars are stripped by tests/setup.ts; the serverless markers are not —
// save/restore them explicitly, mirroring tests/tools/browser-runtime-guard.test.ts.
const RUNTIME_KEYS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME"] as const;
let savedRuntimeEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedRuntimeEnv = {};
  for (const k of RUNTIME_KEYS) {
    savedRuntimeEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of RUNTIME_KEYS) {
    const v = savedRuntimeEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function transientError(msg = "upstream blip"): NovadaError {
  return makeNovadaError(NovadaErrorCode.API_DOWN, msg);
}

// Deterministic fake clock: lets a test simulate "the first attempt took N ms"
// without an actual multi-second sleep. Only `withSingleTransientRetry`'s own
// elapsed-time bookkeeping reads Date.now(); the real `setTimeout` for the
// inter-attempt delay still runs (kept tiny below) so no real multi-second
// wait is introduced either way.
function installFakeClock(startMs = 1_700_000_000_000): { advance: (ms: number) => void } {
  let now = startMs;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return { advance: (ms: number) => { now += ms; } };
}

describe("submitRetryBudget — hosted vs local split", () => {
  // review2-2026-10-21 MEDIUM #1: hosted no longer caps a SINGLE attempt at
  // TIMEOUTS.SEARCH_SUBMIT_TIMEOUT (25s) — that cut off any platform whose
  // genuine submit takes 25-50s before the retry logic ever saw a result
  // (axios ECONNABORTED is a raw AxiosError, never retried by this module).
  // perAttemptMs is now Infinity (no cap beyond whatever of totalMs remains);
  // TIMEOUTS.SEARCH_SUBMIT_TIMEOUT is REPURPOSED as minRetryAttemptMs — see
  // config.ts's own doc comment on that constant for the reuse justification.
  it("hosted (VERCEL set): totalMs = HOSTED_SAFE_CEILING_MS, perAttemptMs = Infinity, minRetryAttemptMs = TIMEOUTS.SEARCH_SUBMIT_TIMEOUT", () => {
    process.env.VERCEL = "1";
    const budget = submitRetryBudget();
    expect(budget.totalMs).toBe(HOSTED_SAFE_CEILING_MS);
    expect(budget.perAttemptMs).toBe(Infinity);
    expect(budget.minRetryAttemptMs).toBe(TIMEOUTS.SEARCH_SUBMIT_TIMEOUT);
  });

  // M2: an explicit deadline (the shared whole-tool-call deadline established
  // once at tool entry — config.ts's toolCallDeadline()) makes totalMs
  // whatever of IT remains, not a fresh HOSTED_SAFE_CEILING_MS allotment.
  it("hosted + an explicit deadline: totalMs is derived from the REMAINING deadline, not a fresh HOSTED_SAFE_CEILING_MS", () => {
    process.env.VERCEL = "1";
    const { advance } = installFakeClock();
    const deadline = Date.now() + HOSTED_SAFE_CEILING_MS;
    advance(12_000); // simulate 12s already elapsed since tool entry
    const budget = submitRetryBudget(deadline);
    expect(budget.totalMs).toBe(HOSTED_SAFE_CEILING_MS - 12_000);
    expect(budget.totalMs).toBeLessThan(HOSTED_SAFE_CEILING_MS);
  });

  it("hosted + an ALREADY-PASSED deadline: totalMs clamps to 0, never negative", () => {
    process.env.VERCEL = "1";
    const { advance } = installFakeClock();
    const deadline = Date.now() + 1_000;
    advance(5_000); // deadline is now 4s in the past
    const budget = submitRetryBudget(deadline);
    expect(budget.totalMs).toBe(0);
  });

  it("local (no serverless markers): totalMs unbounded, perAttemptMs = TIMEOUTS.SUBMIT_TIMEOUT_LOCAL (the original hardcoded 60s), ignores any deadline passed in", () => {
    const deadline = Date.now() + 1; // would be exhausted almost immediately if honored
    const budget = submitRetryBudget(deadline);
    expect(budget.totalMs).toBe(Infinity);
    expect(budget.perAttemptMs).toBe(TIMEOUTS.SUBMIT_TIMEOUT_LOCAL);
    expect(budget.perAttemptMs).toBe(60_000);
  });
});

// review2 M1 — the three behaviors the FIX explicitly calls for, pinned
// against the REAL submitRetryBudget() (not a hand literal), so a regression
// in the production constants/wiring fails these directly.
describe("submitRetryBudget — M1: unbounded-first-attempt + minRetryAttemptMs gate", () => {
  it("hosted: a slow first submit (~40s simulated) succeeds WITHOUT being cut at the old 25s cap", async () => {
    process.env.VERCEL = "1";
    const { advance } = installFakeClock();
    const budget = submitRetryBudget();
    const op = vi.fn().mockImplementation(async (attemptTimeoutMs: number) => {
      // The attempt's own timeout must comfortably exceed 40s — i.e. a REAL
      // 40s-taking axios call would not have been aborted by it.
      expect(attemptTimeoutMs).toBeGreaterThan(40_000);
      advance(40_000); // simulate the attempt actually taking 40s
      return "ok-after-40s";
    });
    const result = await withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, budget);
    expect(result).toBe("ok-after-40s");
    expect(op).toHaveBeenCalledTimes(1);
  });

  // Mirror pair: (f) proves the minRetryAttemptMs gate fires (no retry) when
  // the remaining budget is below it; (g) proves it does NOT fire when the
  // remaining budget clears it — together these pin `<=` as the discriminator,
  // not just "some" gate existing (feedback_pendulum_find_the_discriminator.md).
  it("(f) hosted: a failure that leaves LESS than minRetryAttemptMs (25s) remaining → NO retry", async () => {
    process.env.VERCEL = "1";
    const { advance } = installFakeClock();
    const hostedBudget = submitRetryBudget();
    const original = transientError("consumed most of the budget");
    const op = vi.fn().mockImplementation(async () => {
      advance(30_000); // 50s total - 30s = 20s left, under the 25s minRetryAttemptMs
      throw original;
    });
    await expect(withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, hostedBudget)).rejects.toBe(original);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("(g) mirror of (f): hosted: a failure that leaves MORE than minRetryAttemptMs (25s) remaining → retry DOES happen", async () => {
    process.env.VERCEL = "1";
    const { advance } = installFakeClock();
    const hostedBudget = submitRetryBudget();
    const transient = transientError("fast failure, plenty of budget left");
    const op = vi.fn()
      .mockImplementationOnce(async () => {
        advance(5_000); // 50s total - 5s = 45s left, well over the 25s minRetryAttemptMs
        throw transient;
      })
      .mockResolvedValueOnce("ok-after-retry");
    const result = await withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, hostedBudget);
    expect(result).toBe("ok-after-retry");
    expect(op).toHaveBeenCalledTimes(2);
  });
});

describe("withSingleTransientRetry — budget-aware retry (mirror pair a/b)", () => {
  it("(a) hosted + slow first failure that consumes nearly the whole budget → NO retry, original error rethrown", async () => {
    const { advance } = installFakeClock();
    const budget: SubmitRetryBudget = { totalMs: 50_000, perAttemptMs: 25_000 };
    const original = transientError("slow transient failure");
    const op = vi.fn().mockImplementation(async () => {
      // Simulate an attempt that took 49.8s of the 50s total budget — only
      // 200ms left, which cannot fit SINGLE_TRANSIENT_RETRY_DELAY_MS (500ms).
      advance(49_800);
      throw original;
    });

    await expect(withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, budget)).rejects.toBe(original);
    expect(op).toHaveBeenCalledTimes(1); // the guard fired — no second attempt
  });

  it("(b) mirror of (a): hosted + a FAST first failure (budget intact) → retry DOES happen", async () => {
    const { advance } = installFakeClock();
    const budget: SubmitRetryBudget = { totalMs: 50_000, perAttemptMs: 25_000 };
    const transient = transientError("fast transient failure");
    const op = vi.fn()
      .mockImplementationOnce(async () => {
        advance(500); // fast failure — plenty of budget left
        throw transient;
      })
      .mockResolvedValueOnce("ok-after-retry");

    const result = await withSingleTransientRetry(op, 1, budget); // delayMs=1: no real wait needed
    expect(result).toBe("ok-after-retry");
    expect(op).toHaveBeenCalledTimes(2); // the guard did NOT fire — retry happened
  });

  it("(c) local (unbounded budget): even a 'slow' first failure still retries — local behavior unchanged", async () => {
    const { advance } = installFakeClock();
    const localBudget: SubmitRetryBudget = { totalMs: Infinity, perAttemptMs: TIMEOUTS.SUBMIT_TIMEOUT_LOCAL };
    const transient = transientError("local slow failure");
    const op = vi.fn()
      .mockImplementationOnce(async () => {
        advance(59_000); // would have exhausted a 50s/60s HOSTED budget
        throw transient;
      })
      .mockResolvedValueOnce("ok-local");

    const result = await withSingleTransientRetry(op, 1, localBudget);
    expect(result).toBe("ok-local");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("(d) per-attempt timeout handed to `op` is capped by perAttemptMs even when more of totalMs remains", async () => {
    const budget: SubmitRetryBudget = { totalMs: 50_000, perAttemptMs: 25_000 };
    const op = vi.fn().mockResolvedValue("ok");
    await withSingleTransientRetry(op, 1, budget);
    const attemptTimeoutMs = op.mock.calls[0][0] as number;
    expect(attemptTimeoutMs).toBeLessThanOrEqual(budget.perAttemptMs);
    expect(attemptTimeoutMs).toBeGreaterThan(0);
  });

  it("(e) per-attempt timeout on the SECOND attempt is capped by the REMAINING total budget, not just perAttemptMs, once that remainder is the tighter bound", async () => {
    const { advance } = installFakeClock();
    const budget: SubmitRetryBudget = { totalMs: 50_000, perAttemptMs: 25_000 };
    const transient = transientError("mid failure");
    const op = vi.fn()
      .mockImplementationOnce(async () => {
        advance(30_000); // consume 30s of the 50s total — 20s left, under perAttemptMs (25s)
        throw transient;
      })
      .mockResolvedValueOnce("ok");

    await withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, budget);
    const secondAttemptTimeoutMs = op.mock.calls[1][0] as number;
    // Date.now() is fully mocked here (only `advance()` moves it), so the real
    // inter-attempt `setTimeout` wait doesn't itself move the clock — isolating
    // this assertion to the budget-remaining computation, distinct from test
    // (d)'s perAttemptMs-ceiling case: here the REMAINING budget (20000) is the
    // tighter bound, not perAttemptMs (25000).
    expect(secondAttemptTimeoutMs).toBe(20_000);
    expect(secondAttemptTimeoutMs).toBeLessThan(budget.perAttemptMs);
  });

  it("existing 7-test contract preserved: omitting budget entirely still retries once regardless of elapsed time (unbounded default)", async () => {
    const { advance } = installFakeClock();
    const transient = transientError("no-budget-arg failure");
    const op = vi.fn()
      .mockImplementationOnce(async () => {
        advance(10_000_000); // absurdly large — must not matter without a budget arg
        throw transient;
      })
      .mockResolvedValueOnce("ok-default-budget");

    const result = await withSingleTransientRetry(op, 1); // no 3rd arg — matches pre-fix call shape
    expect(result).toBe("ok-default-budget");
    expect(op).toHaveBeenCalledTimes(2);
  });
});

// final-verify-2026-10-21 LOW #2 ("timeout: 0 footgun", §4): `attemptTimeoutMs()`
// computes `Math.min(perAttemptMs, Math.max(0, deadline - Date.now()))`, which
// the `Math.max(0, …)` clamp can legitimately produce as exactly `0` when the
// budget is already exhausted at the instant an attempt is about to be
// dispatched. `op` (submitScrapeTask/submitSearchScrapeTask) passes that value
// straight through as axios's own `timeout` config, and axios treats
// `timeout: 0` as NO timeout (unlimited) — the exact INVERSE of "budget
// exhausted, fail fast now". Not reachable from any production call site today
// (per the final-verify report), but this fix makes it structurally
// impossible: `withSingleTransientRetry` now computes the attempt timeout
// through a guarded helper that throws a structured NovadaError BEFORE calling
// `op` at all whenever that value would be <= 0 — `op` can never observe a
// non-positive timeout.
describe("withSingleTransientRetry — never pass a <=0 timeout to `op` (LOW #2 fix)", () => {
  it("FIRST-attempt call site: budget already exhausted (totalMs=0) → op is NEVER called, a structured API_DOWN error is thrown instead", async () => {
    const budget: SubmitRetryBudget = { totalMs: 0, perAttemptMs: Infinity };
    const op = vi.fn();

    const rejection = expect(withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, budget)).rejects;
    await rejection.toBeInstanceOf(NovadaError);
    await rejection.toMatchObject({ code: NovadaErrorCode.API_DOWN });
    expect(op).not.toHaveBeenCalled();
  });

  it("FIRST-attempt call site, mirror: an already-NEGATIVE totalMs (defensive edge — a hypothetical future caller passing an already-past deadline) → same outcome, op NEVER called", async () => {
    const budget: SubmitRetryBudget = { totalMs: -5_000, perAttemptMs: Infinity };
    const op = vi.fn();

    await expect(withSingleTransientRetry(op, SINGLE_TRANSIENT_RETRY_DELAY_MS, budget)).rejects.toMatchObject({
      code: NovadaErrorCode.API_DOWN,
    });
    expect(op).not.toHaveBeenCalled();
  });

  // The RETRY call site's guard is unreachable today through any REAL
  // `submitRetryBudget()` output, because `minRetryAttemptMs` is always >= 0
  // (default 0, or `TIMEOUTS.SEARCH_SUBMIT_TIMEOUT`) and the pre-retry gate
  // (`remainingAfterDelay <= minRetryAttemptMs`) already guarantees
  // `deadline - Date.now() > delayMs > 0` by the time a retry is dispatched —
  // so `attemptTimeoutMs()` there is always > 0 in practice. But the guard's
  // whole point is to not depend on that holding for every FUTURE caller: a
  // hand-built budget with a negative `minRetryAttemptMs` (defensive edge, not
  // something any current caller does) lets the gate wave a retry through even
  // though the deadline has already passed — exercising this second call site.
  it("RETRY call site: a hand-built budget with a negative minRetryAttemptMs lets the gate allow a retry past the deadline — the NEW guard still catches it, op is called exactly ONCE (never with the retry's <=0 timeout)", async () => {
    const { advance } = installFakeClock();
    const budget: SubmitRetryBudget = { totalMs: 10_000, perAttemptMs: Infinity, minRetryAttemptMs: -1_000 };
    const original = transientError("first attempt fails, pushing past the deadline");
    const op = vi.fn().mockImplementation(async () => {
      advance(10_500); // 500ms past the 10s deadline — remainingAfterDelay is negative but > -1000
      throw original;
    });

    // Mutation guard: WITHOUT the fix, this retry would go through unguarded —
    // `op` gets called a SECOND time with timeout 0 (passed straight to axios
    // as "no timeout"), advances the clock again, and rethrows the SAME
    // `original` object — so a mutated build would show `op` called TWICE and
    // the rejection being `original` itself. Pin both the call count AND that
    // the rejection is the NEW guard's own error, not a re-thrown `original`.
    await expect(withSingleTransientRetry(op, 1, budget)).rejects.toMatchObject({
      code: NovadaErrorCode.API_DOWN,
      message: expect.stringContaining("exhausted before this attempt could be dispatched"),
    });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("mirror of the FIRST-attempt tests: a NORMAL budget with time remaining still calls op with a POSITIVE timeout — the guard never fires when it shouldn't", async () => {
    const budget: SubmitRetryBudget = { totalMs: 10_000, perAttemptMs: Infinity };
    const op = vi.fn().mockResolvedValue("ok");

    const result = await withSingleTransientRetry(op, 1, budget);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    const attemptTimeoutMs = op.mock.calls[0][0] as number;
    expect(attemptTimeoutMs).toBeGreaterThan(0);
  });
});
