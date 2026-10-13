/**
 * Round 3b (S1-connector, 2026-10-13): every tool/resource-facing surface that states a
 * "supported platforms" COUNT or NAMES a platform LIST for novada_scrape must derive it
 * from the catalog's WORKING ops (status:"ok"), never hand-type it — SHEIN (0/5 ops) and
 * ChatGPT (0/2 ops) going fully backend_broken is exactly the drift this closes: a
 * platform can silently stop being genuinely usable while a hand-written list still
 * names it as "supported".
 *
 * Each assertion here recomputes the expected set DIRECTLY from SCRAPER_CATALOG (not by
 * importing WORKING_PLATFORM_NAMES/WORKING_OP_COUNT and trusting them) — so a bug in
 * that derivation helper itself would still be caught, not just a core.ts/discover.ts/
 * resources/index.ts site that forgot to use it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../../src/core.js";
import { SCRAPER_CATALOG } from "../../src/data/scraper_catalog.js";
import { PLATFORM_SCRAPER_TOOLS } from "../../src/tools/platform_scrapers.js";
import { validateDiscoverParams, novadaDiscover } from "../../src/tools/discover.js";
import { readResource } from "../../src/resources/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Independently recomputed "ground truth" — mirrors WORKING_PLATFORM_NAMES/WORKING_OP_COUNT's
 *  OWN logic but reads SCRAPER_CATALOG directly, so a bug in that helper can't hide from this test. */
function computeWorkingPlatforms(): { names: Set<string>; opCount: number } {
  const names = new Set<string>();
  let opCount = 0;
  for (const platform of SCRAPER_CATALOG) {
    const workingOps = platform.ops.filter((op) => op.status === "ok");
    if (workingOps.length > 0) names.add(platform.name);
    opCount += workingOps.length;
  }
  return { names, opCount };
}

describe("novada_scrape description (core.ts) — stated platforms == platforms with >=1 working op", () => {
  const description = TOOLS.find((t) => t.name === "novada_scrape")!.description;
  const { names: expectedNames, opCount: expectedOpCount } = computeWorkingPlatforms();

  it("sanity: the expected set is non-trivial (both SHEIN and ChatGPT are excluded, not everything)", () => {
    expect(expectedNames.size).toBeGreaterThan(0);
    expect(expectedNames.has("SHEIN")).toBe(false);
    expect(expectedNames.has("ChatGPT")).toBe(false);
  });

  it("the 'Supports N platforms (~M operations): ...' headline states the independently-computed N and M", () => {
    const match = description.match(/Supports (\d+) platforms \(~(\d+) operations\): ([^.]+)\./);
    expect(match, "description must contain a 'Supports N platforms (~M operations): <list>.' headline").not.toBeNull();
    const [, statedCountStr, statedOpCountStr, statedListStr] = match!;
    expect(Number(statedCountStr)).toBe(expectedNames.size);
    expect(Number(statedOpCountStr)).toBe(expectedOpCount);

    const statedNames = new Set(statedListStr.split(",").map((s) => s.trim()));
    expect(statedNames).toEqual(expectedNames);
  });

  it("never names SHEIN or ChatGPT in the 'Supports' platform list (both 0 working ops today)", () => {
    const match = description.match(/Supports \d+ platforms \(~\d+ operations\): ([^.]+)\./);
    const statedList = match![1];
    expect(statedList).not.toMatch(/\bSHEIN\b/);
    expect(statedList).not.toMatch(/\bChatGPT\b/);
  });

  it("the 'Prefer the dedicated tool' slug list matches the ACTUAL registered PLATFORM_SCRAPER_TOOLS (not hand-listed)", () => {
    const match = description.match(/for ([a-z0-9/]+), call novada_scrape_<platform>/);
    expect(match, "description must contain the 'for <slug>/<slug>/..., call novada_scrape_<platform>' sentence").not.toBeNull();
    const statedSlugs = new Set(match![1].split("/"));
    const expectedSlugs = new Set(
      PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name.replace(/^novada_scrape_/, "")),
    );
    expect(statedSlugs).toEqual(expectedSlugs);
    expect(statedSlugs.has("shein")).toBe(false); // no dedicated tool exists anymore
  });
});

describe("novadaDiscover's 'Next Steps' hint — same invariant", () => {
  it("states the independently-computed working-platform count and op count, never SHEIN/ChatGPT", async () => {
    const { names: expectedNames, opCount: expectedOpCount } = computeWorkingPlatforms();
    const out = await novadaDiscover(validateDiscoverParams({}));
    const match = out.match(/novada_scrape` for (\d+) active platforms \(~(\d+) operations\)/);
    expect(match, "discover output must state 'novada_scrape` for N active platforms (~M operations)'").not.toBeNull();
    expect(Number(match![1])).toBe(expectedNames.size);
    expect(Number(match![2])).toBe(expectedOpCount);
    expect(out).not.toMatch(/SHEIN/);
    expect(out).not.toMatch(/ChatGPT/);
  });
});

describe("novada://llms-txt resource (quick reference) — same invariant", () => {
  it("states the independently-computed working-platform count and op count, never SHEIN/ChatGPT in the novada_scrape section", () => {
    const { names: expectedNames, opCount: expectedOpCount } = computeWorkingPlatforms();
    const text = readResource("novada://llms-txt").contents[0].text as string;
    const match = text.match(/structured data from (\d+) active platforms \(~(\d+) operations\)/);
    expect(match, "novada://llms-txt must state 'structured data from N active platforms (~M operations)'").not.toBeNull();
    expect(Number(match![1])).toBe(expectedNames.size);
    expect(Number(match![2])).toBe(expectedOpCount);

    // Scope the SHEIN/ChatGPT check to the novada_scrape section specifically — this
    // resource mentions many tools and "SHEIN"/"ChatGPT" could legitimately appear
    // elsewhere (e.g. a generic novada_scrape usage example naming an unsupported
    // platform on purpose).
    const sectionMatch = text.match(/## novada_scrape\n([\s\S]*?)\n##/);
    expect(sectionMatch, "novada://llms-txt must have a '## novada_scrape' section").not.toBeNull();
    expect(sectionMatch![1]).not.toMatch(/\bSHEIN\b/);
    expect(sectionMatch![1]).not.toMatch(/\bChatGPT\b/);
  });
});

describe("novada://guide resource — unaffected sibling sanity check", () => {
  it("the 'Tool Comparison' table's novada_scrape row states the independently-computed platform count", () => {
    const { names: expectedNames } = computeWorkingPlatforms();
    const text = readResource("novada://guide").contents[0].text as string;
    const match = text.match(/novada_scrape\s+\|\s+a supported platform \((\d+) platforms\)/);
    expect(match, "guide's Tool Comparison table must state 'a supported platform (N platforms)' for novada_scrape").not.toBeNull();
    expect(Number(match![1])).toBe(expectedNames.size);
  });
});

describe("hand-maintained docs (README x2, docs/TOOLS.md, novada-agent/SKILL.md) — same invariant", () => {
  const { names: expectedNames, opCount: expectedOpCount } = computeWorkingPlatforms();
  const expectedDedicatedCount = PLATFORM_SCRAPER_TOOLS.length;

  it("npm-package/README.md's novada_scrape row states the working-platform count (not a stale hand-count)", () => {
    const readme = readFileSync(resolve(__dirname, "../../README.md"), "utf8");
    expect(readme).toMatch(new RegExp(`Structured records from ${expectedNames.size} platforms`));
    expect(readme).toMatch(new RegExp(`\\*\\*${expectedDedicatedCount} typed per-platform tools\\*\\*`));
  });

  it("the monorepo root README.md's novada_scrape row states the working-platform count", () => {
    const rootReadme = readFileSync(resolve(__dirname, "../../../README.md"), "utf8");
    expect(rootReadme).toMatch(new RegExp(`Structured records from ${expectedNames.size} platforms`));
    expect(rootReadme).toMatch(new RegExp(`\\*\\*${expectedDedicatedCount} typed per-platform tools\\*\\*`));
  });

  it("docs/TOOLS.md states the working-platform count and op count for the generic gateway", () => {
    const toolsDoc = readFileSync(resolve(__dirname, "../../../docs/TOOLS.md"), "utf8");
    expect(toolsDoc).toMatch(new RegExp(`${expectedNames.size} platforms with a working route today, ~${expectedOpCount} operations`));
    expect(toolsDoc).toMatch(new RegExp(`The ${expectedDedicatedCount} \`novada_scrape_<platform>\` tools`));
  });

  it("novada-agent/SKILL.md's novada_scrape entry states the independently-computed count, platform list, and never names SHEIN/ChatGPT as supported", () => {
    const skill = readFileSync(resolve(__dirname, "../../skills/novada-agent/SKILL.md"), "utf8");
    const match = skill.match(/Supports (\d+) platforms \(~(\d+) operations\): ([^—]+)—/);
    expect(match, "SKILL.md must state 'Supports N platforms (~M operations): <list> —'").not.toBeNull();
    expect(Number(match![1])).toBe(expectedNames.size);
    expect(Number(match![2])).toBe(expectedOpCount);
    const statedNames = new Set(match![3].split(",").map((s) => s.trim()).filter(Boolean));
    expect(statedNames).toEqual(expectedNames);
  });
});
