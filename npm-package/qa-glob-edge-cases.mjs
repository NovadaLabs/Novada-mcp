/**
 * Focused investigation of /docs/** not matching /docs and related edge cases
 */
import { compilePatterns, shouldCrawlUrl } from "./build/tools/crawl.js";

const issues = [];

function check(label, expected, actual) {
  const pass = expected === actual;
  const status = pass ? "PASS" : "FAIL";
  console.log(`${status}: ${label}`);
  console.log(`       expected: ${expected}, actual: ${actual}`);
  if (!pass) issues.push({ label, expected, actual });
  return pass;
}

console.log("=== /docs/** glob behavior ===\n");

const [docsGlobstar] = compilePatterns(["/docs/**"]);
check("/docs/** matches /docs/api", true, docsGlobstar("/docs/api"));
check("/docs/** matches /docs/api/v2", true, docsGlobstar("/docs/api/v2"));
check("/docs/** DOES NOT match /docs (no trailing slash)", false, docsGlobstar("/docs"));
check("/docs/** DOES NOT match /blog", false, docsGlobstar("/blog"));

// The above shows /docs/** MISSES /docs exactly (only child pages)
// This means select_paths: ["/docs/**"] excludes the /docs root page itself from crawl queue

console.log("\n=== Verifying the /docs/** gap: ===");
console.log("If user specifies select_paths=['/docs/**'], the crawl will:");
console.log("- FETCH the root seed (depth=0) even if it's not /docs (correct by design)");
console.log("- SKIP /docs itself if it appears in a child link list (since /docs doesn't match /docs/**)");
console.log("- INCLUDE /docs/anything/* (correct)");
console.log("");
console.log("This means: if root seed is https://example.com/docs, and there's a self-referential link to /docs,");
console.log("that link would be excluded from the queue (since shouldCrawlUrl('/docs', [/docs/**], []) = false).");
console.log("However, the ROOT seed itself IS crawled (depth=0 bypass), so the /docs page IS processed.");
console.log("But discovered LINKS back to /docs are excluded — minor but documented behavior.");
console.log("");

// Let's also check if a common mistake: /docs/* vs /docs/**
const [docsStar] = compilePatterns(["/docs/*"]);
check("/docs/* matches /docs/api", true, docsStar("/docs/api"));
check("/docs/* DOES NOT match /docs/api/v2 (star doesn't cross /)", false, docsStar("/docs/api/v2"));
check("/docs/* DOES NOT match /docs itself", false, docsStar("/docs"));

console.log("\n=== Glob: does ** match zero characters (i.e., /docs/** matches /docs/) ? ===");
// /docs/** - last token is globstar. The preceding literal "/" is required.
// So /docs/** needs at least "/docs/" prefix. But path /docs has no trailing slash.
const [m] = compilePatterns(["/docs/**"]);
check("/docs/** matches /docs/ (with trailing slash)", true, m("/docs/"));
check("/docs/** matches /docs (no trailing slash)", false, m("/docs"));
// Conclusion: /docs/** ONLY matches paths starting with /docs/ (at least one more segment)
// This is a subtle UX issue: if users write ["/docs/**"] expecting to match /docs index too,
// it WILL be missed unless the root seed itself is /docs (depth=0 bypass saves it).

console.log("\n=== Potential Issue: exclude_paths=['/docs/**'] also misses /docs exactly ===");
const [excGlob] = compilePatterns(["/docs/**"]);
// If user wants to EXCLUDE all docs pages including /docs itself
check("exclude /docs/** should exclude /docs/api", !excGlob("/docs/api"), false); // tricky inverted
console.log("Note: shouldCrawlUrl returns false when exclude matches");
console.log("So exclude_paths=['/docs/**'] does NOT block /docs itself — /docs would still be crawled");
console.log("Only /docs/something would be excluded — potential unintended crawl of /docs index page");

// Verify via shouldCrawlUrl
const excPatterns = compilePatterns(["/docs/**"]);
const emptySelects = compilePatterns([]);
check("shouldCrawlUrl for /docs with exclude ['/docs/**'] = true (NOT excluded)",
  true,
  shouldCrawlUrl("https://example.com/docs", emptySelects, excPatterns));
check("shouldCrawlUrl for /docs/api with exclude ['/docs/**'] = false (excluded)",
  false,
  shouldCrawlUrl("https://example.com/docs/api", emptySelects, excPatterns));

console.log("\n=== Testing: include_subdomains in Map ===");
console.log("(Only schema check, can't fully test without live call)");
// Confirmed via map.ts: include_subdomains governs both sitemap filter and BFS crawl

console.log("\n=== select_paths with trailing slash ===");
const [trailingSlash] = compilePatterns(["/docs/"]);
check("/docs/ matches /docs/", true, trailingSlash("/docs/"));
check("/docs/ matches /docs/api", false, trailingSlash("/docs/api"));
check("/docs/ matches /docs", false, trailingSlash("/docs"));

console.log("\n=== SUMMARY ===");
if (issues.length > 0) {
  console.log("ISSUES FOUND:");
  for (const i of issues) {
    console.log(`  - ${i.label}: expected ${i.expected}, got ${i.actual}`);
  }
} else {
  console.log("No unexpected failures (all behavior is as implemented, documented for review)");
}

console.log("\nKey behavioral findings:");
console.log("1. /docs/** DOES NOT match /docs (no trailing slash) — only matches /docs/something");
console.log("   Impact: select_paths=['/docs/**'] silently skips the /docs index page when encountered as a child link");
console.log("   Mitigation: depth=0 seed is always crawled, but depth>0 links to /docs index are filtered");
console.log("2. exclude_paths=['/docs/**'] also does NOT exclude /docs exactly — it only excludes sub-pages");
console.log("   Impact: users may expect to block /docs but /docs itself still gets crawled");
console.log("3. Both issues are consistent with each other but surprising to users from shell-glob experience");
console.log("   where ** is expected to match zero or more path segments including the base");
