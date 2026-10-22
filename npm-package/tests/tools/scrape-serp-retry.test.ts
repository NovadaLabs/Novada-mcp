/**
 * scrape-transient-2026-10-21: novada_scrape (and every novada_scrape_<platform>
 * tool, all of which funnel through this SAME `submitScrapeTask`/`novadaScrape`
 * path — platform_scraper.ts's factory calls `novadaScrape` directly) threw a
 * transient `API_DOWN` (upstream code 10000 "serp capture failed", or a 500 /
 * missing-task_id submit response) on the FIRST hit, with no retry — unlike
 * novada_search, which already absorbs exactly this failure shape via
 * `withSingleSerpRetry` (FIX B, 2026-07-30). Live evidence (claude-directory
 * exam, 2026-10-21): 2/5 and separately 10/20 fresh `novada_scrape_google
 * web_search` calls against the hosted endpoint hit code 10000, every failure
 * self-healing on an immediate manual retry with the identical query.
 *
 * This fix reuses the SAME shared policy (`withSingleTransientRetry`,
 * `_core/submit-retry.ts`) at `novadaScrape`'s submit call site — one retry policy,
 * one home, both consumers (search.ts, scrape.ts) import it. See that
 * module's doc comment for the billing-safety scope rule (submit-phase only,
 * never the poll/download call).
 *
 * NOTE a real divergence from search.ts: submitScrapeTask's "no task_id, no
 * inline json, not an explicit empty-serp" fallback is treated as a GRACEFUL
 * empty result (`{kind:"empty"}`), not a thrown error — unlike
 * submitSearchScrapeTask, which explicitly throws API_DOWN for that exact
 * shape. So there is no "self-heals on missing task_id" scenario to test
 * here; the two reproducible throwing failure modes for novada_scrape are
 * code 500 and code 10000 ("serp capture failed" — the one confirmed live in
 * VERIFY.md / the 2026-10-21 hosted measurements).
 *
 * Two layers of coverage, mirroring search-serp-retry.test.ts:
 *  1. A reference-identity check that `withSingleSerpRetry` (search.ts) and
 *     the new `scrape.ts` call site resolve to the exact same function, so
 *     they can never drift into two separate policies.
 *  2. Integration-level tests through `novadaScrape` (axios-mocked) proving
 *     the exact reported failure modes (code 10000, code 500) self-heal,
 *     that permanent/account-level errors are NOT retried (exactly one
 *     submit call), that two consecutive transient failures propagate after
 *     exactly two attempts (bound test — never a third attempt), and that a
 *     successful retry results in exactly one billable task (the SECOND
 *     submit's task_id) reaching the poll/download phase — never two.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { withSingleTransientRetry } from "../../src/_core/submit-retry.js";
import { withSingleSerpRetry } from "../../src/tools/search.js";
import { NovadaError, NovadaErrorCode } from "../../src/_core/errors.js";
import { HOSTED_SAFE_CEILING_MS } from "../../src/config.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { novadaScrape, pollForResult } = await import("../../src/tools/scrape.js");

// IMPORTANT: use resetAllMocks (not clearAllMocks) — resetAllMocks also drains
// any leftover `mockResolvedValueOnce` queue from a prior test. clearAllMocks
// only resets call history, NOT queued one-shot implementations, so a test
// that (by bug or by a failed earlier assertion) doesn't consume every queued
// value it set up would leak a stale response into the NEXT test's first
// call — exactly the kind of cross-test contamination this suite must not
// have, since every test here depends on precise submit-call-count behavior.
beforeEach(() => {
  vi.resetAllMocks();
});

function axiosOk(data: unknown) {
  return { data, status: 200, headers: {}, config: {} as never, statusText: "OK" };
}

// NOTE: submitScrapeTask (scrape.ts) classifies on the TOP-LEVEL envelope
// `code` (`body.code`), unlike submitSearchScrapeTask's nested-vs-flat
// confusion risk — 500 / 11006 / 11008 / 10000 / classifyBusinessCode(11004,
// ...) are all checked against `body.code`, never `body.data.code`. A mock
// that nests the business code one level down (as `data.code`) silently
// falls through to the unrelated "graceful empty result" path instead of
// throwing — caught the hard way while writing this file (see commit
// message / report for the live debug trace).
const SUBMIT_OK = (taskId: string) =>
  axiosOk({ code: 0, data: { code: 200, data: { task_id: taskId }, msg: "success" }, msg: "success" });
const SUBMIT_CODE_10000 = axiosOk({ code: 10000, data: null, msg: "serp capture failed" });
const SUBMIT_CODE_500 = axiosOk({ code: 500, data: null, msg: "internal error" });
const SUBMIT_INVALID_PLATFORM = axiosOk({ code: 11008, data: null, msg: "unknown platform" });
const SUBMIT_INSUFFICIENT_BALANCE = axiosOk({ code: 11004, data: null, msg: "Insufficient balance" });

function downloadOk(records: unknown[]) {
  return axiosOk([{ spider_code: 200, rest: { organic_results: records } }]);
}

// ─── Layer 0: one shared function, not a parallel copy ─────────────────────

describe("withSingleSerpRetry / withSingleTransientRetry — single shared policy", () => {
  it("search.ts's withSingleSerpRetry IS _core/submit-retry.ts's withSingleTransientRetry (same reference, not a re-implementation)", () => {
    expect(withSingleSerpRetry).toBe(withSingleTransientRetry);
  });
});

// ─── Layer 1: novadaScrape absorbs the exact reported failure modes ────────

describe("novadaScrape — single retry on transient upstream submit failure", () => {
  it("self-heals when the first submit hits code 10000 ('serp capture failed')", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(SUBMIT_CODE_10000)
      .mockResolvedValueOnce(SUBMIT_OK("task-retry-ok"));
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "Recovered", url: "https://example.com/recovered" }]));

    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "dify plugin marketplace" }, format: "markdown", limit: 10 },
      "test-key",
    );

    expect(result).toContain("Recovered");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    // Billing guard: only ONE task ever reaches the poll/download phase (the
    // retry's task_id) — the first (failed, no task_id created) submit never
    // produced a task to poll, so the download endpoint is hit for the
    // SECOND submit's work only, not called twice for two different tasks.
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get.mock.calls[0][0]).toContain("task-retry-ok");
  });

  it("self-heals when the first submit hits a bare code 500", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(SUBMIT_CODE_500)
      .mockResolvedValueOnce(SUBMIT_OK("task-500-retry"));
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "Recovered500" }]));

    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "dify plugin marketplace" }, format: "markdown", limit: 10 },
      "test-key",
    );

    expect(result).toContain("Recovered500");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry — fails immediately — on INVALID_PARAMS (code 11008, unknown platform)", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_INVALID_PLATFORM);

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "zzz-not-a-real-platform.com", operation: "foo", params: {}, format: "markdown", limit: 10 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.INVALID_PARAMS);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry — fails immediately — on INSUFFICIENT_BALANCE (permanent, no-retry, top-up instruction)", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_INSUFFICIENT_BALANCE);

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "google.com", operation: "google_search", params: { q: "test" }, format: "markdown", limit: 10 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.INSUFFICIENT_BALANCE);
    expect((thrown as NovadaError).retryable).toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("bound: two consecutive transient (code 10000) failures propagate after EXACTLY two submit attempts, never a third", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_CODE_10000);

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "google.com", operation: "google_search", params: { q: "dify plugin marketplace" }, format: "markdown", limit: 10 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.API_DOWN);
    expect((thrown as NovadaError).retryable).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("applies identically to a different novada_scrape_<platform> tool sharing the same path (bing.com)", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(SUBMIT_CODE_10000)
      .mockResolvedValueOnce(SUBMIT_OK("task-bing-retry"));
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "RecoveredBing" }]));

    const result = await novadaScrape(
      { platform: "bing.com", operation: "bing_search", params: { q: "dify plugin marketplace" }, format: "markdown", limit: 10 },
      "test-key",
    );

    expect(result).toContain("RecoveredBing");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});

// ─── scrape-transient-2026-10-21 follow-up (MEDIUM): hosted-aware submit timeout ──
//
// Pins that submitScrapeTask's axios.post call actually RECEIVES the budget-capped
// timeout computed by withSingleTransientRetry/submitRetryBudget — not just that the
// retry/no-retry DECISION is correct (covered above and in
// tests/_core/submit-retry-budget.test.ts). Closes reports/scrape-transient-review-
// 2026-10-21.md's MEDIUM finding: on hosted, each attempt's own axios timeout must
// never be the flat 60s that made the pre-fix worst case (~120.5s for two attempts)
// exceed HOSTED_SAFE_CEILING_MS / HOSTED_FUNCTION_LIMIT_MS.
//
// review2-2026-10-21 MEDIUM #1 update: round 1 shipped a flat 25s per-attempt
// cap for ALL platforms, verified against latency evidence for only ~5 of 15+
// catalog platforms — a platform whose genuine submit takes 25-50s would have
// been newly cut off (raw axios ECONNABORTED, never retried by this module).
// Fixed: hosted's FIRST attempt (and any retry) may now use the WHOLE
// remaining HOSTED_SAFE_CEILING_MS budget — these tests now assert "close to
// 50s, not the old 25s" instead of "exactly 25s".
describe("novadaScrape submit — hosted-aware per-attempt axios timeout (MEDIUM fix, round 2: unbounded first attempt)", () => {
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
    for (const k of RUNTIME_KEYS) {
      const v = savedRuntimeEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("on hosted (VERCEL set): axios.post's config.timeout is close to HOSTED_SAFE_CEILING_MS (50s) — NOT cut at the old 25s cap", async () => {
    process.env.VERCEL = "1";
    mockedAxios.post.mockResolvedValueOnce(SUBMIT_OK("task-hosted-timeout"));
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "HostedOk" }]));

    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "hosted timeout check" }, format: "markdown", limit: 10 },
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const config = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    // Mutation guard (reintroduce the fixed 25s cap): this must be > 25_000 —
    // a 40-50s-taking platform submit would have been aborted under the old cap.
    expect(config.timeout).toBeGreaterThan(25_000);
    expect(config.timeout).toBeGreaterThan(40_000);
    expect(config.timeout).toBeLessThanOrEqual(HOSTED_SAFE_CEILING_MS); // never exceeds the whole-call ceiling
  });

  it("on hosted, the RETRY attempt's axios.post timeout is ALSO close to the full remaining budget (not the old 25s cap) after a fast first failure", async () => {
    process.env.VERCEL = "1";
    mockedAxios.post
      .mockResolvedValueOnce(SUBMIT_CODE_10000)
      .mockResolvedValueOnce(SUBMIT_OK("task-hosted-retry-timeout"));
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "HostedRetryOk" }]));

    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "hosted retry timeout check" }, format: "markdown", limit: 10 },
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    const firstConfig = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    const secondConfig = mockedAxios.post.mock.calls[1][2] as { timeout: number };
    // Mutation guard: both must exceed the old 25s flat cap.
    expect(firstConfig.timeout).toBeGreaterThan(25_000);
    expect(secondConfig.timeout).toBeGreaterThan(25_000);
    expect(firstConfig.timeout).toBeLessThanOrEqual(HOSTED_SAFE_CEILING_MS);
    expect(secondConfig.timeout).toBeLessThanOrEqual(HOSTED_SAFE_CEILING_MS);
    expect(secondConfig.timeout).toBeGreaterThan(0);
  });

  it("retry is SKIPPED end-to-end through novadaScrape when a slow first submit failure leaves no room for minRetryAttemptMs — exactly ONE submit call, structured API_DOWN error (never an uncaught throw or platform 504)", async () => {
    process.env.VERCEL = "1";
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mockedAxios.post.mockImplementationOnce(async () => {
      now += 30_000; // consumes 30s of the shared 50s deadline — 20s left, under the 25s minRetryAttemptMs
      return SUBMIT_CODE_10000;
    });

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "google.com", operation: "google_search", params: { q: "hosted exhausted budget check" }, format: "markdown", limit: 10 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    } finally {
      dateSpy.mockRestore();
    }

    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.API_DOWN);
    expect((thrown as NovadaError).agent_instruction).toBeTruthy();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // the retry was SKIPPED — budget exhausted
  });

  it("local (no serverless markers): axios.post's config.timeout stays the original flat 60s, unchanged by this fix", async () => {
    mockedAxios.post.mockResolvedValueOnce(SUBMIT_OK("task-local-timeout"));
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "LocalOk" }]));

    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "local timeout check" }, format: "markdown", limit: 10 },
      "test-key",
    );

    const config = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    expect(config.timeout).toBe(60_000);
  });

});

// ─── scrape-transient-review2-2026-10-21 follow-up (MEDIUM #2): one shared ──
// deadline for submit + poll, never additive ─────────────────────────────────
//
// Round 1 bounded the SUBMIT phase alone (HOSTED_SAFE_CEILING_MS). The poll
// phase then got its OWN independent syncPollCeilingMs() allotment on top,
// worst case additive up to ~HOSTED_FUNCTION_LIMIT_MS (the platform kill) —
// the exact bare-504 class the original fix exists to prevent, just requiring
// a narrower combination of conditions (review2's own MEDIUM #2 finding).
//
// Fix: novadaScrape computes ONE `callDeadline` once at tool entry; the poll
// ceiling is `min(syncPollCeilingMs(), remaining-of-callDeadline)`. This is a
// Math.min() — fully characterized by a mirror pair: (A) remaining is the
// binding term (poll gets cut to near-zero), (B) local never binds (own
// ceiling always wins, byte-identical to pre-fix).
describe("novadaScrape poll — shared deadline with submit (M2 additive-budget fix)", () => {
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
    for (const k of RUNTIME_KEYS) {
      const v = savedRuntimeEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("(A) hosted: when submit consumes the ENTIRE shared deadline, poll is skipped (0 axios.get calls) and a clean 'processing' envelope is returned — never an uncaught throw or platform 504", async () => {
    process.env.VERCEL = "1";
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mockedAxios.post.mockImplementationOnce(async () => {
      now += HOSTED_SAFE_CEILING_MS; // submit alone consumes the WHOLE 50s shared deadline
      return SUBMIT_OK("task-budget-exhausted-before-poll");
    });

    let result: string;
    try {
      result = await novadaScrape(
        { platform: "google.com", operation: "google_search", params: { q: "poll gets zero budget" }, format: "markdown", limit: 10 },
        "test-key",
      );
    } finally {
      dateSpy.mockRestore();
    }

    // Mutation guard (revert the min(ownCeiling, remaining) intersection back to
    // an unconditional syncPollCeilingMs()): that would call axios.get at least
    // once here, failing this assertion.
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result).toContain("status: processing");
    expect(result).toContain("task-budget-exhausted-before-poll");
  });

  it("(B) mirror of (A): local (no serverless markers) — even after the SAME simulated 50s-consuming submit, poll still runs with its FULL unchanged ceiling (local ignores the shared deadline entirely)", async () => {
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mockedAxios.post.mockImplementationOnce(async () => {
      now += HOSTED_SAFE_CEILING_MS; // would have exhausted a HOSTED budget — must not matter locally
      return SUBMIT_OK("task-local-unaffected");
    });
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "LocalPollOk" }]));

    let result: string;
    try {
      result = await novadaScrape(
        { platform: "google.com", operation: "google_search", params: { q: "local poll unaffected" }, format: "markdown", limit: 10 },
        "test-key",
      );
    } finally {
      dateSpy.mockRestore();
    }

    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // poll DID run — local is never budget-starved
    expect(result).toContain("LocalPollOk");
  });
});

// ─── final-verify-2026-10-21 LOW #1: pin pollForResult's own `timeoutMs <= 0`
// guard directly ──────────────────────────────────────────────────────────────
//
// Unlike pollSearchResult (search.ts, see search-serp-retry.test.ts's mirror
// block), pollForResult's `timeoutMs <= 0` guard and its while-loop's own
// natural fallthrough return the IDENTICAL value ({kind:"pending", taskId}) —
// there is no message to discriminate on. The loop's own
// `while (Date.now() < deadline)` check is mathematically guaranteed to be
// false on its very first evaluation whenever `timeoutMs <= 0` (deadline =
// Date.now() + timeoutMs <= Date.now() at that instant, and Date.now() only
// ever increases), so the RETURNED VALUE and the axios.get CALL COUNT are
// byte-identical whether the guard exists or not (confirmed by
// final-verify-2026-10-21.md §3's own mutation: "all 13 tests in
// scrape-serp-retry.test.ts still passed" with the guard removed). The one
// thing that DOES differ when the guard is removed is that the function goes
// on to build the download URL and call Date.now() (at least twice: once for
// `deadline`, once for the loop condition) before returning — work the guard
// exists specifically to skip. Pin THAT as the discriminator.
describe("pollForResult — timeoutMs<=0 guard is itself load-bearing (skips all downstream work, not just network calls)", () => {
  it("timeoutMs === 0: returns the SAME pending outcome, but short-circuits BEFORE any Date.now() call — mutation guard: removing the guard makes Date.now() get called (deadline computation + loop condition), failing this assertion", async () => {
    const dateSpy = vi.spyOn(Date, "now");
    try {
      const result = await pollForResult("test-key", "task-zero-timeout", 0);
      expect(result).toEqual({ kind: "pending", taskId: "task-zero-timeout" });
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(dateSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("timeoutMs negative: same guard fires (not just the ===0 boundary), same zero-Date.now()-calls short-circuit", async () => {
    const dateSpy = vi.spyOn(Date, "now");
    try {
      const result = await pollForResult("test-key", "task-negative-timeout", -5_000);
      expect(result).toEqual({ kind: "pending", taskId: "task-negative-timeout" });
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(dateSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("mirror: timeoutMs > 0 DOES call Date.now() (builds the URL, enters the loop) — proving the guard is what skips that work, not some unrelated reason", async () => {
    mockedAxios.get.mockResolvedValue(downloadOk([{ title: "Polled" }]));
    const dateSpy = vi.spyOn(Date, "now");
    try {
      const result = await pollForResult("test-key", "task-positive-timeout", 5_000);
      expect(result).toEqual({
        kind: "done",
        items: [{ spider_code: 200, rest: { organic_results: [{ title: "Polled" }] } }],
      });
      expect(dateSpy).toHaveBeenCalled();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    } finally {
      dateSpy.mockRestore();
    }
  });
});
