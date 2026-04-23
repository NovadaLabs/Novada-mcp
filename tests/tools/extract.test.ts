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

  it("throws when response is not HTML", async () => {
    mockedAxios.get.mockResolvedValue({ data: { json: true } });

    await expect(
      novadaExtract({ url: "https://example.com", format: "markdown" }, API_KEY)
    ).rejects.toThrow("Response is not HTML");
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
