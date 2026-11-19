/**
 * C1 (#39, 2026-11-18): unit tests for the shared engine-fallback race
 * primitive used by BOTH novada_search (search.ts) and novada_research
 * (research.ts) for the identical upstream SERP failure class.
 */
import { describe, it, expect } from "vitest";
import { raceEngineFallbacks, type FallbackAttempt } from "../../src/_core/search-fallback.js";

function attempt<T>(label: string, run: () => Promise<T[]>): FallbackAttempt<T> {
  return { label, run };
}

describe("raceEngineFallbacks", () => {
  it("returns [] with hadError:false and servedBy:null when given zero attempts", async () => {
    const outcome = await raceEngineFallbacks([]);
    expect(outcome).toEqual({ results: [], servedBy: null, hadError: false });
  });

  it("the first attempt to resolve with non-empty results wins, labeled by servedBy", async () => {
    const slow = attempt<string>("slow", () => new Promise(r => setTimeout(() => r(["slow-result"]), 30)));
    const fast = attempt<string>("fast", () => Promise.resolve(["fast-result"]));
    const outcome = await raceEngineFallbacks([slow, fast]);
    expect(outcome).toEqual({ results: ["fast-result"], servedBy: "fast", hadError: false });
  });

  it("an empty-but-not-thrown attempt loses the race to a slower non-empty attempt — never wins just by finishing first", async () => {
    const fastEmpty = attempt<string>("fast-empty", () => Promise.resolve([]));
    const slowReal = attempt<string>("slow-real", () => new Promise(r => setTimeout(() => r(["real"]), 20)));
    const outcome = await raceEngineFallbacks([fastEmpty, slowReal]);
    expect(outcome).toEqual({ results: ["real"], servedBy: "slow-real", hadError: false });
  });

  it("mirror — every attempt legitimately empty (no thrown error anywhere): hadError:false, NOT misreported as a failure", async () => {
    const a = attempt<string>("a", () => Promise.resolve([]));
    const b = attempt<string>("b", () => Promise.resolve([]));
    const outcome = await raceEngineFallbacks([a, b]);
    expect(outcome).toEqual({ results: [], servedBy: null, hadError: false });
  });

  it("every attempt genuinely throws: hadError:true — must NOT be reported as an honest empty result", async () => {
    const a = attempt<string>("a", () => Promise.reject(new Error("upstream 502")));
    const b = attempt<string>("b", () => Promise.reject(new Error("upstream timeout")));
    const outcome = await raceEngineFallbacks([a, b]);
    expect(outcome).toEqual({ results: [], servedBy: null, hadError: true });
  });

  it("mixed: one attempt throws, the other legitimately empties — hadError:true (at least one REAL failure, not a clean sweep of empties)", async () => {
    const thrown = attempt<string>("thrown", () => Promise.reject(new Error("upstream 503")));
    const empty = attempt<string>("empty", () => Promise.resolve([]));
    const outcome = await raceEngineFallbacks([thrown, empty]);
    expect(outcome).toEqual({ results: [], servedBy: null, hadError: true });
  });

  it("a later-resolving non-empty attempt still wins even when an earlier attempt already threw", async () => {
    const failsFast = attempt<string>("fails-fast", () => Promise.reject(new Error("boom")));
    const succeedsLater = attempt<string>("succeeds-later", () => new Promise(r => setTimeout(() => r(["recovered"]), 10)));
    const outcome = await raceEngineFallbacks([failsFast, succeedsLater]);
    expect(outcome).toEqual({ results: ["recovered"], servedBy: "succeeds-later", hadError: false });
  });
});
