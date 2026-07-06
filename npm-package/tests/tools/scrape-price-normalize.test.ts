import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrape, normalizeProductRecord } = await import("../../src/tools/scrape.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
// Real (sanitized) upstream Amazon records captured live 2026-07-06 (TOW2-237):
// flat final_price=0, is_available=false, real price lives in variations[].price
// (or buybox unit_price when a listing has no variations).
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/amazon-keywords-price-bug.json"), "utf8"),
) as Record<string, unknown>[];

function makeDownloadOk(records: unknown[]) {
  return {
    data: [{ spider_code: 200, rest: { results: records } }],
    status: 200, headers: {}, config: {} as never, statusText: "OK",
  };
}
const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "t-price" }, msg: "success" }, msg: "success" },
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

beforeEach(() => vi.clearAllMocks());

describe("normalizeProductRecord — TOW2-237 price + availability reconciliation", () => {
  it("reproduces the bug in the raw fixture (guards against a stale fixture)", () => {
    // Ground truth: the SAVED real data must actually exhibit the bug, else the
    // test proves nothing.
    for (const r of FIXTURE) {
      expect(r.final_price).toBe(0);
      expect(r.is_available).toBe(false);
      expect(r.availability).toBe("In Stock");
    }
  });

  it("surfaces the matching-asin variation price when flat final_price is 0", () => {
    const rec = FIXTURE.find(r => r.asin === "B0CFQ5T5F6")!;
    const out = normalizeProductRecord(rec);
    // matching variation (asin B0CFQ5T5F6) price is 8.97
    expect(out.final_price).toBe(8.97);
    expect(out.price).toBe(8.97);
    expect(out._price_source).toBe("reconciled");
  });

  it("does NOT promote per-unit price to listing price; surfaces it separately", () => {
    // B0GW2MWGKC is a 2-pack with variations:[] and buybox unit_price "$4.33".
    // unit_price is PER-UNIT (per-item in the pack), not the ~$8.67 listing price.
    // Promoting it would mislead price-ranking agents, so final_price stays 0 and
    // the per-unit value is surfaced on a separate, never-promoted breadcrumb.
    const rec = FIXTURE.find(r => r.asin === "B0GW2MWGKC")!;
    const out = normalizeProductRecord(rec);
    expect(out.final_price).toBe(0); // NOT reconciled to the per-unit value
    expect(out._price_source).toBeUndefined();
    expect(out._unit_price_only).toBe(4.33);
  });

  it("reconciles is_available to true when availability string says In Stock", () => {
    for (const r of FIXTURE) {
      const out = normalizeProductRecord(r);
      expect(out.is_available).toBe(true);
    }
  });

  it("never overwrites a real upstream final_price (Walmart-style passthrough)", () => {
    const walmartish = { final_price: 6.99, initial_price: 13.99, is_available: true, availability: "In stock" };
    const out = normalizeProductRecord(walmartish);
    expect(out.final_price).toBe(6.99); // untouched
    expect(out._price_source).toBe("upstream");
    expect(out.is_available).toBe(true);
  });

  it("leaves price at 0 when NO price is anywhere in the record (does not invent)", () => {
    const noPrice = {
      asin: "X", final_price: 0, initial_price: 0,
      buybox_prices: { final_price: 0, unit_price: null },
      variations: [], availability: "In Stock", is_available: false,
    };
    const out = normalizeProductRecord(noPrice);
    expect(out.final_price).toBe(0);
    expect(out._price_source).toBeUndefined(); // no reconciliation happened
    // availability still reconciled independently
    expect(out.is_available).toBe(true);
  });

  it("marks out-of-stock string as NOT available", () => {
    const oos = { availability: "Currently unavailable", is_available: false, final_price: 0, variations: [] };
    const out = normalizeProductRecord(oos);
    expect(out.is_available).toBe(false);
  });

  it('does not false-positive on "Not available" (negative guard before positive regex)', () => {
    const notAvail = { availability: "Not available", is_available: false, final_price: 0, variations: [] };
    const out = normalizeProductRecord(notAvail);
    expect(out.is_available).toBe(false);
  });

  it("passes non-product records through untouched", () => {
    const searchRec = { title: "Some blog post", url: "https://example.com", snippet: "hello" };
    const out = normalizeProductRecord(searchRec);
    expect(out).toEqual(searchRec);
  });
});

describe("novadaScrape — end-to-end price surfaces in json output (TOW2-237)", () => {
  it("json output for the real Amazon fixture has price>0 and is_available consistent", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get.mockResolvedValue(makeDownloadOk(FIXTURE));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "usb c cable" }, format: "json", limit: 20 },
      "test-key",
    );
    const jsonMatch = result.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]) as Record<string, unknown>[];
    expect(parsed.length).toBe(FIXTURE.length);
    for (const rec of parsed) {
      // is_available agrees with the "In Stock" availability string on every record.
      expect(rec.is_available).toBe(true);
    }
    // Records with a real LISTING price surface it (B0CFQ5T5F6→8.97, B088NRLMPV→9.99).
    const withRealPrice = parsed.filter(r => (r.final_price as number) > 0);
    expect(withRealPrice.length).toBe(2);
    for (const rec of withRealPrice) expect(rec._price_source).toBe("reconciled");
    // The 2-pack with only a per-unit price stays 0 and exposes _unit_price_only —
    // it is NOT promoted to a misleading listing price.
    const unitOnly = parsed.find(r => r.asin === "B0GW2MWGKC")!;
    expect(unitOnly.final_price).toBe(0);
    expect(unitOnly._unit_price_only).toBe(4.33);
  });
});
