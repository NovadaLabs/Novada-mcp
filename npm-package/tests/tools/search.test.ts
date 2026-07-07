import { describe, it, expect, vi, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { novadaSearch } from "../../src/tools/search.js";
import { validateSearchParams } from "../../src/tools/types.js";
import * as extractModule from "../../src/tools/extract.js";
import { NovadaErrorCode } from "../../src/_core/errors.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

/** Mock the 2-step scraper flow: POST returns task_id, GET returns results. */
function mockGoogleSuccess(results: Array<{ title: string; url: string; description: string }>) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, data: { task_id: "task-google-1" } },
  });
  mockedAxios.get.mockResolvedValue({
    data: { organic_results: results },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novadaSearch", () => {
  it("returns formatted results on success", async () => {
    mockGoogleSuccess([
      { title: "Result 1", url: "https://example.com/1", description: "Desc 1" },
      { title: "Result 2", url: "https://example.com/2", description: "Desc 2" },
    ]);

    const result = await novadaSearch({ query: "test query", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Result 1");
    expect(result).toContain("https://example.com/1");
    expect(result).toContain("Result 2");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it("returns 'no results' when organic_results is empty", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-empty" } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [] },
    });

    const result = await novadaSearch({ query: "obscure query", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("No results found for:");
    expect(result).toContain("novada_research");
  });

  it("returns SERP unavailable on code 402 (no SERP quota)", async () => {
    // submitSearchScrapeTask throws for non-zero codes; novadaSearch catches and returns SERP_UNAVAILABLE
    mockedAxios.post.mockResolvedValue({
      data: { code: 402, msg: "Api Key error: User has no permission" },
    });

    const result = await novadaSearch({ query: "test", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Search Unavailable");
  });

  it("handles flat organic_results from poll endpoint (no spider_code wrapper)", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-flat" } },
    });
    // Poll returns direct object (no {spider_code, rest} envelope)
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "Flat Result", url: "https://flat.com", snippet: "A snippet" }] },
    });

    const result = await novadaSearch({ query: "test", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Flat Result");
    expect(result).toContain("https://flat.com");
  });

  it("classifies a transient 404 as retryable API_DOWN, not permanent SERP-unavailable (H3)", async () => {
    // H3: a 404/network blip is NOT an entitlement problem. It must surface as a
    // transient, retryable API_DOWN — never as "SERP not available for this API key"
    // (which would send the agent/customer down a false "contact support" path).
    // SERP_UNAVAILABLE is now reserved for genuine 401/402/403/quota codes.
    const err = new AxiosError("Not Found", "ERR_BAD_RESPONSE");
    Object.defineProperty(err, "response", { value: { status: 404, data: "404 page not found" } });
    mockedAxios.post.mockRejectedValue(err);

    await expect(
      novadaSearch({ query: "test-404-unique", engine: "google", num: 10, country: "", language: "" }, API_KEY)
    ).rejects.toMatchObject({ code: NovadaErrorCode.API_DOWN, retryable: true });
  });

  it("passes query to scraper API POST body", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-params" } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "T", url: "https://t.com", description: "D" }] },
    });

    await novadaSearch({ query: "site test", engine: "google", num: 5, country: "de", language: "de" }, API_KEY);
    const postBody = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
    expect(postBody.get("q")).toBe("site test");
    expect(postBody.get("scraper_name")).toBe("google.com");
  });

  it("appends extracted content to search results when extract_options provided", async () => {
    mockGoogleSuccess([
      { title: "R1", url: "https://example.com/1", description: "D1" },
      { title: "R2", url: "https://example.com/2", description: "D2" },
      { title: "R3", url: "https://example.com/3", description: "D3" },
      { title: "R4", url: "https://example.com/4", description: "D4" },
      { title: "R5", url: "https://example.com/5", description: "D5" },
    ]);

    const novadaExtractSpy = vi.spyOn(extractModule, "novadaExtract").mockImplementation(async (params) => {
      return `Extracted content for ${(params as { url: string }).url}`;
    });

    const result = await novadaSearch(
      {
        query: "test-extract-opts",
        engine: "google",
        num: 10,
        country: "",
        language: "",
        extract_options: { format: "markdown", top_n: 3 },
      },
      API_KEY
    );

    expect(result).toContain("Extracted content for https://example.com/1");
    expect(result).toContain("Extracted content for https://example.com/2");
    expect(result).toContain("Extracted content for https://example.com/3");
    expect(result).not.toContain("Extracted content for https://example.com/4");
    expect(result).not.toContain("Extracted content for https://example.com/5");
    expect(novadaExtractSpy).toHaveBeenCalledTimes(3);
    novadaExtractSpy.mockRestore();
  });

  it("search still works without extract_options (backward compat)", async () => {
    mockGoogleSuccess([{ title: "Result A", url: "https://example.com/a", description: "Desc A" }]);

    const result = await novadaSearch(
      { query: "test-no-extract", engine: "google", num: 10, country: "", language: "" },
      API_KEY
    );

    expect(result).toContain("Result A");
    expect(result).not.toContain("extracted_content");
    expect(result).not.toContain("extract_error");
  });

  it("individual extract failure does not fail the search call", async () => {
    mockGoogleSuccess([
      { title: "Good", url: "https://example.com/good", description: "Good page" },
      { title: "Bad", url: "https://example.com/bad", description: "Bad page" },
      { title: "Also Good", url: "https://example.com/ok", description: "OK page" },
    ]);

    const novadaExtractSpy = vi.spyOn(extractModule, "novadaExtract").mockImplementation(async (params) => {
      const url = (params as { url: string }).url;
      if (url === "https://example.com/bad") {
        throw new Error("Connection refused");
      }
      return `Content for ${url}`;
    });

    const result = await novadaSearch(
      {
        query: "test-extract-fail",
        engine: "google",
        num: 10,
        country: "",
        language: "",
        extract_options: { format: "markdown", top_n: 3 },
      },
      API_KEY
    );

    expect(result).toContain("Good");
    expect(result).toContain("Bad");
    expect(result).toContain("Content for https://example.com/good");
    expect(result).toContain("Content for https://example.com/ok");
    expect(result).toContain("extract_error:");
    expect(result).toContain("Connection refused");

    novadaExtractSpy.mockRestore();
  });

  // ─── NOV-567: source authority / exclude_social ─────────────────────────────

  it("exclude_social drops social + PR results from the response", async () => {
    mockGoogleSuccess([
      { title: "Acme on PRNewswire", url: "https://www.prnewswire.com/news/acme", description: "press release" },
      { title: "Acme reported by Reuters", url: "https://www.reuters.com/markets/acme", description: "news" },
      { title: "Acme on LinkedIn", url: "https://www.linkedin.com/company/acme", description: "profile" },
      { title: "Acme blog", url: "https://acme.example.com/blog", description: "company blog" },
    ]);

    const result = await novadaSearch(
      { query: "acme-excludesocial-unique", engine: "google", num: 10, country: "", language: "", exclude_social: true },
      API_KEY
    );

    // Social/PR domains removed
    expect(result).not.toContain("prnewswire.com");
    expect(result).not.toContain("linkedin.com");
    // Authoritative + neutral kept
    expect(result).toContain("reuters.com");
    expect(result).toContain("acme.example.com");
    expect(result).toContain("exclude_social:true");
  });

  it("exclude_social on an all-social SERP reports no results", async () => {
    mockGoogleSuccess([
      { title: "X post", url: "https://x.com/acme", description: "tweet" },
      { title: "Reddit thread", url: "https://www.reddit.com/r/acme/x", description: "thread" },
    ]);

    const result = await novadaSearch(
      { query: "acme-allsocial-unique", engine: "google", num: 10, country: "", language: "", exclude_social: true },
      API_KEY
    );
    expect(result).toContain("No results found for:");
  });

  it("source_type=research appends social/PR exclusions to the query", async () => {
    mockedAxios.post.mockResolvedValue({ data: { code: 0, data: { task_id: "task-src" } } });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "Study", url: "https://arxiv.org/abs/1", description: "paper" }] },
    });

    await novadaSearch(
      { query: "acme clinical study", engine: "google", num: 10, country: "", language: "", source_type: "research" },
      API_KEY
    );

    const postBody = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
    const q = postBody.get("q") ?? "";
    expect(q).toContain("acme clinical study");
    expect(q).toContain("-site:prnewswire.com");
    expect(q).toContain("-site:reddit.com");
  });

  // ─── Bing removed from engine enum (TOW2-256 T3.2) ──────────────────────────

  it("rejects engine:'bing' with ZodError (bing removed from enum)", () => {
    expect(() => validateSearchParams({ query: "test", engine: "bing" as never })).toThrow();
  });
});
