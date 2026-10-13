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
  // Round 4 (F7): "yandex.com" is now a preflight-rejected known-broken value
  // (see the dedicated describe block below) — this wire-format proof uses
  // "yandex.com.tr" (live-verified working) instead, so it keeps proving the
  // real wire format rather than a value that can never reach the network.
  it("web_search sends scraper_name=yandex.com, scraper_id=yandex, and threads q + yandex_domain as FLAT form fields (Format A)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYandex(
      validateScrapeYandexParams({
        operation: "web_search",
        params: { q: "wireless earbuds", yandex_domain: "yandex.com.tr" },
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
    expect(form.get("yandex_domain")).toBe("yandex.com.tr");
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

// Round 4 (F7, final-exam verifier, live-verified 2026-10-13): yandex_domain=
// "yandex.com" fails 4/4 live (upstream code 10000, "serp capture failed")
// while the operation itself is healthy and the value is still structurally
// ACCEPTED (reordering the example wasn't enough — Directory review requires
// every tool to succeed for valid input). Fixed as DATA (known_broken_param_
// values.ts), checked pre-flight inside preflightScrape (scrape.ts) — reached
// through novadaScrapeYandex exactly the same way every other preflight
// rejection is, so no new wiring is tested here beyond the value itself.
describe("novadaScrapeYandex — known-broken param value (F7): yandex_domain='yandex.com' rejected pre-flight", () => {
  it("rejects yandex_domain='yandex.com' BEFORE any network call, naming yandex.ru/yandex.com.tr as working alternatives", async () => {
    mockSuccess(MOCK_RECORDS); // if this were reached, the mock would let it "succeed" — proves rejection happens first
    let thrown: unknown;
    try {
      await novadaScrapeYandex(
        validateScrapeYandexParams({ operation: "web_search", params: { q: "test", yandex_domain: "yandex.com" } }),
        "test-key",
      );
    } catch (e) {
      thrown = e;
    }
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(thrown).toBeDefined();
    const message = (thrown as Error).message;
    expect(message).toContain("yandex.com");
    expect(message.toLowerCase()).toContain("known-broken");
    const agentInstruction = (thrown as { agent_instruction?: string }).agent_instruction ?? "";
    expect(agentInstruction).toContain("yandex.ru");
    expect(agentInstruction).toContain("yandex.com.tr");
  });

  it("yandex_domain='yandex.ru' (a working alternative) still passes preflight and reaches the network call", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYandex(
      validateScrapeYandexParams({ operation: "web_search", params: { q: "test", yandex_domain: "yandex.ru" } }),
      "test-key",
    );
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it("yandex_domain='yandex.com.tr' (the other working alternative) also passes preflight", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeYandex(
      validateScrapeYandexParams({ operation: "web_search", params: { q: "test", yandex_domain: "yandex.com.tr" } }),
      "test-key",
    );
    expect(mockedAxios.post).toHaveBeenCalled();
  });
});
