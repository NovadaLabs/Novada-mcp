/**
 * NOV-682: boundQuery() — over-long search queries are truncated at a word
 * boundary instead of throwing. No network calls, pure function.
 */

import { describe, it, expect } from "vitest";
import { boundQuery } from "../src/tools/search.js";

const MAX = 500;

describe("boundQuery", () => {
  it("passes short queries through untouched", () => {
    const r = boundQuery("hello world");
    expect(r.query).toBe("hello world");
    expect(r.truncated).toBeNull();
  });

  it("passes a query of exactly 500 chars through untouched", () => {
    const q = "a".repeat(MAX);
    const r = boundQuery(q);
    expect(r.query).toBe(q);
    expect(r.truncated).toBeNull();
  });

  it("truncates an over-long query to within the cap", () => {
    const q = ("word ".repeat(200)).trim(); // 999 chars
    const r = boundQuery(q);
    expect(r.query.length).toBeLessThanOrEqual(MAX);
    expect(r.query.length).toBeGreaterThan(0);
    expect(r.truncated).toBe(`query_truncated:${q.length}→${r.query.length}`);
  });

  it("cuts at a word boundary — never mid-word", () => {
    const q = ("alpha beta gamma ".repeat(40)).trim(); // 679 chars
    const r = boundQuery(q);
    // Every token in the bounded query must be a complete word from the set
    for (const token of r.query.split(" ")) {
      expect(["alpha", "beta", "gamma"]).toContain(token);
    }
  });

  it("falls back to a hard cut when there is no usable word boundary", () => {
    const q = "x".repeat(900); // one giant token, no spaces
    const r = boundQuery(q);
    expect(r.query.length).toBe(MAX);
    expect(r.truncated).toBe(`query_truncated:900→${MAX}`);
  });

  it("hard-cuts rather than dropping more than half the budget", () => {
    // Single space very early — word-boundary cut would leave only 10 chars
    const q = "shortword " + "y".repeat(890);
    const r = boundQuery(q);
    expect(r.query.length).toBe(MAX);
  });

  it("truncates at exactly 501 chars (boundary fencepost)", () => {
    const q = "a".repeat(501);
    const r = boundQuery(q);
    expect(r.query.length).toBe(MAX);
    expect(r.truncated).toBe(`query_truncated:501→${MAX}`);
  });

  it("never splits a surrogate pair at the cut point", () => {
    // 249 'x' + emoji pairs: an emoji's high surrogate lands exactly at index 499
    const q = "x".repeat(499) + "😀".repeat(10);
    const r = boundQuery(q);
    // Last char must not be a lone high surrogate
    const last = r.query.charCodeAt(r.query.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(r.query.length).toBeLessThanOrEqual(MAX);
  });

  it("never returns trailing whitespace", () => {
    const q = ("pad ".repeat(130)).trim() + " "; // ends near boundary with space
    const r = boundQuery(q + "z".repeat(200));
    expect(r.query).toBe(r.query.trim());
  });
});
