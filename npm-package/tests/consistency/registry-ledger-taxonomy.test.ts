/**
 * Registry `ledger` drift guard (C-7 / G-10 / G-12 audit, W-B4).
 *
 * W-B4 added a class-driven `ledger` field to every TOOL_REGISTRY row
 * (src/tools/registry.ts) — which billing ledger ("wallet" | "capture" | "mixed"
 * | "none") a tool call draws on. Unlike `title`/`group` (F-7/F-1, guarded by
 * tests/consistency/registry-title-group-partition.test.ts), `ledger` is declared
 * OPTIONAL at the TypeScript level on purpose: src/tools/platform_scraper.ts's
 * factory-built `registryEntry: ToolMeta` object literals predate this field and
 * are owned by a different concurrent worker in this audit (not touched here) —
 * making `ledger` required on the TYPE would break that file's compile. The 16
 * platform-scraper rows instead get `ledger` injected via `.map()` at the spread
 * site in registry.ts, and the 22 hand-authored rows set it directly.
 *
 * Because the type-level safety net (`required field fails the build`) does NOT
 * apply here, this file is the ONLY thing that would catch a 39th tool — or a
 * regression removing the `.map()` injection — shipping with no ledger stamped.
 * Every assertion below ITERATES TOOL_REGISTRY / LEDGER_TOOL_NAMES — no tool name
 * is hardcoded (class-not-instance), and the detector is proven to fire on
 * SYNTHETIC drift before it is trusted against the real registry (same
 * "not-inert" proof pattern as registry-title-group-partition.test.ts's
 * partitionCheck self-check).
 */
import { describe, it, expect } from "vitest";
import {
  TOOL_REGISTRY,
  TOOL_LEDGERS,
  LEDGER_TOOL_NAMES,
  LEDGER_EXPLAINER,
  type ToolLedger,
  type ToolMeta,
} from "../../src/tools/registry.js";

/**
 * Pure "every row has a valid ledger" check, factored out so it can be exercised
 * against a SYNTHETIC (fabricated) registry — including one row with `ledger`
 * left `undefined`, exactly the class of bug a 39th unrouted tool would
 * introduce — before trusting it against the real TOOL_REGISTRY.
 */
function findUnledgeredRows(
  rows: ReadonlyArray<Pick<ToolMeta, "name" | "ledger">>,
  validLedgers: readonly string[]
): { unassigned: string[]; invalid: Array<{ name: string; ledger: unknown }> } {
  const validSet = new Set(validLedgers);
  const unassigned: string[] = [];
  const invalid: Array<{ name: string; ledger: unknown }> = [];
  for (const row of rows) {
    if (row.ledger === undefined || row.ledger === null) {
      unassigned.push(row.name);
    } else if (!validSet.has(row.ledger)) {
      invalid.push({ name: row.name, ledger: row.ledger });
    }
  }
  return { unassigned, invalid };
}

describe("findUnledgeredRows self-check: the detector fires on injected drift (not inert)", () => {
  const validLedgers = ["wallet", "capture", "mixed", "none"];

  it("flags a row with `ledger` left undefined (the exact class of bug a 39th unrouted tool would introduce)", () => {
    const { unassigned, invalid } = findUnledgeredRows(
      [
        { name: "novada_a", ledger: "capture" },
        { name: "novada_b", ledger: undefined },
      ],
      validLedgers
    );
    expect(unassigned).toEqual(["novada_b"]);
    expect(invalid).toEqual([]);
  });

  it("flags a row with an invalid/typo'd ledger value", () => {
    const { unassigned, invalid } = findUnledgeredRows(
      [
        { name: "novada_a", ledger: "capture" },
        // @ts-expect-error — deliberately invalid value for the synthetic check
        { name: "novada_c", ledger: "wallett" },
      ],
      validLedgers
    );
    expect(unassigned).toEqual([]);
    expect(invalid).toEqual([{ name: "novada_c", ledger: "wallett" }]);
  });

  it("reports a fully-ledgered, valid synthetic registry as clean (sanity — the detector isn't just always-fail)", () => {
    const { unassigned, invalid } = findUnledgeredRows(
      [
        { name: "novada_a", ledger: "capture" },
        { name: "novada_b", ledger: "wallet" },
        { name: "novada_c", ledger: "none" },
        { name: "novada_d", ledger: "mixed" },
      ],
      validLedgers
    );
    expect(unassigned).toEqual([]);
    expect(invalid).toEqual([]);
  });
});

describe("every TOOL_REGISTRY entry has a valid `ledger` (C-7/G-10/G-12)", () => {
  it("no row is missing `ledger` — the exact non-inert proof: run the SAME checker against a registry snapshot with one row's ledger stripped, and confirm it fails first", () => {
    // Non-inert proof required by the audit brief: prove this check can fail
    // before trusting that it's green today for the right reason.
    const withOneStripped = TOOL_REGISTRY.map((t, i) =>
      i === 0 ? { ...t, ledger: undefined } : t
    );
    const stripped = findUnledgeredRows(withOneStripped, TOOL_LEDGERS);
    expect(
      stripped.unassigned,
      "sanity check itself is broken — stripping a ledger did not get flagged"
    ).toEqual([withOneStripped[0].name]);

    // Now the REAL assertion against the actual, unmodified registry.
    const real = findUnledgeredRows(TOOL_REGISTRY, TOOL_LEDGERS);
    expect(real.unassigned, `tool(s) with no ledger assigned: ${real.unassigned.join(", ")}`).toEqual([]);
    expect(
      real.invalid,
      `tool(s) with an invalid ledger value: ${real.invalid.map((r) => `${r.name}=${String(r.ledger)}`).join(", ")}`
    ).toEqual([]);
  });

  it("covers all 38 registered tools (guards against an empty-import false pass)", () => {
    expect(TOOL_REGISTRY.length).toBe(38);
  });

  it("ledger values sum to the full registry length (no double-counting, no gaps)", () => {
    const sum = TOOL_LEDGERS.reduce((acc, l) => acc + LEDGER_TOOL_NAMES[l].length, 0);
    expect(sum).toBe(TOOL_REGISTRY.length);
  });

  it("every TOOL_REGISTRY row's own `.ledger` matches LEDGER_TOOL_NAMES membership (single-field is internally consistent with the derived table)", () => {
    const offenders = TOOL_REGISTRY.filter(
      (t) => !t.ledger || !LEDGER_TOOL_NAMES[t.ledger as ToolLedger]?.includes(t.name)
    ).map((t) => `${t.name} (ledger=${String(t.ledger)})`);
    expect(offenders, `registry row .ledger disagrees with derived LEDGER_TOOL_NAMES: ${offenders.join(", ")}`).toEqual([]);
  });

  it("at least one tool is stamped for every ledger value except possibly the rarest (sanity: taxonomy isn't collapsed to one bucket)", () => {
    for (const l of TOOL_LEDGERS) {
      expect(LEDGER_TOOL_NAMES[l].length, `no tool uses ledger "${l}" — is the taxonomy still meaningful?`).toBeGreaterThan(0);
    }
  });
});

describe("class-not-instance: every platform scraper inherits ledger:\"capture\" from ONE injection site, not per-tool", () => {
  it("all 16 scraper-group tools (novada_scrape + 15 pinned platforms) are ledger:\"capture\"", () => {
    const scraperNames = LEDGER_TOOL_NAMES.capture;
    // novada_scrape itself + the 15 factory-generated platform scrapers all
    // route through scrape.ts's SCRAPER_API_BASE — confirm they're ALL present
    // under the "capture" bucket (not asserting the exact list, so a 17th
    // platform is covered automatically without editing this test).
    const platformScraperCount = TOOL_REGISTRY.filter((t) => t.group === "scrapers").length;
    const captureScraperCount = TOOL_REGISTRY.filter(
      (t) => t.group === "scrapers" && t.ledger === "capture"
    ).length;
    expect(platformScraperCount).toBeGreaterThan(10); // sanity: didn't import an empty list
    expect(captureScraperCount).toBe(platformScraperCount);
    expect(scraperNames).toContain("novada_scrape");
  });
});

describe("LEDGER_EXPLAINER covers every ToolLedger value with non-empty copy", () => {
  it("has a non-empty explainer string for each of wallet/capture/mixed/none", () => {
    for (const l of TOOL_LEDGERS) {
      expect(typeof LEDGER_EXPLAINER[l]).toBe("string");
      expect(LEDGER_EXPLAINER[l].trim().length, `LEDGER_EXPLAINER["${l}"] is empty`).toBeGreaterThan(0);
    }
  });
});
