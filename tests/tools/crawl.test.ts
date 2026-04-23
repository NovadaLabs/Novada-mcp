import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaCrawl } from "../../src/tools/crawl.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => { vi.clearAllMocks(); });

describe("novadaCrawl", () => {
  it("crawls multiple pages and returns content", async () => {
    mockedAxios.get.mockResolvedValue({
      data: `<html><body>
        <h1>Page Title</h1>
        <p>${"word ".repeat(30)}</p>
        <a href="https://example.com/page2">Page 2</a>
      </body></html>`,
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 2, strategy: "bfs", render: "static" },
      "test-key"
    );

    expect(result).toContain("Crawl Results");
    expect(result).toContain("https://example.com");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("returns error message when site is unreachable", async () => {
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await novadaCrawl(
      { url: "https://unreachable.example.com", max_pages: 1, strategy: "bfs", render: "static" },
      "test-key"
    );

    expect(result).toContain("Failed to crawl");
  });

  it("escalates to render mode when auto-detecting JS-heavy content", async () => {
    // First call: returns JS-heavy content (Cloudflare-like)
    // Subsequent calls: return good content
    let callCount = 0;
    mockedAxios.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First fetch: JS-heavy
        return Promise.resolve({
          data: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
          status: 200, headers: {}, config: {} as never, statusText: "OK",
        });
      }
      // Re-fetch with render: good content
      return Promise.resolve({
        data: `<html><body><h1>Real Content</h1><p>${"word ".repeat(30)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 1, strategy: "bfs", render: "auto" },
      "test-key"
    );

    // Should have been called at least twice (once static, once render re-fetch)
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(result).toContain("Real Content");
  });

  it("respects max_pages limit", async () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="https://example.com/page${i}">p${i}</a>`).join("");
    mockedAxios.get.mockResolvedValue({
      data: `<html><body><p>${"text ".repeat(50)}</p>${links}</body></html>`,
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 3, strategy: "bfs", render: "static" },
      "test-key"
    );

    const pageCount = (result.match(/###/g) || []).length;
    expect(pageCount).toBeLessThanOrEqual(3);
  });
});
