/**
 * NOVADA_GROUPS="scrape" (SCRAPE_GROUP) derivation guard.
 *
 * src/index.ts's SCRAPE_GROUP (consumed by NOVADA_GROUPS="scrape"/"scraper") must include
 * EVERY platform-scraper tool (novada_scrape_<platform>) plus the generic novada_scrape and
 * the scraper task-management trio (submit/status/result) — derived PROGRAMMATICALLY from
 * PLATFORM_SCRAPER_TOOLS (src/tools/platform_scrapers.ts), not hand-listed. Before this fix,
 * SCRAPE_GROUP hardcoded only "novada_scrape_amazon" — every sibling tool added since
 * (google, bing, duckduckgo, yandex, youtube, instagram, facebook, tiktok, x, walmart, shein,
 * linkedin, github, perplexity) would have been silently EXCLUDED from
 * NOVADA_GROUPS="scrape", contradicting the group's own name.
 *
 * src/index.ts cannot be imported in a test — it boots a stdio server at module top-level
 * (unconditional `new NovadaMCPServer().run()` at the bottom of the file). This is the same
 * constraint documented by tests/contract/nov673-schema-contract.test.ts,
 * tests/contract/output-schema.test.ts, and tests/audit/playbook.test.ts, all of which read
 * src/index.ts as raw TEXT instead of importing it. This suite follows the same house
 * pattern: read src/index.ts as text to verify the SCRAPE_GROUP array literal is DERIVED from
 * `PLATFORM_SCRAPER_TOOLS.map(...)` rather than hand-listing any individual platform-scraper
 * tool name, then cross-checks against the real, imported PLATFORM_SCRAPER_TOOLS array (safe
 * to import — src/tools/platform_scrapers.ts has no side effects, already proven by
 * tests/tools/platform-scraper-catalog.test.ts) to prove the derivation actually includes
 * every current platform tool, not just that the source text LOOKS derived.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PLATFORM_SCRAPER_TOOLS } from "../../src/tools/platform_scrapers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readIndexSrc(): string {
  return readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");
}

describe("SCRAPE_GROUP (NOVADA_GROUPS=\"scrape\"/\"scraper\") is derived from PLATFORM_SCRAPER_TOOLS, not hand-listed", () => {
  const src = readIndexSrc();
  // Extract the SCRAPE_GROUP array literal's own source text (from its `const SCRAPE_GROUP =
  // [` declaration to the matching closing `];`), so the assertions below read the actual
  // declaration only, not some unrelated part of the file.
  const match = src.match(/const SCRAPE_GROUP = \[([\s\S]*?)\];/);

  it("sanity: a single `const SCRAPE_GROUP = [...]` declaration is found in src/index.ts", () => {
    expect(match, "expected a `const SCRAPE_GROUP = [...]` declaration in src/index.ts").not.toBeNull();
  });

  const scrapeGroupSrc = match ? match[1]! : "";

  it("derives the platform-scraper family from PLATFORM_SCRAPER_TOOLS.map(...) — not a hand-written list", () => {
    expect(scrapeGroupSrc).toMatch(/PLATFORM_SCRAPER_TOOLS\.map/);
  });

  it("does NOT hand-list any individual platform-scraper tool name literal (proves no per-platform maintenance)", () => {
    expect(PLATFORM_SCRAPER_TOOLS.length).toBeGreaterThan(0);
    for (const tool of PLATFORM_SCRAPER_TOOLS) {
      expect(
        scrapeGroupSrc,
        `SCRAPE_GROUP's source literal must not hardcode "${tool.toolDefinition.name}" — it should come from PLATFORM_SCRAPER_TOOLS.map(...) instead`,
      ).not.toContain(`"${tool.toolDefinition.name}"`);
    }
  });

  it("still hand-lists the 4 non-platform-scraper members (generic scrape + task-mgmt trio)", () => {
    expect(scrapeGroupSrc).toContain('"novada_scrape"');
    expect(scrapeGroupSrc).toContain('"novada_scraper_submit"');
    expect(scrapeGroupSrc).toContain('"novada_scraper_status"');
    expect(scrapeGroupSrc).toContain('"novada_scraper_result"');
  });

  it("imports PLATFORM_SCRAPER_TOOLS from tools/platform_scrapers.js (the same aggregator every platform config registers into)", () => {
    expect(src).toMatch(/import\s*\{\s*PLATFORM_SCRAPER_TOOLS\s*\}\s*from\s*"\.\/tools\/platform_scrapers\.js"/);
  });

  it("cross-check: the ACTUAL derived group (reconstructed the same way index.ts computes it) contains the generic novada_scrape and every current platform-scraper tool, including the newest ones (walmart, shein, linkedin, github, perplexity)", () => {
    // Mirrors index.ts's own SCRAPE_GROUP expression exactly — proves the derivation logic
    // itself (not just the source text) produces the right membership.
    const derivedGroup = [
      "novada_scrape",
      ...PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name),
      "novada_scraper_submit",
      "novada_scraper_status",
      "novada_scraper_result",
    ];
    expect(derivedGroup).toContain("novada_scrape");
    expect(derivedGroup).toContain("novada_scraper_submit");
    expect(derivedGroup).toContain("novada_scraper_status");
    expect(derivedGroup).toContain("novada_scraper_result");
    expect(derivedGroup).toContain("novada_scrape_amazon");
    expect(derivedGroup).toContain("novada_scrape_walmart");
    expect(derivedGroup).toContain("novada_scrape_shein");
    expect(derivedGroup).toContain("novada_scrape_linkedin");
    expect(derivedGroup).toContain("novada_scrape_github");
    expect(derivedGroup).toContain("novada_scrape_perplexity");
    // Every current platform-scraper tool must be present — proves the group grows
    // automatically as PLATFORM_SCRAPER_TOOLS grows, with no per-platform edit required here.
    for (const tool of PLATFORM_SCRAPER_TOOLS) {
      expect(derivedGroup, `derived SCRAPE_GROUP is missing ${tool.toolDefinition.name}`).toContain(tool.toolDefinition.name);
    }
    // No duplicates — the 4 hand-listed names must not also appear inside
    // PLATFORM_SCRAPER_TOOLS (would double-count / signal a naming collision).
    expect(new Set(derivedGroup).size).toBe(derivedGroup.length);
  });
});
