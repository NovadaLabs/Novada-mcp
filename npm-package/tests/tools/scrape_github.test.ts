/**
 * novada_scrape_github — wire-format proof.
 *
 * Mirrors scrape_amazon.test.ts's proof pattern. All 3 github.com catalog operations
 * are "params" format (Format B), so every op threads params via scraper_params.
 *
 * No AND-required ops in this family: each github.com catalog op has exactly one
 * required:true key. repository_by_url and repository_details_by_url both take the
 * same `url` param but resolve to DIFFERENT catalog scraper_ids (github_repository_repo-url
 * vs github_repository_url) — see scrape_github.ts's own comment on this duplication.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const { novadaScrapeGithub, validateScrapeGithubParams, GITHUB_OPERATIONS } =
  await import("../../src/tools/scrape_github.js");

const MOCK_RECORDS = [{ name: "gin-gonic/gin", stars: "82000", language: "Go" }];

const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "github-task-1" }, msg: "success" }, msg: "success" },
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

describe("novadaScrapeGithub — request format (wire-format proof)", () => {
  it("repository_by_url sends scraper_name=github.com, scraper_id=github_repository_repo-url, and threads url via scraper_params (Format B)", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGithub(
      validateScrapeGithubParams({ operation: "repository_by_url", params: { url: "https://github.com/gin-gonic/gin" } }),
      "test-key",
    );

    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");

    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("github.com");
    expect(form.get("scraper_id")).toBe("github_repository_repo-url");

    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].url).toBe("https://github.com/gin-gonic/gin");

    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("repository_details_by_url resolves to the DIFFERENT scraper_id=github_repository_url (not repo-url) for the same url param shape", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrapeGithub(
      validateScrapeGithubParams({ operation: "repository_details_by_url", params: { url: "https://github.com/QwenLM/Qwen" } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("github_repository_url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].url).toBe("https://github.com/QwenLM/Qwen");
  });

  it("repositories_by_search_url resolves to scraper_id=github_repository_search-url and threads search_url", async () => {
    mockSuccess(MOCK_RECORDS);
    const searchUrl = "https://github.com/search?q=ai&type=repositories";
    await novadaScrapeGithub(
      validateScrapeGithubParams({ operation: "repositories_by_search_url", params: { search_url: searchUrl } }),
      "test-key",
    );
    const [, body] = mockedAxios.post.mock.calls[0];
    const form = body as URLSearchParams;
    expect(form.get("scraper_id")).toBe("github_repository_search-url");
    const scraperParams = JSON.parse(form.get("scraper_params")!);
    expect(scraperParams[0].search_url).toBe(searchUrl);
  });
});

describe("novadaScrapeGithub — enum safety (only catalog-'ok' operations reachable)", () => {
  it("GITHUB_OPERATIONS has exactly 3 entries", () => {
    expect(Object.values(GITHUB_OPERATIONS)).toHaveLength(3);
  });

  it("repository_by_url and repository_details_by_url map to two DISTINCT catalog slugs (no accidental collapse to the same op)", () => {
    expect(GITHUB_OPERATIONS.repository_by_url).not.toBe(GITHUB_OPERATIONS.repository_details_by_url);
  });

  it("rejects an unknown/typo'd operation name", () => {
    expect(() => validateScrapeGithubParams({ operation: "totally_made_up", params: {} })).toThrow();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("every GITHUB_OPERATIONS slug exists in the live github.com catalog with status 'ok' (no backend_broken github.com ops exist to exclude — verified against the whole platform block, not just the mapped slugs)", async () => {
    const { CATALOG_BY_DOMAIN, SCRAPER_CATALOG } = await import("../../src/data/scraper_catalog.js");
    const githubCatalog = CATALOG_BY_DOMAIN.get("github.com");
    expect(githubCatalog, "github.com missing from the live catalog").toBeDefined();
    for (const [friendlyName, slug] of Object.entries(GITHUB_OPERATIONS)) {
      const op = githubCatalog!.get(slug);
      expect(op, `operation '${friendlyName}' maps to slug '${slug}', which is not in the live github.com catalog`).toBeDefined();
      expect(op!.status, `operation '${friendlyName}' (slug '${slug}') is backend_broken in the live catalog`).toBe("ok");
    }
    const githubPlatform = SCRAPER_CATALOG.find((p) => p.domain === "github.com");
    expect(githubPlatform!.ops.every((op) => op.status === "ok"), "github.com catalog has a backend_broken op not reflected in this assertion").toBe(true);
  });
});
