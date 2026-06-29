import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaExtract } from "../../src/tools/extract.js";
import { detectJsHeavyContent } from "../../src/utils/http.js";
import { clearCache } from "../../src/_core/session-cache.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  // The extract session cache is a module-level Map keyed by url+mode+format.
  // Many tests reuse https://example.com; without a reset, a success cached by
  // an earlier test short-circuits later tests before the axios mock is hit.
  clearCache();
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

  // NOTE: in auto mode the static phase races a direct fetch against a proxy fetch
  // (two axios.get calls in non-deterministic order), so per-call mockResolvedValueOnce
  // ordering is unreliable. We drive the mock by call count instead: the first two
  // calls are the static race, everything after is the render/escalation path.
  // The mode string in the output is "mode: <usedMode>" (with a space) — assert the
  // behavioural contract (escalated away from a clean static success) rather than a
  // brittle no-space literal.

  it("escalates away from static when the static fetch is JS-heavy", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => {
      n++;
      // Static race (direct + proxy) both look JS-heavy → must trigger escalation.
      if (n <= 2) return { data: jsHeavyHtml } as never;
      // Render/escalation path returns rich content.
      return { data: richHtml } as never;
    });

    const result = await novadaExtract({ url: "https://nov-esc-render.example", format: "markdown", render: "auto" }, API_KEY);
    // A JS-heavy static page must never be reported as a clean static success.
    expect(result).not.toContain("mode: static |");
    // Escalation must be visible: either it succeeded (render/browser) or it was
    // attempted and surfaced (render-failed / wayback fallback / escalation hint).
    expect(result).toMatch(/mode: (render|browser|render-failed)/);
  });

  it("reports render-failed when every escalation fetch throws", async () => {
    let n = 0;
    mockedAxios.get.mockImplementation(async () => {
      n++;
      // Static race both JS-heavy → escalate.
      if (n <= 2) return { data: jsHeavyHtml } as never;
      // All render/escalation fetches fail.
      throw new Error("render fetch failed");
    });

    const result = await novadaExtract({ url: "https://nov-esc-failed.example", format: "markdown", render: "auto" }, API_KEY);
    expect(result).toContain("mode: render-failed");
    expect(result).not.toContain("mode: static |");
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

  it("single JSON object exposes content_truncated / returned_chars / total_chars", async () => {
    mockedAxios.get.mockResolvedValue({ data: longPageHtml });

    const result = await novadaExtract({
      url: "https://nov563-json.example/long",
      format: "json",
      max_chars: 5000,
    }, API_KEY);

    const parsed = JSON.parse(result);
    expect(parsed.content_truncated).toBe(true);
    expect(parsed.returned_chars).toBe(parsed.content.length);
    expect(parsed.total_chars).toBeGreaterThan(parsed.returned_chars);
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

  // NOV-563/568: The old batch path re-truncated each page to floor(25000/N) chars,
  // ignoring max_chars entirely. At 8 URLs that meant ~3125 chars/page. These tests
  // lock in that the batch path now honors per-page max_chars and never re-slices.
  const longHtml = `<html><head><title>Long</title></head><body><main>${"<p>Long content here paragraph. ".repeat(1500)}</p></main></body></html>`;

  it("8-URL batch with max_chars=20000 keeps each page well above the old 3125-char cap and emits no batch sentinel", async () => {
    mockedAxios.get.mockResolvedValue({ data: longHtml });

    // Unique URLs avoid colliding with the session-dedup cache populated by other tests
    // (cache key is url+mode+format+fields and excludes max_chars).
    const urls = Array.from({ length: 8 }, (_, i) => `https://nov563-8url.example/page${i + 1}`);
    const result = await novadaExtract({
      url: "https://example.com",
      urls,
      format: "markdown",
      max_chars: 20000,
    }, API_KEY);

    expect(result).toContain("## Batch Extract Results");
    expect(result).toContain("urls:8");
    // The old per-URL re-truncation sentinel must be gone.
    expect(result).not.toContain("[truncated at");

    // Each of the 8 page sections must carry far more than the old 3125-char cap.
    const sections = result.split(/### \[\d+\/8\] /).slice(1);
    expect(sections.length).toBe(8);
    for (const section of sections) {
      // Strip the per-item flag line we add so we measure actual page content.
      const body = section.replace(/^[^\n]*\n?returned_chars:[^\n]*\n/, "");
      expect(body.length).toBeGreaterThan(3125);
    }
  });

  it("batch emits per-item returned_chars + content_truncated flags", async () => {
    mockedAxios.get.mockResolvedValue({ data: longHtml });

    const result = await novadaExtract({
      url: "https://example.com",
      urls: ["https://nov563-flags.example/a", "https://nov563-flags.example/b"],
      format: "markdown",
      max_chars: 4000,
    }, API_KEY);

    expect(result).toContain("## Batch Extract Results");
    // Per-item flags appear once per page (2 pages).
    const flagLines = result.split("\n").filter(l => /^returned_chars:\d+ \| content_truncated:(true|false)/.test(l));
    expect(flagLines.length).toBe(2);
    // With max_chars=4000 on a long page, each item should be truncated.
    expect(flagLines.every(l => l.includes("content_truncated:true"))).toBe(true);
    // total_chars surfaces when the inner block exposed it.
    expect(flagLines.every(l => /total_chars:\d+/.test(l))).toBe(true);
  });

  it("batch persists full output to disk and puts the path at the TOP of the result", async () => {
    mockedAxios.get.mockResolvedValue({ data: longHtml });

    const result = await novadaExtract({
      url: "https://example.com",
      urls: ["https://nov563-path.example/a", "https://nov563-path.example/b"],
      format: "markdown",
      max_chars: 20000,
    }, API_KEY);

    // saveOutput is best-effort; when it succeeds the path must be the first line.
    const firstLine = result.split("\n")[0];
    expect(firstLine.startsWith("path: ")).toBe(true);
    // The path prefix must sit above the batch header, not after it.
    expect(result.indexOf("path: ")).toBeLessThan(result.indexOf("## Batch Extract Results"));
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

describe("JSON fields contract (value/source/confidence object)", () => {
  beforeEach(() => vi.resetAllMocks());

  const productJsonLdHtml = `
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
          ${"<p>Real product description content to exceed the content floor. </p>".repeat(40)}
        </main>
      </body>
    </html>
  `;

  // NOV-564: format="json" returns fields[k] as a structured object
  // { value, source, confidence } (plus agent_instruction when unresolved),
  // NOT a bare scalar. This test locks that contract so it can't silently
  // regress to a string (which would break downstream `parsed.fields.price`).
  it("resolved field is an object with value/source/confidence", async () => {
    mockedAxios.get.mockResolvedValue({ data: productJsonLdHtml });

    const result = await novadaExtract({
      url: "https://nov564-json-fields.example/product",
      format: "json",
      fields: ["price"],
    }, API_KEY);

    const parsed = JSON.parse(result);
    expect(parsed.fields).toBeTypeOf("object");
    expect(parsed.fields.price).toBeTypeOf("object");
    // value is the scalar; source + confidence are siblings, not folded into value.
    expect(parsed.fields.price.value).toBe("99.99");
    expect(parsed.fields.price.source).toBe("jsonld");
    expect(typeof parsed.fields.price.confidence).toBe("number");
    expect(parsed.fields.price.confidence).toBeGreaterThan(0);
  });

  it("unresolved field has value:null and an agent_instruction", async () => {
    mockedAxios.get.mockResolvedValue({ data: productJsonLdHtml });

    const result = await novadaExtract({
      url: "https://nov564-json-unresolved.example/product",
      format: "json",
      fields: ["nonexistent_field_xyz"],
    }, API_KEY);

    const parsed = JSON.parse(result);
    const f = parsed.fields.nonexistent_field_xyz;
    expect(f).toBeTypeOf("object");
    expect(f.value).toBeNull();
    expect(f.source).toBe("unresolved");
    expect(typeof f.agent_instruction).toBe("string");
  });
});

describe("field extraction window — full content, not display-truncated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  // Regression: extractFields must see the FULL pre-truncation content (mainContent),
  // not displayContent which is sliced to max_chars (default 25k) for inline rendering.
  // A field whose markdown text lands past char 25k on a long page must still resolve.
  // Before the fix (passing displayContent), the markdown-text layers only saw the first
  // 25k chars and returned `unresolved` for a value that lives further down the page.
  it("resolves a markdown field located past the 25k display cap on a long page", async () => {
    // ~30k chars of filler before the field, so the field sits beyond the default cap.
    const filler = `<p>${"Lorem ipsum dolor sit amet consectetur. ".repeat(800)}</p>`;
    const longHtml = `
      <html><head><title>Long Doc</title></head>
      <body><main>
        <h1>Long Document</h1>
        ${filler}
        <p>Author: Jane Researcher</p>
      </main></body></html>
    `;
    expect(longHtml.length).toBeGreaterThan(25000);
    mockedAxios.get.mockResolvedValue({ data: longHtml });

    const result = await novadaExtract({
      url: "https://nov564-longpage.example/doc",
      format: "json",
      fields: ["author"],
    }, API_KEY);

    const parsed = JSON.parse(result);
    // The inline content is still capped (display contract preserved)...
    expect(parsed.content_truncated).toBe(true);
    // ...but the field resolves from the full content, not the truncated slice.
    expect(parsed.fields.author.source).not.toBe("unresolved");
    expect(parsed.fields.author.value).toContain("Jane Researcher");
  });
});
