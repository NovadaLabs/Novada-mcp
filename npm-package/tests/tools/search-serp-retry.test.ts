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

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { withSingleSerpRetry, novadaSearch } from "../../src/tools/search.js";
import { NovadaError, NovadaErrorCode, makeNovadaError } from "../../src/_core/errors.js";

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
