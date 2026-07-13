// ─── Per-op Format Routing Tests ────────────────────────────────────────────
// Verifies the bug fix: google map/comment/shopping ops use Format B (scraper_params)
// while google_search / bing / duckduckgo / yandex use Format A (flat).
//
// "Format A" = flat form body with `json=1` (search-engine style)
// "Format B" = `scraper_params=[{...}]` JSON array

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrape } = await import("../../src/tools/scrape.js");

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "t-001" }, msg: "success" }, msg: "success" },
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};
const DOWNLOAD_OK = {
  data: [{ spider_code: 200, rest: { results: [{ title: "Result 1" }] } }],
  status: 200, headers: {}, config: {} as never, statusText: "OK",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedAxios.post.mockResolvedValue(SUBMIT_OK);
  mockedAxios.get.mockResolvedValue(DOWNLOAD_OK);
});

/** Extract the URLSearchParams body sent to the submit POST. */
function getSubmitBody(): URLSearchParams | null {
  const calls = mockedAxios.post.mock.calls;
  if (!calls.length) return null;
  // submitScrapeTask sends: axios.post(url, body, config)
  // body is either URLSearchParams (flat) or URLSearchParams with scraper_params (params)
  const body = calls[0][1] as URLSearchParams;
  return body instanceof URLSearchParams ? body : null;
}

describe("Format A — flat (search-engine ops)", () => {
  it("google_search sends q=... as flat field, NOT scraper_params", async () => {
    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "test query" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    // Format A: q is a direct form field
    expect(body!.get("q")).toBe("test query");
    // Format A: scraper_params is absent (or not the primary key)
    const scraperParams = body!.get("scraper_params");
    expect(scraperParams).toBeNull();
  });

  it("bing_search sends keyword as flat field", async () => {
    await novadaScrape(
      { platform: "bing.com", operation: "bing_search", params: { keyword: "bing test" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    expect(body!.get("keyword")).toBe("bing test");
    expect(body!.get("scraper_params")).toBeNull();
  });

  it("duckduckgo sends keyword as flat field", async () => {
    await novadaScrape(
      { platform: "duckduckgo.com", operation: "duckduckgo", params: { keyword: "ddg test" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    expect(body!.get("keyword")).toBe("ddg test");
    expect(body!.get("scraper_params")).toBeNull();
  });

  it("yandex sends keyword as flat field", async () => {
    await novadaScrape(
      { platform: "yandex.com", operation: "yandex", params: { keyword: "yandex test" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    expect(body!.get("keyword")).toBe("yandex test");
    expect(body!.get("scraper_params")).toBeNull();
  });
});

describe("Format B — scraper_params (non-search ops, bug fix targets)", () => {
  it("google_map-details_placeid sends scraper_params JSON (bug fix)", async () => {
    await novadaScrape(
      { platform: "google.com", operation: "google_map-details_placeid", params: { place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    const raw = body!.get("scraper_params");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].place_id).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
  });

  it("google_map-details_location sends scraper_params JSON (bug fix)", async () => {
    await novadaScrape(
      {
        platform: "google.com",
        operation: "google_map-details_location",
        params: { country: "us", keyword: "coffee shop", merchant_limit: "5" },
      },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    const raw = body!.get("scraper_params");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].country).toBe("us");
  });

  it("google_comment_url sends scraper_params JSON (bug fix)", async () => {
    await novadaScrape(
      { platform: "google.com", operation: "google_comment_url", params: { url: "https://maps.google.com/..." } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    const raw = body!.get("scraper_params");
    expect(raw).not.toBeNull();
  });

  it("google_shopping_keywords sends scraper_params JSON (bug fix)", async () => {
    await novadaScrape(
      { platform: "google.com", operation: "google_shopping_keywords", params: { keyword: "laptop" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    const raw = body!.get("scraper_params");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].keyword).toBe("laptop");
  });

  it("amazon_product_keywords sends scraper_params JSON", async () => {
    await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    const raw = body!.get("scraper_params");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].keyword).toBe("iphone");
  });

  it("tiktok_posts_url sends scraper_params JSON", async () => {
    await novadaScrape(
      { platform: "tiktok.com", operation: "tiktok_posts_url", params: { url: "https://tiktok.com/@user/video/123" } },
      "test-key"
    );
    const body = getSubmitBody();
    expect(body).not.toBeNull();
    const raw = body!.get("scraper_params");
    expect(raw).not.toBeNull();
  });
});

describe("Backend-broken ops — warning prepended, call still forwarded", () => {
  it("shein_products_keyword warns but still calls backend", async () => {
    const result = await novadaScrape(
      { platform: "shein.com", operation: "shein_products_keyword", params: { keyword: "dress" } },
      "test-key"
    );
    // Warning should be in output
    expect(result).toMatch(/backend|broken|warning|NOTE/i);
    // Backend was still called (post was invoked)
    expect(mockedAxios.post).toHaveBeenCalled();
  });
});
