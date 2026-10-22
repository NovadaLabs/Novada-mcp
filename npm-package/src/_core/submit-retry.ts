import { NovadaError, NovadaErrorCode, makeNovadaError } from "./errors.js";
import { isHostedEnvironment, HOSTED_SAFE_CEILING_MS, TIMEOUTS } from "../config.js";

/**
 * Single home for the "absorb one transient upstream submit failure" retry
 * policy, shared by every tool that submits a task to the Scraper API's
 * `/request` endpoint — novada_search (submitSearchScrapeTask, search.ts) and
 * novada_scrape + every novada_scrape_<platform> tool (submitScrapeTask,
 * scrape.ts, via the single shared `platform_scraper.ts` factory). Both hit
 * the SAME upstream endpoint and the SAME known-transient failure shapes
 * (upstream 5xx, business code 10000 "serp capture failed" / "result data
 * not exist", or a success envelope with no task_id and no inline results) —
 * one error CLASS, one retry policy, one home. Class-not-instance: fixing
 * this in only one of the two submit paths (the original bug — novada_search
 * got the retry in FIX B 2026-07-30, novada_scrape did not) left every
 * platform scraper tool exposed to the identical upstream blip. See
 * feedback_routing_key_is_not_a_ranking_key.md / class-not-instance memory
 * note: a fix that only covers one member of a class is the recurring root
 * cause, not an exception to avoid repeating.
 *
 * Originally added as `withSingleSerpRetry` in search.ts (FIX B, 2026-07-30);
 * that name is kept as a re-export there for backward compatibility with
 * existing imports/tests. This module is the canonical implementation.
 *
 * Scope discipline (billing safety): wrap ONLY the SUBMIT call, never the
 * poll/download call. A submit that fails before a task_id is known has not
 * created or billed a task yet ("Nothing was created or charged yet — this
 * is safe to retry immediately", per scrape.ts's own classifyScraperTimeoutOrNetworkError
 * comment) — retrying it cannot double-charge. A POLL-phase failure means a
 * task already exists and was already billed; retrying there must RESUME by
 * task_id (the existing `task_id` resume path), never re-submit, and must
 * never go through this helper.
 *
 * scrape-transient-2026-10-21 follow-up round 1 (MEDIUM, see
 * reports/scrape-transient-review-2026-10-21.md): the retry used to be
 * time-unaware. `submitScrapeTask`/`submitSearchScrapeTask` each used a flat
 * 60s axios timeout regardless of `isHostedEnvironment()`, so a worst case of
 * two ~60s attempts (~120.5s with the retry delay) could exceed both
 * `HOSTED_SAFE_CEILING_MS` (50s) and `HOSTED_FUNCTION_LIMIT_MS` (60s,
 * config.ts) — turning a transient upstream blip into a platform 504 instead
 * of the structured `NovadaError` this module exists to surface. Fixed by
 * making the retry BUDGET-aware (see `SubmitRetryBudget`/`submitRetryBudget`
 * below): hosted gets a total wall-clock budget derived from the SAME
 * `HOSTED_SAFE_CEILING_MS` every other tool ceiling uses, a per-attempt cap
 * from the (previously dead) `TIMEOUTS.SEARCH_SUBMIT_TIMEOUT`, and skips the
 * retry entirely — rethrowing the original transient error immediately —
 * once the budget can no longer fit a meaningful second attempt. Local
 * (stdio, no serverless kill) keeps the ORIGINAL unlimited-total /
 * 60s-per-attempt behavior, now centralized as `TIMEOUTS.SUBMIT_TIMEOUT_LOCAL`
 * instead of a hardcoded literal at each call site.
 *
 * round 2 (MEDIUM x2, reports/scrape-transient-review2-2026-10-21.md):
 *
 * M1 — the flat `TIMEOUTS.SEARCH_SUBMIT_TIMEOUT` (25s) per-attempt cap from
 * round 1 was derived from hard latency evidence on only ~5 of 15+ catalog
 * platforms; the other ~9 have none, and the yandex precedent (20.3s observed
 * on a confirmed-slow upstream path) proves this backend CAN hold a
 * connection open close to that cap. A platform whose genuine submit takes
 * 25–50s would have been newly cut off and classified a bare axios
 * `ECONNABORTED` — NOT retried (this module only retries a `NovadaError`,
 * never a raw `AxiosError`) — turning the round-1 fix into a regression for
 * any such platform. Fix: on hosted, attempt 1 (and any retry) may use the
 * WHOLE remaining total budget — `perAttemptMs: Infinity` in
 * `submitRetryBudget()` below — as close to the pre-fix flat-60s behavior as
 * `HOSTED_SAFE_CEILING_MS` allows. The retry DECISION (not the attempt
 * timeout) is instead gated on `minRetryAttemptMs`: reusing
 * `TIMEOUTS.SEARCH_SUBMIT_TIMEOUT` for this new purpose rather than inventing
 * a magic number (see that constant's own doc comment in config.ts for the
 * justification) — only retry when enough budget remains for an attempt we
 * already trust to very likely succeed within that margin.
 *
 * M2 — `submitRetryBudget().totalMs` used to bound the submit phase ALONE;
 * the poll phase then got its OWN independent ceiling with zero deduction for
 * time already spent on submit, additive up to ~`HOSTED_FUNCTION_LIMIT_MS`
 * (the platform kill). Fix: `submitRetryBudget` now optionally takes an
 * absolute `deadline` (see `config.ts`'s `toolCallDeadline()`, established
 * ONCE at tool entry in `novadaScrape`/`novadaSearch`) and derives `totalMs`
 * from whatever of it remains — the SAME deadline the poll phase then clamps
 * its own ceiling against (`min(ownCeiling, remaining)`). One deadline, two
 * phases, never additive. See `toolCallDeadline()`'s doc comment for the full
 * invariant.
 */
export const SINGLE_TRANSIENT_RETRY_DELAY_MS = 500;

/**
 * Wall-clock budget for one `withSingleTransientRetry` call: `totalMs` bounds
 * attempt 1 + the inter-attempt delay + attempt 2 COMBINED, from the moment
 * the call starts; `perAttemptMs` bounds any SINGLE attempt even when more of
 * `totalMs` remains (so attempt 1 can't eat the whole budget and still leave
 * a nominally-nonzero sliver for attempt 2) — `Infinity` means no cap beyond
 * whatever of `totalMs` remains (hosted's new M1 behavior: attempt 1 may use
 * the full budget).
 *
 * `minRetryAttemptMs` (review2 M1, optional — defaults to 0, i.e. "retry
 * whenever ANY time remains", the pre-M1 behavior): the retry is only
 * attempted when the budget remaining AFTER the inter-attempt delay is at
 * least this much; below it, the ORIGINAL transient error is rethrown
 * immediately instead of racing a second attempt that has too little time to
 * plausibly succeed.
 */
export interface SubmitRetryBudget {
  totalMs: number;
  perAttemptMs: number;
  minRetryAttemptMs?: number;
}

/**
 * The submit-retry budget for THIS runtime: hosted (Vercel/Lambda) gets a
 * budget tied to the SAME `HOSTED_SAFE_CEILING_MS` ceiling every other
 * hosted-aware tool timeout in config.ts respects, so the submit phase
 * (including its one retry) can never by itself blow past the point the
 * platform kills the function. Local (stdio) has no such kill, so the total
 * is unbounded and the per-attempt cap matches the ORIGINAL hardcoded value
 * both submit call sites used before this fix (`TIMEOUTS.SUBMIT_TIMEOUT_LOCAL`)
 * — local behavior is unchanged by this fix (both by round 1 AND by this
 * round 2 follow-up: `deadline` is simply ignored on the local branch).
 *
 * @param deadline Optional absolute `Date.now()`-style timestamp — the SAME
 * whole-tool-call deadline the poll phase will later clamp its own ceiling
 * against (`config.ts`'s `toolCallDeadline()`, established once at tool
 * entry). When provided (hosted only), `totalMs` is however much of it
 * remains right now, so the submit phase and the poll phase that follows
 * share ONE wall-clock budget instead of each getting a fresh
 * `HOSTED_SAFE_CEILING_MS` allotment (review2 MEDIUM #2 — additive budgets).
 * When omitted, hosted falls back to a fresh `HOSTED_SAFE_CEILING_MS`
 * allotment starting now — the round-1 behavior, still correct for any
 * caller that submits without a shared deadline (there are none today; kept
 * for back-compat with the existing direct unit tests of this function).
 *
 * review2 MEDIUM #1: hosted's `perAttemptMs` is now `Infinity` — attempt 1
 * (and any retry) may consume the WHOLE remaining `totalMs`, not a flat 25s —
 * so a legitimately slow submit on any of the ~9 catalog platforms with no
 * latency evidence (review2 §[MEDIUM] "class, not instance") is no longer cut
 * off before the retry logic even sees a result. `minRetryAttemptMs` reuses
 * `TIMEOUTS.SEARCH_SUBMIT_TIMEOUT` (see its own doc comment in config.ts) as
 * the floor the REMAINING budget must clear before a retry is attempted at
 * all — not a new magic number, the same value round 1 already calibrated as
 * "enough time for a submit we trust to very likely succeed."
 */
export function submitRetryBudget(deadline?: number): SubmitRetryBudget {
  if (!isHostedEnvironment()) {
    return { totalMs: Infinity, perAttemptMs: TIMEOUTS.SUBMIT_TIMEOUT_LOCAL };
  }
  const totalMs = deadline !== undefined ? Math.max(0, deadline - Date.now()) : HOSTED_SAFE_CEILING_MS;
  return { totalMs, perAttemptMs: Infinity, minRetryAttemptMs: TIMEOUTS.SEARCH_SUBMIT_TIMEOUT };
}

/** A budget with no effective limit — the default when a caller omits `budget`
 * (e.g. the direct unit tests of this function), preserving the pre-budget
 * behavior of always attempting the retry regardless of elapsed time. */
const UNBOUNDED_BUDGET: SubmitRetryBudget = { totalMs: Infinity, perAttemptMs: Infinity };

/**
 * Run `op` once; on a transient (`NovadaErrorCode.API_DOWN`) `NovadaError`,
 * wait `delayMs` and run it exactly one more time. Any other error (including
 * a non-NovadaError, or a second consecutive API_DOWN) propagates immediately
 * without a further retry — this absorbs exactly ONE blip, it is not a
 * generic retry loop.
 *
 * `op` receives the timeout (ms) it should use for THIS attempt's own request
 * — capped by both `budget.perAttemptMs` and whatever of `budget.totalMs`
 * remains, so a single attempt can never itself exceed the ceiling either.
 * Before firing the retry, if the budget remaining after `delayMs` would not
 * clear `budget.minRetryAttemptMs` (defaults to 0 — the round-1 behavior,
 * "retry whenever any time remains"), the ORIGINAL transient error (with its
 * own agent_instruction) is rethrown immediately instead — risking the retry
 * at that point would mean trading a clean, structured tool error for either
 * a bare platform 504 (if the second attempt itself gets cut mid-flight) or a
 * second attempt too rushed to plausibly succeed (review2 MEDIUM #1).
 *
 * Exported so the retry/no-retry decision can be unit-tested directly against
 * a mock `op`.
 */
export async function withSingleTransientRetry<T>(
  op: (attemptTimeoutMs: number) => Promise<T>,
  delayMs: number = SINGLE_TRANSIENT_RETRY_DELAY_MS,
  budget: SubmitRetryBudget = UNBOUNDED_BUDGET,
): Promise<T> {
  const deadline = Date.now() + budget.totalMs;
  const minRetryAttemptMs = budget.minRetryAttemptMs ?? 0;
  const attemptTimeoutMs = () => Math.min(budget.perAttemptMs, Math.max(0, deadline - Date.now()));

  // final-verify-2026-10-21 LOW #2 (§4, "timeout: 0 footgun"): `attemptTimeoutMs()`
  // can legitimately compute to exactly 0 (the `Math.max(0, …)` clamp) when the
  // budget is already exhausted at the instant an attempt is about to be
  // dispatched. `op` (submitScrapeTask/submitSearchScrapeTask) passes this value
  // straight through as axios's `timeout` config — and axios treats `timeout: 0`
  // as NO timeout (unlimited), the exact INVERSE of "budget exhausted, fail fast
  // now". Not reachable from any call site today (verified: neither novadaScrape
  // nor novadaSearch does async work between reading the deadline and calling
  // this function, and `minRetryAttemptMs` already keeps the retry attempt's
  // remaining budget well above 0) — but make it structurally impossible rather
  // than relying on every future caller preserving that invariant: never let a
  // <=0 timeout reach `op`/axios. Mirrors the poll phase's own `<=0` guards
  // (scrape.ts's pollForResult, search.ts's pollSearchResult) — same class of
  // defensive floor, same reasoning, now at the submit phase too.
  const requireAttemptBudget = (): number => {
    const ms = attemptTimeoutMs();
    if (ms <= 0) {
      throw makeNovadaError(
        NovadaErrorCode.API_DOWN,
        "Submit retry budget exhausted before this attempt could be dispatched.",
      );
    }
    return ms;
  };

  try {
    return await op(requireAttemptBudget());
  } catch (err) {
    if (err instanceof NovadaError && err.code === NovadaErrorCode.API_DOWN) {
      const remainingAfterDelay = deadline - Date.now() - delayMs;
      // `<=` (not `<`) is the SAME comparison round 1 used with its implicit
      // minRetryAttemptMs of 0 (`remainingAfterDelay <= 0`) — generalizing the
      // operator, not just the threshold, keeps every pre-existing caller that
      // omits minRetryAttemptMs byte-identical at the remainingAfterDelay===0
      // boundary.
      if (remainingAfterDelay <= minRetryAttemptMs) {
        // Not enough budget left for a meaningful second attempt — surface the
        // original error now rather than risk the hosted wall-clock kill.
        throw err;
      }
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      return op(requireAttemptBudget());
    }
    throw err;
  }
}
