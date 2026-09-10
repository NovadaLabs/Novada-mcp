/**
 * F9 — shared empty-result honesty guard (battery 2026-09-10, P1-3 status-lie class).
 *
 * CONFIRMED live on hosted 0.9.37: novada_scrape_instagram / _facebook / _walmart returned
 * 0 records as a plain "status: ok" / isError:false (previously observed on youtube and
 * linkedin — per-instance fixes kept missing members of the class). Class fix: novadaScrape
 * (src/tools/scrape.ts) — the ONE engine every platform-scraper tool and the generic
 * novada_scrape funnel through — now classifies every 0-record outcome as
 * `status: empty_result` (never plain ok) with an agent_instruction that names both
 * hypotheses: (a) the target genuinely has no matching data, (b) the upstream returned
 * nothing (extraction failure surfaced as an empty payload), weighted by the upstream
 * signal where one exists.
 *
 * COVERAGE AS A TABLE-ROW SWEEP: the main suite enumerates EVERY tool in
 * PLATFORM_SCRAPER_TOOLS × EVERY friendly operation in its config (params derived from
 * SCRAPER_CATALOG so preflight passes generically). A 16th platform config pushed into
 * PLATFORM_SCRAPER_TOOLS is swept automatically — new coverage is a new ROW, never a new
 * hand-written test. The generic novada_scrape path is asserted separately (it shares the
 * same engine, but has no config row to enumerate).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { PLATFORM_SCRAPER_TOOLS } = await import("../../src/tools/platform_scrapers.js");
const { novadaScrape } = await import("../../src/tools/scrape.js");
const { CATALOG_BY_DOMAIN } = await import("../../src/data/scraper_catalog.js");

// ─── The three observed 0-record wire shapes ────────────────────────────────────────────

/** Submit-level explicit empty: { code:0, data:{ code:400, data:null, msg:"serp returns empty" } }.
 *  This is the exact shape behind the hosted "status: ok" + "_No results found_" envelope the
 *  battery flagged on instagram/facebook/walmart (see shein's verbatim evidence row). */
const SUBMIT_EXPLICIT_EMPTY = {
  data: { code: 0, data: { code: 400, data: null, msg: "serp returns empty" }, msg: "success" },
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

/** Submit resolves to a task_id; the download endpoint then returns a LITERALLY EMPTY array —
 *  zero items, no explicit "no results" signal at all. */
const SUBMIT_TASK_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "empty-sweep-task-1" }, msg: "success" }, msg: "success" },
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};
const DOWNLOAD_EMPTY_ARRAY = {
  data: [],
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

/** Download returns a wrapped item whose `rest` contains an empty records array — items
 *  present, but zero recognizable records inside. */
const DOWNLOAD_WRAPPED_EMPTY_RECORDS = {
  data: [{ spider_code: 200, rest: { results: [] } }],
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

/**
 * Build a params object that passes preflightScrape for (platform, scraperId), derived
 * generically from the catalog (single source of truth): every catalog param key is
 * supplied (satisfies "all" mode, "any" mode, and extraAll alike), preferring the
 * catalog's own dflt example value. `url` fallback covers any op with an empty param
 * list (buildOpMapFromCatalog's own fallback key).
 */
function preflightSatisfyingParams(platform: string, scraperId: string): Record<string, unknown> {
  const catalogOp = CATALOG_BY_DOMAIN.get(platform)?.get(scraperId);
  // `q` covers search-engine ops whose accepted query aliases (q/keyword/query, see
  // SEARCH_ENGINE_OP_KEYS in scrape.ts) are not all present as catalog param rows
  // (e.g. bing_news); `url` covers any op with an empty catalog param list
  // (buildOpMapFromCatalog's own fallback key). Extra keys are harmless passthrough
  // on a mocked wire.
  const params: Record<string, unknown> = { url: "https://example.com/x", q: "test-query" };
  for (const p of catalogOp?.params ?? []) {
    params[p.key] = p.dflt && p.dflt.trim().length > 0 ? p.dflt : "test-value";
  }
  return params;
}

/** Assertions shared by every sweep row: classified, never plain ok, both-hypotheses guidance. */
function expectEmptyResultEnvelope(result: string) {
  expect(result).toContain("## Scrape Results");
  expect(result).toContain("records: 0");
  expect(result).toContain("status: empty_result");
  expect(result).not.toContain("status: ok");
  expect(result).toContain("agent_instruction:");
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Table-row sweep: EVERY platform tool × EVERY operation inherits the guard ─────────

interface SweepCase {
  toolName: string;
  platform: string;
  opName: string;
  scraperId: string;
}

const SWEEP_CASES: SweepCase[] = PLATFORM_SCRAPER_TOOLS.flatMap((tool) =>
  Object.entries(tool.config.operations).map(([opName, opCfg]) => ({
    toolName: tool.toolDefinition.name,
    platform: tool.config.platform,
    opName,
    scraperId: opCfg.scraperId,
  })),
);

const TOOL_BY_NAME = new Map(PLATFORM_SCRAPER_TOOLS.map((t) => [t.toolDefinition.name, t]));

describe("F9 sweep — every platform tool × every operation classifies 0 records as empty_result (never plain ok)", () => {
  it("sweep is non-vacuous and enumerates the ENTIRE platform-scraper family (a future scraper config is swept automatically)", () => {
    expect(PLATFORM_SCRAPER_TOOLS.length).toBeGreaterThanOrEqual(15);
    const sweptTools = new Set(SWEEP_CASES.map((c) => c.toolName));
    expect([...sweptTools].sort()).toEqual(
      PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name).sort(),
    );
    // Every tool contributes at least one operation row.
    expect(SWEEP_CASES.length).toBeGreaterThanOrEqual(PLATFORM_SCRAPER_TOOLS.length);
  });

  it.each(SWEEP_CASES)(
    "$toolName / $opName: upstream explicit-empty submit → status: empty_result",
    async ({ toolName, platform, opName, scraperId }) => {
      mockedAxios.post.mockResolvedValue(SUBMIT_EXPLICIT_EMPTY);
      const tool = TOOL_BY_NAME.get(toolName)!;
      const result = await tool.dispatch(
        { operation: opName, params: preflightSatisfyingParams(platform, scraperId) },
        "test-key",
      );
      expectEmptyResultEnvelope(result);
      // The friendly operation name (what the caller typed) is echoed, per the C1 contract.
      expect(result).toContain(`operation: ${opName}`);
      // Explicit upstream signal → the envelope says the backend itself reported empty…
      expect(result).toContain("empty_signal: upstream_explicit_empty");
      // …but the upstream-failure hypothesis is still stated (honesty direction: when in
      // doubt, never plain ok, both hypotheses on the table).
      expect(result.toLowerCase()).toContain("cannot be fully ruled out");
    },
  );

  it.each(PLATFORM_SCRAPER_TOOLS.map((t) => {
    const [opName, opCfg] = Object.entries(t.config.operations)[0]!;
    return { toolName: t.toolDefinition.name, platform: t.config.platform, opName, scraperId: opCfg.scraperId };
  }))(
    "$toolName / $opName: bare empty download array (no upstream signal) → empty_result with BOTH hypotheses",
    async ({ toolName, platform, opName, scraperId }) => {
      mockedAxios.post.mockResolvedValue(SUBMIT_TASK_OK);
      mockedAxios.get.mockResolvedValue(DOWNLOAD_EMPTY_ARRAY);
      const tool = TOOL_BY_NAME.get(toolName)!;
      const result = await tool.dispatch(
        { operation: opName, params: preflightSatisfyingParams(platform, scraperId) },
        "test-key",
      );
      expectEmptyResultEnvelope(result);
      expect(result).toContain("empty_signal: empty_download");
      // Both hypotheses stated, explicitly NOT confirmation of absence.
      expect(result.toLowerCase()).toContain("genuinely has no");
      expect(result.toLowerCase()).toContain("upstream");
      expect(result).toContain("Do not treat this as confirmation");
    },
  );

  it.each(PLATFORM_SCRAPER_TOOLS.map((t) => {
    const [opName, opCfg] = Object.entries(t.config.operations)[0]!;
    return { toolName: t.toolDefinition.name, platform: t.config.platform, opName, scraperId: opCfg.scraperId };
  }))(
    "$toolName / $opName: wrapped payload with zero extractable records → empty_result with BOTH hypotheses",
    async ({ toolName, platform, opName, scraperId }) => {
      mockedAxios.post.mockResolvedValue(SUBMIT_TASK_OK);
      mockedAxios.get.mockResolvedValue(DOWNLOAD_WRAPPED_EMPTY_RECORDS);
      const tool = TOOL_BY_NAME.get(toolName)!;
      const result = await tool.dispatch(
        { operation: opName, params: preflightSatisfyingParams(platform, scraperId) },
        "test-key",
      );
      expectEmptyResultEnvelope(result);
      expect(result).toContain("empty_signal: no_records_extracted");
      expect(result).toContain("Do not treat this as confirmation");
    },
  );
});

// ─── Observed battery fixtures (2026-09-10 run): instagram / facebook / walmart ────────

describe("F9 observed fixtures — the three hosted-0.9.37 FAIL rows now classify empty_result", () => {
  function observedCase(toolName: string) {
    const tool = TOOL_BY_NAME.get(toolName);
    expect(tool, `${toolName} missing from PLATFORM_SCRAPER_TOOLS`).toBeDefined();
    const [opName, opCfg] = Object.entries(tool!.config.operations)[0]!;
    return { tool: tool!, opName, params: preflightSatisfyingParams(tool!.config.platform, opCfg.scraperId) };
  }

  it("novada_scrape_instagram: 0-record explicit-empty response is empty_result, not status: ok", async () => {
    const { tool, opName, params } = observedCase("novada_scrape_instagram");
    mockedAxios.post.mockResolvedValue(SUBMIT_EXPLICIT_EMPTY);
    const result = await tool.dispatch({ operation: opName, params }, "test-key");
    expectEmptyResultEnvelope(result);
  });

  it("novada_scrape_facebook: 0-record empty-download response is empty_result, not status: ok", async () => {
    const { tool, opName, params } = observedCase("novada_scrape_facebook");
    mockedAxios.post.mockResolvedValue(SUBMIT_TASK_OK);
    mockedAxios.get.mockResolvedValue(DOWNLOAD_EMPTY_ARRAY);
    const result = await tool.dispatch({ operation: opName, params }, "test-key");
    expectEmptyResultEnvelope(result);
  });

  it("novada_scrape_walmart: 0-record wrapped-empty response is empty_result, not status: ok", async () => {
    const { tool, opName, params } = observedCase("novada_scrape_walmart");
    mockedAxios.post.mockResolvedValue(SUBMIT_TASK_OK);
    mockedAxios.get.mockResolvedValue(DOWNLOAD_WRAPPED_EMPTY_RECORDS);
    const result = await tool.dispatch({ operation: opName, params }, "test-key");
    expectEmptyResultEnvelope(result);
  });
});

// ─── The generic novada_scrape path shares the same guard (same engine, no config row) ──

describe("F9 — generic novada_scrape inherits the same shared guard", () => {
  it("explicit-empty submit → empty_result", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_EXPLICIT_EMPTY);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_asin", params: { asin: "B09XYZ" }, format: "markdown", limit: 20 },
      "test-key",
    );
    expectEmptyResultEnvelope(result);
    // Back-compat: the human-readable phrase existing consumers pin stays present.
    expect(result).toContain("No results found");
  });

  it("empty download array → empty_result", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_TASK_OK);
    mockedAxios.get.mockResolvedValue(DOWNLOAD_EMPTY_ARRAY);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_asin", params: { asin: "B09XYZ" }, format: "markdown", limit: 20 },
      "test-key",
    );
    expectEmptyResultEnvelope(result);
    expect(result).toContain("No records returned");
  });

  it("wrapped zero-record payload → empty_result", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_TASK_OK);
    mockedAxios.get.mockResolvedValue(DOWNLOAD_WRAPPED_EMPTY_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_asin", params: { asin: "B09XYZ" }, format: "markdown", limit: 20 },
      "test-key",
    );
    expectEmptyResultEnvelope(result);
    expect(result).toContain("No records returned");
  });
});
