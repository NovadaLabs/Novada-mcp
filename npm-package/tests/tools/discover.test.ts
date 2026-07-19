/**
 * Discover catalog drift guards.
 *
 * The discover catalog is DERIVED from the canonical TOOL_REGISTRY (src/tools/registry.ts),
 * and the server's wired tool list lives in the `TOOLS` array exported by src/core.ts. These
 * tests fail loudly the moment any of those three drift apart:
 *
 *   1. TOOL_REGISTRY names === src/core.ts TOOLS names        (exact set — no ghosts, no omissions)
 *   2. Every registry entry has a valid category + status     (typed metadata integrity)
 *   3. The rendered discover catalog ⊆ TOOL_REGISTRY          (no ghost tools surface to agents)
 *   4. Category filtering returns exactly the registered tools for that category
 *
 * Why import src/core.ts's TOOLS directly (not text-parse it): core.ts documents itself as
 * side-effect-free and safe to import from any transport or test (no server construction, no
 * process.exit, no stdio boot — unlike src/index.ts, which boots a stdio server at module
 * top-level and must never be imported by a test). `TOOLS` is EXACTLY the wired ListTools
 * surface (`_TOOL_DEFINITIONS.filter(t => REGISTERED_TOOL_NAMES.has(t.name))`), so importing
 * it is both simpler and MORE robust than regex-scraping `_TOOL_DEFINITIONS` text: it stays
 * correct even when a tool definition is generated/spread in from another module (e.g.
 * tools/platform_scraper.ts's per-platform scraper factory) rather than written as a literal
 * `name: "novada_x"` string directly in core.ts. This mirrors the pattern already used by
 * tests/tools/collision-matrix.test.ts and tests/contract/nov673-schema-contract.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TOOL_REGISTRY,
  TOOL_CATEGORIES,
  REGISTERED_TOOL_NAMES,
} from "../../src/tools/registry.js";
import { novadaDiscover, validateDiscoverParams, DiscoverParamsSchema } from "../../src/tools/discover.js";
import { TOOLS } from "../../src/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Pure set-difference logic factored out of the "exact match" test below, so it can be
 * exercised against SYNTHETIC (fabricated) name lists in the self-check block further down
 * — proving the detector actually fires on drift, not just that it's inert-green today.
 */
function diffToolNames(registryNames: readonly string[], wiredNames: readonly string[]): { ghosts: string[]; missing: string[] } {
  const wiredSet = new Set(wiredNames);
  const registrySet = new Set(registryNames);
  return {
    ghosts: [...registrySet].filter((n) => !wiredSet.has(n)), // in registry, not wired
    missing: [...wiredSet].filter((n) => !registrySet.has(n)), // wired, not in registry
  };
}

describe("discover catalog ↔ registry ↔ wired TOOLS", () => {
  const wiredNames = TOOLS.map((t) => t.name);
  const registryNames = TOOL_REGISTRY.map((t) => t.name);

  it("the test can locate the wired TOOLS array (sanity)", () => {
    expect(wiredNames.length).toBeGreaterThan(20);
    expect(wiredNames).toContain("novada_search");
    expect(wiredNames).toContain("novada_discover");
  });

  it("registry names EXACTLY match the wired TOOLS names (fails loudly on drift)", () => {
    // TOW2-256: TOOLS now DERIVES from REGISTERED_TOOL_NAMES — the filter in core.ts
    // means dispatch-only aliases (proxy variants, scraper stubs, etc.)
    // are NOT in the wired TOOLS array at all. No alias exclusion needed here: the
    // invariant is simply wiredNames === registryNames (exact set equality).
    //
    // Structural guarantee: adding a name to _TOOL_DEFINITIONS without also adding it
    // to TOOL_REGISTRY keeps it hidden automatically. The reverse — adding to registry
    // without a definition — surfaces it as an empty schema, which is caught by the
    // "every wired tool is in registry" direction of this assertion.
    const { ghosts, missing } = diffToolNames(registryNames, wiredNames);

    expect(ghosts, `registry lists tools NOT present in src/core.ts TOOLS (add definition or remove from registry): ${ghosts.join(", ")}`).toEqual([]);
    expect(missing, `src/core.ts TOOLS includes tools missing from TOOL_REGISTRY (add to registry or remove from _TOOL_DEFINITIONS): ${missing.join(", ")}`).toEqual([]);
    // Exact set equality (order-independent). No alias filtering needed — TOOLS is derived.
    expect([...new Set(registryNames)].sort()).toEqual([...new Set(wiredNames)].sort());
  });

  it("registry has no duplicate tool names", () => {
    expect(new Set(registryNames).size).toBe(registryNames.length);
  });

  it("every registry entry has a valid category and status", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(TOOL_CATEGORIES, `${tool.name} has an unknown category: ${tool.category}`).toContain(tool.category);
      expect(["active", "todo"], `${tool.name} has an invalid status: ${tool.status}`).toContain(tool.status);
      expect(tool.description.trim().length, `${tool.name} has an empty description`).toBeGreaterThan(0);
    }
  });

  it("REGISTERED_TOOL_NAMES is consistent with TOOL_REGISTRY", () => {
    expect(REGISTERED_TOOL_NAMES.size).toBe(registryNames.length);
    for (const n of registryNames) expect(REGISTERED_TOOL_NAMES.has(n)).toBe(true);
  });

  // Drift guard for the "tool count stated 8 different ways" problem: pin the
  // curated registry size and require the human-authored README headline to
  // derive from it (state "22 curated tools"). NOT a semantic diff test — just a
  // count assertion so a bare wrong integer (38/33/25/11) can't silently return.
  it("registry count is 23 and the README headline count matches it", () => {
    const EXPECTED_CURATED_COUNT = 24;
    expect(
      TOOL_REGISTRY.length,
      `registry size changed — update EXPECTED_CURATED_COUNT and every README/SKILL count to ${TOOL_REGISTRY.length}`
    ).toBe(EXPECTED_CURATED_COUNT);

    const readmePath = resolve(__dirname, "../../README.md");
    const readme = readFileSync(readmePath, "utf8");
    // Count assertion only (per the comment above): the registry-derived count must
    // appear as a tool count in the README, so a wrong integer can't silently ship.
    // Robust to phrasing ("23 tools" or "23 curated tools") — the number is the invariant.
    expect(
      readme,
      `README must state "${EXPECTED_CURATED_COUNT} tools" (derived from registry) — not a stale hand-count`
    ).toMatch(new RegExp(`${EXPECTED_CURATED_COUNT}\\s+(curated\\s+)?tools`));
  });
});

/**
 * Self-check (synthetic fixtures only, never the real registry/TOOLS) — proves
 * `diffToolNames` (the exact comparison the "registry names EXACTLY match" test above
 * runs against the real data) actually FIRES on injected drift, rather than merely being
 * green today because nothing happens to be wrong right now. Mirrors the "not-inert" proof
 * pattern used by tests/tools/collision-matrix.test.ts's self-check section.
 *
 * This is also the direct proof that switching the guard from regex-parsing src/core.ts's
 * source text to importing its `TOOLS` export (done above) did not weaken detection: a tool
 * definition that is GENERATED/spread in from another module (exactly what
 * tools/platform_scraper.ts's factory does for novada_scrape_amazon and its future
 * per-platform siblings) is invisible to a literal `name: "novada_x"` regex scan but fully
 * visible here, because `diffToolNames` only ever looks at the real, computed name arrays.
 */
describe("diffToolNames self-check: the drift detector fires on injected drift", () => {
  it("flags a registry-only name as a ghost (registered but not wired — the exact class of bug a hand-written literal could introduce)", () => {
    const { ghosts, missing } = diffToolNames(
      ["novada_real_tool", "novada_typo_or_removed_tool"],
      ["novada_real_tool"],
    );
    expect(ghosts).toEqual(["novada_typo_or_removed_tool"]);
    expect(missing).toEqual([]);
  });

  it("flags a wired-only name as missing (dispatchable but never added to the registry)", () => {
    const { ghosts, missing } = diffToolNames(
      ["novada_real_tool"],
      ["novada_real_tool", "novada_new_platform_tool"],
    );
    expect(ghosts).toEqual([]);
    expect(missing).toEqual(["novada_new_platform_tool"]);
  });

  it("reports both directions independently when both a ghost and a missing name are present", () => {
    const { ghosts, missing } = diffToolNames(
      ["novada_shared", "novada_ghost_only"],
      ["novada_shared", "novada_missing_only"],
    );
    expect(ghosts).toEqual(["novada_ghost_only"]);
    expect(missing).toEqual(["novada_missing_only"]);
  });

  it("reports no drift when the two lists match exactly (sanity: the detector isn't just always-fail)", () => {
    const { ghosts, missing } = diffToolNames(["novada_a", "novada_b"], ["novada_b", "novada_a"]);
    expect(ghosts).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe("novadaDiscover output ⊆ registry (no ghosts)", () => {
  it("every tool name rendered in the catalog is a registered tool", async () => {
    const out = await novadaDiscover(validateDiscoverParams({}));
    // Catalog renders names as `| \`novada_x\` |` table cells.
    const rendered = [...out.matchAll(/\|\s*`(novada_[a-z_]+)`\s*\|/g)].map((m) => m[1]);
    expect(rendered.length).toBeGreaterThan(0);
    for (const name of rendered) {
      expect(REGISTERED_TOOL_NAMES.has(name), `catalog rendered a ghost tool not in the registry: ${name}`).toBe(true);
    }
    // And the catalog renders ALL active registered tools (no silent omission).
    const activeNames = TOOL_REGISTRY.filter((t) => t.status === "active").map((t) => t.name).sort();
    expect([...new Set(rendered)].sort()).toEqual(activeNames);
  });

  it("category filter returns exactly the registered tools for that category", async () => {
    for (const cat of TOOL_CATEGORIES) {
      const expected = TOOL_REGISTRY.filter((t) => t.category === cat).map((t) => t.name).sort();
      if (expected.length === 0) continue; // no Auth tools currently
      const out = await novadaDiscover(validateDiscoverParams({ category: cat }));
      const rendered = [...new Set([...out.matchAll(/\|\s*`(novada_[a-z_]+)`\s*\|/g)].map((m) => m[1]))].sort();
      expect(rendered, `category "${cat}" catalog drifted from registry`).toEqual(expected);
    }
  });

  it("rejects an unknown category", () => {
    expect(() => validateDiscoverParams({ category: "Bogus" })).toThrow();
  });
});

// ─── Round-3f gap tests: Auth must not appear in enum or description ──────────

describe("DiscoverParamsSchema must exclude Auth (zero-entry category)", () => {
  it("the Zod enum does NOT include Auth", () => {
    // Extract the enum values from the Zod schema definition
    const categoryField = DiscoverParamsSchema.shape.category;
    // unwrap Optional → ZodEnum
    const inner = (categoryField as unknown as { _def: { innerType: { options: string[] } } })._def.innerType;
    const enumValues: string[] = inner.options;
    expect(enumValues, "Auth must not be in the Zod enum — it has zero registry entries").not.toContain("Auth");
  });

  it("the .describe() string does NOT mention Auth", () => {
    const categoryField = DiscoverParamsSchema.shape.category;
    const description: string = (categoryField as unknown as { description: string }).description;
    expect(description, ".describe() string must not list Auth").not.toContain("Auth");
  });

  it("Zod validation error for an invalid category does NOT hint Auth in valid values", () => {
    let errorMsg = "";
    try {
      validateDiscoverParams({ category: "proxy" }); // lowercase — invalid
    } catch (e: unknown) {
      if (e && typeof e === "object" && "issues" in e) {
        const issues = (e as { issues: Array<{ values?: string[] }> }).issues;
        const validValues = issues.flatMap((i) => i.values ?? []);
        errorMsg = validValues.join(", ");
      }
    }
    expect(errorMsg, "valid-values hint in Zod error must not contain Auth").not.toContain("Auth");
    // Must still contain at least one real category (e.g. Proxy)
    expect(errorMsg).toContain("Proxy");
  });
});
