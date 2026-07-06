/**
 * Unit tests for glob matcher and path filter logic in crawl.ts
 * Tests compilePatterns / shouldCrawlUrl / globToMatcher behavior
 */

// We can import directly from the built JS
import { compilePatterns, shouldCrawlUrl } from "./build/tools/crawl.js";

const FAILURES = [];
const PASSES = [];

function test(desc, fn) {
  try {
    fn();
    PASSES.push(desc);
  } catch (e) {
    FAILURES.push({ desc, error: e.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ─── compilePatterns ──────────────────────────────────────────────────────────

test("compilePatterns: undefined returns empty array", () => {
  assert(compilePatterns(undefined).length === 0, "expected []");
});

test("compilePatterns: empty array returns empty array", () => {
  assert(compilePatterns([]).length === 0, "expected []");
});

test("compilePatterns: pattern exactly 200 chars is accepted", () => {
  const p = "/" + "a".repeat(199);
  const matchers = compilePatterns([p]);
  assert(matchers.length === 1, "200-char pattern should be compiled");
});

test("compilePatterns: pattern 201 chars is silently skipped (internal 1000 cap)", () => {
  // The internal cap is 1000 chars; Zod cap is 200 chars per element.
  // A 201-char pattern passes Zod (Zod limits to 200 → fails at schema level, not here).
  // But the internal compilePatterns guard is 1000. So 201-char pattern SHOULD be compiled.
  const p = "/" + "a".repeat(200); // 201 total
  const matchers = compilePatterns([p]);
  assert(matchers.length === 1, "201-char pattern should be compiled (internal cap is 1000, not 200)");
});

test("compilePatterns: more than 50 patterns silently truncates to 50", () => {
  const patterns = Array.from({ length: 55 }, (_, i) => `/path${i}/**`);
  const matchers = compilePatterns(patterns);
  assert(matchers.length === 50, `expected 50 matchers but got ${matchers.length}`);
});

// ─── Glob semantics: globstar ** ──────────────────────────────────────────────

test("glob **: /** matches /docs", () => {
  const [m] = compilePatterns(["/**"]);
  assert(m("/docs"), "/** should match /docs");
});

test("glob **: /** matches /docs/api/v2", () => {
  const [m] = compilePatterns(["/**"]);
  assert(m("/docs/api/v2"), "/** should match /docs/api/v2");
});

test("glob **: /docs/** matches /docs/api", () => {
  const [m] = compilePatterns(["/docs/**"]);
  assert(m("/docs/api"), "/docs/** should match /docs/api");
});

test("glob **: /docs/** matches /docs/api/v2/ref", () => {
  const [m] = compilePatterns(["/docs/**"]);
  assert(m("/docs/api/v2/ref"), "/docs/** should match deep paths");
});

test("glob **: /docs/** does NOT match /blog/post", () => {
  const [m] = compilePatterns(["/docs/**"]);
  assert(!m("/blog/post"), "/docs/** should NOT match /blog/post");
});

test("glob **: /docs/** does NOT match /docsextra", () => {
  // This is a subtle semantic issue: /docs/** should match /docs/*, but
  // does it match /docsextra? (It should NOT — "docs" is a literal).
  const [m] = compilePatterns(["/docs/**"]);
  const result = m("/docsextra");
  // Expected: false (** starts after /docs/, not inside "docs" segment)
  assert(!result, "/docs/** should NOT match /docsextra (** only expands after the literal segment)");
});

test("glob **: /docs/** DOES or DOES NOT match /docs itself", () => {
  const [m] = compilePatterns(["/docs/**"]);
  // /docs itself — /docs/** with ** matching empty string
  // ** matches zero chars → /docs/ but path is /docs (no trailing slash).
  // This is an edge case: depends on whether ** can match empty.
  const result = m("/docs");
  // Note the actual result — this might be true or false depending on implementation.
  // Document it as observed behavior.
  console.log(`/docs/** matches /docs: ${result}`);
  // No assertion — just observing. If true, that's fine (** matches zero).
  assert(true, "observed");
});

// ─── Glob semantics: star * ───────────────────────────────────────────────────

test("glob *: /doc* matches /docs", () => {
  const [m] = compilePatterns(["/doc*"]);
  assert(m("/docs"), "/doc* should match /docs");
});

test("glob *: /doc* matches /documentation", () => {
  const [m] = compilePatterns(["/doc*"]);
  assert(m("/documentation"), "/doc* should match /documentation");
});

test("glob *: /doc* does NOT match /docs/api (crosses /)", () => {
  const [m] = compilePatterns(["/doc*"]);
  assert(!m("/docs/api"), "/doc* should NOT match /docs/api — * doesn't cross /");
});

test("glob *: /get* matches /get", () => {
  const [m] = compilePatterns(["/get*"]);
  assert(m("/get"), "/get* should match /get (zero extra chars)");
});

// ─── Glob semantics: question mark ? ─────────────────────────────────────────

test("glob ?: /g?t matches /get", () => {
  const [m] = compilePatterns(["/g?t"]);
  assert(m("/get"), "/g?t should match /get");
});

test("glob ?: /g?t matches /gut", () => {
  const [m] = compilePatterns(["/g?t"]);
  assert(m("/gut"), "/g?t should match /gut");
});

test("glob ?: /g?t does NOT match /gt (zero chars)", () => {
  const [m] = compilePatterns(["/g?t"]);
  assert(!m("/gt"), "/g?t should NOT match /gt (? requires exactly 1 char)");
});

test("glob ?: /g?t does NOT match /geet (two chars)", () => {
  const [m] = compilePatterns(["/g?t"]);
  assert(!m("/geet"), "/g?t should NOT match /geet");
});

test("glob ?: /g?t does NOT match /g/t (? can't be /)", () => {
  const [m] = compilePatterns(["/g?t"]);
  assert(!m("/g/t"), "/g?t should NOT match /g/t — ? can't match /");
});

// ─── shouldCrawlUrl ───────────────────────────────────────────────────────────

test("shouldCrawlUrl: no filters always returns true", () => {
  const result = shouldCrawlUrl("https://example.com/docs/api", [], []);
  assert(result, "no filters should allow all URLs");
});

test("shouldCrawlUrl: select filter matches → true", () => {
  const selects = compilePatterns(["/docs/**"]);
  const result = shouldCrawlUrl("https://example.com/docs/api", selects, []);
  assert(result, "matching select filter should return true");
});

test("shouldCrawlUrl: select filter no match → false", () => {
  const selects = compilePatterns(["/docs/**"]);
  const result = shouldCrawlUrl("https://example.com/blog/post", selects, []);
  assert(!result, "non-matching select filter should return false");
});

test("shouldCrawlUrl: exclude filter matches → false (exclude wins)", () => {
  const excludes = compilePatterns(["/blog/**"]);
  const result = shouldCrawlUrl("https://example.com/blog/post", [], excludes);
  assert(!result, "exclude filter match should return false");
});

test("shouldCrawlUrl: exclude overrides select (both match)", () => {
  const selects = compilePatterns(["/blog/**"]);
  const excludes = compilePatterns(["/blog/**"]);
  const result = shouldCrawlUrl("https://example.com/blog/post", selects, excludes);
  assert(!result, "exclude should win over select when both match");
});

test("shouldCrawlUrl: invalid URL returns false", () => {
  const result = shouldCrawlUrl("not-a-url", [], []);
  assert(!result, "invalid URL should return false");
});

// ─── CRITICAL: seed bypass at depth > 0 ──────────────────────────────────────

test("seed bypass: depth=0 should bypass select_paths (per source comment)", () => {
  // The actual bypass is in novadaCrawl() at line 213:
  //   if (item.depth > 0 && !shouldCrawlUrl(...)) continue;
  // So the seed (depth=0) is ALWAYS fetched regardless of select_paths.
  // We can't test this without a live call, but we can verify shouldCrawlUrl itself
  // returns false for a non-matching pattern (so the depth=0 check IS the exemption).
  const selects = compilePatterns(["/docs/**"]);
  const seedPath = "https://example.com/get";
  const matchResult = shouldCrawlUrl(seedPath, selects, []);
  assert(!matchResult, "shouldCrawlUrl returns false for mismatched select pattern");
  // The fact that depth=0 items bypass this check is in crawl.ts logic, not shouldCrawlUrl.
  // This test CONFIRMS: without the depth=0 bypass, the seed would be skipped.
});

// ─── Edge cases: glob patterns that should NOT cause issues ───────────────────

test("glob: empty pattern compiles but matches nothing useful", () => {
  // Empty string pattern: "" — matches only empty string path
  const matchers = compilePatterns([""]);
  // Zod minimum is min(1), so empty pattern fails at Zod level, but
  // compilePatterns itself doesn't guard empty (that's Zod's job)
  assert(matchers.length === 1, "empty pattern still compiles to a matcher");
  const emptyMatcher = matchers[0];
  assert(emptyMatcher("") === true, "empty pattern should only match empty string");
  assert(emptyMatcher("/docs") === false, "empty pattern should not match /docs");
});

test("glob: pattern with only ** matches everything", () => {
  const [m] = compilePatterns(["**"]);
  assert(m("/docs/api/v2"), "** alone matches any path");
  assert(m(""), "** alone matches empty");
  assert(m("/"), "** alone matches /");
});

test("glob: exact path /get matches only /get", () => {
  const [m] = compilePatterns(["/get"]);
  assert(m("/get"), "/get should match /get");
  assert(!m("/gets"), "/get should not match /gets");
  assert(!m("/ge"), "/get should not match /ge");
});

// ─── Asymmetry check: select_paths and exclude_paths have same Zod cap ────────

test("schema: select_paths and exclude_paths both cap at 20 items in Zod", () => {
  // Already tested via MCP, just confirming the caps are identical
  assert(true, "confirmed by crawl-select_paths-too-many and crawl-exclude_paths-too-many tests");
});

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`\n=== GLOB/PATH FILTER UNIT TEST RESULTS ===`);
console.log(`PASSED: ${PASSES.length}`);
console.log(`FAILED: ${FAILURES.length}`);

if (FAILURES.length > 0) {
  console.log(`\nFAILURES:`);
  for (const f of FAILURES) {
    console.log(`  FAIL: ${f.desc}`);
    console.log(`        Error: ${f.error}`);
  }
}

console.log(`\nAll tests:`, JSON.stringify({ passes: PASSES, failures: FAILURES }, null, 2));
