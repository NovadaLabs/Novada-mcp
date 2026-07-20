/**
 * novada_scrape_youtube — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 13 youtube.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params (a JSON
 * array in a single form field), never as flat form fields (Format A).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeYoutube, validateScrapeYoutubeParams, YOUTUBE_OPERATIONS } =
  await import("../../src/tools/scrape_youtube.js");

const MOCK_RECORDS = [{ title: "Example video", views: "1.2M", video_id: "LCAY3PGHZyw" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "youtube-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeYoutube — request format (wire-format proof)", () => {
  it("transcript_by_video sends scraper_name=youtube.com, scraper_id=youtube_transcript_id, and threads video_id via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYoutube(
      validateScrapeYoutubeParams({ operation: "transcript_by_video", params: { video_id: "LCAY3PGHZyw" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("youtube.com");
    expect(form.get("scraper_id")).toBe("youtube_transcript_id");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].video_id).toBe("LCAY3PGHZyw");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("channel_by_url resolves to scraper_id=youtube_profiles_url and threads url", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYoutube(
      validateScrapeYoutubeParams({ operation: "channel_by_url", params: { url: "https://www.youtube.com/@disneykids" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("youtube.com");
    expect(form.get("scraper_id")).toBe("youtube_profiles_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://www.youtube.com/@disneykids");
  });

  it("videos_by_filters resolves to scraper_id=youtube_video-post_search_filters and threads keyword_search", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYoutube(
      validateScrapeYoutubeParams({ operation: "videos_by_filters", params: { keyword_search: "music", duration: "Under 3 minutes" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("youtube_video-post_search_filters");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].keyword_search).toBe("music");
    expect(scraperParams[0].duration).toBe("Under 3 minutes");
  });

  // C2 fix (2026-07-20, synthesis.md): videos_by_label (youtube_video_search_label)
  // was missing from YOUTUBE_OPERATIONS even though the tool's own description
  // already claimed video-search-by-label coverage.
  it("videos_by_label resolves to scraper_id=youtube_video_search_label and threads search_label", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYoutube(
      validateScrapeYoutubeParams({ operation: "videos_by_label", params: { search_label: "music" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("youtube_video_search_label");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].search_label).toBe("music");
  });
});

describe("novadaScrapeYoutube — enum safety (only catalog-'ok' operations reachable)", () => {
  it("YOUTUBE_OPERATIONS has exactly 13 entries", () => {
    expect(Object.values(YOUTUBE_OPERATIONS)).toHaveLength(13);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeYoutubeParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every YOUTUBE_OPERATIONS slug exists in the live youtube.com catalog with status 'ok' (no backend_broken youtube.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const youtubeCatalog = CATALOG_BY_DOMAIN.get("youtube.com");
    expect(youtubeCatalog, "youtube.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(YOUTUBE_OPERATIONS)) {
      const op = youtubeCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live youtube.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const youtubePlatform = SCRAPER_CATALOG.find((p) => p.domain === "youtube.com");
    expect(youtubePlatform!.ops.every((op) => op.status === "ok"), "youtube.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });

  // C2 regression guard: the reverse-direction check the original gap slipped
  // through — every catalog "ok" op for this platform must be reachable via
  // YOUTUBE_OPERATIONS, not just "every mapped op is valid". This is the check
  // that would have caught youtube_video_search_label being dropped.
  it("every 'ok' youtube.com catalog operation is mapped in YOUTUBE_OPERATIONS (full coverage, not just valid coverage)", async () => {
    const { SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const youtubePlatform = SCRAPER_CATALOG.find((p) => p.domain === "youtube.com");
    expect(youtubePlatform, "youtube.com missing from the live catalog").toBeDefined();
    const okSlugs = youtubePlatform!.ops.filter((op) => op.status === "ok").map((op) => op.slug);
    const mappedSlugs: Set<string> = new Set(Object.values(YOUTUBE_OPERATIONS));
    const missing = okSlugs.filter((slug) => !mappedSlugs.has(slug));
    expect(missing, `catalog 'ok' op(s) not reachable via any friendly YOUTUBE_OPERATIONS name: ${missing.join(", ")}`).toEqual([]);
  });
});
