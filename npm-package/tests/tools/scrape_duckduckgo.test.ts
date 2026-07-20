/**
 * novada_scrape_duckduckgo — wire-format proof.
 *
 * Mirrors scrape_google.test.ts's proof pattern. DuckDuckGo has exactly ONE catalog
 * operation ("flat" format), so this suite proves the single op's wire format plus enum
 * safety, without a multi-op resolution matrix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeDuckduckgo, validateScrapeDuckduckgoParams, DUCKDUCKGO_OPERATIONS } =
  await import("../../src/tools/scrape_duckduckgo.js");

const MOCK_RECORDS = [{ title: "Example result", link: "https://example.com", rank: 1 }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "ddg-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeDuckduckgo — request format (wire-format proof)", () => {
  it("web_search sends scraper_name=duckduckgo.com, scraper_id=duckduckgo, and threads q as a FLAT form field (Format A)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeDuckduckgo(
      validateScrapeDuckduckgoParams({ operation: "web_search", params: { q: "wireless earbuds" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("duckduckgo.com");
    expect(form.get("scraper_id")).toBe("duckduckgo");
    expect(form.get("q")).toBe("wireless earbuds");
    expect(form.get("scraper_params")).toBeNull();
    expect(form.get("json")).toBe("1");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("threads optional region/time-range/adult-filter params flat", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeDuckduckgo(
      validateScrapeDuckduckgoParams({
        operation: "web_search",
        params: { q: "privacy tools", kl: "us-en", df: "w", kp: "1" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("kl")).toBe("us-en");
    expect(form.get("df")).toBe("w");
    expect(form.get("kp")).toBe("1");
  });
});

describe("novadaScrapeDuckduckgo — enum safety (only catalog-'ok' operations reachable)", () => {
  it("DUCKDUCKGO_OPERATIONS has exactly 1 entry", () => {
    expect(Object.values(DUCKDUCKGO_OPERATIONS)).toHaveLength(1);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeDuckduckgoParams({ operation: "totally_made_up", params: {} })).toThrow();
  });

  it("every DUCKDUCKGO_OPERATIONS slug exists in the live duckduckgo.com catalog with status 'ok' (no backend_broken duckduckgo.com ops exist to exclude)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const ddgCatalog = CATALOG_BY_DOMAIN.get("duckduckgo.com");
    expect(ddgCatalog, "duckduckgo.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(DUCKDUCKGO_OPERATIONS)) {
      const op = ddgCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live duckduckgo.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const ddgPlatform = SCRAPER_CATALOG.find((p) => p.domain === "duckduckgo.com");
    expect(ddgPlatform!.ops.every((op) => op.status === "ok"), "duckduckgo.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
