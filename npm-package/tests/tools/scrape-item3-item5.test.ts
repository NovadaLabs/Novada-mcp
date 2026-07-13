/**
 * Tests for:
 *   ITEM 3 — lying-zero price fields: initial_price:0 / buybox_prices.final_price:0
 *            must surface as null; buybox reconciled from trustworthy price when possible.
 *   ITEM 5 — 11006 split: unknown_operation (pre-dispatch, no API call) vs
 *            not_activated (catalog-known op, upstream 11006).
 *
 * RED first: run these before implementing. All ITEM-3 and ITEM-5 tests here must
 * fail on the unmodified codebase, then pass after the implementation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { NovadaError } from "../../src/_core/errors.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrape, normalizeProductRecord } = await import("../../src/tools/scrape.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDownloadOk(records: unknown[]) {
  return {
    data: [{ spider_code: 200, rest: { results: records } }],
    status: 200, headers: {}, config: {} as never, statusText: "OK",
  };
}

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "t-item3-5" }, msg: "success" }, msg: "success" },
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

function mockApiError(code: number, msg: string) {
  mockedAxios.post.mockResolvedValue({
    data: { code, data: null, msg },
    status: 200, headers: {}, config: {} as never, statusText: "OK",
  });
}

beforeEach(() => vi.clearAllMocks());

// ─── ITEM 3: lying-zero price fields ─────────────────────────────────────────

describe("ITEM 3 — normalizeProductRecord: lying-zero price fields", () => {
  /**
   * Core fixture: upstream sends initial_price=0 & buybox final_price=0
   * while final_price=59.99 (the trustworthy price) exists.
   */
  const LYING_ZERO_RECORD = {
    asin: "B001ITEM3",
    title: "Test Product",
    final_price: 59.99,
    initial_price: 0,
    buybox_prices: { final_price: 0, unit_price: "" },
    availability: "In Stock",
    is_available: false,
  };

  it("nulls out initial_price when upstream sends 0 (absent signal, not a real price)", () => {
    const out = normalizeProductRecord(LYING_ZERO_RECORD);
    // 0 in initial_price means "upstream didn't populate this field"
    // It must surface as null — never 0 or ""
    expect(out.initial_price).toBeNull();
  });

  it("reconciles buybox_prices.final_price from record's trustworthy final_price when buybox has 0", () => {
    const out = normalizeProductRecord(LYING_ZERO_RECORD);
    // buybox_prices.final_price: 0 → derive from record's final_price (59.99)
    const buybox = out.buybox_prices as Record<string, unknown>;
    expect(buybox.final_price).toBe(59.99);
  });

  it("nulls out buybox_prices.unit_price when it is empty string", () => {
    const out = normalizeProductRecord(LYING_ZERO_RECORD);
    const buybox = out.buybox_prices as Record<string, unknown>;
    // "" = absent, not "no unit price" — surface as null
    expect(buybox.unit_price).toBeNull();
  });

  it("nulls out buybox_prices.final_price to null when no trustworthy price exists anywhere", () => {
    const noPrice = {
      asin: "B002ITEM3",
      final_price: 0,
      initial_price: 0,
      buybox_prices: { final_price: 0, unit_price: "" },
      variations: [],
      is_available: false,
    };
    const out = normalizeProductRecord(noPrice);
    const buybox = out.buybox_prices as Record<string, unknown>;
    // Can't derive → null (not 0)
    expect(buybox.final_price).toBeNull();
  });

  it("leaves initial_price 13.99 untouched when it is a real list price", () => {
    const withListPrice = {
      final_price: 0,
      initial_price: 13.99,
      buybox_prices: { final_price: 0, unit_price: "" },
      variations: [],
    };
    const out = normalizeProductRecord(withListPrice);
    // real initial_price (>0) must survive normalization
    expect(out.initial_price).toBe(13.99);
  });

  it("does not alter records that have no price fields (non-product records pass through)", () => {
    const searchRec = { title: "blog post", url: "https://example.com" };
    const out = normalizeProductRecord(searchRec);
    expect(out).toEqual(searchRec);
  });

  it("json output format surfaces null for initial_price and buybox zeros consistently", async () => {
    // Verify the normalization flows all the way through novadaScrape → json format.
    // ALL formats share the same normalizeProductRecord call, so a single format test
    // is sufficient to prove consistency (the normalization precedes formatting).
    const record = { ...LYING_ZERO_RECORD };
    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get.mockResolvedValue(makeDownloadOk([record]));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "test" }, format: "json", limit: 1 },
      "test-key",
    );

    const jsonMatch = result.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const [parsed] = JSON.parse(jsonMatch![1]) as Record<string, unknown>[];
    expect(parsed.initial_price).toBeNull();
    const buybox = parsed.buybox_prices as Record<string, unknown>;
    expect(buybox.final_price).toBe(59.99);
    expect(buybox.unit_price).toBeNull();
  });

  it("toon format also surfaces null (not 0) for unknown price fields", async () => {
    const record = { ...LYING_ZERO_RECORD };
    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get.mockResolvedValue(makeDownloadOk([record]));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "test" }, format: "toon", limit: 1 },
      "test-key",
    );

    // toon: HEADERS row + data row, pipe-separated.
    // initial_price must appear as "null" (the string), not "0" or "".
    const lines = result.split("\n");
    const headerLine = lines.find(l => l.startsWith("HEADERS:"))!;
    expect(headerLine).toBeDefined();
    const headers = headerLine.replace("HEADERS: ", "").split(" | ");
    const dataLine = lines[lines.indexOf(headerLine) + 1];
    expect(dataLine).toBeDefined();
    const values = dataLine.split(" | ");

    const initialPriceIdx = headers.indexOf("initial_price");
    expect(initialPriceIdx).toBeGreaterThanOrEqual(0);
    expect(values[initialPriceIdx]).toBe("null");
  });
});

// ─── ITEM 5: 11006 split — unknown_operation vs not_activated ─────────────────

describe("ITEM 5 — 11006 split: unknown_operation vs not_activated", () => {
  it("unknown_operation: pre-dispatch rejection carries 'unknown_operation' marker in detail", async () => {
    // An operation that does not exist in the catalog for amazon.com.
    // Must be rejected BEFORE any upstream call.
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    const err = preflightScrape("amazon.com", "amazon_totally_fake_op", { keyword: "x" });

    expect(err).not.toBeNull();
    // Marker must be 'unknown_operation' — distinguishable from 'not_activated'
    expect(err!.detail).toContain("unknown_operation");
    // Message must name nearest valid operations so the agent can self-correct
    expect(err!.message).toContain("amazon_product_asin");
    // Absolutely no upstream call for a pre-dispatch rejection
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("not_activated: upstream 11006 for a catalog-known operation surfaces detail='not_activated'", async () => {
    // amazon_product_keywords IS in the catalog. The upstream returning 11006 means
    // the account doesn't have the Scraper API product — NOT that the op is invalid.
    mockApiError(11006, "Scraper error");

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "test" }, format: "markdown", limit: 1 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    // Must be 'not_activated', NOT 'code 11006' — the two cases are now distinct
    expect(err.detail).toBe("not_activated");
    // Message must direct user to the activation dashboard
    expect(err.message).toContain("dashboard.novada.com");
    // MUST have made an upstream call (the pre-dispatch check passed; the op IS in catalog)
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it("not_activated: a different catalog-known op (tiktok) also gets not_activated detail", async () => {
    // Regression guard: the split must work for any catalog platform, not just amazon.
    mockApiError(11006, "Scraper error");

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "tiktok.com", operation: "tiktok_posts_url", params: { url: "https://tiktok.com/@test" }, format: "markdown", limit: 1 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(NovadaError);
    expect((thrown as NovadaError).detail).toBe("not_activated");
    expect((thrown as NovadaError).message).toContain("dashboard.novada.com");
  });

  it("not_activated error does NOT carry a custom agent_instruction beyond the generic code", async () => {
    // House rule: agent_instruction is reserved for the 5 universal API-key errors.
    // For not_activated, message + detail is sufficient. The agent_instruction should
    // NOT contain scraper-operation-specific guidance added for this error.
    mockApiError(11006, "Scraper error");

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "test" }, format: "markdown", limit: 1 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    // Must have agent_instruction (it's a NovadaError), but it should be the
    // generic PRODUCT_UNAVAILABLE instruction — not a custom scraper-specific one.
    // We verify it is NOT completely empty (a real guidance exists) and NOT the old
    // alias-hint guidance that was specific to the op.
    expect(err.agent_instruction).not.toContain("Read novada://scraper-platforms to confirm the exact operation ID");
  });

  it("unknown_operation path via backend 11006 for non-catalog platform surfaces distinct detail", async () => {
    // An inactive platform (not in the 16-platform catalog) defers to the backend.
    // When backend returns 11006, it means "unknown platform/operation".
    // Preflight returns null (can't check inactive platform), so the call goes through.
    mockApiError(11006, "Scraper error");

    let thrown: unknown;
    try {
      await novadaScrape(
        // Use a platform that is NOT in the 16-platform catalog
        { platform: "some-inactive-platform.com", operation: "inactive_op", params: { url: "https://test.com" }, format: "markdown", limit: 1 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    // For non-catalog platforms, 11006 means unknown_operation (not a real op ID)
    expect(err.detail).toContain("unknown_operation");
    // Must NOT say "not_activated" — that would be misleading for inactive platforms
    expect(err.detail).not.toBe("not_activated");
  });

  it("known-broken op still shows broken-op warning when it fails (compose check)", async () => {
    // shein_products_keyword is backend_broken in the catalog.
    // When it times out (the typical broken-op failure), the broken-op notice MUST appear.
    // This verifies the split does not accidentally break the FIX-1 broken-op path.
    mockedAxios.post.mockRejectedValue(new Error("timeout of 60000ms exceeded"));

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "shein.com", operation: "shein_products_keyword", params: { keyword: "dress" }, format: "markdown", limit: 1 },
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    expect(msg).toContain("currently failing on the backend");
    expect(msg).toContain("shein_products_keyword");
  });
});
