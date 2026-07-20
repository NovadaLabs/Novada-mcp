/**
 * novada_scrape_tiktok — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 5 tiktok.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeTiktok, validateScrapeTiktokParams, TIKTOK_OPERATIONS } =
  await import("../../src/tools/scrape_tiktok.js");

const MOCK_RECORDS = [{ description: "Example post", likes: "1.2K", username: "gingercat168" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "tiktok-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeTiktok — request format (wire-format proof)", () => {
  it("profile_by_url sends scraper_name=tiktok.com, scraper_id=tiktok_profiles_url, and threads url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeTiktok(
      validateScrapeTiktokParams({ operation: "profile_by_url", params: { url: "https://www.tiktok.com/@maggieend" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("tiktok.com");
    expect(form.get("scraper_id")).toBe("tiktok_profiles_url");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].url).toBe("https://www.tiktok.com/@maggieend");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("posts_by_profile resolves to scraper_id=tiktok_posts_profileurl and threads url + optional filters", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeTiktok(
      validateScrapeTiktokParams({
        operation: "posts_by_profile",
        params: { url: "https://www.tiktok.com/@gingercat168", num_of_posts: 5 },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("tiktok_posts_profileurl");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.tiktok.com/@gingercat168");
    expect(scraperParams[0].num_of_posts).toBe(5);
  });

  it("post_by_url resolves to scraper_id=tiktok_posts_url and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeTiktok(
      validateScrapeTiktokParams({
        operation: "post_by_url",
        params: { url: "https://www.tiktok.com/@gingercat168/video/7586318922010332446" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("tiktok_posts_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.tiktok.com/@gingercat168/video/7586318922010332446");
  });
});

describe("novadaScrapeTiktok — enum safety (only catalog-'ok' operations reachable)", () => {
  it("TIKTOK_OPERATIONS has exactly 5 entries", () => {
    expect(Object.values(TIKTOK_OPERATIONS)).toHaveLength(5);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeTiktokParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every TIKTOK_OPERATIONS slug exists in the live tiktok.com catalog with status 'ok' (no backend_broken tiktok.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const tiktokCatalog = CATALOG_BY_DOMAIN.get("tiktok.com");
    expect(tiktokCatalog, "tiktok.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(TIKTOK_OPERATIONS)) {
      const op = tiktokCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live tiktok.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const tiktokPlatform = SCRAPER_CATALOG.find((p) => p.domain === "tiktok.com");
    expect(tiktokPlatform!.ops.every((op) => op.status === "ok"), "tiktok.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
