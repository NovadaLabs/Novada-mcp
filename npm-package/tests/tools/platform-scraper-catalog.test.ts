/**
 * Platform-scraper ↔ SCRAPER_CATALOG cross-check guard.
 *
 * Tools-v2: the platform-scraper factory (src/tools/platform_scraper.ts) will grow from
 * one config (Amazon, src/tools/scrape_amazon.ts) to 16 as the remaining per-platform
 * tools are added. Each config hand-maps a friendly `operation` name to a catalog
 * `scraper_id` (slug) in src/data/scraper_catalog.ts — a purely textual link that no
 * existing guard verifies. A typo'd slug, a slug for the wrong platform, or a slug that
 * IS real but is marked `backend_broken` in the catalog would all currently ship green:
 * scrape_amazon.test.ts only proves the wire format for the operations someone thought
 * to write a test for, and discover.test.ts / tool-definitions.test.ts / collision-matrix
 * only look at tool NAMES and SCHEMAS, never at what a resolved `operation` enum value
 * actually points at in the catalog.
 *
 * This suite closes that gap generically — across the WHOLE platform-scraper family via
 * `PLATFORM_SCRAPER_TOOLS` (never hardcoding "amazon"), so it automatically covers all 16
 * configs as they're added — by asserting, for every config's every operation:
 *   (a) `config.platform` is a real `domain` in SCRAPER_CATALOG.
 *   (b) the operation's `scraperId` exists as an operation `slug` under that platform.
 *   (c) that catalog op's `status === "ok"` — a `backend_broken` slug must never be
 *       reachable through a platform-scraper tool's closed enum.
 *   (d) (defensive) no two friendly operation names collide within one config, and every
 *       platform-scraper tool name is unique and starts with `novada_scrape_`.
 *
 * `checkConfigAgainstCatalog` is factored out and re-run against SYNTHETIC fixtures (a
 * fake platform never in the real catalog) in the self-check block below, mirroring the
 * "not-inert" proof pattern used by tests/tools/discover.test.ts's `diffToolNames`
 * self-check and tests/tools/collision-matrix.test.ts's scan-function self-checks: it
 * proves the checker actually FAILS on (i) a nonexistent scraperId, (ii) a backend_broken
 * scraperId, and (iii) a platform absent from the catalog — never touching the real
 * registry/catalog in that block.
 *
 * Why `tool.config` (not re-parsing ParamsSchema): the factory (src/tools/platform_scraper.ts)
 * exports each tool's raw `PlatformScraperConfig` — `{platform, operations: {friendly:
 * {scraperId, paramsDoc}}}` — directly on the `DispatchableScraperTool` returned by
 * `toDispatchableScraperTool()`. That's the single source of truth the handler itself
 * resolves `operation` against (see `handler()` in platform_scraper.ts), so checking it
 * directly is both simpler and exactly what a customer's call would actually hit.
 */
import { describe, it, expect } from "vitest";
import { PLATFORM_SCRAPER_TOOLS } from "../../src/tools/platform_scrapers.js";
import { SCRAPER_CATALOG, type CatalogPlatform } from "../../src/data/scraper_catalog.js";

// ─── Checker (generic — no platform name hardcoded) ────────────────────────────────────

interface CatalogCheckProblem {
  operationName: string;
  scraperId: string;
  issue: string;
}

/**
 * Cross-checks one platform-scraper config's operation -> scraperId map against the
 * catalog. Deliberately typed against the MINIMAL shape it needs (not the full
 * `PlatformScraperConfig`/`CatalogPlatform` interfaces) so it can be exercised against
 * hand-built synthetic fixtures in the self-check block without importing test-only
 * duplicates of those types.
 */
function checkConfigAgainstCatalog(
  config: { platform: string; operations: Record<string, { scraperId: string }> },
  catalog: readonly CatalogPlatform[],
): CatalogCheckProblem[] {
  const platformEntry = catalog.find((p) => p.domain === config.platform);
  if (!platformEntry) {
    return [
      {
        operationName: "*",
        scraperId: "*",
        issue: `platform "${config.platform}" is not a domain in SCRAPER_CATALOG`,
      },
    ];
  }

  const opsBySlug = new Map(platformEntry.ops.map((op) => [op.slug, op]));
  const problems: CatalogCheckProblem[] = [];
  for (const [operationName, opConfig] of Object.entries(config.operations)) {
    const catalogOp = opsBySlug.get(opConfig.scraperId);
    if (!catalogOp) {
      problems.push({
        operationName,
        scraperId: opConfig.scraperId,
        issue: `scraperId "${opConfig.scraperId}" is not an operation slug under platform "${config.platform}" in SCRAPER_CATALOG`,
      });
      continue;
    }
    if (catalogOp.status !== "ok") {
      problems.push({
        operationName,
        scraperId: opConfig.scraperId,
        issue: `scraperId "${opConfig.scraperId}" has catalog status "${catalogOp.status}" (must be "ok") — a dead/broken operation must never be reachable through a platform-scraper tool's closed enum`,
      });
    }
  }
  return problems;
}

// ─── Real registry checks — generic over the whole PLATFORM_SCRAPER_TOOLS family ───────

describe("platform-scraper configs ↔ SCRAPER_CATALOG (no dead/typo'd operations reach a customer)", () => {
  it("sanity: the platform-scraper family is non-empty and includes Amazon", () => {
    expect(PLATFORM_SCRAPER_TOOLS.length).toBeGreaterThan(0);
    expect(PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name)).toContain("novada_scrape_amazon");
  });

  it("every config's platform is a real domain in SCRAPER_CATALOG", () => {
    const bad = PLATFORM_SCRAPER_TOOLS
      .filter((t) => !SCRAPER_CATALOG.some((p) => p.domain === t.config.platform))
      .map((t) => `${t.toolDefinition.name}: platform "${t.config.platform}"`);
    expect(bad, `platform-scraper config(s) whose platform is not in SCRAPER_CATALOG:\n${bad.join("\n")}`).toEqual([]);
  });

  it("every operation's scraperId exists in the catalog AND is status 'ok' (no dead/typo'd operation ever exposed)", () => {
    const problems = PLATFORM_SCRAPER_TOOLS.flatMap((tool) =>
      checkConfigAgainstCatalog(tool.config, SCRAPER_CATALOG).map((p) => ({ tool: tool.toolDefinition.name, ...p })),
    );
    expect(
      problems,
      `catalog cross-check problem(s) — a customer could reach a nonexistent or backend_broken scraper:\n${JSON.stringify(problems, null, 2)}`,
    ).toEqual([]);
  });

  it("no two friendly operation names collide within a single config (defensive: JS object literals silently dedupe on a literal key collision)", () => {
    for (const tool of PLATFORM_SCRAPER_TOOLS) {
      const names = Object.keys(tool.config.operations);
      expect(new Set(names).size, `${tool.toolDefinition.name}: duplicate friendly operation name(s)`).toBe(names.length);
    }
  });

  it("every platform-scraper tool name is unique and starts with novada_scrape_", () => {
    const names = PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name);
    expect(new Set(names).size, `duplicate platform-scraper tool name(s): ${names.join(", ")}`).toBe(names.length);
    for (const name of names) {
      expect(name, `${name} does not follow the novada_scrape_<platform> naming convention`).toMatch(/^novada_scrape_/);
    }
  });
});

// ─── Self-check: proves checkConfigAgainstCatalog is not inert ─────────────────────────
//
// Synthetic fixtures ONLY — a fake platform/catalog that never touches the real
// SCRAPER_CATALOG or any real config, mirroring discover.test.ts's diffToolNames
// self-check and collision-matrix.test.ts's scan-function self-checks.

describe("checkConfigAgainstCatalog self-check (synthetic fixtures — proves the guard fires, not just green-by-accident)", () => {
  const fakeCatalog: CatalogPlatform[] = [
    {
      domain: "scratch.example.com",
      name: "Scratch",
      platform_id: 999,
      ops: [
        {
          slug: "scratch_op_ok",
          api_id: 1,
          api_name: "Scratch OK op",
          format: "params",
          params: [],
          status: "ok",
          verified: "2026-07-13",
        },
        {
          slug: "scratch_op_broken",
          api_id: 2,
          api_name: "Scratch broken op",
          format: "params",
          params: [],
          status: "backend_broken",
          broken_reason: "synthetic fixture — deliberately broken",
          verified: "2026-07-13",
        },
      ],
    },
  ];

  it("(i) flags a nonexistent scraperId (typo)", () => {
    const problems = checkConfigAgainstCatalog(
      { platform: "scratch.example.com", operations: { thing: { scraperId: "scratch_op_typo" } } },
      fakeCatalog,
    );
    expect(problems.length).toBe(1);
    expect(problems[0]!.issue).toMatch(/not an operation slug/);
  });

  it("(ii) flags a backend_broken scraperId", () => {
    const problems = checkConfigAgainstCatalog(
      { platform: "scratch.example.com", operations: { thing: { scraperId: "scratch_op_broken" } } },
      fakeCatalog,
    );
    expect(problems.length).toBe(1);
    expect(problems[0]!.issue).toMatch(/backend_broken/);
  });

  it("(iii) flags a platform not in the catalog", () => {
    const problems = checkConfigAgainstCatalog(
      { platform: "nonexistent.example.com", operations: { thing: { scraperId: "whatever" } } },
      fakeCatalog,
    );
    expect(problems.length).toBe(1);
    expect(problems[0]!.issue).toMatch(/is not a domain in SCRAPER_CATALOG/);
  });

  it("does NOT flag a valid, ok-status operation (no false positive)", () => {
    const problems = checkConfigAgainstCatalog(
      { platform: "scratch.example.com", operations: { thing: { scraperId: "scratch_op_ok" } } },
      fakeCatalog,
    );
    expect(problems).toEqual([]);
  });

  it("reports one problem PER bad operation, not just the first (multiple typo'd ops in one config)", () => {
    const problems = checkConfigAgainstCatalog(
      {
        platform: "scratch.example.com",
        operations: {
          a: { scraperId: "scratch_op_typo_a" },
          b: { scraperId: "scratch_op_ok" },
          c: { scraperId: "scratch_op_broken" },
        },
      },
      fakeCatalog,
    );
    expect(problems.length).toBe(2);
    expect(problems.map((p) => p.operationName).sort()).toEqual(["a", "c"]);
  });
});
