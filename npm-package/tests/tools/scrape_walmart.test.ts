/**
 * novada_scrape_walmart — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 5 walmart.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 *
 * 3 of the 5 ops are AND-required (see scrape.ts's AND_REQUIRED_OPS): product_by_keyword
 * (domain+keyword), product_by_category_url (category_url+all+page_limit), and
 * product_by_url_and_zipcode (url+zipcode) — mirroring the wire-level preflight proof
 * scrape_amazon.test.ts/scrape_instagram.test.ts already establish for their own
 * AND-required ops.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeWalmart, validateScrapeWalmartParams, WALMART_OPERATIONS } =
  await import("../../src/tools/scrape_walmart.js");

const MOCK_RECORDS = [{ title: "Fresh Gala Apples 3 lb Bag", price: "$4.24", rating: "4.6" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "walmart-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeWalmart — request format (wire-format proof)", () => {
  it("product_by_sku sends scraper_name=walmart.com, scraper_id=walmart_product_sku, and threads sku via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeWalmart(
      validateScrapeWalmartParams({ operation: "product_by_sku", params: { sku: "433078517" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("walmart.com");
    expect(form.get("scraper_id")).toBe("walmart_product_sku");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].sku).toBe("433078517");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("product_by_url resolves to scraper_id=walmart_product_url and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    const productUrl = "https://www.walmart.com/ip/Fresh-Gala-Apples-3-lb-Bag/44390958";
    await novadaScrapeWalmart(
      validateScrapeWalmartParams({ operation: "product_by_url", params: { url: productUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("walmart_product_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe(productUrl);
  });

  it("product_by_keyword resolves to scraper_id=walmart_product_keywords and threads BOTH domain and keyword", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeWalmart(
      validateScrapeWalmartParams({
        operation: "product_by_keyword",
        params: { domain: "https://www.walmart.com/", keyword: "shoes" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("walmart_product_keywords");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].domain).toBe("https://www.walmart.com/");
    expect(scraperParams[0].keyword).toBe("shoes");
  });

  it("product_by_category_url resolves to scraper_id=walmart_product_category-url and threads ALL of category_url, all, page_limit", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeWalmart(
      validateScrapeWalmartParams({
        operation: "product_by_category_url",
        params: { category_url: "https://www.walmart.com/shop/savings", all: "true", page_limit: "1" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("walmart_product_category-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].category_url).toBe("https://www.walmart.com/shop/savings");
    expect(scraperParams[0].all).toBe("true");
    expect(scraperParams[0].page_limit).toBe("1");
  });

  it("product_by_url_and_zipcode resolves to scraper_id=walmart_product_zipcodes and threads BOTH url and zipcode", async () => {
    mockSuccess(MOCK_RECORDS);
    const productUrl = "https://www.walmart.com/ip/Nike-Men-s-Air-More-Uptempo/17722213945";
    await novadaScrapeWalmart(
      validateScrapeWalmartParams({
        operation: "product_by_url_and_zipcode",
        params: { url: productUrl, zipcode: "95829" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("walmart_product_zipcodes");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe(productUrl);
    expect(scraperParams[0].zipcode).toBe("95829");
  });
});

// AND-required preflight: 3 ops each need ALL of their listed keys — a call missing any
// one must reject BEFORE any network call, naming the missing key(s).
describe("novadaScrapeWalmart — AND-required preflight on multi-param ops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("product_by_keyword: domain alone (keyword missing) throws naming 'keyword' before any network call", async () => {
    await expect(
      novadaScrapeWalmart(
        validateScrapeWalmartParams({ operation: "product_by_keyword", params: { domain: "https://www.walmart.com/" } }),
        "test-key",
      ),
    ).rejects.toThrow(/keyword/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("product_by_keyword: keyword alone (domain missing) throws naming 'domain' before any network call", async () => {
    await expect(
      novadaScrapeWalmart(
        validateScrapeWalmartParams({ operation: "product_by_keyword", params: { keyword: "shoes" } }),
        "test-key",
      ),
    ).rejects.toThrow(/domain/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("product_by_category_url: missing page_limit (category_url + all present) throws naming 'page_limit'", async () => {
    await expect(
      novadaScrapeWalmart(
        validateScrapeWalmartParams({
          operation: "product_by_category_url",
          params: { category_url: "https://www.walmart.com/shop/savings", all: "true" },
        }),
        "test-key",
      ),
    ).rejects.toThrow(/page_limit/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("product_by_category_url: only category_url present throws naming BOTH missing keys ('all' and 'page_limit')", async () => {
    let thrown: unknown;
    try {
      await novadaScrapeWalmart(
        validateScrapeWalmartParams({
          operation: "product_by_category_url",
          params: { category_url: "https://www.walmart.com/shop/savings" },
        }),
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("all");
    expect(message).toContain("page_limit");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("product_by_url_and_zipcode: url alone (zipcode missing) throws naming 'zipcode' before any network call", async () => {
    await expect(
      novadaScrapeWalmart(
        validateScrapeWalmartParams({
          operation: "product_by_url_and_zipcode",
          params: { url: "https://www.walmart.com/ip/Nike-Men-s-Air-More-Uptempo/17722213945" },
        }),
        "test-key",
      ),
    ).rejects.toThrow(/zipcode/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("product_by_url_and_zipcode: zipcode alone (url missing) throws naming 'url' before any network call", async () => {
    await expect(
      novadaScrapeWalmart(
        validateScrapeWalmartParams({ operation: "product_by_url_and_zipcode", params: { zipcode: "95829" } }),
        "test-key",
      ),
    ).rejects.toThrow(/url/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("novadaScrapeWalmart — enum safety (only catalog-'ok' operations reachable)", () => {
  it("WALMART_OPERATIONS has exactly 5 entries", () => {
    expect(Object.values(WALMART_OPERATIONS)).toHaveLength(5);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeWalmartParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every WALMART_OPERATIONS slug exists in the live walmart.com catalog with status 'ok' (no backend_broken walmart.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const walmartCatalog = CATALOG_BY_DOMAIN.get("walmart.com");
    expect(walmartCatalog, "walmart.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(WALMART_OPERATIONS)) {
      const op = walmartCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live walmart.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const walmartPlatform = SCRAPER_CATALOG.find((p) => p.domain === "walmart.com");
    expect(walmartPlatform!.ops.every((op) => op.status === "ok"), "walmart.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
