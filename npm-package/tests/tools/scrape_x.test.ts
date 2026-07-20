/**
 * novada_scrape_x — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 3 x.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeX, validateScrapeXParams, X_OPERATIONS } =
  await import("../../src/tools/scrape_x.js");

const MOCK_RECORDS = [{ text: "Example post", likes: "4.1K", author: "NASA" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "x-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeX — request format (wire-format proof)", () => {
  it("post_by_url sends scraper_name=x.com, scraper_id=twitter_post_posturl, and threads post_url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeX(
      validateScrapeXParams({ operation: "post_by_url", params: { post_url: "https://x.com/NASA/status/2048903895716364742" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("x.com");
    expect(form.get("scraper_id")).toBe("twitter_post_posturl");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].post_url).toBe("https://x.com/NASA/status/2048903895716364742");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("profile_by_username resolves to scraper_id=twitter_profile_username and threads user_name", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeX(
      validateScrapeXParams({ operation: "profile_by_username", params: { user_name: "BillGates" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("twitter_profile_username");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].user_name).toBe("BillGates");
  });

  it("profile_by_url resolves to scraper_id=twitter_profile_profileurl and threads profile_url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeX(
      validateScrapeXParams({ operation: "profile_by_url", params: { profile_url: "https://x.com/BillGates" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("twitter_profile_profileurl");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].profile_url).toBe("https://x.com/BillGates");
  });
});

describe("novadaScrapeX — enum safety (only catalog-'ok' operations reachable)", () => {
  it("X_OPERATIONS has exactly 3 entries", () => {
    expect(Object.values(X_OPERATIONS)).toHaveLength(3);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeXParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every X_OPERATIONS slug exists in the live x.com catalog with status 'ok' (no backend_broken x.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const xCatalog = CATALOG_BY_DOMAIN.get("x.com");
    expect(xCatalog, "x.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(X_OPERATIONS)) {
      const op = xCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live x.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const xPlatform = SCRAPER_CATALOG.find((p) => p.domain === "x.com");
    expect(xPlatform!.ops.every((op) => op.status === "ok"), "x.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
