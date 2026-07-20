/**
 * novada_scrape_instagram — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 7 instagram.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 *
 * posts_by_profile (slug ins_posts_profileurl) is the one AND-required op in this family
 * (see scrape.ts's AND_REQUIRED_OPS) — profileurl and resultsLimit are BOTH independently
 * required, mirroring the wire-level preflight proof scrape_amazon.test.ts already
 * establishes for Amazon's 3 AND-required ops.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeInstagram, validateScrapeInstagramParams, INSTAGRAM_OPERATIONS } =
  await import("../../src/tools/scrape_instagram.js");

const MOCK_RECORDS = [{ caption: "Example post", likes: "3.4K", username: "novadaproxies" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "instagram-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeInstagram — request format (wire-format proof)", () => {
  it("profile_by_url sends scraper_name=instagram.com, scraper_id=ins_profiles_profileurl, and threads profileurl via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeInstagram(
      validateScrapeInstagramParams({ operation: "profile_by_url", params: { profileurl: "https://www.instagram.com/novadaproxies/" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("instagram.com");
    expect(form.get("scraper_id")).toBe("ins_profiles_profileurl");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].profileurl).toBe("https://www.instagram.com/novadaproxies/");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("profile_by_username resolves to scraper_id=ins_profiles_username and threads username", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeInstagram(
      validateScrapeInstagramParams({ operation: "profile_by_username", params: { username: "novadaproxies" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("ins_profiles_username");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].username).toBe("novadaproxies");
  });

  it("posts_by_profile resolves to scraper_id=ins_posts_profileurl and threads BOTH profileurl and resultsLimit", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeInstagram(
      validateScrapeInstagramParams({
        operation: "posts_by_profile",
        params: { profileurl: "https://www.instagram.com/novadaproxies/", resultsLimit: 10 },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("ins_posts_profileurl");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].profileurl).toBe("https://www.instagram.com/novadaproxies/");
    expect(scraperParams[0].resultsLimit).toBe(10);
  });

  it("comments_by_post_url resolves to scraper_id=ins_comment_posturl and threads posturl", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeInstagram(
      validateScrapeInstagramParams({
        operation: "comments_by_post_url",
        params: { posturl: "https://www.instagram.com/cats_of_instagram/reel/CyFH4k6qEF0/" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("ins_comment_posturl");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].posturl).toBe("https://www.instagram.com/cats_of_instagram/reel/CyFH4k6qEF0/");
  });
});

// AND-required preflight: posts_by_profile needs BOTH profileurl and resultsLimit — a call
// missing either must reject BEFORE any network call, naming the missing key(s).
describe("novadaScrapeInstagram — AND-required preflight on posts_by_profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("profileurl alone (resultsLimit missing) throws naming 'resultsLimit' before any network call", async () => {
    await expect(
      novadaScrapeInstagram(
        validateScrapeInstagramParams({
          operation: "posts_by_profile",
          params: { profileurl: "https://www.instagram.com/novadaproxies/" },
        }),
        "test-key",
      ),
    ).rejects.toThrow(/resultsLimit/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("resultsLimit alone (profileurl missing) throws naming 'profileurl' before any network call", async () => {
    await expect(
      novadaScrapeInstagram(
        validateScrapeInstagramParams({ operation: "posts_by_profile", params: { resultsLimit: 10 } }),
        "test-key",
      ),
    ).rejects.toThrow(/profileurl/i);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("novadaScrapeInstagram — enum safety (only catalog-'ok' operations reachable)", () => {
  it("INSTAGRAM_OPERATIONS has exactly 7 entries", () => {
    expect(Object.values(INSTAGRAM_OPERATIONS)).toHaveLength(7);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeInstagramParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every INSTAGRAM_OPERATIONS slug exists in the live instagram.com catalog with status 'ok' (no backend_broken instagram.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const instagramCatalog = CATALOG_BY_DOMAIN.get("instagram.com");
    expect(instagramCatalog, "instagram.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(INSTAGRAM_OPERATIONS)) {
      const op = instagramCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live instagram.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const instagramPlatform = SCRAPER_CATALOG.find((p) => p.domain === "instagram.com");
    expect(instagramPlatform!.ops.every((op) => op.status === "ok"), "instagram.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
