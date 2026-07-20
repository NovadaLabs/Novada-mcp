/**
 * novada_scrape_facebook — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 6 facebook.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeFacebook, validateScrapeFacebookParams, FACEBOOK_OPERATIONS } =
  await import("../../src/tools/scrape_facebook.js");

const MOCK_RECORDS = [{ text: "Example post", likes: "512", author: "buzzfeedtastyjapan" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "facebook-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeFacebook — request format (wire-format proof)", () => {
  it("profile_by_url sends scraper_name=facebook.com, scraper_id=facebook_profile_profiles-url, and threads url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeFacebook(
      validateScrapeFacebookParams({ operation: "profile_by_url", params: { url: "https://www.facebook.com/buzzfeedtastyjapan" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("facebook.com");
    expect(form.get("scraper_id")).toBe("facebook_profile_profiles-url");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].url).toBe("https://www.facebook.com/buzzfeedtastyjapan");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("comments_by_post_url resolves to scraper_id=facebook_comment_comments-url and threads url + optional filters", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeFacebook(
      validateScrapeFacebookParams({
        operation: "comments_by_post_url",
        params: { url: "https://www.facebook.com/share/p/1K6xfHFkrK/", limit_records: 10 },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("facebook_comment_comments-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.facebook.com/share/p/1K6xfHFkrK/");
    expect(scraperParams[0].limit_records).toBe(10);
  });

  it("events_by_list_url resolves to scraper_id=facebook_event_eventlist-url and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeFacebook(
      validateScrapeFacebookParams({
        operation: "events_by_list_url",
        params: { url: "https://www.facebook.com/yestheory/events" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("facebook_event_eventlist-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.facebook.com/yestheory/events");
  });
});

describe("novadaScrapeFacebook — enum safety (only catalog-'ok' operations reachable)", () => {
  it("FACEBOOK_OPERATIONS has exactly 6 entries", () => {
    expect(Object.values(FACEBOOK_OPERATIONS)).toHaveLength(6);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeFacebookParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every FACEBOOK_OPERATIONS slug exists in the live facebook.com catalog with status 'ok' (no backend_broken facebook.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const facebookCatalog = CATALOG_BY_DOMAIN.get("facebook.com");
    expect(facebookCatalog, "facebook.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(FACEBOOK_OPERATIONS)) {
      const op = facebookCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live facebook.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const facebookPlatform = SCRAPER_CATALOG.find((p) => p.domain === "facebook.com");
    expect(facebookPlatform!.ops.every((op) => op.status === "ok"), "facebook.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
