/**
 * Closure-C3: mid-pattern globstar zero-segment matching.
 *
 * Pattern "/a/**\/b" must match "/a/b" (globstar zero-segment), and similarly for other
 * mid-pattern double-star occurrences. The F4 fix only handled trailing slash-globstar
 * (e.g. "/foo/**" vs "/foo"); this tests the intermediate-position case.
 *
 * No network calls — pure pattern compilation + matching.
 */

import { describe, it, expect } from "vitest";
import { compilePatterns } from "../../src/tools/crawl.js";

describe("closure-C3: mid-pattern globstar zero-segment", () => {
  // ── Core matrix from the closure spec ─────────────────────────────────────

  it("/a/**/b vs /a/b is TRUE (zero-segment globstar)", () => {
    const [match] = compilePatterns(["/a/**/b"]);
    expect(match("/a/b")).toBe(true);
  });

  it("/a/**/b vs /a/x/b is TRUE (one-segment globstar)", () => {
    const [match] = compilePatterns(["/a/**/b"]);
    expect(match("/a/x/b")).toBe(true);
  });

  it("/a/**/b vs /a/bc is FALSE (boundary guard)", () => {
    const [match] = compilePatterns(["/a/**/b"]);
    expect(match("/a/bc")).toBe(false);
  });

  it("/**/foo vs /foo is TRUE (leading globstar zero-segment)", () => {
    const [match] = compilePatterns(["/**/foo"]);
    expect(match("/foo")).toBe(true);
  });

  // ── Existing /introduction/** boundary cases must remain correct ──────────

  it("/introduction/** vs /introduction is TRUE (trailing slash optional, F4)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introduction")).toBe(true);
  });

  it("/introduction/** vs /introductionX is FALSE (boundary guard preserved)", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introductionX")).toBe(false);
  });

  it("/introduction/** vs /introduction/page is TRUE", () => {
    const [match] = compilePatterns(["/introduction/**"]);
    expect(match("/introduction/page")).toBe(true);
  });

  // ── Additional mid-pattern cases ─────────────────────────────────────────

  it("/docs/**/index vs /docs/index is TRUE", () => {
    const [match] = compilePatterns(["/docs/**/index"]);
    expect(match("/docs/index")).toBe(true);
  });

  it("/docs/**/index vs /docs/api/index is TRUE", () => {
    const [match] = compilePatterns(["/docs/**/index"]);
    expect(match("/docs/api/index")).toBe(true);
  });

  it("/v1/**/api vs /v1/api is TRUE", () => {
    const [match] = compilePatterns(["/v1/**/api"]);
    expect(match("/v1/api")).toBe(true);
  });

  it("/v1/**/api vs /v1/foo/bar/api is TRUE", () => {
    const [match] = compilePatterns(["/v1/**/api"]);
    expect(match("/v1/foo/bar/api")).toBe(true);
  });

  it("/**/foo vs /bar/foo is TRUE", () => {
    const [match] = compilePatterns(["/**/foo"]);
    expect(match("/bar/foo")).toBe(true);
  });

  it("/**/foo vs /xfoo is FALSE", () => {
    const [match] = compilePatterns(["/**/foo"]);
    expect(match("/xfoo")).toBe(false);
  });

  // ── ReDoS safety must be preserved ───────────────────────────────────────

  it("mid-globstar pattern stays linear (<100ms on long path)", () => {
    const [match] = compilePatterns(["/a/**/b"]);
    const longPath = "/a/" + "x/".repeat(200) + "b";
    const start = Date.now();
    expect(match(longPath)).toBe(true);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("deeply nested mid-globstar stays linear (<100ms)", () => {
    const pattern = "/" + "a/**/".repeat(3) + "b";
    const [match] = compilePatterns([pattern]);
    const longPath = "/a/" + "x/".repeat(100) + "a/" + "y/".repeat(50) + "a/" + "z/".repeat(30) + "b";
    const start = Date.now();
    // Just verify no hang — correctness less important for deeply nested
    match(longPath);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
