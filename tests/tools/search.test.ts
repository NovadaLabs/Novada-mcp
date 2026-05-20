import { describe, it, expect, vi, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { novadaSearch } from "../../src/tools/search.js";
import * as extractModule from "../../src/tools/extract.js";

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

  it("returns SERP unavailable on 404 (endpoint not deployed)", async () => {
    const err = new AxiosError("Not Found", "ERR_BAD_RESPONSE");
    Object.defineProperty(err, "response", { value: { status: 404, data: "404 page not found" } });
    mockedAxios.post.mockRejectedValue(err);

    const result = await novadaSearch({ query: "test", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Search Unavailable");
    expect(result).toContain("novada_extract");
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
        query: "test",
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
      { query: "test", engine: "google", num: 10, country: "", language: "" },
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
        query: "test",
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

  // ─── Bing-specific regression tests ─────────────────────────────────────────

  it("Bing: uses a_auto_push=false (not is_auto_push)", async () => {
    // regression: wrong param name caused null response every time
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { data: { task_id: "task-bing-1" } } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "Bing Result", url: "https://bing.com/r", description: "A snippet" }] },
    });

    await novadaSearch({ query: "test", engine: "bing", num: 5, country: "", language: "" }, API_KEY);

    const postBody = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
    expect(postBody.get("a_auto_push")).toBe("false");
    expect(postBody.get("is_auto_push")).toBeNull(); // must NOT use the wrong field
  });

  it("Bing: retries on null data and succeeds on second attempt", async () => {
    // regression: ~20% of Bing calls return data.data.data=null — retry must recover
    mockedAxios.post
      .mockResolvedValueOnce({ data: { code: 0, data: { data: null } } })          // null → retry
      .mockResolvedValueOnce({ data: { code: 0, data: { data: { task_id: "task-bing-retry" } } } }); // succeeds

    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "Retried Bing", url: "https://example.com", description: "Desc" }] },
    });

    const result = await novadaSearch({ query: "test", engine: "bing", num: 5, country: "", language: "" }, API_KEY);
    expect(result).toContain("Retried Bing");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2); // one retry
  });

  it("Bing: falls back to HTML parsing when no task_id", async () => {
    const bingHtml = `<ul><li class="b_algo"><h2><a href="https://example.com/bing">Bing HTML Title</a></h2><div class="b_caption"><p>HTML snippet</p></div></li></ul>`;
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { data: { html: bingHtml } } }, // html present, no task_id
    });

    const result = await novadaSearch({ query: "test", engine: "bing", num: 5, country: "", language: "" }, API_KEY);
    expect(result).toContain("Bing HTML Title");
    expect(result).toContain("https://example.com/bing");
  });

  it("Bing: returns empty gracefully after 3 null responses (no crash)", async () => {
    mockedAxios.post.mockResolvedValue({ data: { code: 0, data: { data: null } } });

    const result = await novadaSearch({ query: "test", engine: "bing", num: 5, country: "", language: "" }, API_KEY);
    expect(result).toContain("No results found for:");
    expect(mockedAxios.post).toHaveBeenCalledTimes(3); // all 3 retries exhausted
  });

  it("Bing: task_id resolved from inner.data.task_id (not inner.task_id)", async () => {
    // regression: task_id is one level deeper than the google path
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { data: { task_id: "deep-task-id" } } }, // data.data.task_id
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [{ title: "Deep Path", url: "https://deep.com", description: "d" }] },
    });

    const result = await novadaSearch({ query: "test", engine: "bing", num: 5, country: "", language: "" }, API_KEY);
    expect(result).toContain("Deep Path");
    // Verify the get call used the task_id from the deep path
    const getUrl = mockedAxios.get.mock.calls[0][0] as string;
    expect(getUrl).toContain("deep-task-id");
  });
});
