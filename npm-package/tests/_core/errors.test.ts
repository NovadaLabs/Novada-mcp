/**
 * FIX-A (2026-07-30, agent-first extract error path): summarizeAggregateError maps a
 * bare Promise.any() AggregateError (default message: literal "All promises were
 * rejected" — zero actionable content) to a summary of its distinct underlying causes.
 * Pure in-process logic, zero network.
 */

import { describe, it, expect } from "vitest";
import { summarizeAggregateError } from "../../src/_core/errors.js";

describe("summarizeAggregateError", () => {
  it("lists distinct causes (3 causes) and never leaks the raw AggregateError message", () => {
    const agg = new AggregateError(
      [new Error("ECONNREFUSED 1.2.3.4:443"), new Error("ENOTFOUND example.com"), new Error("timeout of 3000ms exceeded")],
      "All promises were rejected"
    );
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.message).not.toContain("All promises were rejected");
    expect(result!.message).toContain("All 3 fetch strategies failed");
    expect(result!.causes).toHaveLength(3);
    expect(result!.message).toContain("ECONNREFUSED 1.2.3.4:443");
    expect(result!.message).toContain("ENOTFOUND example.com");
    expect(result!.message).toContain("timeout of 3000ms exceeded");
  });

  it("handles a single-cause aggregate", () => {
    const agg = new AggregateError([new Error("ECONNREFUSED 1.2.3.4:443")], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes).toEqual(["ECONNREFUSED 1.2.3.4:443"]);
    expect(result!.message).toBe("All 1 fetch strategies failed: ECONNREFUSED 1.2.3.4:443");
  });

  it("dedupes identical causes and caps at the first 3 distinct causes", () => {
    const agg = new AggregateError(
      [
        new Error("ECONNREFUSED"),
        new Error("ECONNREFUSED"), // duplicate — must be deduped
        new Error("cause-2"),
        new Error("cause-3"),
        new Error("cause-4"), // beyond the cap — must be dropped
      ],
      "All promises were rejected"
    );
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes).toEqual(["ECONNREFUSED", "cause-2", "cause-3"]);
    expect(result!.message).not.toContain("cause-4");
    // Total count in the message reflects the real error count, not the capped list.
    expect(result!.message).toContain("All 5 fetch strategies failed");
  });

  it("truncates an individual cause longer than ~120 chars", () => {
    const longMsg = "x".repeat(200);
    const agg = new AggregateError([new Error(longMsg)], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes[0].length).toBeLessThanOrEqual(120);
    expect(result!.causes[0].endsWith("…")).toBe(true);
  });

  it("collapses embedded newlines in a cause to a single line", () => {
    const agg = new AggregateError([new Error("line1\nline2\r\nline3")], "All promises were rejected");
    const result = summarizeAggregateError(agg);
    expect(result).not.toBeNull();
    expect(result!.causes[0]).not.toContain("\n");
    expect(result!.causes[0]).toContain("line1 line2 line3");
  });

  it("returns null for a plain (non-aggregate) Error", () => {
    expect(summarizeAggregateError(new Error("plain failure"))).toBeNull();
  });

  it("returns null for a non-Error value", () => {
    expect(summarizeAggregateError("just a string")).toBeNull();
    expect(summarizeAggregateError(null)).toBeNull();
    expect(summarizeAggregateError(undefined)).toBeNull();
    expect(summarizeAggregateError(42)).toBeNull();
  });

  it("degrades to null (never throws) for a duck-typed aggregate with an empty errors array", () => {
    const fakeAgg = { message: "All promises were rejected", errors: [] };
    expect(() => summarizeAggregateError(fakeAgg)).not.toThrow();
    expect(summarizeAggregateError(fakeAgg)).toBeNull();
  });

  it("degrades to null (never throws) when `errors` is present but not an array", () => {
    const malformed = { message: "All promises were rejected", errors: "not-an-array" };
    expect(() => summarizeAggregateError(malformed)).not.toThrow();
    expect(summarizeAggregateError(malformed)).toBeNull();
  });

  it("degrades to null (never throws) when reading a property throws (pathological getter)", () => {
    const hostile = {
      message: "All promises were rejected",
      get errors(): unknown[] {
        throw new Error("getter exploded");
      },
    };
    expect(() => summarizeAggregateError(hostile)).not.toThrow();
    expect(summarizeAggregateError(hostile)).toBeNull();
  });

  it("accepts a duck-typed cross-realm AggregateError-shaped object (not instanceof AggregateError)", () => {
    const duckTyped = { name: "AggregateError", message: "All promises were rejected", errors: [new Error("cross-realm cause")] };
    const result = summarizeAggregateError(duckTyped);
    expect(result).not.toBeNull();
    expect(result!.causes).toEqual(["cross-realm cause"]);
  });
});
