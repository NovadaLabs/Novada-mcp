/**
 * novada_scrape_perplexity — wire-format proof + ChatGPT-exclusion confirmation.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. Both perplexity.ai catalog operations
 * are "params" format (Format B), so both thread params via scraper_params.
 *
 * ChatGPT confirmation (per the Tools-v2 FINAL platform-scraper pass brief): chatgpt.com
 * is Perplexity's sibling AI-answer platform in the catalog, but has NO
 * novada_scrape_chatgpt tool because BOTH of its catalog operations
 * (chatgpt_answer_searchterm, chatgpt_answer_url) are status:"backend_broken"
 * ("submit hangs >120s — scraper likely disabled/broken", verified 2026-07-13) — a tool
 * exposing zero working operations would be worse than no tool at all. This is asserted
 * directly against the live catalog below, and cross-checked against
 * PLATFORM_SCRAPER_TOOLS to prove no novada_scrape_chatgpt tool was ever registered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapePerplexity, validateScrapePerplexityParams, PERPLEXITY_OPERATIONS } =
  await import("../../src/tools/scrape_perplexity.js");

const MOCK_RECORDS = [{ answer: "Apple is a technology company and fruit." }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "perplexity-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapePerplexity — request format (wire-format proof)", () => {
  it("answer_by_url sends scraper_name=perplexity.ai, scraper_id=perplexity_answer_url, and threads url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapePerplexity(
      validateScrapePerplexityParams({ operation: "answer_by_url", params: { url: "https://www.perplexity.ai/?q=apple" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("perplexity.ai");
    expect(form.get("scraper_id")).toBe("perplexity_answer_url");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].url).toBe("https://www.perplexity.ai/?q=apple");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("answer_by_search_term resolves to scraper_id=perplexity_answer_searchterm and threads search_terms", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapePerplexity(
      validateScrapePerplexityParams({ operation: "answer_by_search_term", params: { search_terms: "Today's weather" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("perplexity_answer_searchterm");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].search_terms).toBe("Today's weather");
  });
});

describe("novadaScrapePerplexity — enum safety (only catalog-'ok' operations reachable)", () => {
  it("PERPLEXITY_OPERATIONS has exactly 2 entries", () => {
    expect(Object.values(PERPLEXITY_OPERATIONS)).toHaveLength(2);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapePerplexityParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every PERPLEXITY_OPERATIONS slug exists in the live perplexity.ai catalog with status 'ok' (no backend_broken perplexity.ai ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const perplexityCatalog = CATALOG_BY_DOMAIN.get("perplexity.ai");
    expect(perplexityCatalog, "perplexity.ai missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(PERPLEXITY_OPERATIONS)) {
      const op = perplexityCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live perplexity.ai catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const perplexityPlatform = SCRAPER_CATALOG.find((p) => p.domain === "perplexity.ai");
    expect(perplexityPlatform!.ops.every((op) => op.status === "ok"), "perplexity.ai catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});

describe("ChatGPT exclusion confirmation (chatgpt.com has ZERO status:'ok' operations)", () => {
  it("chatgpt.com's catalog block exists and has exactly 2 operations, BOTH status:'backend_broken'", async () => {
    const { SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const chatgptPlatform = SCRAPER_CATALOG.find((p) => p.domain === "chatgpt.com");
    expect(chatgptPlatform, "chatgpt.com missing from the live catalog").toBeDefined();
    expect(chatgptPlatform!.ops).toHaveLength(2);
    expect(chatgptPlatform!.ops.map((op) => op.slug).sort()).toEqual([
      "chatgpt_answer_searchterm",
      "chatgpt_answer_url",
    ]);
    for (const op of chatgptPlatform!.ops) {
      expect(op.status, `chatgpt.com op '${op.slug}' is not backend_broken — the ChatGPT-exclusion premise no longer holds; re-evaluate whether novada_scrape_chatgpt should now be added`).toBe("backend_broken");
    }
  });

  it("no novada_scrape_chatgpt tool is registered in PLATFORM_SCRAPER_TOOLS (a tool with zero working operations is worse than no tool)", async () => {
    const { PLATFORM_SCRAPER_TOOLS } = await import("../../src/tools/platform_scrapers.js");
    const names = PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name);
    expect(names).not.toContain("novada_scrape_chatgpt");
    const chatgptConfigured = PLATFORM_SCRAPER_TOOLS.some((t) => t.config.platform === "chatgpt.com");
    expect(chatgptConfigured, "no platform-scraper config should ever pin platform=\"chatgpt.com\" while every chatgpt.com op is backend_broken").toBe(false);
  });
});
