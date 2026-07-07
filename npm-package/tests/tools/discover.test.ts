/**
 * Discover catalog drift guards.
 *
 * The discover catalog is DERIVED from the canonical TOOL_REGISTRY (src/tools/registry.ts),
 * and the server's wired tool list lives in the `TOOLS` array in src/index.ts. These tests
 * fail loudly the moment any of those three drift apart:
 *
 *   1. TOOL_REGISTRY names === src/index.ts TOOLS names      (exact set — no ghosts, no omissions)
 *   2. Every registry entry has a valid category + status     (typed metadata integrity)
 *   3. The rendered discover catalog ⊆ TOOL_REGISTRY          (no ghost tools surface to agents)
 *   4. Category filtering returns exactly the registered tools for that category
 *
 * Why read src/index.ts as TEXT instead of importing it: index.ts constructs and runs the
 * MCP server at module top-level (`new NovadaMCPServer(); server.run()`). Importing it would
 * boot a stdio server inside the test process. Parsing the file text is side-effect-free.
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

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract the tool names declared in the `_TOOL_DEFINITIONS = [ ... ]` array in src/core.ts.
 * This is the FULL dispatch-capable set (visible + hidden). The exported `TOOLS` array
 * is derived from this by filtering to REGISTERED_TOOL_NAMES — so the structural invariant
 * is: every registry name has a _TOOL_DEFINITIONS entry (no ghost schemas) and the test
 * asserts wiredNames === registryNames after that filter is applied implicitly by the derive.
 *
 * We read source text (not import) to avoid booting the MCP server.
 */
function readWiredToolNames(): string[] {
  const indexPath = resolve(__dirname, "../../src/core.ts");
  const src = readFileSync(indexPath, "utf8");
  // _TOOL_DEFINITIONS contains ALL dispatchable tool schemas; TOOLS derives from it.
  // We want the names that TOOLS will expose: those in both _TOOL_DEFINITIONS AND the registry.
  // Rather than re-implementing the filter here, read _TOOL_DEFINITIONS names and the test
  // assertion will compare against registryNames directly (exact equality).
  const start = src.indexOf("const _TOOL_DEFINITIONS");
  expect(start, "could not locate `const _TOOL_DEFINITIONS` in src/core.ts").toBeGreaterThan(-1);
  const end = src.indexOf("\n];", start);
  expect(end, "could not locate end of _TOOL_DEFINITIONS array in src/core.ts").toBeGreaterThan(start);
  const block = src.slice(start, end);
  const allDefinedNames = [...block.matchAll(/name:\s*"(novada_[a-z_]+)"/g)].map((m) => m[1]);
  // Mirror the core.ts filter: only names in the registry are exported as TOOLS.
  // This makes this parser match EXACTLY what TOOLS.filter(REGISTERED_TOOL_NAMES) produces.
  const registrySet = new Set(TOOL_REGISTRY.map((t) => t.name));
  return allDefinedNames.filter((n) => registrySet.has(n));
}

describe("discover catalog ↔ registry ↔ wired TOOLS", () => {
  const wiredNames = readWiredToolNames();
  const registryNames = TOOL_REGISTRY.map((t) => t.name);

  it("the test can locate the wired TOOLS array (sanity)", () => {
    expect(wiredNames.length).toBeGreaterThan(20);
    expect(wiredNames).toContain("novada_search");
    expect(wiredNames).toContain("novada_discover");
  });

  it("registry names EXACTLY match the wired TOOLS names (fails loudly on drift)", () => {
    // TOW2-256: TOOLS now DERIVES from REGISTERED_TOOL_NAMES — the filter in core.ts
    // means dispatch-only aliases (proxy variants, scraper stubs, novada_verify, etc.)
    // are NOT in the wired TOOLS array at all. No alias exclusion needed here: the
    // invariant is simply wiredNames === registryNames (exact set equality).
    //
    // Structural guarantee: adding a name to _TOOL_DEFINITIONS without also adding it
    // to TOOL_REGISTRY keeps it hidden automatically. The reverse — adding to registry
    // without a definition — surfaces it as an empty schema, which is caught by the
    // "every wired tool is in registry" direction of this assertion.
    const wiredSet = new Set(wiredNames);
    const registrySet = new Set(registryNames);

    const ghosts = [...registrySet].filter((n) => !wiredSet.has(n)); // in registry, not wired
    const missing = [...wiredSet].filter((n) => !registrySet.has(n)); // wired, not in registry

    expect(ghosts, `registry lists tools NOT present in src/core.ts TOOLS (add definition or remove from registry): ${ghosts.join(", ")}`).toEqual([]);
    expect(missing, `src/core.ts TOOLS includes tools missing from TOOL_REGISTRY (add to registry or remove from _TOOL_DEFINITIONS): ${missing.join(", ")}`).toEqual([]);
    // Exact set equality (order-independent). No alias filtering needed — TOOLS is derived.
    expect([...registrySet].sort()).toEqual([...wiredSet].sort());
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
    const EXPECTED_CURATED_COUNT = 23;
    expect(
      TOOL_REGISTRY.length,
      `registry size changed — update EXPECTED_CURATED_COUNT and every README/SKILL count to ${TOOL_REGISTRY.length}`
    ).toBe(EXPECTED_CURATED_COUNT);

    const readmePath = resolve(__dirname, "../../README.md");
    const readme = readFileSync(readmePath, "utf8");
    expect(
      readme,
      `README must state "${EXPECTED_CURATED_COUNT} curated tools" (derived from registry) — not a stale hand-count`
    ).toContain(`${EXPECTED_CURATED_COUNT} curated tools`);
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
