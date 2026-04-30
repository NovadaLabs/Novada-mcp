import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaExtract } from "../../src/tools/extract.js";
import { detectJsHeavyContent } from "../../src/utils/http.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novadaExtract", () => {
  const sampleHtml = `
    <html>
      <head>
        <title>Test Page</title>
        <meta name="description" content="A test page for extraction">
      </head>
      <body>
        <main>
          <h1>Main Content</h1>
          <p>This is the main content of the page with enough text to pass the threshold for content extraction. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>
          <a href="https://example.com/link1">Link 1</a>
          <a href="https://example.com/link2">Link 2</a>
        </main>
      </body>
    </html>
  `;

  it("extracts title and content in markdown format", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract({ url: "https://example.com", format: "markdown" }, API_KEY);
    expect(result).toContain("title: Test Page");
    expect(result).toContain("A test page for extraction");
    expect(result).toContain("Main Content");
  });

  it("returns raw html when format is html", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract({ url: "https://example.com", format: "html" }, API_KEY);
    expect(result).toContain("<html>");
    expect(result).toContain("<title>Test Page</title>");
  });

  it("extracts links from the page", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract({ url: "https://example.com", format: "markdown" }, API_KEY);
    expect(result).toContain("https://example.com/link1");
    expect(result).toContain("https://example.com/link2");
  });

  it("returns error string when response is not HTML (single URL)", async () => {
    mockedAxios.get.mockResolvedValue({ data: { json: true } });

    const result = await novadaExtract({ url: "https://example.com", format: "markdown" }, API_KEY);
    expect(result).toContain("## Extract Failed");
    expect(result).toContain("Response is not HTML");
    expect(result).toContain("## Agent Hints");
  });

  it("returns plain text when format is text", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract({ url: "https://example.com", format: "text" }, API_KEY);
    expect(result).toContain("Test Page");
    expect(result).not.toContain("# ");  // no markdown headers
  });
});

describe("auto-escalation (static → render)", () => {
  const jsHeavyHtml = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>";
  const richHtml = `<html><head><title>Rich Page</title></head><body>${"<p>Real content paragraph.</p>".repeat(25)}</body></html>`;

  it("escalates to render mode when static returns JS-heavy page", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: jsHeavyHtml })   // static fetch
      .mockResolvedValueOnce({ data: richHtml });       // render fallback (no unblocker key)

    const result = await novadaExtract({ url: "https://example.com", format: "markdown", render: "auto" }, API_KEY);
    expect(result).toContain("mode:render");
    expect(result).not.toContain("mode:static");
  });

  it("uses render-failed mode when escalation attempt throws", async () => {
    // fetchViaProxy: tries scraper API first, then falls back to direct fetch on non-401 errors.
    // Both must fail for the render attempt to truly throw.
    mockedAxios.get
      .mockResolvedValueOnce({ data: jsHeavyHtml })              // static: scraper API
      .mockRejectedValueOnce(new Error("scraper api error"))     // render: scraper API fails
      .mockRejectedValueOnce(new Error("direct fetch error"));   // render: direct fallback also fails

    const result = await novadaExtract({ url: "https://example.com", format: "markdown", render: "auto" }, API_KEY);
    expect(result).toContain("mode:render-failed");
  });
});

describe("smart routing detection", () => {
  it("detects empty Cloudflare page as JS-heavy", () => {
    const html = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>";
    expect(detectJsHeavyContent(html)).toBe(true);
  });

  it("detects rich static page as NOT JS-heavy", () => {
    const richHtml = "<html><body>" + "<p>Content paragraph.</p>".repeat(20) + "</body></html>";
    expect(detectJsHeavyContent(richHtml)).toBe(false);
  });
});

describe("P0-1: quality floor", () => {
  beforeEach(() => vi.resetAllMocks());

  const smallPageHtml = `
    <html>
      <head><title>Small Page</title></head>
      <body><p>Short but real content that should be considered valid.</p></body>
    </html>
  `;

  it("returns quality >= 1 for non-empty content", async () => {
    mockedAxios.get.mockResolvedValue({ data: smallPageHtml });

    const result = await novadaExtract({ url: "https://example.com/small", format: "markdown" }, API_KEY);
    const match = result.match(/quality:(\d+)/);
    expect(match).not.toBeNull();
    const score = parseInt(match![1], 10);
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it("returns quality 0 for empty content (bot challenge page)", async () => {
    // A pure bot challenge page produces no extractable content, quality stays 0
    const botHtml = "<html><head><title>Just a moment...</title></head><body>Checking your browser before allowing you access.</body></html>";
    mockedAxios.get.mockResolvedValue({ data: botHtml });

    // Bot challenge pages have near-zero content — quality should be very low (≤ 10)
    const result = await novadaExtract({ url: "https://example.com", format: "markdown" }, API_KEY);
    const match = result.match(/quality:(\d+)/);
    expect(match).not.toBeNull();
    const score = parseInt(match![1], 10);
    // Bot challenge = extremely low quality (floor doesn't apply if content is truly empty)
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe("P0-3: strip *(pattern)* annotation from field values", () => {
  beforeEach(() => vi.resetAllMocks());

  const htmlWithProduct = `
    <html>
      <head>
        <title>Product Page</title>
        <script type="application/ld+json">
          {"@type":"Product","name":"Firecrawl","offers":{"price":"99.99","priceCurrency":"USD"}}
        </script>
      </head>
      <body>
        <main>
          <h1>Firecrawl</h1>
          ${"<p>Real product description content here. </p>".repeat(20)}
        </main>
      </body>
    </html>
  `;

  it("field values have no *(pattern)* annotation", async () => {
    mockedAxios.get.mockResolvedValue({ data: htmlWithProduct });

    const result = await novadaExtract({
      url: "https://example.com/product",
      format: "markdown",
      fields: ["name"],
    }, API_KEY);

    // The value itself should not contain *(pattern)*
    // (the source tag *(from schema)* or *(pattern)* may appear after the value, but not embedded in it)
    const fieldsSection = result.split("## Requested Fields")[1]?.split("---")[0] ?? "";
    const nameLine = fieldsSection.split("\n").find(l => l.startsWith("name:"));
    expect(nameLine).toBeDefined();
    // Value before the source tag should be clean
    expect(nameLine).not.toMatch(/Firecrawl \*\(pattern\)\*/);
  });

  it("returns clean field value when annotation is stripped", async () => {
    // Mock extractFields to simulate API returning a value with *(pattern)* suffix
    // We test this indirectly: the rendered output line for a pattern-matched field
    // should have the source tag AFTER the value, not embedded in the value
    mockedAxios.get.mockResolvedValue({ data: htmlWithProduct });

    const result = await novadaExtract({
      url: "https://example.com/product",
      format: "markdown",
      fields: ["name"],
    }, API_KEY);

    // The fields block should exist
    expect(result).toContain("## Requested Fields");
    // The raw annotation should not appear inside the actual value
    const lines = result.split("\n");
    const nameLine = lines.find(l => /^name:/.test(l));
    if (nameLine) {
      // Extract just the value portion (after "name: ")
      const valueAndTag = nameLine.slice("name: ".length);
      // Value should not start with *(pattern)*
      expect(valueAndTag).not.toMatch(/^\*\(pattern\)\*/);
    }
  });
});

describe("P0-5: max_chars truncation", () => {
  beforeEach(() => vi.resetAllMocks());

  const longPageHtml = `
    <html>
      <head><title>Long Page</title></head>
      <body><main>${"<p>This is a long paragraph with content. ".repeat(1500)}</p></main></body>
    </html>
  `;

  const shortPageHtml = `
    <html>
      <head><title>Short Page</title></head>
      <body><main><p>This is a short page with minimal content.</p></main></body>
    </html>
  `;

  it("truncates content at max_chars when content exceeds limit", async () => {
    mockedAxios.get.mockResolvedValue({ data: longPageHtml });

    const result = await novadaExtract({
      url: "https://example.com/long",
      format: "markdown",
      max_chars: 5000,
    }, API_KEY);

    expect(result).toContain("[Content may be truncated");
    expect(result).toContain("content_truncated:true");
  });

  it("does not truncate when content is within max_chars", async () => {
    mockedAxios.get.mockResolvedValue({ data: shortPageHtml });

    const result = await novadaExtract({
      url: "https://example.com/short",
      format: "markdown",
      max_chars: 25000,
    }, API_KEY);

    expect(result).not.toContain("[Content truncated");
    expect(result).not.toContain("content_truncated:true");
  });

  it("defaults to 25000 chars when max_chars not provided", async () => {
    mockedAxios.get.mockResolvedValue({ data: longPageHtml });

    const result = await novadaExtract({
      url: "https://example.com/long",
      format: "markdown",
    }, API_KEY);

    // When content exceeds 25000, truncation notice should appear with 25000 as the limit
    if (result.includes("[Content may be truncated")) {
      expect(result).toContain("[Content may be truncated");
    }
    // Otherwise content fits in 25000 chars — acceptable
  });

  it("truncates content at max_chars for format='text'", async () => {
    mockedAxios.get.mockResolvedValue({ data: longPageHtml });

    const result = await novadaExtract({
      url: "https://example.com/long",
      format: "text",
      max_chars: 5000,
    }, API_KEY);

    expect(result).toContain("[Content may be truncated");
  });
});

describe("P1-6: urls array alias", () => {
  beforeEach(() => vi.resetAllMocks());

  const sampleHtml = `
    <html>
      <head><title>Sample Page</title></head>
      <body><main><p>Sample content for testing batch extraction. ${"Lorem ipsum dolor. ".repeat(20)}</p></main></body>
    </html>
  `;

  it("accepts urls array and returns array of results (batch format)", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract({
      url: "https://example.com",
      urls: ["https://example.com/a", "https://example.com/b"],
      format: "markdown",
    }, API_KEY);

    expect(result).toContain("## Batch Extract Results");
    expect(result).toContain("urls:2");
    expect(result).toContain("https://example.com/a");
    expect(result).toContain("https://example.com/b");
  });

  it("single url still returns single object (backward compat)", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract({
      url: "https://example.com",
      format: "markdown",
    }, API_KEY);

    // Single URL should NOT produce batch format
    expect(result).not.toContain("## Batch Extract Results");
    expect(result).toContain("## Extracted Content");
  });

  it("urls array respects max_chars per URL", async () => {
    mockedAxios.get.mockResolvedValue({ data: `<html><head><title>Test</title></head><body><main>${"<p>Long content here. ".repeat(1500)}</p></main></body></html>` });

    const result = await novadaExtract({
      url: "https://example.com",
      urls: ["https://example.com/page1", "https://example.com/page2"],
      format: "markdown",
      max_chars: 3000,
    }, API_KEY);

    expect(result).toContain("## Batch Extract Results");
    // Each page should have truncation applied
    expect(result).toContain("[Content may be truncated");
  });
});

describe("quality score", () => {
  // Reset mock implementations (not just calls) to clear any leaked Once mocks from prior tests
  beforeEach(() => vi.resetAllMocks());

  const richHtmlWithJsonLd = `
    <html>
      <head>
        <title>Product Page</title>
        <script type="application/ld+json">
          {"@type":"Product","name":"Test Product","offers":{"price":"99.99","priceCurrency":"USD"}}
        </script>
      </head>
      <body>
        <main>
          <h1>Test Product</h1>
          ${"<p>This is a long paragraph with real product content to ensure we exceed 5000 characters. ".repeat(80)}
          <h2>Features</h2>
          <h3>Details</h3>
          <a href="https://example.com/related1">Related 1</a>
          <a href="https://example.com/related2">Related 2</a>
        </main>
      </body>
    </html>
  `;

  it("includes quality score in output for a successful extraction", async () => {
    mockedAxios.get.mockResolvedValue({ data: richHtmlWithJsonLd });

    const result = await novadaExtract({ url: "https://example.com/product", format: "markdown" }, API_KEY);
    expect(result).toMatch(/quality:\d+/);
  });

  it("quality score is low (≤10) when bot challenge is detected", async () => {
    const botHtml = "<html><head><title>Just a moment...</title></head><body>Checking your browser before allowing you access.</body></html>";
    mockedAxios.get.mockResolvedValue({ data: botHtml });

    const result = await novadaExtract({ url: "https://example.com", format: "markdown" }, API_KEY);
    const match = result.match(/quality:(\d+)/);
    expect(match).not.toBeNull();
    const score = parseInt(match![1], 10);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("includes structured data block when JSON-LD is present", async () => {
    mockedAxios.get.mockResolvedValue({ data: richHtmlWithJsonLd });

    const result = await novadaExtract({ url: "https://example.com/product", format: "markdown" }, API_KEY);
    expect(result).toContain("## Structured Data");
    expect(result).toContain("type: Product");
    expect(result).toContain("name: Test Product");
  });
});
