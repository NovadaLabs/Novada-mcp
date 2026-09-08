/**
 * `?groups=scrapers` / `?groups=meta` derivation guard (F-1 P1 / F-7 audit, W-B1).
 *
 * W-B1 added two NEW, additive `TOOL_GROUPS` keys to hosted-server/vercel/api/mcp.ts:
 *   - "scrapers" — MUST resolve to exactly {novada_scrape} ∪ every
 *     novada_scrape_<platform> tool (16 total today) — DERIVED from
 *     PLATFORM_SCRAPER_TOOLS (the same aggregator src/tools/platform_scrapers.js
 *     exports and npm-package's own src/index.ts SCRAPE_GROUP already derives
 *     from — see npm-package/tests/tools/scrape-group-derivation.test.ts), never
 *     a hand-listed literal. This mirrors that npm-side guard on the hosted side.
 *   - "meta" — intentionally narrowed to the hosted-VISIBLE subset of the
 *     registry's 4-tool "meta" bucket (novada_session_stats and
 *     novada_search_feedback are HOSTED_HIDDEN and must never appear in ANY
 *     TOOL_GROUPS array — already guarded generically by
 *     tool-catalog-derivation.test.mjs's "no HOSTED_HIDDEN tool is reachable
 *     through any TOOL_GROUPS entry" test; this file adds a direct, scoped
 *     assertion for the two tools "meta" DOES carry).
 *
 * Deliberately did NOT touch the pre-existing "core" (10 tools) or "account"
 * (3 tools) keys — those already mean something different/narrower on hosted
 * than the npm-side registry partition, and redefining them would silently
 * change behavior for hosted customers already using ?groups=core/?groups=account
 * (an owner decision, logged for Wave E — not this file's concern).
 *
 * Same STATIC-analysis style as tool-catalog-derivation.test.mjs in this same
 * directory (mcp.ts is never imported — module-load side effects; see that
 * file's header for the full rationale): text-slice mcp.ts's TOOL_GROUPS
 * literal, cross-checked against a real, side-effect-free import of the
 * vendored PLATFORM_SCRAPER_TOOLS array.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const VENDOR_PLATFORM_SCRAPERS = join(__dirname, "..", "vendor", "novada-mcp", "tools", "platform_scrapers.js");

const mcpSrc = readFileSync(MCP_TS, "utf8");
const { PLATFORM_SCRAPER_TOOLS } = await import(VENDOR_PLATFORM_SCRAPERS);
const PLATFORM_SCRAPER_NAMES = PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name);

function sliceBetween(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end);
}

function namesIn(slice) {
  return [...slice.matchAll(/"(novada_[a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
}

const toolGroupsSlice = sliceBetween("const TOOL_GROUPS: Record<string, string[]> = {", "\n};", "TOOL_GROUPS");

/** Extract one named group's array contents from the TOOL_GROUPS slice, e.g. "scrapers". */
function groupSourceAndNames(groupKey) {
  const re = new RegExp(`\\b${groupKey}:\\s*\\[([^\\]]*)\\]`);
  const m = toolGroupsSlice.match(re);
  assert.ok(m, `TOOL_GROUPS.${groupKey} not found in mcp.ts`);
  return { source: m[1], names: namesIn(m[1]) };
}

// ─── PLATFORM_SCRAPER_NAMES sanity (mirrors tool-catalog-derivation.test.mjs) ─────

test("sanity: the vendored PLATFORM_SCRAPER_TOOLS has exactly 15 entries", () => {
  assert.equal(PLATFORM_SCRAPER_NAMES.length, 15, `expected 15, found: ${PLATFORM_SCRAPER_NAMES.join(", ")}`);
});

// ─── TOOL_GROUPS.scrapers is DERIVED, never hand-listed ───────────────────────────

test('TOOL_GROUPS.scrapers derives the platform-scraper family from PLATFORM_SCRAPER_TOOLS.map(...) — not a hand-written list', () => {
  const { source } = groupSourceAndNames("scrapers");
  assert.match(source, /PLATFORM_SCRAPER_TOOLS\.map/);
});

test("TOOL_GROUPS.scrapers's source literal does not hardcode any individual platform-scraper tool name (proves no per-platform maintenance)", () => {
  const { source } = groupSourceAndNames("scrapers");
  for (const name of PLATFORM_SCRAPER_NAMES) {
    assert.ok(
      !source.includes(`"${name}"`),
      `TOOL_GROUPS.scrapers must not hardcode "${name}" — it should come from PLATFORM_SCRAPER_TOOLS.map(...) instead`,
    );
  }
});

test("TOOL_GROUPS.scrapers still hand-lists the ONE non-platform-scraper member (generic novada_scrape)", () => {
  const { source } = groupSourceAndNames("scrapers");
  assert.match(source, /"novada_scrape"/);
});

// The two tests below reconstruct the REAL resolved array the same way mcp.ts's own
// expression does (`["novada_scrape", ...PLATFORM_SCRAPER_TOOLS.map(...)]`) rather than
// text-extracting names from source — `namesIn` only ever sees the ONE literal string in
// that expression ("novada_scrape"); the other 15 are computed at runtime via `.map(...)`,
// which is exactly the "derived, not hand-listed" property under test. Mirrors
// scrape-group-derivation.test.ts's own "cross-check: the ACTUAL derived group" test,
// which reconstructs index.ts's SCRAPE_GROUP expression the same way for the same reason.
test("TOOL_GROUPS.scrapers's REAL resolved value (reconstructed the same way mcp.ts computes it) is EXACTLY {novada_scrape} ∪ every current PLATFORM_SCRAPER_TOOLS entry (16 total)", () => {
  const derivedScrapersGroup = ["novada_scrape", ...PLATFORM_SCRAPER_NAMES];
  assert.equal(derivedScrapersGroup.length, 16, `expected 16 tools, found ${derivedScrapersGroup.length}`);
  assert.equal(new Set(derivedScrapersGroup).size, 16, "no duplicates expected");
  assert.ok(derivedScrapersGroup.includes("novada_scrape"));
  for (const name of PLATFORM_SCRAPER_NAMES) {
    assert.ok(derivedScrapersGroup.includes(name), `derived TOOL_GROUPS.scrapers is missing ${name}`);
  }
});

test("TOOL_GROUPS.scrapers grows automatically as PLATFORM_SCRAPER_TOOLS grows (every current platform tool, including the newest ones, is covered with zero hand-edits here)", () => {
  for (const name of ["novada_scrape_walmart", "novada_scrape_shein", "novada_scrape_linkedin", "novada_scrape_github", "novada_scrape_perplexity"]) {
    assert.ok(PLATFORM_SCRAPER_NAMES.includes(name), `vendored PLATFORM_SCRAPER_TOOLS is missing ${name} — re-vendor from npm-package`);
  }
});

// ─── TOOL_GROUPS.meta — hosted-visible subset, scoped assertion ───────────────────

test("TOOL_GROUPS.meta is exactly {novada_discover, novada_setup} (the hosted-visible subset — session_stats/search_feedback stay excluded, they're HOSTED_HIDDEN)", () => {
  const { names } = groupSourceAndNames("meta");
  assert.deepEqual([...names].sort(), ["novada_discover", "novada_setup"]);
});

test("TOOL_GROUPS.meta does not reference novada_session_stats or novada_search_feedback", () => {
  const { names } = groupSourceAndNames("meta");
  assert.ok(!names.includes("novada_session_stats"));
  assert.ok(!names.includes("novada_search_feedback"));
});
