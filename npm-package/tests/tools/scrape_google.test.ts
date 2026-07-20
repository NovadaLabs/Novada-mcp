/**
 * novada_scrape_google — wire-format proof.
 *
 * Tools-v2 search-engine platform-scraper pass: mirrors scrape_amazon.test.ts's proof
 * pattern for the first SEARCH-ENGINE platform-scraper tool. Proves (1) each friendly
 * `operation` name resolves to the EXACT catalog scraper_id, (2) operation-specific params
 * thread through unchanged in the correct wire format — Format A (flat form fields) for
 * "flat" catalog ops, Format B (scraper_params JSON array) for "params" catalog ops — and
 * (3) the multi-required google_map-details_location op is AND-required at preflight
 * (seeded into scrape.ts's AND_REQUIRED_OPS by this same change).
 *
 * Mocking strategy matches scrape.test.ts / scrape_amazon.test.ts: mock axios (the actual
 * HTTP boundary), not submitScrapeTask itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeGoogle, validateScrapeGoogleParams, GOOGLE_OPERATIONS } =
  await import("../../src/tools/scrape_google.js");

const MOCK_RECORDS = [{ title: "Example result", link: "https://example.com", rank: 1 }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "google-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeGoogle — request format (wire-format proof)", () => {
  it("web_search sends scraper_name=google.com, scraper_id=google_search, and threads q as a FLAT form field (Format A)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "web_search", params: { q: "wireless earbuds" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("google.com");
    expect(form.get("scraper_id")).toBe("google_search");
    // google_search is catalog format:"flat" — op params are sent as flat form fields,
    // not as a scraper_params JSON array.
    expect(form.get("q")).toBe("wireless earbuds");
    expect(form.get("scraper_params")).toBeNull();
    // Format A auto-injects json=1 when the caller doesn't supply it.
    expect(form.get("json")).toBe("1");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("search_by_url resolves to scraper_id=google_search_url and threads url flat", async () => {
    mockSuccess(MOCK_RECORDS);
    const searchUrl = "https://www.google.com/search?q=laptop+bags";
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "search_by_url", params: { url: searchUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("google.com");
    expect(form.get("scraper_id")).toBe("google_search_url");
    expect(form.get("url")).toBe(searchUrl);
    expect(form.get("scraper_params")).toBeNull();
  });

  it("shopping resolves to scraper_id=google_shopping_keywords and threads keyword via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "shopping", params: { keyword: "pizza" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("google.com");
    expect(form.get("scraper_id")).toBe("google_shopping_keywords");
    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].keyword).toBe("pizza");
  });

  it("maps_by_place_id resolves to scraper_id=google_map-details_placeid and threads place_id via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "maps_by_place_id", params: { place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("google_map-details_placeid");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].place_id).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
  });

  it("maps_reviews_by_url resolves to scraper_id=google_comment_url and threads url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({ operation: "maps_reviews_by_url", params: { url: "https://maps.google.com/..." } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("google_comment_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://maps.google.com/...");
  });

  it("maps_by_location resolves to scraper_id=google_map-details_location and threads country+keyword+merchant_limit via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGoogle(
      validateScrapeGoogleParams({
        operation: "maps_by_location",
        params: { country: "us", keyword: "coffee shop", merchant_limit: "5" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("google_map-details_location");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].country).toBe("us");
    expect(scraperParams[0].keyword).toBe("coffee shop");
    expect(scraperParams[0].merchant_limit).toBe("5");
  });
});

// The engine's shared preflight (scrape.ts's AND_REQUIRED_OPS) was extended by this same
// change to treat google_map-details_location's 3 keys as independently required. Wire-level
// proof that this reaches the per-platform tool, not just novada_scrape's generic string param.
describe("novadaScrapeGoogle — AND-required preflight on maps_by_location (seeded AND_REQUIRED_OPS entry)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keyword+merchant_limit present but country missing throws naming 'country' before any network call", async () => {
    await expect(
      novadaScrapeGoogle(
        validateScrapeGoogleParams({
          operation: "maps_by_location",
          params: { keyword: "coffee shop", merchant_limit: "5" },
        }),
        "test-key",
      ),
    ).rejects.toThrow(/country/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("only country present throws naming BOTH missing keys ('keyword' and 'merchant_limit')", async () => {
    let thrown: unknown;
    try {
      await novadaScrapeGoogle(
        validateScrapeGoogleParams({ operation: "maps_by_location", params: { country: "us" } }),
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("keyword");
    expect(message).toContain("merchant_limit");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("novadaScrapeGoogle — enum safety (only catalog-'ok' operations reachable)", () => {
  it("GOOGLE_OPERATIONS has exactly 13 entries", () => {
    expect(Object.values(GOOGLE_OPERATIONS)).toHaveLength(13);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeGoogleParams({ operation: "totally_made_up", params: {} })).toThrow();
  });

  it("every GOOGLE_OPERATIONS slug exists in the live google.com catalog with status 'ok'", async () => {
    const { CATALOG_BY_DOMAIN } = await import("../../src/data/scraper_catalog.js");
    const googleCatalog = CATALOG_BY_DOMAIN.get("google.com");
    expect(googleCatalog, "google.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(GOOGLE_OPERATIONS)) {
      const op = googleCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live google.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
  });
});
