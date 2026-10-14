/**
 * novada_scrape_youtube — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 13 youtube.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params (a JSON
 * array in a single form field), never as flat form fields (Format A).
 *
 * Round 3 (S1-connector, live-verified 2026-10-13): `transcript_by_video`
 * (catalog slug youtube_transcript_id) is now status:"backend_broken" (API_DOWN
 * 404 "subtitles_error: Unable to download API page" across 2 different
 * video_ids) and has been REMOVED from YOUTUBE_OPERATIONS — same enum-safety
 * pattern as scrape_shein.ts's pre-existing 3-excluded-slugs precedent. 12 of
 * the 13 catalog operations remain "ok" and reachable.
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
  it("YOUTUBE_OPERATIONS has exactly 12 entries, not including the 1 known backend_broken catalog slug (youtube_transcript_id)", () => {
    const mappedSlugs = Object.values(YOUTUBE_OPERATIONS);
    expect(mappedSlugs).toHaveLength(12);
    expect(mappedSlugs).not.toContain("youtube_transcript_id");
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeYoutubeParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("rejects the backend_broken catalog slug's friendly name (transcript_by_video) — Zod enum rejects before any backend round-trip", () => {
    expect(() => validateScrapeYoutubeParams({ operation: "transcript_by_video", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every YOUTUBE_OPERATIONS slug exists in the live youtube.com catalog with status 'ok'", async () => {
    const { CATALOG_BY_DOMAIN } = await import("../../src/data/scraper_catalog.js");
    const youtubeCatalog = CATALOG_BY_DOMAIN.get("youtube.com");
    expect(youtubeCatalog, "youtube.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(YOUTUBE_OPERATIONS)) {
      const op = youtubeCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live youtube.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
  });

  it("the live youtube.com catalog has exactly 1 backend_broken op (sanity: this test suite's premise stays true)", async () => {
    const { SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const youtubePlatform = SCRAPER_CATALOG.find((p) => p.domain === "youtube.com");
    expect(youtubePlatform, "youtube.com missing from the live catalog").toBeDefined();
    const broken = youtubePlatform!.ops.filter((op) => op.status === "backend_broken");
    expect(broken.map((op) => op.slug)).toEqual(["youtube_transcript_id"]);
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
