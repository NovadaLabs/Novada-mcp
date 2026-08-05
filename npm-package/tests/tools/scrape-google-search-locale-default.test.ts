// ─── google_search default locale (F1 fix — TOW2-audit 2026-08-03/04) ──────
//
// ROOT CAUSE (live-verified against scraper.novada.com/request on 2026-08-04,
// funded key, 6 raw curl calls — see investigation notes in the session that
// produced this fix): when a `google_search` call omits `country`, the
// backend routes the scrape through a non-US proxy IP (observed: Japan —
// e.g. a plain `q=apple` call came back with Japanese-localized organic
// results and a Japanese "total_results" string). For English-language
// long-tail queries this foreign-locale route genuinely returns ZERO organic
// results (`code:400`, `msg:"serp returns empty"`), even though the exact
// same query returns ~2000-3000 real results once `country=us` is supplied.
//
// This was audited as F1 (HIGH, CONFIRMED) in
// novada-test-engineering/ledger/novada-mcp/2026-08-03-novada-mcp-0.9.33-tow2257-async/
// via the golden-v1 canary `scrape-google-web-search`
// (query: "novada mcp web scraping"). Reproduced 1:1 with raw curl using the
// documented wire contract (scraper_name=google.com, scraper_id=google_search,
// q=..., json=1) — NO country/gl/hl param, matching what novadaScrape sends
// today for a caller who (like the golden item) doesn't pass a locale param.
//
// Isolation matters here: `hl=en` ALONE reproduced the empty result again
// (Google's regional index, not just the Accept-Language-style hl, drives
// this). Only `country=us` (which selects the proxy IP/region) fixed it.
//
// Response shapes below are copied VERBATIM from real captured
// scraper.novada.com/request responses (not guessed) — see this repo's own
// scrape.test.ts mockTaskStatus postmortem for why a guessed shape is
// unacceptable evidence here.
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrape } = await import("../../src/tools/scrape.js");

// Real capture: POST .../request with scraper_id=google_search, q="novada mcp
// web scraping", json=1, NO country — 2026-08-04, cost_time 3883ms (backend
// genuinely attempted the search, not a fast param-validation reject).
const REAL_EMPTY_SERP_NO_COUNTRY = {
  data: {
    code: 0,
    data: { code: 400, cost_time: 3883, data: null, msg: "serp returns empty" },
    msg: "success",
    timestamp: 1785847637,
  },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

// Real capture: identical request + country=us — 2026-08-04, cost_time 2103ms,
// 9 organic results, "About 2430 results". Trimmed to the fields this suite
// needs; every field present here is copied from the live response, none
// invented.
const REAL_SUCCESS_WITH_COUNTRY_US = {
  data: {
    code: 0,
    data: {
      code: 200,
      cost_time: 2103,
      data: {
        filename: "novada_probe_6",
        html: null,
        task_id: "62038440cf69c06f1000b8a939c498a7",
        json: [
          {
            spider_code: 200,
            rest: {
              search_information: {
                total_results: "About 2430 results",
                query_displayed: "novada mcp web scraping",
                organic_results_state: "Results for exact spelling",
              },
              organic: [
                { title: "Scraper API for Easy Web Scraping", link: "https://www.novada.com/products/scraper-api/", position: 1 },
                { title: "409 Web Scraping MCP Servers — Page 4", link: "https://mcpservers.org/category/web-scraping?page=4", position: 2 },
              ],
            },
          },
        ],
      },
    },
    msg: "success",
    timestamp: 1785847754,
  },
  status: 200,
  headers: {},
  config: {} as never,
  statusText: "OK",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novadaScrape — google_search default locale (F1 regression fix)", () => {
  it("auto-fills country=us on the outgoing form when the caller omits country/gl", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping" }, format: "json", limit: 20 },
      "test-key"
    );
    expect(mockedAxios.post).toHaveBeenCalled();
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("country")).toBe("us");
  });

  it("does NOT override an explicit caller-supplied country", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", country: "de" }, format: "json", limit: 20 },
      "test-key"
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("country")).toBe("de");
  });

  it("does NOT override an explicit caller-supplied gl (google's own region param name)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", gl: "de" }, format: "json", limit: 20 },
      "test-key"
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("country")).toBeNull();
    expect(form.get("gl")).toBe("de");
  });

  it("regression ratchet: the exact golden-v1 F1 canary call (q='novada mcp web scraping', no locale param) auto-fills country=us on the wire and returns real records, not the empty-serp FATAL", async () => {
    // Before the fix, this exact call (matching golden-v1.json's
    // `scrape-google-web-search` item) reproduced the empty-serp FATAL
    // (REAL_EMPTY_SERP_NO_COUNTRY) because no country was sent. After the fix,
    // submitScrapeTask auto-fills country=us, and the backend returns real
    // results (REAL_SUCCESS_WITH_COUNTRY_US).
    //
    // NOTE (fix-round, code-review required change 4): the mock always resolves
    // to REAL_SUCCESS_WITH_COUNTRY_US regardless of what was actually sent on
    // the wire, so the two assertions below are NOT a ratchet by themselves —
    // they'd pass even with the LOCALE_DEFAULT_ON_MISSING row deleted. The
    // form.get("country") assertion (same technique as test 1 above) is the
    // real ratchet: it fails if the table row (or the auto-fill) is ever removed.
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", json: true }, format: "json", limit: 20 },
      "test-key"
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("country")).toBe("us");
    expect(result).toContain("novada.com");
    expect(result).not.toContain("serp returns empty");
  });

  it("treats an empty-string country as ABSENT and REPLACES it with the default (never sends country=\"\" on the wire)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", country: "" }, format: "json", limit: 20 },
      "test-key"
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("country")).toBe("us");
  });

  it("appends the locale-default disclosure to Agent Hints when defaulted (json format)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping" }, format: "json", limit: 20 },
      "test-key"
    );
    expect(result).toContain('defaulted to country="us"');
  });

  it("appends the locale-default disclosure to Agent Hints when defaulted (markdown format)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping" }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain('defaulted to country="us"');
  });

  it("omits the locale-default disclosure when the caller passed country explicitly (json format)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", country: "de" }, format: "json", limit: 20 },
      "test-key"
    );
    expect(result).not.toContain('defaulted to country="us"');
  });

  it("omits the locale-default disclosure when the caller passed gl explicitly (markdown format)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_SUCCESS_WITH_COUNTRY_US);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", gl: "de" }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).not.toContain('defaulted to country="us"');
  });

  it("sanity: REAL_EMPTY_SERP_NO_COUNTRY capture is graded as graceful empty, not a thrown error (documents the pre-fix symptom)", async () => {
    mockedAxios.post.mockResolvedValueOnce(REAL_EMPTY_SERP_NO_COUNTRY);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: { q: "novada mcp web scraping", country: "jp" }, format: "json", limit: 20 },
      "test-key"
    );
    // Explicit country:"jp" must NOT be overridden by the default, and the
    // real captured empty-serp shape must still resolve gracefully (no throw).
    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as URLSearchParams).get("country")).toBe("jp");
    expect(result).toBeTruthy();
  });
});
