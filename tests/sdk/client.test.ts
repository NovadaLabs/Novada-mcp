import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { NovadaClient } from "../../src/sdk/index.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => { vi.clearAllMocks(); });

const client = new NovadaClient({ scraperApiKey: "test-key" });

describe("NovadaClient", () => {
  describe("search()", () => {
    it("returns typed SearchResult array", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          code: 200,
          data: {
            organic_results: [
              { title: "Result 1", url: "https://example.com", description: "Desc 1" },
            ],
          },
        },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const results = await client.search("test query");
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({ title: "Result 1", url: "https://example.com", snippet: "Desc 1" });
    });
  });

  describe("extract()", () => {
    it("returns typed ExtractResult", async () => {
      mockedAxios.get.mockResolvedValue({
        data: `<html><body><h1>Test Title</h1><p>${"content ".repeat(50)}</p></body></html>`,
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const result = await client.extract("https://example.com");
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBeTruthy();
      expect(typeof result.content).toBe("string");
      expect(typeof result.chars).toBe("number");
    });
  });

  describe("scrape()", () => {
    it("returns ScrapeResult with records and formatted string", async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          code: 0,
          data: [
            { title: "iPhone 16 Pro", price: "$999", asin: "B09X" },
            { title: "iPhone 16", price: "$799", asin: "B09Y" },
          ],
        },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      const result = await client.scrape("amazon.com", "amazon_product_by-keywords", { keyword: "iphone" }, { format: "json" });
      expect(result.platform).toBe("amazon.com");
      expect(result.operation).toBe("amazon_product_by-keywords");
      expect(result.records).toHaveLength(2);
      expect(result.records[0]).toMatchObject({ title: "iPhone 16 Pro" });
      expect(typeof result.formatted).toBe("string");
      expect(result.formatted).toContain("```json");
    });
  });

  describe("proxy()", () => {
    it("throws when proxy not configured", () => {
      const c = new NovadaClient({ scraperApiKey: "key" });
      expect(() => c.proxy({ type: "residential" })).toThrow("Proxy credentials not configured");
    });

    it("returns ProxyConfig when credentials provided", () => {
      const c = new NovadaClient({
        scraperApiKey: "key",
        proxy: { user: "user_ABC", pass: "pass", endpoint: "proxy.example.com:7777" },
      });

      const config = c.proxy({ type: "residential", country: "us" });
      expect(config.proxyUrl).toContain("proxy.example.com:7777");
      expect(config.username).toContain("country-us");
    });
  });

  describe("verify()", () => {
    it("returns VerifyResult with parsed verdict and confidence", async () => {
      // Mock 3 search calls: query 1 has 4 results (supporting), query 2 has 1 result (contra)
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            code: 200,
            data: {
              organic_results: [
                { title: "Support 1", url: "https://example.com/1", description: "Supporting snippet 1" },
                { title: "Support 2", url: "https://example.com/2", description: "Supporting snippet 2" },
                { title: "Support 3", url: "https://example.com/3", description: "Supporting snippet 3" },
                { title: "Support 4", url: "https://example.com/4", description: "Supporting snippet 4" },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            code: 200,
            data: {
              organic_results: [
                { title: "Contra 1", url: "https://contra.com/1", description: "Contradicting snippet" },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          data: { code: 200, data: { organic_results: [] } },
        });

      const result = await client.verify("The Eiffel Tower is located in Paris");

      expect(result.claim).toBe("The Eiffel Tower is located in Paris");
      expect(result.verdict).toBe("supported");
      expect(result.confidence).toBeGreaterThan(0);
      expect(typeof result.raw).toBe("string");
      expect(result.raw).toContain("## Claim Verification");
    });
  });
});
