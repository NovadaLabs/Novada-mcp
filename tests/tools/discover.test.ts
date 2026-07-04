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
import { PROXY_ALIAS_MAP } from "../../src/tools/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract the tool names declared in the `TOOLS = [ ... ]` array in src/index.ts.
 * This is the server's authoritative ListTools surface. We slice from `const TOOLS = [`
 * to the first top-level `];` so we never pick up names from other arrays (CATEGORY_MAP
 * values, the --help block, etc.).
 */
function readWiredToolNames(): string[] {
  const indexPath = resolve(__dirname, "../../src/index.ts");
  const src = readFileSync(indexPath, "utf8");
  const start = src.indexOf("const TOOLS = [");
  expect(start, "could not locate `const TOOLS = [` in src/index.ts").toBeGreaterThan(-1);
  const end = src.indexOf("\n];", start);
  expect(end, "could not locate end of TOOLS array in src/index.ts").toBeGreaterThan(start);
  const block = src.slice(start, end);
  const names = [...block.matchAll(/name:\s*"(novada_[a-z_]+)"/g)].map((m) => m[1]);
  return names;
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
    // 0.9.4: backward-compat aliases are intentionally WIRED (old callers still work)
    // but NOT registered (removed from tools/list to shrink the surface). Exclude them.
    const ALIAS_NAMES = new Set<string>([
      ...Object.keys(PROXY_ALIAS_MAP),  // novada_proxy_residential/isp/datacenter/mobile/static/dedicated
      "novada_health_all",              // → novada_account(section="summary")
      "novada_scraper_submit",          // → novada_scrape (sync inline)
      "novada_scraper_status",          // → benign ok (async flow removed)
      "novada_scraper_result",          // → benign ok
      "novada_scraper_task_mgmt",       // → benign ok
      "novada_verify",                  // 0.9.8: cut from tools/list (low value + verdict-quality issues); handler kept functional (hidden), no error for old callers
      // 0.9.9: folded into novada_account — hidden from list, aliases still work
      "novada_wallet_balance",          // → novada_account(section="balance")
      "novada_wallet_usage_record",     // → novada_account(section="usage")
      "novada_plan_balance_all",        // → novada_account(section="plans")
      "novada_traffic_daily",           // → novada_account(section="traffic")
      "novada_capture_logs",            // → novada_account(section="summary")
      "novada_account_summary",         // → novada_account(section="summary")
      "novada_health",                  // → novada_account(section="summary")
      "novada_unblock",                 // Phase-3 fold → novada_extract(format:"html", render mapped from method)
    ]);
    const wiredSet = new Set(wiredNames.filter((n) => !ALIAS_NAMES.has(n)));
    const registrySet = new Set(registryNames);

    const ghosts = [...registrySet].filter((n) => !wiredSet.has(n)); // in registry, not wired
    const missing = [...wiredSet].filter((n) => !registrySet.has(n)); // wired (non-alias), not in registry

    expect(ghosts, `registry lists tools that are NOT wired in src/index.ts TOOLS: ${ghosts.join(", ")}`).toEqual([]);
    expect(missing, `src/index.ts wires tools missing from TOOL_REGISTRY: ${missing.join(", ")}`).toEqual([]);
    // Exact set equality (order-independent), aliases excluded.
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
