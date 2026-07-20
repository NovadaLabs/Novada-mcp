/**
 * novada_scrape_linkedin — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 4 linkedin.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 *
 * No AND-required ops in this family: each linkedin.com catalog op has exactly one
 * required:true key (confirmed by the "jobs_search requires only location" test below,
 * counter to the op's own upstream name "By Keywords" — see scrape_linkedin.ts's own
 * comment on this).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeLinkedin, validateScrapeLinkedinParams, LINKEDIN_OPERATIONS } =
  await import("../../src/tools/scrape_linkedin.js");

const MOCK_RECORDS = [{ title: "Product Manager", company: "Novada", location: "Berlin, Germany" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "linkedin-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeLinkedin — request format (wire-format proof)", () => {
  it("company_by_url sends scraper_name=linkedin.com, scraper_id=linkedin_company_information_url, and threads url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeLinkedin(
      validateScrapeLinkedinParams({ operation: "company_by_url", params: { url: "https://www.linkedin.com/company/novadaproxies/" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("linkedin.com");
    expect(form.get("scraper_id")).toBe("linkedin_company_information_url");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].url).toBe("https://www.linkedin.com/company/novadaproxies/");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("jobs_search resolves to scraper_id=linkedin_job_listings_information_keyword and threads location (+ optional keyword)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeLinkedin(
      validateScrapeLinkedinParams({
        operation: "jobs_search",
        params: { location: "Germany", keyword: "product manager" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("linkedin_job_listings_information_keyword");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].location).toBe("Germany");
    expect(scraperParams[0].keyword).toBe("product manager");
  });

  it("jobs_by_search_url resolves to scraper_id=linkedin_job_listings_information_job-listing-url and threads listing_url", async () => {
    mockSuccess(MOCK_RECORDS);
    const listingUrl = "https://www.linkedin.com/jobs/search?keywords=Google%20Ads&location=Worldwide";
    await novadaScrapeLinkedin(
      validateScrapeLinkedinParams({ operation: "jobs_by_search_url", params: { listing_url: listingUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("linkedin_job_listings_information_job-listing-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].listing_url).toBe(listingUrl);
  });

  it("job_by_url resolves to scraper_id=linkedin_job_listings_information_job-url and threads position_url", async () => {
    mockSuccess(MOCK_RECORDS);
    const positionUrl = "https://www.linkedin.com/jobs/view/4378890064/";
    await novadaScrapeLinkedin(
      validateScrapeLinkedinParams({ operation: "job_by_url", params: { position_url: positionUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("linkedin_job_listings_information_job-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].position_url).toBe(positionUrl);
  });
});

// Preflight requires only `location` for jobs_search (the catalog's real required key,
// not `keyword` despite the op's upstream name "By Keywords") — a call with `keyword`
// alone but no `location` must still reject before any network call.
describe("novadaScrapeLinkedin — preflight requires location (not keyword) for jobs_search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keyword alone (location missing) throws naming 'location' before any network call", async () => {
    await expect(
      novadaScrapeLinkedin(
        validateScrapeLinkedinParams({ operation: "jobs_search", params: { keyword: "product manager" } }),
        "test-key",
      ),
    ).rejects.toThrow(/location/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("location alone (no keyword) succeeds — keyword is optional for this op", async () => {
    mockSuccess(MOCK_RECORDS);
    await expect(
      novadaScrapeLinkedin(
        validateScrapeLinkedinParams({ operation: "jobs_search", params: { location: "Germany" } }),
        "test-key",
      ),
    ).resolves.toBeTypeOf("string");
    expect(mockedAxios.post).toHaveBeenCalled();
  });
});

describe("novadaScrapeLinkedin — enum safety (only catalog-'ok' operations reachable)", () => {
  it("LINKEDIN_OPERATIONS has exactly 4 entries", () => {
    expect(Object.values(LINKEDIN_OPERATIONS)).toHaveLength(4);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeLinkedinParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every LINKEDIN_OPERATIONS slug exists in the live linkedin.com catalog with status 'ok' (no backend_broken linkedin.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const linkedinCatalog = CATALOG_BY_DOMAIN.get("linkedin.com");
    expect(linkedinCatalog, "linkedin.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(LINKEDIN_OPERATIONS)) {
      const op = linkedinCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live linkedin.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const linkedinPlatform = SCRAPER_CATALOG.find((p) => p.domain === "linkedin.com");
    expect(linkedinPlatform!.ops.every((op) => op.status === "ok"), "linkedin.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
