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
import { readResource, RESOURCES } from "../../src/resources/index.js";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";

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

// ─── Round 4b (S1-connector, F-review "Round-4 review" FIX-FIRST, 2026-10-13) ──
//
// The reviewer found registry.ts's novada_scrape one-liner (rendered by
// novada_discover on BOTH surfaces) still hand-stated "16 active platforms
// (~87 operations) ... SHEIN, ChatGPT" — the exact false claim this whole file
// exists to eliminate, just never applied to that ONE surface because the
// suite above enumerates 7 known FILES, not the underlying CLASS of defect.
//
// Widened from "7 hand-picked surfaces" to the CLASS "every user/model-visible
// string": every TOOLS[] description + serialized inputSchema (param
// descriptions), every TOOL_REGISTRY description, every MCP resource's
// rendered text, plus (unchanged) README x2/docs/TOOLS.md/SKILL.md and the
// index.ts CLI banner. A single shared phrase-pattern ("N active platforms
// (~M operations)") is scanned across ALL of them — so a FUTURE file that
// reuses this exact phrasing with a stale number is caught automatically,
// without needing to be named here, closing the actual gap the reviewer
// found (a new surface silently not being on anyone's list).

/** Every user/model-visible string this repo renders, collected by SOURCE
 *  CLASS rather than by file name — adding a new resource/doc/registry entry
 *  is automatically covered; nobody has to remember to add it to a list. */
async function collectVisibleStrings(): Promise<{ label: string; text: string }[]> {
  const sources: { label: string; text: string }[] = [];
  for (const t of TOOLS) {
    sources.push({ label: `TOOLS["${t.name}"].description`, text: t.description });
    sources.push({ label: `TOOLS["${t.name}"].inputSchema (param descriptions, serialized)`, text: JSON.stringify(t.inputSchema) });
  }
  for (const t of TOOL_REGISTRY) {
    sources.push({ label: `TOOL_REGISTRY["${t.name}"].description`, text: t.description });
  }
  for (const r of RESOURCES) {
    const { contents } = readResource(r.uri);
    for (const c of contents) {
      const text = (c as { text?: unknown }).text;
      if (typeof text === "string") sources.push({ label: `resource ${r.uri}`, text });
    }
  }
  const discoverOut = await novadaDiscover(validateDiscoverParams({}));
  sources.push({ label: "novadaDiscover() default output", text: discoverOut });
  return sources;
}

/** Phrase SHAPES (not files) this codebase uses to state a platform/op/dedicated-
 *  tool count — named capture groups so one validator handles every shape. A
 *  shape used by a brand-new surface in the future is caught the moment that
 *  surface reuses one of these phrasings with a stale number; a genuinely NEW
 *  phrasing still needs a row here (same as adding a resource needs a line in
 *  collectVisibleStrings) — this is the declarative "class" surface, kept small
 *  and explicit rather than an unbounded NLP guess. */
const PLATFORM_CLAIM_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "'N active platforms (~M operations)'", regex: /(?<count>\d+)\s+active platforms\s*\(~(?<opCount>\d+)\s+operations\)/g },
  { name: "'Supports N platforms (~M operations)'", regex: /Supports (?<count>\d+) platforms \(~(?<opCount>\d+) operations\)/g },
  { name: "'N platforms with a working route today, ~M operations'", regex: /(?<count>\d+) platforms with a working route today, ~(?<opCount>\d+) operations/g },
  { name: "'a supported platform (N platforms)'", regex: /a supported platform \((?<count>\d+) platforms\)/g },
  { name: "'Structured records from N platforms'", regex: /Structured records from (?<count>\d+) platforms/g },
  { name: "'N typed per-platform tools'", regex: /(?<dedicatedCount>\d+) typed per-platform tools/g },
  { name: "'The N `novada_scrape_<platform>` tools'", regex: /The (?<dedicatedCount>\d+) `novada_scrape_<platform>` tools/g },
  { name: "'N dedicated platform scrapers'", regex: /(?<dedicatedCount>\d+) dedicated platform scrapers/g },
];

describe("CLASS sweep (F-review widening): every user/model-visible string matching a known platform-count phrase states the TRUE count", () => {
  const { names: expectedNames, opCount: expectedOpCount } = computeWorkingPlatforms();
  const expectedDedicatedCount = PLATFORM_SCRAPER_TOOLS.length;

  it("sanity: the sweep actually finds matches (not vacuously passing over zero occurrences)", async () => {
    const sources = await collectVisibleStrings();
    let totalMatches = 0;
    for (const { text } of sources) {
      for (const { regex } of PLATFORM_CLAIM_PATTERNS) {
        totalMatches += [...text.matchAll(regex)].length;
      }
    }
    expect(totalMatches).toBeGreaterThan(3);
  });

  it("every match of every known platform-count phrase, in every collected visible string, states the independently-computed count/opCount/dedicatedCount", async () => {
    const sources = await collectVisibleStrings();
    const failures: string[] = [];
    for (const { label, text } of sources) {
      for (const { name, regex } of PLATFORM_CLAIM_PATTERNS) {
        for (const m of text.matchAll(regex)) {
          const g = m.groups ?? {};
          if (g.count !== undefined && Number(g.count) !== expectedNames.size) {
            failures.push(`${label}: pattern ${name} stated count=${g.count}, expected ${expectedNames.size} (match: "${m[0]}")`);
          }
          if (g.opCount !== undefined && Number(g.opCount) !== expectedOpCount) {
            failures.push(`${label}: pattern ${name} stated opCount=${g.opCount}, expected ${expectedOpCount} (match: "${m[0]}")`);
          }
          if (g.dedicatedCount !== undefined && Number(g.dedicatedCount) !== expectedDedicatedCount) {
            failures.push(`${label}: pattern ${name} stated dedicatedCount=${g.dedicatedCount}, expected ${expectedDedicatedCount} (match: "${m[0]}")`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("not-inert proof: a planted stale claim (count+1) IS caught by the same scan logic", async () => {
    const stale = `Extract data from ${expectedNames.size + 1} active platforms (~${expectedOpCount} operations).`;
    const hits: string[] = [];
    for (const { name, regex } of PLATFORM_CLAIM_PATTERNS) {
      for (const m of stale.matchAll(regex)) {
        const g = m.groups ?? {};
        if (g.count !== undefined && Number(g.count) !== expectedNames.size) hits.push(name);
      }
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("TOOL_REGISTRY['novada_scrape'].description (registry.ts, F-review) — same invariant as core.ts's TOOLS description", () => {
  it("states the independently-computed working-platform count and op count — what novada_discover renders on BOTH surfaces", () => {
    const { names: expectedNames, opCount: expectedOpCount } = computeWorkingPlatforms();
    const entry = TOOL_REGISTRY.find((t) => t.name === "novada_scrape")!;
    const match = entry.description.match(/(\d+) active platforms \(~(\d+) operations\)/);
    expect(match, "TOOL_REGISTRY novada_scrape description must state 'N active platforms (~M operations)'").not.toBeNull();
    expect(Number(match![1])).toBe(expectedNames.size);
    expect(Number(match![2])).toBe(expectedOpCount);
    expect(entry.description).not.toMatch(/\bSHEIN\b/);
    expect(entry.description).not.toMatch(/\bChatGPT\b/);
  });
});

describe("index.ts --help CLI banner (F-review) — static source-text guard", () => {
  // index.ts has top-level side effects gated behind `if (cliArgs.includes(...))`
  // branches checked against the REAL process.argv at import time (binds stdio,
  // can start the MCP server) — same reason hosted's test suite never imports
  // mcp.ts directly (see tool-catalog-derivation.test.mjs's header). This guard
  // is therefore STATIC (source text), not a runtime render of the banner: it
  // proves the stale literals are gone and the derived-constant references are
  // present, which is the exact regression class this round fixes.
  const indexSrc = readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");

  it("no longer hard-codes the stale '16 active platforms' / '~87 operations' / '15 dedicated platform scrapers' / SHEIN+ChatGPT example literals", () => {
    expect(indexSrc).not.toMatch(/16 active platforms/);
    expect(indexSrc).not.toMatch(/~87 operations/);
    expect(indexSrc).not.toMatch(/15 dedicated platform scrapers/);
    expect(indexSrc).not.toMatch(/SHEIN, ChatGPT/);
  });

  it("the --help banner's novada_scrape / novada_scrape_<platform> lines now interpolate the derived constants instead", () => {
    expect(indexSrc).toMatch(/\$\{WORKING_PLATFORM_NAMES\.length\} active platforms \(~\$\{WORKING_OP_COUNT\} operations/);
    expect(indexSrc).toMatch(/\$\{PLATFORM_SCRAPER_TOOLS\.length\} dedicated platform scrapers \(\$\{DEDICATED_PLATFORM_SLUGS\.join/);
  });
});

// ─── {{sibling:}} markup leak guard (reviewer's own flagged error-path gap) ────
//
// "SIBLING_SPAN_RE requires a matching {{/sibling}} close tag to fire at all —
// an unclosed/malformed span would leave raw {{sibling:...}} text completely
// unstripped and visible to a client. No test in the diff guards against this."
// Two checks: (1) every {{sibling: OPEN in the raw, pre-render SOURCE has a
// matching {{/sibling}} CLOSE (so the markup is well-formed at the only place
// it's hand-authored); (2) no RENDERED description on npm's own surface
// contains a literal "{{" at all (the only way "{{" could survive rendering
// is a malformed/unclosed span, or a brand-new markup convention nobody
// taught renderDescriptionForSurface about — either way, a real leak).
describe("{{sibling:}} markup leak guard (F-review error-path gap)", () => {
  it("_TOOL_DEFINITIONS (raw, pre-render source): every '{{sibling:' open has a matching '{{/sibling}}' close", async () => {
    const { _TOOL_DEFINITIONS } = await import("../../src/core.js");
    for (const t of _TOOL_DEFINITIONS) {
      const opens = [...t.description.matchAll(/\{\{sibling:/g)].length;
      const closes = [...t.description.matchAll(/\{\{\/sibling\}\}/g)].length;
      expect(opens, `${t.name}: ${opens} '{{sibling:' opens vs ${closes} '{{/sibling}}' closes`).toBe(closes);
    }
  });

  it("no rendered TOOLS description (npm's own surface) contains a literal '{{' (proves no unclosed/malformed span survives rendering)", () => {
    for (const t of TOOLS) {
      expect(t.description, `${t.name} description contains a literal '{{' after rendering`).not.toContain("{{");
    }
  });

  it("not-inert proof: a deliberately UNCLOSED span (missing {{/sibling}}) is left un-stripped and WOULD be caught by the above guard", async () => {
    const { renderDescriptionForSurface } = await import("../../src/_core/description_surface.js");
    const malformed = "Use {{sibling:novada_site_copy}}this other tool for whole-site jobs.";
    const rendered = renderDescriptionForSurface(malformed, new Set<string>()); // tool NOT available
    // No matching close tag means SIBLING_SPAN_RE never matches at all — the
    // raw markup passes through completely unstripped, exactly the leak this
    // guard exists to catch.
    expect(rendered).toContain("{{");
  });
});
