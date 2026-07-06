/**
 * ReDoS-hardening tests for compilePatterns (NOV-570).
 *
 * compilePatterns must NEVER compile raw user input as a backtracking regex. Patterns are
 * treated as globs and compiled into linear-time matcher functions (`PathMatcher`): every
 * regex metacharacter is a literal, only `**`/`*`/`?` are expanded, and the match is
 * whole-string (anchored). There is no RegExp engine involved at all, so a crafted
 * "catastrophic" pattern can no longer freeze the single Node thread.
 *
 * NOTE: compilePatterns returns `PathMatcher[]` — functions `(path) => boolean` — NOT
 * `RegExp[]`. Call the matcher directly: `matcher("/some/path")`.
 *
 * No network calls — pure pattern compilation + matching.
 */

import { describe, it, expect } from "vitest";
import { compilePatterns, shouldCrawlUrl } from "../../src/tools/crawl.js";

describe("compilePatterns — ReDoS hardening (NOV-570)", () => {
  it("classic catastrophic pattern compiles + matches in <100ms and never throws", () => {
    // Classic evil regex `(a+)+$` plus a non-matching suffix is the textbook ReDoS trigger.
    // Compiled as a regex against "aaaa…!" it backtracks exponentially. As a glob it is inert.
    const evil = "(a+)+" + "$";
    const attackInput = "/" + "a".repeat(50) + "!";

    const start = Date.now();
    let compiled: Array<(path: string) => boolean> = [];
    expect(() => { compiled = compilePatterns([evil]); }).not.toThrow();
    // Exercise matching on the pathological input — must not hang.
    expect(() => compiled.forEach(match => match(attackInput))).not.toThrow();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it("another nested-quantifier ReDoS form stays fast and safe", () => {
    const evil = "([a-zA-Z]+)*" + "$";
    const attackInput = "/" + "x".repeat(60) + "@";

    const start = Date.now();
    const compiled = compilePatterns([evil]);
    compiled.forEach(match => match(attackInput));
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("treats patterns as globs, not regex — metacharacters are literal", () => {
    // `.` is a literal dot under glob rules, so it must NOT match an arbitrary char.
    const [match] = compilePatterns(["/file.txt"]);
    expect(match("/file.txt")).toBe(true);
    expect(match("/fileXtxt")).toBe(false); // '.' is literal, not "any char"
  });

  it("expands * within a segment and ** across segments", () => {
    const [single] = compilePatterns(["/docs/*"]);
    expect(single("/docs/intro")).toBe(true);
    expect(single("/docs/api/v1")).toBe(false); // '*' does not cross '/'

    const [deep] = compilePatterns(["/docs/**"]);
    expect(deep("/docs/intro")).toBe(true);
    expect(deep("/docs/api/v1")).toBe(true); // '**' crosses '/'
  });

  it("expands ? to a single non-separator char", () => {
    const [match] = compilePatterns(["/v?/users"]);
    expect(match("/v1/users")).toBe(true);
    expect(match("/v12/users")).toBe(false); // '?' is exactly one char
    expect(match("//users")).toBe(false); // '?' does not match '/'
  });

  it("anchors patterns (full-path match, no partial)", () => {
    const [match] = compilePatterns(["/api/**"]);
    expect(match("/api/users")).toBe(true);
    expect(match("/v2/api/users")).toBe(false); // not anchored at start would wrongly match
  });

  it("skips over-long patterns (>1000 chars) without throwing", () => {
    const tooLong = "/" + "a".repeat(1001);
    expect(compilePatterns([tooLong])).toEqual([]);
    // A valid short pattern alongside an over-long one still compiles.
    expect(compilePatterns([tooLong, "/ok"]).length).toBe(1);
  });

  it("honors at most 50 patterns", () => {
    const many = Array.from({ length: 75 }, (_, i) => `/p${i}/**`);
    expect(compilePatterns(many).length).toBe(50);
  });

  it("returns [] for empty / undefined input", () => {
    expect(compilePatterns(undefined)).toEqual([]);
    expect(compilePatterns([])).toEqual([]);
  });

  it("integrates with shouldCrawlUrl for include/exclude semantics", () => {
    const select = compilePatterns(["/docs/**"]);
    const exclude = compilePatterns(["/docs/internal/**"]);
    expect(shouldCrawlUrl("https://x.com/docs/intro", select, exclude)).toBe(true);
    expect(shouldCrawlUrl("https://x.com/docs/internal/secret", select, exclude)).toBe(false);
    expect(shouldCrawlUrl("https://x.com/blog/post", select, exclude)).toBe(false); // not in select
  });
});
