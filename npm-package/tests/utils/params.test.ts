import { describe, it, expect } from "vitest";
import { cleanParams } from "../../src/utils/params.js";

describe("cleanParams", () => {
  it("removes null values", () => {
    expect(cleanParams({ a: "keep", b: null })).toEqual({ a: "keep" });
  });

  it("removes undefined values", () => {
    expect(cleanParams({ a: "keep", b: undefined })).toEqual({ a: "keep" });
  });

  it("removes empty strings", () => {
    expect(cleanParams({ a: "keep", b: "", c: "  " })).toEqual({ a: "keep" });
  });

  it("removes empty arrays", () => {
    expect(cleanParams({ a: "keep", b: [] })).toEqual({ a: "keep" });
  });

  it("removes empty objects", () => {
    expect(cleanParams({ a: "keep", b: {} })).toEqual({ a: "keep" });
  });

  it("preserves non-empty values", () => {
    const input = { a: "hello", b: 42, c: true, d: [1, 2], e: { x: 1 } };
    expect(cleanParams(input)).toEqual(input);
  });

  it("preserves zero and false", () => {
    expect(cleanParams({ a: 0, b: false })).toEqual({ a: 0, b: false });
  });

  it("returns empty object for all-empty input", () => {
    expect(cleanParams({ a: null, b: "", c: [] })).toEqual({});
  });
});
