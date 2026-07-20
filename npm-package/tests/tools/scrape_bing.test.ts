/**
 * novada_scrape_bing — wire-format proof.
 *
 * Mirrors scrape_google.test.ts's proof pattern. All 4 bing.com catalog operations are
 * "flat" format, so every op threads params as flat form fields (Format A), never
 * scraper_params (Format B).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeBing, validateScrapeBingParams, BING_OPERATIONS } =
  await import("../../src/tools/scrape_bing.js");

const MOCK_RECORDS = [{ title: "Example result", link: "https://example.com", rank: 1 }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "bing-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeBing — request format (wire-format proof)", () => {
  it("web_search sends scraper_name=bing.com, scraper_id=bing_search, and threads q as a FLAT form field (Format A)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeBing(
      validateScrapeBingParams({ operation: "web_search", params: { q: "wireless earbuds" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("bing.com");
    expect(form.get("scraper_id")).toBe("bing_search");
    expect(form.get("q")).toBe("wireless earbuds");
    expect(form.get("scraper_params")).toBeNull();
    expect(form.get("json")).toBe("1");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("news resolves to scraper_id=bing_news and threads q flat, plus optional qft", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeBing(
      validateScrapeBingParams({ operation: "news", params: { q: "AI regulation", qft: "sortbydate" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("bing.com");
    expect(form.get("scraper_id")).toBe("bing_news");
    expect(form.get("q")).toBe("AI regulation");
    expect(form.get("qft")).toBe("sortbydate");
    expect(form.get("scraper_params")).toBeNull();
  });

  it("videos resolves to scraper_id=bing_videos and threads q flat", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeBing(
      validateScrapeBingParams({ operation: "videos", params: { q: "cooking tutorial" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("bing_videos");
    expect(form.get("q")).toBe("cooking tutorial");
  });

  it("shopping resolves to scraper_id=bing_shopping and threads q flat", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeBing(
      validateScrapeBingParams({ operation: "shopping", params: { q: "running shoes" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("bing_shopping");
    expect(form.get("q")).toBe("running shoes");
  });
});

describe("novadaScrapeBing — enum safety (only catalog-'ok' operations reachable)", () => {
  it("BING_OPERATIONS has exactly 4 entries", () => {
    expect(Object.values(BING_OPERATIONS)).toHaveLength(4);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeBingParams({ operation: "totally_made_up", params: {} })).toThrow();
  });

  it("every BING_OPERATIONS slug exists in the live bing.com catalog with status 'ok' (no backend_broken bing.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const bingCatalog = CATALOG_BY_DOMAIN.get("bing.com");
    expect(bingCatalog, "bing.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(BING_OPERATIONS)) {
      const op = bingCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live bing.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const bingPlatform = SCRAPER_CATALOG.find((p) => p.domain === "bing.com");
    expect(bingPlatform!.ops.every((op) => op.status === "ok"), "bing.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
