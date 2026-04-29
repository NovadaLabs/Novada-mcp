import { describe, it, expect, vi, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { novadaSearch } from "../../src/tools/search.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novadaSearch", () => {
  it("returns formatted results on success", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        code: 200,
        data: {
          organic_results: [
            { title: "Result 1", url: "https://example.com/1", description: "Desc 1" },
            { title: "Result 2", url: "https://example.com/2", description: "Desc 2" },
          ],
        },
      },
    });

    const result = await novadaSearch({ query: "test query", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Result 1");
    expect(result).toContain("https://example.com/1");
    expect(result).toContain("Result 2");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("returns 'no results' when organic_results is empty", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 200, data: { organic_results: [] } },
    });

    const result = await novadaSearch({ query: "obscure query", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toBe("No results found for this query.");
  });

  it("returns SERP unavailable on code 402 (no SERP quota)", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 402, msg: "Api Key error：User has no permission" },
    });

    const result = await novadaSearch({ query: "test", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Search Unavailable");
  });

  it("handles flat organic_results (no data wrapper)", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        organic_results: [
          { title: "Flat Result", link: "https://flat.com", snippet: "A snippet" },
        ],
      },
    });

    const result = await novadaSearch({ query: "test", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Flat Result");
    expect(result).toContain("https://flat.com");
    expect(result).toContain("A snippet");
  });

  it("returns actionable SERP unavailable message on 404", async () => {
    const err = new AxiosError("Not Found", "ERR_BAD_RESPONSE");
    Object.defineProperty(err, "response", { value: { status: 404, data: "404 page not found" } });
    mockedAxios.post.mockRejectedValue(err);

    const result = await novadaSearch({ query: "test", engine: "google", num: 10, country: "", language: "" }, API_KEY);
    expect(result).toContain("Search Unavailable");
    expect(result).toContain("novada_extract");
    expect(result).toContain("novada_research");
    expect(result).not.toContain("Error [UNKNOWN]");
  });

  it("passes country/language params to API in POST body", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { data: { organic_results: [{ title: "T", url: "https://t.com", description: "D" }] } },
    });

    await novadaSearch({ query: "test", engine: "google", num: 5, country: "de", language: "de" }, API_KEY);
    const calledBody = mockedAxios.post.mock.calls[0][1] as { serpapi_query: Record<string, string> };
    expect(calledBody.serpapi_query.country).toBe("de");
    expect(calledBody.serpapi_query.language).toBe("de");
  });
});
