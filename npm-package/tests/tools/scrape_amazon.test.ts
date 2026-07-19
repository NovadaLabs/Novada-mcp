/**
 * novada_scrape_amazon — wire-format proof.
 *
 * Tools-v2 Option B scaffold: this is the proof-of-pattern test that the new
 * Amazon-only tool (1) resolves each friendly `operation` name to the EXACT
 * catalog scraper_id, (2) threads operation-specific params through unchanged,
 * (3) delegates to the same upstream HTTP shape novada_scrape already uses
 * (verified byte-for-byte against scraper.novada.com/request — see
 * scrape.test.ts's own "request format" describe block, which this mirrors),
 * and (4) makes the 3 backend_broken Amazon operations UNREACHABLE through the
 * enum — unlike novada_scrape, which still forwards them with a warning.
 *
 * Mocking strategy matches scrape.test.ts: mock axios (the actual HTTP boundary
 * inside submitScrapeTask/pollForResult), not submitScrapeTask itself — this
 * proves the full real request shape, not just that some internal function was
 * called with the right arguments.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { novadaScrapeAmazon, validateScrapeAmazonParams, AMAZON_OPERATIONS } =
  await import("../../src/tools/scrape_amazon.js");

const MOCK_RECORDS = [
  { title: "Anker Soundcore Wireless Earbuds", price: "$39.99", rating: "4.5", asin: "B0BWBK8F37" },
];

// Submit response: { code:0, data: { code:200, data: { task_id:"..." } } } — same shape
// scrape.test.ts's SUBMIT_OK uses.
const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "amazon-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeAmazon — request format (wire-format proof)", () => {
  it("product_by_asin sends scraper_name=amazon.com, scraper_id=amazon_product_asin, and threads asin via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({ operation: "product_by_asin", params: { asin: "B0BWBK8F37" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_product_asin");

    // amazon_product_asin is catalog format:"params" (Format B) — op params are sent
    // as a JSON array under scraper_params, not as flat form fields.
    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].asin).toBe("B0BWBK8F37");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("products_by_keywords resolves to scraper_id=amazon_product_keywords and threads keyword", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({ operation: "products_by_keywords", params: { keyword: "wireless earbuds", max_pages: 1 } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_product_keywords");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].keyword).toBe("wireless earbuds");
    expect(scraperParams[0].max_pages).toBe(1);
  });

  it("bestsellers resolves to scraper_id=amazon_product_best-sellers and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    const bestsellerUrl = "https://www.amazon.com/best-sellers-movies-TV-DVD-Blu-ray/zgbs/movies-tv";
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({ operation: "bestsellers", params: { url: bestsellerUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("amazon_product_best-sellers");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe(bestsellerUrl);
  });

  it("reviews_by_url resolves to scraper_id=amazon_comment_url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({ operation: "reviews_by_url", params: { url: "https://www.amazon.com/dp/B0987XD787" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("amazon_comment_url");
  });

  it("seller_by_url resolves to scraper_id=amazon_seller_url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({ operation: "seller_by_url", params: { url: "https://www.amazon.com/sp?seller=A19CIDGEL341NO" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("amazon_seller_url");
  });

  // FIX 4: wire-format coverage for the 5 ops the original scaffold left untested.

  it("product_by_url resolves to scraper_id=amazon_product_url and threads url (+ optional zip_code)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({
        operation: "product_by_url",
        params: { url: "https://www.amazon.com/dp/B0BWBK8F37/", zip_code: "10001" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_product_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.amazon.com/dp/B0BWBK8F37/");
    expect(scraperParams[0].zip_code).toBe("10001");
  });

  it("global_product_by_url resolves to scraper_id=amazon_global-product_url and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({
        operation: "global_product_by_url",
        params: { url: "https://www.amazon.com/dp/B0BWBK8F37/" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_global-product_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.amazon.com/dp/B0BWBK8F37/");
  });

  it("listings_by_keyword resolves to scraper_id=amazon_product-list_keywords-domain and threads keyword+domain", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({
        operation: "listings_by_keyword",
        params: { keyword: "coffee", domain: "https://www.amazon.com" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_product-list_keywords-domain");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].keyword).toBe("coffee");
    expect(scraperParams[0].domain).toBe("https://www.amazon.com");
  });

  it("global_product_by_category_url resolves to scraper_id=amazon_global-product_category-url and threads url+maximum", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({
        operation: "global_product_by_category_url",
        params: { url: "https://www.amazon.com/s?k=coffer", maximum: 3 },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_global-product_category-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.amazon.com/s?k=coffer");
    expect(scraperParams[0].maximum).toBe(3);
  });

  it("global_product_by_keyword_and_brand resolves to scraper_id=amazon_global-product_keywords-brand and threads keyword+brands+max_pages", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeAmazon(
      validateScrapeAmazonParams({
        operation: "global_product_by_keyword_and_brand",
        params: { keyword: "iphone 17 Pro Max", brands: "Apple", max_pages: 1 },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_global-product_keywords-brand");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].keyword).toBe("iphone 17 Pro Max");
    expect(scraperParams[0].brands).toBe("Apple");
    expect(scraperParams[0].max_pages).toBe(1);
  });
});

// FIX 4 / FIX 1: the 3 Amazon ops with more than one INDEPENDENTLY required catalog
// param must reject a call missing ANY one of them, naming the missing key(s), and
// must do so BEFORE any network call (preflightScrape's AND-mode check). This is the
// wire-level proof that FIX 1's shared-engine preflight fix actually reaches the
// per-platform tool, not just novada_scrape's generic `operation` string param.
describe("novadaScrapeAmazon — AND-required preflight on multi-param ops (FIX 1 / FIX 4)", () => {
  beforeEach(() => {
    // These ops must never reach the network — no axios mock is configured, so
    // any accidental submit would surface as an unrelated failure instead of a
    // silent pass. mockedAxios.post is asserted not-called below regardless.
    vi.clearAllMocks();
  });

  it("listings_by_keyword: keyword alone (domain missing) throws naming 'domain' before any network call", async () => {
    await expect(
      novadaScrapeAmazon(
        validateScrapeAmazonParams({ operation: "listings_by_keyword", params: { keyword: "coffee" } }),
        "test-key",
      ),
    ).rejects.toThrow(/domain/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("listings_by_keyword: domain alone (keyword missing) throws naming 'keyword' before any network call", async () => {
    await expect(
      novadaScrapeAmazon(
        validateScrapeAmazonParams({ operation: "listings_by_keyword", params: { domain: "https://www.amazon.com" } }),
        "test-key",
      ),
    ).rejects.toThrow(/keyword/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("global_product_by_category_url: url alone (maximum missing) throws naming 'maximum' before any network call", async () => {
    await expect(
      novadaScrapeAmazon(
        validateScrapeAmazonParams({
          operation: "global_product_by_category_url",
          params: { url: "https://www.amazon.com/s?k=coffer" },
        }),
        "test-key",
      ),
    ).rejects.toThrow(/maximum/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("global_product_by_category_url: maximum alone (url missing) throws naming 'url' before any network call", async () => {
    await expect(
      novadaScrapeAmazon(
        validateScrapeAmazonParams({ operation: "global_product_by_category_url", params: { maximum: 3 } }),
        "test-key",
      ),
    ).rejects.toThrow(/url/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("global_product_by_keyword_and_brand: keyword+brands present but max_pages missing throws naming 'max_pages'", async () => {
    await expect(
      novadaScrapeAmazon(
        validateScrapeAmazonParams({
          operation: "global_product_by_keyword_and_brand",
          params: { keyword: "iphone 17 Pro Max", brands: "Apple" },
        }),
        "test-key",
      ),
    ).rejects.toThrow(/max_pages/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("global_product_by_keyword_and_brand: only keyword present throws naming BOTH missing keys ('brands' and 'max_pages')", async () => {
    let thrown: unknown;
    try {
      await novadaScrapeAmazon(
        validateScrapeAmazonParams({
          operation: "global_product_by_keyword_and_brand",
          params: { keyword: "iphone 17 Pro Max" },
        }),
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("brands");
    expect(message).toContain("max_pages");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

// FIX 3: the "## Scrape Results" header must show the friendly operation name the
// caller actually typed ("product_by_asin"), not the raw catalog slug it resolves
// to internally ("amazon_product_asin").
describe("novadaScrapeAmazon — FIX 3 friendly operation name in output header", () => {
  it("renders the friendly operation name, not the raw catalog slug, in the header line", async () => {
    mockSuccess(MOCK_RECORDS);
    const output = await novadaScrapeAmazon(
      validateScrapeAmazonParams({ operation: "product_by_asin", params: { asin: "B0BWBK8F37" } }),
      "test-key",
    );
    expect(output).toContain("operation: product_by_asin");
    expect(output).not.toContain("operation: amazon_product_asin");
  });
});

describe("novadaScrapeAmazon — enum safety (backend_broken ops unreachable)", () => {
  it("AMAZON_OPERATIONS has exactly 10 entries, none of which are the 3 known backend_broken catalog slugs", () => {
    const brokenSlugs = [
      "amazon_product_category-url",
      "amazon_global-product_seller-url",
      "amazon_global-product_keywords",
    ];
    const mappedSlugs = Object.values(AMAZON_OPERATIONS);
    expect(mappedSlugs).toHaveLength(10);
    for (const broken of brokenSlugs) {
      expect(mappedSlugs).not.toContain(broken);
    }
  });

  it("rejects a backend_broken catalog slug passed as `operation` — Zod enum rejects before any backend round-trip", () => {
    expect(() => validateScrapeAmazonParams({ operation: "amazon_product_category-url", params: {} })).toThrow();
    expect(() => validateScrapeAmazonParams({ operation: "amazon_global-product_seller-url", params: {} })).toThrow();
    expect(() => validateScrapeAmazonParams({ operation: "amazon_global-product_keywords", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeAmazonParams({ operation: "totally_made_up", params: {} })).toThrow();
  });

  it("every AMAZON_OPERATIONS slug exists in the live amazon.com catalog with status 'ok'", async () => {
    const { CATALOG_BY_DOMAIN } = await import("../../src/data/scraper_catalog.js");
    const amazonCatalog = CATALOG_BY_DOMAIN.get("amazon.com");
    expect(amazonCatalog, "amazon.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(AMAZON_OPERATIONS)) {
      const op = amazonCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live amazon.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
  });
});
