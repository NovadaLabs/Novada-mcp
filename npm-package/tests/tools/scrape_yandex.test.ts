/**
 * novada_scrape_yandex — wire-format proof.
 *
 * Mirrors scrape_duckduckgo.test.ts's proof pattern. Yandex has exactly ONE catalog
 * operation ("flat" format), so this suite proves the single op's wire format plus enum
 * safety, without a multi-op resolution matrix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeYandex, validateScrapeYandexParams, YANDEX_OPERATIONS } =
  await import("../../src/tools/scrape_yandex.js");

const MOCK_RECORDS = [{ title: "Example result", link: "https://example.com", rank: 1 }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "yandex-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeYandex — request format (wire-format proof)", () => {
  it("web_search sends scraper_name=yandex.com, scraper_id=yandex, and threads q + yandex_domain as FLAT form fields (Format A)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYandex(
      validateScrapeYandexParams({
        operation: "web_search",
        params: { q: "wireless earbuds", yandex_domain: "yandex.com" },
      }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("yandex.com");
    expect(form.get("scraper_id")).toBe("yandex");
    expect(form.get("q")).toBe("wireless earbuds");
    expect(form.get("yandex_domain")).toBe("yandex.com");
    expect(form.get("scraper_params")).toBeNull();
    expect(form.get("json")).toBe("1");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("threads optional lang/location/page/within params flat", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYandex(
      validateScrapeYandexParams({
        operation: "web_search",
        params: { q: "новости", yandex_domain: "yandex.ru", lang: "ru", page: "2" },
      }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("yandex_domain")).toBe("yandex.ru");
    expect(form.get("lang")).toBe("ru");
    expect(form.get("page")).toBe("2");
  });
});

describe("novadaScrapeYandex — enum safety (only catalog-'ok' operations reachable)", () => {
  it("YANDEX_OPERATIONS has exactly 1 entry", () => {
    expect(Object.values(YANDEX_OPERATIONS)).toHaveLength(1);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeYandexParams({ operation: "totally_made_up", params: {} })).toThrow();
  });

  it("every YANDEX_OPERATIONS slug exists in the live yandex.com catalog with status 'ok' (no backend_broken yandex.com ops exist to exclude)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const yandexCatalog = CATALOG_BY_DOMAIN.get("yandex.com");
    expect(yandexCatalog, "yandex.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(YANDEX_OPERATIONS)) {
      const op = yandexCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live yandex.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const yandexPlatform = SCRAPER_CATALOG.find((p) => p.domain === "yandex.com");
    expect(yandexPlatform!.ops.every((op) => op.status === "ok"), "yandex.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
