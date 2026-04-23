import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Must come after mock setup
const { novadaScrape } = await import("../../src/tools/scrape.js");

const MOCK_RECORDS = [
  { title: "iPhone 16 Pro", price: "$999", rating: "4.8", asin: "B09G9FPHY6" },
  { title: "iPhone 16", price: "$799", rating: "4.6", asin: "B09G9FPHY7" },
];

function mockSuccess(records: unknown[]) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, data: records, msg: "" },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

function mockApiError(code: number, msg: string) {
  mockedAxios.post.mockResolvedValue({
    data: { code, data: null, msg },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novadaScrape — output formats", () => {
  it("returns markdown table by default", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("## Scrape Results");
    expect(result).toContain("amazon.com");
    expect(result).toContain("amazon_product_by-keywords");
    expect(result).toContain("iPhone 16 Pro");
    expect(result).toContain("|"); // markdown table
  });

  it("returns JSON fenced block for format=json", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "json", limit: 20 },
      "test-key"
    );
    expect(result).toContain("```json");
    const jsonMatch = result.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("iPhone 16 Pro");
  });

  it("returns CSV fenced block for format=csv", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "csv", limit: 20 },
      "test-key"
    );
    expect(result).toContain("```csv");
    expect(result).toContain("title,price,rating,asin");
    expect(result).toContain("iPhone 16 Pro");
  });

  it("returns HTML string for format=html", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "html", limit: 20 },
      "test-key"
    );
    expect(result).toContain("<table>");
    expect(result).toContain("<th>title</th>");
    expect(result).toContain("iPhone 16 Pro");
  });

  it("returns base64 xlsx block for format=xlsx", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "xlsx", limit: 20 },
      "test-key"
    );
    expect(result).toContain("base64");
    const b64Match = result.match(/```\n([A-Za-z0-9+/=\n]+)\n```/);
    expect(b64Match).not.toBeNull();
    // Verify it's valid base64 by decoding
    const buf = Buffer.from(b64Match![1].trim(), "base64");
    // xlsx is zip — PK header
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

describe("novadaScrape — request format", () => {
  it("sends correct scraper_name, scraper_id, and operation params", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone", num: 5 }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("scraper.novada.com");
    expect((body as Record<string, unknown>).scraper_name).toBe("amazon.com");
    expect((body as Record<string, unknown>).scraper_id).toBe("amazon_product_by-keywords");
    expect((body as Record<string, unknown>).keyword).toBe("iphone");
    expect((config as Record<string, unknown>).headers).toMatchObject({ "Authorization": "Bearer test-key" });
  });

  it("respects limit — truncates records to limit", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Product ${i}` }));
    mockSuccess(many);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "json", limit: 10 },
      "test-key"
    );
    const jsonMatch = result.match(/```json\n([\s\S]+?)\n```/);
    const parsed = JSON.parse(jsonMatch![1]);
    expect(parsed).toHaveLength(10);
  });
});

describe("novadaScrape — flattenRecord edge cases", () => {
  it("flattens array-of-objects fields into indexed keys", async () => {
    const nested = [{ title: "Product", images: [{ url: "http://a.com/1.jpg" }, { url: "http://b.com/2.jpg" }] }];
    mockSuccess(nested);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("images.0.url");
    expect(result).toContain("images.1.url");
  });

  it("flattens deeply nested objects with dot-path keys", async () => {
    const nested = [{ title: "X", price: { value: "999", currency: "USD" } }];
    mockSuccess(nested);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("price.value");
    expect(result).toContain("price.currency");
  });
});

describe("novadaScrape — error handling", () => {
  it("throws with actionable message for code 11006 (account permissions)", async () => {
    mockApiError(11006, "Scraper error");
    await expect(
      novadaScrape({ platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 }, "test-key")
    ).rejects.toThrow("Scraper access not enabled");
  });

  it("throws with actionable message for code 11008 (bad platform name)", async () => {
    mockApiError(11008, "Scraper name error");
    await expect(
      novadaScrape({ platform: "bad-platform", operation: "something", params: {}, format: "markdown", limit: 20 }, "test-key")
    ).rejects.toThrow("Unknown platform");
  });

  it("throws for code 11000 (invalid API key)", async () => {
    mockApiError(11000, "Invalid ApiKey");
    await expect(
      novadaScrape({ platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 }, "test-key")
    ).rejects.toThrow("Invalid API key");
  });

  it("returns no-data message when API returns empty array", async () => {
    mockSuccess([]);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("No records returned");
  });
});
