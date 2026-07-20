/**
 * novada_scrape_shein — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. Both shein.com catalog operations
 * exposed here are "params" format (Format B), so both thread params via scraper_params.
 *
 * SHEIN's catalog has 5 total operations, of which 3 are status:"backend_broken"
 * ("submit endpoint hangs 60s+ — connection timeout") — shein_products_keyword,
 * shein_products_category_id, shein_products_category_url. This is the same
 * enum-safety pattern as scrape_amazon.test.ts's 3-excluded-slugs proof: the 3
 * broken slugs must be unreachable through SHEIN_OPERATIONS at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeShein, validateScrapeSheinParams, SHEIN_OPERATIONS } =
  await import("../../src/tools/scrape_shein.js");

const MOCK_RECORDS = [{ title: "iPhone Headphone Jack Adapter", price: "$5.00" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "shein-task-1" }, msg: "success" }, msg: "success" },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

function makeDownloadOk(records: unknown[]) {
  return {
    data: [{ spider_code: 200, rest: { results: records } }],
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  };
}

function mockSuccess(records: unknown[]) {
  mockedAxios.post.mockResolvedValue(SUBMIT_OK);
  mockedAxios.get.mockResolvedValue(makeDownloadOk(records));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novadaScrapeShein — request format (wire-format proof)", () => {
  it("product_by_id sends scraper_name=shein.com, scraper_id=shein_product_id, and threads ID via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeShein(
      validateScrapeSheinParams({
        operation: "product_by_id",
        params: { ID: "Tween-Girls-Casual-Solid-Color-Criss-Cross-Racerback-Sports-Dress-Kids-p-423721658" },
      }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("shein.com");
    expect(form.get("scraper_id")).toBe("shein_product_id");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].ID).toBe("Tween-Girls-Casual-Solid-Color-Criss-Cross-Racerback-Sports-Dress-Kids-p-423721658");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("product_by_url resolves to scraper_id=shein_product_url and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    const productUrl = "https://us.shein.com/iPhone-Headphone-Jack-Adapter-p-918166-cat-2277.html";
    await novadaScrapeShein(
      validateScrapeSheinParams({ operation: "product_by_url", params: { url: productUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("shein_product_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe(productUrl);
  });
});

describe("novadaScrapeShein — enum safety (backend_broken ops unreachable)", () => {
  it("SHEIN_OPERATIONS has exactly 2 entries, neither of which are the 3 known backend_broken catalog slugs", () => {
    const brokenSlugs = [
      "shein_products_keyword",
      "shein_products_category_id",
      "shein_products_category_url",
    ];
    const mappedSlugs = Object.values(SHEIN_OPERATIONS);
    expect(mappedSlugs).toHaveLength(2);
    for (const broken of brokenSlugs) {
      expect(mappedSlugs).not.toContain(broken);
    }
  });

  it("rejects a backend_broken catalog slug passed as `operation` — Zod enum rejects before any backend round-trip", () => {
    expect(() => validateScrapeSheinParams({ operation: "shein_products_keyword", params: {} })).toThrow();
    expect(() => validateScrapeSheinParams({ operation: "shein_products_category_id", params: {} })).toThrow();
    expect(() => validateScrapeSheinParams({ operation: "shein_products_category_url", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeSheinParams({ operation: "totally_made_up", params: {} })).toThrow();
  });

  it("every SHEIN_OPERATIONS slug exists in the live shein.com catalog with status 'ok'", async () => {
    const { CATALOG_BY_DOMAIN } = await import("../../src/data/scraper_catalog.js");
    const sheinCatalog = CATALOG_BY_DOMAIN.get("shein.com");
    expect(sheinCatalog, "shein.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(SHEIN_OPERATIONS)) {
      const op = sheinCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live shein.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
  });

  it("the live shein.com catalog still has exactly 3 backend_broken ops (sanity: this test suite's premise stays true)", async () => {
    const { SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const sheinPlatform = SCRAPER_CATALOG.find((p) => p.domain === "shein.com");
    expect(sheinPlatform, "shein.com missing from the live catalog").toBeDefined();
    const broken = sheinPlatform!.ops.filter((op) => op.status === "backend_broken");
    expect(broken.map((op) => op.slug).sort()).toEqual([
      "shein_products_category_id",
      "shein_products_category_url",
      "shein_products_keyword",
    ]);
  });
});
