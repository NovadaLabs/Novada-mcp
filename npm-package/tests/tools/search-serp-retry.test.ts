/**
 * FIX B (2026-07-30) — field feedback: novada_search threw one transient
 * `API_DOWN: ... upstream SERP failure` that self-healed on a manual retry.
 * The tool now absorbs exactly ONE retry itself before surfacing the error,
 * scoped strictly to the transient (API_DOWN) failure class — auth/validation/
 * quota errors are not retried.
 *
 * Two layers of coverage:
 *  1. Pure unit tests of `withSingleSerpRetry` against a mock `op` — fast,
 *     no network/axios mocking, proves the retry/no-retry decision logic.
 *  2. An integration-level test through `novadaSearch` (axios-mocked) proving
 *     the exact reported failure mode — submitSearchScrapeTask's "no task_id"
 *     branch — self-heals via the retry and a genuine non-retryable failure
 *     (SERP not activated / code 402) still makes only one submit call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { withSingleSerpRetry, novadaSearch, pollSearchResult } from "../../src/tools/search.js";
import { NovadaError, NovadaErrorCode, makeNovadaError } from "../../src/_core/errors.js";
import { HOSTED_SAFE_CEILING_MS } from "../../src/config.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-serp-retry";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Unit tests: withSingleSerpRetry ────────────────────────────────────────

describe("withSingleSerpRetry", () => {
  it("returns the result on first try without retrying when op succeeds", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const result = await withSingleSerpRetry(op, 1);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on a transient API_DOWN NovadaError, then succeeds", async () => {
    const transient = makeNovadaError(NovadaErrorCode.API_DOWN, "Search provider returned no task_id (upstream SERP failure).");
    const op = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce("ok-after-retry");

    const result = await withSingleSerpRetry(op, 1);
    expect(result).toBe("ok-after-retry");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient NovadaError (e.g. INVALID_PARAMS) — fails immediately", async () => {
    const permanent = makeNovadaError(NovadaErrorCode.INVALID_PARAMS, "bad query");
    const op = vi.fn().mockRejectedValue(permanent);

    await expect(withSingleSerpRetry(op, 1)).rejects.toBe(permanent);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("does not retry an auth NovadaError (INVALID_API_KEY) — fails immediately", async () => {
    const authErr = makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "bad key");
    const op = vi.fn().mockRejectedValue(authErr);

    await expect(withSingleSerpRetry(op, 1)).rejects.toBe(authErr);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("does not retry a plain (non-NovadaError) Error — fails immediately", async () => {
    const plain = new Error("generic scraper error, code 402");
    const op = vi.fn().mockRejectedValue(plain);

    await expect(withSingleSerpRetry(op, 1)).rejects.toBe(plain);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("does not retry a THIRD time — two consecutive transient failures propagate after exactly 2 attempts", async () => {
    const transient1 = makeNovadaError(NovadaErrorCode.API_DOWN, "first failure");
    const transient2 = makeNovadaError(NovadaErrorCode.API_DOWN, "second failure");
    const op = vi.fn()
      .mockRejectedValueOnce(transient1)
      .mockRejectedValueOnce(transient2);

    await expect(withSingleSerpRetry(op, 1)).rejects.toBe(transient2);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("propagates a NovadaError subtype check correctly (instanceof, not just code)", async () => {
    // Sanity: a plain object shaped like a NovadaError (duck-typed) must NOT be
    // treated as one — only genuine `instanceof NovadaError` triggers retry.
    const fakeError = { code: NovadaErrorCode.API_DOWN, message: "looks like it but isn't" };
    expect(fakeError instanceof NovadaError).toBe(false);
    const op = vi.fn().mockRejectedValue(fakeError);
    await expect(withSingleSerpRetry(op, 1)).rejects.toBe(fakeError);
    expect(op).toHaveBeenCalledTimes(1);
  });
});

// ─── Integration: novadaSearch absorbs the exact reported failure mode ─────

describe("novadaSearch — single retry on transient upstream SERP failure", () => {
  it("self-heals when the first submit hits the no-task_id upstream SERP failure", async () => {
    // 1st POST: code:0 but no task_id anywhere and no inline json → submitSearchScrapeTask
    // throws makeNovadaError(API_DOWN, "Search provider returned no task_id ...") — the
    // exact failure mode from the field report.
    mockedAxios.post
      .mockResolvedValueOnce({ data: { code: 0, data: { data: {} } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { task_id: "task-retry-ok" } } });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "Recovered", url: "https://example.com/recovered", description: "d" }] },
    });

    const result = await novadaSearch(
      { query: "retry-self-heal-unique", engine: "google", num: 10, country: "", language: "" },
      API_KEY,
    );

    expect(result).toContain("Recovered");
    expect(result).toContain("https://example.com/recovered");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("does not retry — and fails immediately — on a genuine entitlement error (code 402)", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 402, msg: "Api Key error: User has no permission" },
    });

    const result = await novadaSearch(
      { query: "no-retry-entitlement-unique", engine: "google", num: 10, country: "", language: "" },
      API_KEY,
    );

    expect(result).toContain("Search Unavailable");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("surfaces the error after two consecutive no-task_id failures (retry exhausted)", async () => {
    mockedAxios.post.mockResolvedValue({ data: { code: 0, data: { data: {} } } });

    await expect(
      novadaSearch({ query: "retry-exhausted-unique", engine: "google", num: 10, country: "", language: "" }, API_KEY),
    ).rejects.toMatchObject({ code: NovadaErrorCode.API_DOWN, retryable: true });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});

// ─── scrape-transient-2026-10-21 follow-up (MEDIUM): hosted-aware submit timeout ──
//
// Mirrors scrape-serp-retry.test.ts's equivalent block: pins that
// submitSearchScrapeTask's axios.post call actually RECEIVES the budget-capped
// timeout computed by withSingleSerpRetry/submitRetryBudget, not just that the
// retry/no-retry DECISION is correct. Closes reports/scrape-transient-review-
// 2026-10-21.md's MEDIUM finding for search.ts's submit path specifically (it
// has the identical flat-60s pattern as scrape.ts's).
describe("novadaSearch submit — hosted-aware per-attempt axios timeout (MEDIUM fix)", () => {
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

  // review2-2026-10-21 MEDIUM #1: round 1's flat 25s per-attempt cap applied to
  // EVERY engine/platform regardless of latency evidence. Fixed: hosted's first
  // attempt (and any retry) may now use the WHOLE remaining HOSTED_SAFE_CEILING_MS
  // budget — these assert "close to 50s", not "exactly 25s".
  it("on hosted (VERCEL set): axios.post's config.timeout is close to HOSTED_SAFE_CEILING_MS (50s) — NOT cut at the old 25s cap", async () => {
    process.env.VERCEL = "1";
    mockedAxios.post.mockResolvedValueOnce({ data: { code: 0, data: { task_id: "task-hosted-timeout" } } });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "HostedOk", url: "https://example.com/hosted", description: "d" }] },
    });

    await novadaSearch(
      { query: "hosted timeout check", engine: "google", num: 10, country: "", language: "" },
      API_KEY,
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const config = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    // Mutation guard (reintroduce the fixed 25s cap): must be > 25_000.
    expect(config.timeout).toBeGreaterThan(25_000);
    expect(config.timeout).toBeGreaterThan(40_000);
    expect(config.timeout).toBeLessThanOrEqual(HOSTED_SAFE_CEILING_MS);
  });

  it("on hosted, the RETRY attempt's axios.post timeout is ALSO close to the full remaining budget (not the old 25s cap) after a fast first failure", async () => {
    process.env.VERCEL = "1";
    mockedAxios.post
      .mockResolvedValueOnce({ data: { code: 0, data: { data: {} } } }) // no-task_id transient failure
      .mockResolvedValueOnce({ data: { code: 0, data: { task_id: "task-hosted-retry-timeout" } } });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "HostedRetryOk", url: "https://example.com/hosted-retry", description: "d" }] },
    });

    await novadaSearch(
      { query: "hosted retry timeout check", engine: "google", num: 10, country: "", language: "" },
      API_KEY,
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    const firstConfig = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    const secondConfig = mockedAxios.post.mock.calls[1][2] as { timeout: number };
    expect(firstConfig.timeout).toBeGreaterThan(25_000);
    expect(secondConfig.timeout).toBeGreaterThan(25_000);
    expect(firstConfig.timeout).toBeLessThanOrEqual(HOSTED_SAFE_CEILING_MS);
    expect(secondConfig.timeout).toBeLessThanOrEqual(HOSTED_SAFE_CEILING_MS);
    expect(secondConfig.timeout).toBeGreaterThan(0);
  });

  it("retry is SKIPPED end-to-end through novadaSearch when a slow first submit failure leaves no room for minRetryAttemptMs — exactly ONE submit call, structured API_DOWN error", async () => {
    process.env.VERCEL = "1";
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mockedAxios.post.mockImplementationOnce(async () => {
      now += 30_000; // consumes 30s of the shared 50s deadline — 20s left, under the 25s minRetryAttemptMs
      return { data: { code: 0, data: { data: {} } } }; // no-task_id transient failure
    });

    let thrown: unknown;
    try {
      await novadaSearch(
        { query: "hosted exhausted budget check", engine: "google", num: 10, country: "", language: "" },
        API_KEY,
      );
    } catch (e) {
      thrown = e;
    } finally {
      dateSpy.mockRestore();
    }

    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.API_DOWN);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // the retry was SKIPPED — budget exhausted
  });

  it("local (no serverless markers): axios.post's config.timeout stays the original flat 60s, unchanged by this fix", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { code: 0, data: { task_id: "task-local-timeout" } } });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "LocalOk", url: "https://example.com/local", description: "d" }] },
    });

    await novadaSearch(
      { query: "local timeout check", engine: "google", num: 10, country: "", language: "" },
      API_KEY,
    );

    const config = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    expect(config.timeout).toBe(60_000);
  });
});

// ─── scrape-transient-review2-2026-10-21 follow-up (MEDIUM #2): one shared ──
// deadline for submit + poll, never additive — mirrors scrape-serp-retry
// .test.ts's equivalent block for novadaSearch's own pollSearchResult call.
describe("novadaSearch poll — shared deadline with submit (M2 additive-budget fix)", () => {
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

  it("(A) hosted: when submit consumes the ENTIRE shared deadline, poll is skipped (0 axios.get calls) and a structured API_DOWN timeout error is thrown — never an uncaught throw or platform 504", async () => {
    process.env.VERCEL = "1";
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mockedAxios.post.mockImplementationOnce(async () => {
      now += HOSTED_SAFE_CEILING_MS; // submit alone consumes the WHOLE 50s shared deadline
      return { data: { code: 0, data: { task_id: "task-search-budget-exhausted" } } };
    });

    let thrown: unknown;
    try {
      await novadaSearch(
        { query: "search poll gets zero budget", engine: "google", num: 10, country: "", language: "" },
        API_KEY,
      );
    } catch (e) {
      thrown = e;
    } finally {
      dateSpy.mockRestore();
    }

    // Mutation guard (revert the min(ownCeiling, remaining) intersection back
    // to an unconditional TIMEOUTS.SEARCH_TOTAL_CEILING): that would call
    // axios.get at least once here, failing this assertion.
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).code).toBe(NovadaErrorCode.API_DOWN);
  });

  it("(B) mirror of (A): local (no serverless markers) — even after the SAME simulated 50s-consuming submit, poll still runs with its FULL unchanged ceiling (local ignores the shared deadline entirely)", async () => {
    let now = 1_700_000_000_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mockedAxios.post.mockImplementationOnce(async () => {
      now += HOSTED_SAFE_CEILING_MS; // would have exhausted a HOSTED budget — must not matter locally
      return { data: { code: 0, data: { task_id: "task-search-local-unaffected" } } };
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "LocalSearchPollOk", url: "https://example.com/local-poll", description: "d" }] },
    });

    let result: string;
    try {
      result = await novadaSearch(
        { query: "local search poll unaffected", engine: "google", num: 10, country: "", language: "" },
        API_KEY,
      );
    } finally {
      dateSpy.mockRestore();
    }

    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // poll DID run — local is never budget-starved
    expect(result).toContain("LocalSearchPollOk");
  });
});

// ─── final-verify-2026-10-21 LOW #1: pin pollSearchResult's own `ceilingMs <=
// 0` guard directly ──────────────────────────────────────────────────────────
//
// The integration-level test (A) above only asserts `code === API_DOWN`, which
// the while loop's own natural-timeout fallthrough (bottom of pollSearchResult,
// "... timed out after Xs") ALSO produces when ceilingMs<=0 — the loop's own
// `Date.now() < deadline` check is false from the first iteration whenever
// `deadline <= Date.now()`, so removing the explicit guard does not change (A)'s
// outcome at all (confirmed by final-verify-2026-10-21.md §3's own mutation:
// "all 16 tests in search-serp-retry.test.ts still passed" with the guard
// removed). The ONE thing that DOES differ is the error MESSAGE — the explicit
// guard says "ran out of time budget before polling could start", the natural
// fallthrough says "timed out after {ceilingMs/1000}s" — so pin THAT as the
// discriminator, calling pollSearchResult directly (not through novadaSearch)
// so no submit-phase noise is involved.
describe("pollSearchResult — ceilingMs<=0 guard is itself load-bearing (message-level discriminator)", () => {
  it("ceilingMs === 0: throws the GUARD's specific message, zero axios.get calls — mutation guard: removing the explicit guard changes this message to the loop's generic 'timed out after 0s' fallthrough, failing this assertion", async () => {
    await expect(pollSearchResult(API_KEY, "task-zero-ceiling", 0)).rejects.toMatchObject({
      code: NovadaErrorCode.API_DOWN,
      message: expect.stringContaining("ran out of time budget before polling could start"),
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("ceilingMs negative: same guard fires (not just the ===0 boundary), same specific message, zero axios.get calls", async () => {
    await expect(pollSearchResult(API_KEY, "task-negative-ceiling", -5_000)).rejects.toMatchObject({
      code: NovadaErrorCode.API_DOWN,
      message: expect.stringContaining("ran out of time budget before polling could start"),
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("mirror: ceilingMs > 0 with the download endpoint never returning a result exhausts the loop's OWN natural timeout — a DIFFERENT message, proving the two paths are genuinely distinct outcomes, not just two ways to phrase the same one", async () => {
    const dateSpy = vi.spyOn(Date, "now");
    let now = 1_700_000_000_000;
    dateSpy.mockImplementation(() => now);
    mockedAxios.get.mockImplementation(async () => {
      now += 50; // advance past the tiny ceiling after the first poll round-trip
      return { data: { code: 27202, data: null, msg: "" } }; // pending forever
    });

    try {
      await expect(pollSearchResult(API_KEY, "task-natural-timeout", 10)).rejects.toMatchObject({
        code: NovadaErrorCode.API_DOWN,
        message: expect.stringContaining("timed out after"),
      });
    } finally {
      dateSpy.mockRestore();
    }
    expect(mockedAxios.get).toHaveBeenCalled(); // the loop DID run here — unlike the ceilingMs<=0 cases above
  });
});
