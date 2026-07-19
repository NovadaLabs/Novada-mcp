import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { NovadaError, NovadaErrorCode } from "../../src/_core/errors.js";

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
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "html", limit: 20 },
      "test-key"
    );
    expect(result).toContain("<table>");
    expect(result).toContain("<th>title</th>");
    expect(result).toContain("iPhone 16 Pro");
  });

  it("returns base64 xlsx block for format=xlsx", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "xlsx", limit: 20 },
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

  it("returns base64 xlsx block for format=excel (MCP schema alias)", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "excel", limit: 20 },
      "test-key"
    );
    expect(result).toContain("base64");
    expect(result).toContain("format: excel");
    const b64Match = result.match(/```\n([A-Za-z0-9+/=\n]+)\n```/);
    expect(b64Match).not.toBeNull();
    // Verify base64 decodes to a real xlsx (zip PK header)
    const buf = Buffer.from(b64Match![1].trim(), "base64");
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
  });

  it("CSV has header row and data rows", async () => {
    mockSuccess(MOCK_RECORDS);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "csv", limit: 20 },
      "test-key"
    );
    const csvMatch = result.match(/```csv\n([\s\S]+?)\n```/);
    expect(csvMatch).not.toBeNull();
    const lines = csvMatch![1].trim().split("\n");
    // Header row present
    expect(lines[0]).toContain("title");
    // At least 2 data rows
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 records
    // Data row contains the first record's title
    expect(lines.slice(1).some(l => l.includes("iPhone 16 Pro"))).toBe(true);
  });

  it("CSV drops base64 blob columns and RFC-4180 quotes comma cells", async () => {
    // A favicon/image base64 data URI (useless in a spreadsheet) + a long unbroken
    // base64 blob + a title containing a comma (must be quoted to round-trip).
    const bigBlob = "A".repeat(300); // 300-char unbroken base64-looking token
    const recs = [
      {
        title: "Widget, Deluxe Edition",
        price: "$19",
        favicon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAA==",
        thumbnail: bigBlob,
        url: "https://example.com/widget",
      },
      {
        title: "Gadget",
        price: "$29",
        favicon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAA==",
        thumbnail: bigBlob,
        url: "https://example.com/gadget",
      },
    ];
    mockSuccess(recs);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "widget" }, format: "csv", limit: 20 },
      "test-key"
    );
    const csvMatch = result.match(/```csv\n([\s\S]+?)\n```/);
    expect(csvMatch).not.toBeNull();
    const csv = csvMatch![1];

    // 1. Base64 blobs must NOT appear anywhere in the CSV.
    expect(csv).not.toContain("data:image");
    expect(csv).not.toContain(bigBlob);
    // The blob column headers should be dropped too.
    const header = csv.split("\n")[0];
    expect(header).not.toContain("favicon");
    expect(header).not.toContain("thumbnail");
    // Useful columns survive, key columns lead (title first).
    expect(header.startsWith("title")).toBe(true);
    expect(header).toContain("price");
    expect(header).toContain("url");

    // 2. The comma-containing title cell must be RFC-4180 quoted so it round-trips.
    expect(csv).toContain('"Widget, Deluxe Edition"');
    // Parse the first data row respecting quotes → the title field is intact.
    const firstDataRow = csv.split("\n")[1];
    const cells = parseCsvLine(firstDataRow);
    expect(cells[0]).toBe("Widget, Deluxe Edition"); // comma preserved inside one cell
    expect(cells[1]).toBe("$19");
  });
});

/** Minimal RFC-4180 line parser for test assertions (handles quoted commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

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
    // scrape.ts resolves the legacy alias "amazon_product_by-keywords" to the
    // canonical "amazon_product_keywords" (OPERATION_ALIASES) BEFORE calling
    // submitScrapeTask, so the wire-level scraper_id is the canonical slug.
    expect(form.get("scraper_id")).toBe("amazon_product_keywords");
    // amazon_product_keywords is catalog format:"params" (Format B) — op params
    // are sent as a JSON array under scraper_params, not as flat form fields
    // (see src/data/scraper_catalog.ts + submitScrapeTask's per-op format lookup).
    const scraperParamsRaw = form.get("scraper_params");
    expect(scraperParamsRaw).not.toBeNull();
    const scraperParams = JSON.parse(scraperParamsRaw!);
    expect(scraperParams[0].keyword).toBe("iphone");
    expect((config as Record<string, unknown>).headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("polls the download endpoint with task_id and apikey", async () => {
    mockSuccess(MOCK_RECORDS);
    await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
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
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "json", limit: 10 },
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
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
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
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("images.0.url");
    expect(result).toContain("images.1.url");
  });

  it("flattens deeply nested objects with dot-path keys", async () => {
    const nested = [{ title: "X", price: { value: "999", currency: "USD" } }];
    mockSuccess(nested);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("price.value");
    expect(result).toContain("price.currency");
  });
});

// NOTE: novadaScrape's error contract changed from catch-and-return-a-JSON-string
// to THROW a typed NovadaError (or, for a few raw upstream messages, a plain
// Error) — see the try/catch wrapping the whole function body in scrape.ts.
// index.ts is what turns a thrown error into isError:true for the MCP response;
// the tool function itself no longer swallows errors into a JSON envelope.
describe("novadaScrape — error handling", () => {
  it("throws PRODUCT_UNAVAILABLE (not_activated) for code 11006 (account permissions)", async () => {
    mockApiError(11006, "Scraper error");
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    // amazon_product_keywords (canonical, resolved from the alias) IS in the active
    // catalog, so 11006 here means "not activated on this account" (not unknown op).
    expect(err.code).toBe(NovadaErrorCode.PRODUCT_UNAVAILABLE);
    expect(err.detail).toBe("not_activated");
    expect(err.message).toContain("not_activated");
    expect(err.message).toContain("not activated on this account");
    expect(err.message).toContain("dashboard.novada.com/overview/products");
  });

  it("throws INVALID_PARAMS for code 11008 (bad platform name)", async () => {
    mockApiError(11008, "Scraper name error");
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "bad-platform", operation: "something", params: {}, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    expect(err.code).toBe(NovadaErrorCode.INVALID_PARAMS);
    expect(err.detail).toBe("code 11008");
    expect(err.message).toContain("Unknown platform");
  });

  it("throws a plain Error for code 11000 (invalid API key)", async () => {
    mockApiError(11000, "Invalid ApiKey");
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    // Code 11000 falls through submitScrapeTask's generic errorMessages map and
    // throws a plain Error (not a typed NovadaError) — the index.ts dispatch
    // layer classifies it via classifyError, not the tool itself.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Scraper error (code 11000): Invalid API key.");
  });

  it("returns no-data message when API returns empty array", async () => {
    mockSuccess([]);
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
      "test-key"
    );
    expect(result).toContain("No records returned");
  });

  it("throws API_DOWN when task fails with error in download result", async () => {
    mockTaskError("500 Internal Server Error", 500);
    let thrown: unknown;
    try {
      await novadaScrape(
        // q is required by preflightScrape for google_search (SEARCH_QUERY_KEYS);
        // the original empty params:{} tripped the missing-param preflight check
        // instead of ever reaching the download-error path this test targets.
        { platform: "google.com", operation: "google_search", params: { q: "test" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    expect(err.code).toBe(NovadaErrorCode.API_DOWN);
    expect(err.message).toContain("all failed");
    expect(err.message).toContain("error_code: 500");
  });

  it("throws with an embedded 11006 hint when the raw upstream exception message mentions it", async () => {
    // Arrange: axios.post itself REJECTS with a plain Error whose text happens to
    // mention "code 11006" — this is NOT the same path as submitScrapeTask's own
    // typed `body.code === 11006` branch (that one throws a NovadaError). A raw
    // exception from the HTTP call is not specially reclassified; it propagates
    // as the same plain Error all the way out of novadaScrape.
    mockedAxios.post.mockRejectedValue(new Error("Scraper error (code 11006): Scraper API not yet activated on this account."));
    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(NovadaError);
    expect((thrown as Error).message).toContain("code 11006");
    expect((thrown as Error).message).toContain("not yet activated");
  });

  it("throws the underlying error when the API call rejects with a network error", async () => {
    // Arrange: mock to throw a generic network error
    mockedAxios.post.mockRejectedValue(new Error("ECONNREFUSED network error"));
    // Assert: novadaScrape does NOT catch-and-stringify; the network error
    // propagates unchanged (index.ts's classifyError is what turns it into a
    // structured isError:true response at the MCP dispatch boundary).
    await expect(
      novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      )
    ).rejects.toThrow("ECONNREFUSED network error");
  });
});

// #6: pre-flight validation — reject a bad op id / missing required param BEFORE
// any backend round-trip, so a typo can't hang ~60s and 504 on the hosted endpoint.
describe("novadaScrape — pre-flight (#6)", () => {
  it("rejects an unknown operation for a known platform without calling the API", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    const err = preflightScrape("amazon.com", "amazon_product_totally-made-up", { keyword: "x" });
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_PARAMS");
    expect(err!.detail).toBe("preflight:unknown_operation");
    // agent_instruction lists valid operations so the agent can self-correct
    expect(err!.agent_instruction).toContain("amazon_product_asin");
    // FIX 3: the primary message ALSO lists the platform's valid operations, so
    // the op list survives even if only .message is surfaced to the agent.
    expect(err!.message).toContain("Valid operations for amazon.com:");
    expect(err!.message).toContain("amazon_product_asin");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("rejects a valid operation that is missing its required param", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    const err = preflightScrape("amazon.com", "amazon_product_asin", {});
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_PARAMS");
    expect(err!.detail).toBe("preflight:missing_param");
    expect(err!.agent_instruction).toContain("asin");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only required param as missing", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    const err = preflightScrape("tiktok.com", "tiktok_posts_url", { url: "   " });
    expect(err).not.toBeNull();
    expect(err!.detail).toBe("preflight:missing_param");
  });

  it("passes a valid operation with its required param", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    expect(preflightScrape("amazon.com", "amazon_product_asin", { asin: "B09XYZ" })).toBeNull();
  });

  it("defers an unknown/inactive platform to the backend (returns null)", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    // reddit.com is not in the active-platform map → must not hard-reject here
    expect(preflightScrape("reddit.com", "reddit_posts_subreddit", {})).toBeNull();
  });

  it("accepts any of q/keyword/query for search-engine operations", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    expect(preflightScrape("google.com", "google_search", { q: "hi" })).toBeNull();
    expect(preflightScrape("google.com", "google_search", { keyword: "hi" })).toBeNull();
    expect(preflightScrape("google.com", "google_search", {})).not.toBeNull();
  });

  // FIX 1: the preflight OR/AND gap. Catalog-derived "params"-format ops with more
  // than one required field are INDEPENDENTLY required (AND), not alternates (OR).
  // Previously `.some(...)` let any ONE of these keys satisfy preflight, so a call
  // missing a second required field sailed through preflight and only failed at the
  // backend (or hung until the network round-trip completed).
  it("requires ALL independently-required catalog keys for a multi-required 'params'-format op (AND, not OR)", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    // amazon_product-list_keywords-domain needs BOTH keyword AND domain.
    expect(preflightScrape("amazon.com", "amazon_product-list_keywords-domain", { keyword: "coffee" })).not.toBeNull();
    expect(preflightScrape("amazon.com", "amazon_product-list_keywords-domain", { domain: "https://www.amazon.com" })).not.toBeNull();
    expect(
      preflightScrape("amazon.com", "amazon_product-list_keywords-domain", { keyword: "coffee", domain: "https://www.amazon.com" }),
    ).toBeNull();
  });

  it("names the specific missing key(s) in the AND-required error message", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    const err = preflightScrape("amazon.com", "amazon_global-product_category-url", { url: "https://www.amazon.com/s?k=coffer" });
    expect(err).not.toBeNull();
    expect(err!.detail).toBe("preflight:missing_param");
    expect(err!.message).toContain("maximum");
    expect(err!.agent_instruction).toContain("maximum");

    // Missing all 3 independently-required keys names all 3.
    const err2 = preflightScrape("amazon.com", "amazon_global-product_keywords-brand", {});
    expect(err2).not.toBeNull();
    expect(err2!.message).toContain("keyword");
    expect(err2!.message).toContain("brands");
    expect(err2!.message).toContain("max_pages");
  });

  it("passes AND-required preflight once every independently-required key is present", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    expect(
      preflightScrape("amazon.com", "amazon_global-product_category-url", { url: "https://www.amazon.com/s?k=coffer", maximum: 3 }),
    ).toBeNull();
    expect(
      preflightScrape("amazon.com", "amazon_global-product_keywords-brand", { keyword: "iphone", brands: "Apple", max_pages: 1 }),
    ).toBeNull();
  });

  // Regression guard: google_search_url is a "flat" op with 2 catalog-required keys
  // (url, json) that is NOT a SEARCH_ENGINE_OP_KEYS alias. `json` is auto-populated
  // downstream in submitScrapeTask for flat ops and is never actually supplied by
  // the caller — so this op must stay permissive (OR/fallback), not become
  // AND-required, or every normal call (which never passes `json` explicitly) would
  // start failing preflight.
  it("does not regress flat non-alias ops like google_search_url to AND-required (json is auto-injected downstream)", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    expect(preflightScrape("google.com", "google_search_url", { url: "https://www.google.com/search?q=test" })).toBeNull();
  });

  it("does not match Object.prototype keys as operations (pollution-safe)", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    const err = preflightScrape("amazon.com", "__proto__", {});
    expect(err).not.toBeNull();
    expect(err!.detail).toBe("preflight:unknown_operation");
  });

  it("resolves twitter.com → x.com so x.com operations validate", async () => {
    const { preflightScrape } = await import("../../src/tools/scrape.js");
    // preflightScrape itself takes the resolved platform; verify x.com map is correct.
    // FIX-3: catalog-authoritative param for twitter_profile_username is `user_name` (api_id 126).
    expect(preflightScrape("x.com", "twitter_profile_username", { user_name: "jack" })).toBeNull();
  });
});

// FIX-1: broken-op warning must fire on the ERROR path, not only the success path.
// When a backend_broken op fails (timeout / API_DOWN / all-errors), the caller must
// see the known-broken acknowledgement so they understand why it failed.
describe("novadaScrape — backend_broken op warning on error path (FIX-1)", () => {
  it("prepends broken-op notice to thrown error when a backend_broken op times out", async () => {
    // shein_products_keyword is marked backend_broken in the catalog (60s timeout).
    // Simulate a network timeout — the most common failure mode for broken ops.
    mockedAxios.post.mockRejectedValue(new Error("timeout of 60000ms exceeded"));

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "shein.com", operation: "shein_products_keyword", params: { keyword: "dress" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    // The broken-op notice must appear in the thrown error message
    expect(msg).toContain("currently failing on the backend");
    expect(msg).toContain("shein_products_keyword");
  });

  it("prepends broken-op notice when all download items have errors (API_DOWN path)", async () => {
    // chatgpt_answer_searchterm is backend_broken — simulate the all-errors throw.
    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get.mockResolvedValue({
      data: [{ error: "scraper connection timeout", error_code: 10000 }],
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    let thrown: unknown;
    try {
      await novadaScrape(
        { platform: "chatgpt.com", operation: "chatgpt_answer_searchterm", params: { search_terms: "hello" }, format: "markdown", limit: 20 },
        "test-key"
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    // The broken-op notice must appear on this error path too
    expect(msg).toContain("currently failing on the backend");
    expect(msg).toContain("chatgpt_answer_searchterm");
  });
});

// NOV-689: task_id resume path — skip submit when task_id is provided
describe("novadaScrape — task_id resume path (NOV-689)", () => {
  it("skips submit when task_id is provided and fetches result directly", async () => {
    // Arrange: provide task_id — POST (submit) must NOT be called
    mockedAxios.get.mockResolvedValue(makeDownloadOk(MOCK_RECORDS));

    const result = await novadaScrape(
      {
        platform: "amazon.com",
        operation: "amazon_product_keywords",
        params: { keyword: "iphone" },
        format: "markdown",
        limit: 20,
        task_id: "resume-task-abc123",
      } as Parameters<typeof novadaScrape>[0],
      "test-key"
    );

    // submit must NOT be called — no new billable task
    expect(mockedAxios.post).not.toHaveBeenCalled();
    // download must be called with the provided task_id
    expect(mockedAxios.get).toHaveBeenCalled();
    const [url] = mockedAxios.get.mock.calls[0];
    expect(url).toContain("resume-task-abc123");
    // result should contain records
    expect(result).toContain("iPhone 16 Pro");
  });

  it("returns honest processing message with task_id for free-resume when still pending", async () => {
    // Arrange: submit returns a task_id; download stays pending (27202) on every poll.
    // Use fake timers so the 45s ceiling is reached instantly without actually waiting.
    vi.useFakeTimers();
    try {
      mockedAxios.post.mockResolvedValue(SUBMIT_OK);
      mockedAxios.get.mockResolvedValue({
        data: { code: 27202, data: null, msg: "" },
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      });

      // Start the scrape (will poll until deadline)
      const resultPromise = novadaScrape(
        { platform: "amazon.com", operation: "amazon_product_keywords", params: { keyword: "iphone" }, format: "markdown", limit: 20 },
        "test-key"
      );

      // Advance past the POLL_TIMEOUT_MS ceiling (45000ms) + a little extra
      await vi.advanceTimersByTimeAsync(46000);
      const result = await resultPromise;

      // Honest message: tells agent to use task_id to resume without re-charging
      expect(result).toContain("status: processing");
      expect(result).toContain("task_id=");
      expect(result).toContain("WITHOUT re-charging");
      expect(result).toContain("NEW billable task");
      // The old FALSE claim must be gone
      expect(result).not.toContain("cached server-side by task");
      expect(result).not.toContain("retrying does not duplicate billable work");
    } finally {
      vi.useRealTimers();
    }
  });

});
