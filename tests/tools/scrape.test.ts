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

// Submit response: { code:0, data: { code:200, data: { task_id:"..." } } }
const SUBMIT_OK = {
  data: { code: 0, data: { code: 200, data: { task_id: "test-task-123" }, msg: "success" }, msg: "success" },
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

function mockApiError(code: number, msg: string) {
  mockedAxios.post.mockResolvedValue({
    data: { code, data: null, msg },
    status: 200,
    headers: {},
    config: {} as never,
    statusText: "OK",
  });
}

function mockTaskError(errMsg: string, errCode?: number) {
  mockedAxios.post.mockResolvedValue(SUBMIT_OK);
  mockedAxios.get.mockResolvedValue({
    data: [{ error: errMsg, ...(errCode !== undefined ? { error_code: errCode } : {}) }],
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
    const form = body as URLSearchParams;
    expect(form.get("scraper_name")).toBe("amazon.com");
    expect(form.get("scraper_id")).toBe("amazon_product_by-keywords");
    expect(form.get("keyword")).toBe("iphone");
    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("polls the download endpoint with task_id and apikey", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(mockedAxios.get).toHaveBeenCalled();
    const [url] = mockedAxios.get.mock.calls[0];
    expect(url).toContain("api.novada.com");
    expect(url).toContain("scraper_download");
    expect(url).toContain("task_id=test-task-123");
    expect(url).toContain("apikey=test-key");
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

  it("retries polling when task is pending (code 27202)", async () => {
    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { code: 27202, data: null, msg: "" },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      })
      .mockResolvedValueOnce(makeDownloadOk(MOCK_RECORDS));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(result).toContain("iPhone 16 Pro");
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
  it("returns structured error string for code 11006 (account permissions)", async () => {
    mockApiError(11006, "Scraper error");
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.code).toBe(11006);
    expect(parsed.reason).toContain("not yet activated");
    expect(parsed.agent_instruction).toContain("Activate Scraper API");
    expect(parsed.alternatives).toBeInstanceOf(Array);
    expect(parsed.alternatives.length).toBeGreaterThan(0);
  });

  it("returns structured error string for code 11008 (bad platform name)", async () => {
    mockApiError(11008, "Scraper name error");
    const result = await novadaScrape(
      { platform: "bad-platform", operation: "something", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.reason).toContain("Unknown platform");
  });

  it("returns structured error string for code 11000 (invalid API key)", async () => {
    mockApiError(11000, "Invalid ApiKey");
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.reason).toContain("Invalid API key");
  });

  it("returns no-data message when API returns empty array", async () => {
    mockSuccess([]);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("No records returned");
  });

  it("returns structured error string when task fails with error in download result", async () => {
    mockTaskError("500 Internal Server Error", 500);
    const result = await novadaScrape(
      { platform: "google.com", operation: "google_search", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.reason).toContain("Scraper task failed");
  });

  it("returns structured error string on API-not-activated exception (code 11006)", async () => {
    // Arrange: mock the API call to throw an Error with "11006" in the message
    mockedAxios.post.mockRejectedValue(new Error("Scraper error (code 11006): Scraper API not yet activated on this account."));
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    // Assert: handler does NOT throw; returns string containing status and agent_instruction
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.code).toBe(11006);
    expect(parsed.agent_instruction).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("does not throw when API call throws — returns structured string", async () => {
    // Arrange: mock to throw a generic network error
    mockedAxios.post.mockRejectedValue(new Error("ECONNREFUSED network error"));
    // Assert: the handler does NOT throw; it returns a string containing "status" and "agent_instruction"
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: {}, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(typeof result).toBe("string");
    expect(result).toContain("status");
    expect(result).toContain("agent_instruction");
    const parsed = JSON.parse(result);
    expect(parsed.agent_instruction).toBeDefined();
  });
});
