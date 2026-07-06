import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPdfResponse } from "../../src/utils/pdf.js";

// ─── isPdfResponse tests ─────────────────────────────────────────────────────

describe("isPdfResponse", () => {
  it("detects .pdf extension in URL", () => {
    expect(isPdfResponse("https://example.com/report.pdf")).toBe(true);
  });

  it("detects .pdf extension case-insensitively", () => {
    expect(isPdfResponse("https://example.com/REPORT.PDF")).toBe(true);
  });

  it("detects application/pdf content-type header", () => {
    expect(isPdfResponse("https://example.com/file", "application/pdf")).toBe(true);
  });

  it("detects application/pdf with charset suffix", () => {
    expect(isPdfResponse("https://example.com/file", "application/pdf; charset=utf-8")).toBe(true);
  });

  it("returns false for HTML content-type", () => {
    expect(isPdfResponse("https://example.com/page", "text/html")).toBe(false);
  });

  it("returns false for .html URL with no content-type", () => {
    expect(isPdfResponse("https://example.com/page.html")).toBe(false);
  });

  it("strips query string before checking extension", () => {
    expect(isPdfResponse("https://example.com/report.pdf?version=2")).toBe(true);
  });

  it("returns false for URL with pdf in path but not as extension", () => {
    expect(isPdfResponse("https://example.com/pdf-guide/index.html")).toBe(false);
  });
});

// ─── extractPdf tests ────────────────────────────────────────────────────────

describe("extractPdf — size guard", () => {
  it("throws for buffers over 10 MB", async () => {
    const { extractPdf } = await import("../../src/utils/pdf.js");
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0);
    await expect(extractPdf(bigBuffer)).rejects.toThrow("PDF too large");
  });

  it("includes file size in the error message", async () => {
    const { extractPdf } = await import("../../src/utils/pdf.js");
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0);
    await expect(extractPdf(bigBuffer)).rejects.toThrow("11.0 MB");
  });
});

// ─── extractPdf tests using mocked PDFParse ───────────────────────────────────
//
// We mock the pdf-parse module at the top level for this describe block.
// Each test configures the mock before importing the function under test.

vi.mock("pdf-parse");

describe("extractPdf — mocked pdf-parse", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("returns text and page count from pdf-parse", async () => {
    const { PDFParse } = await import("pdf-parse");
    vi.mocked(PDFParse).mockImplementation(() => ({
      getText: vi.fn().mockResolvedValue({ text: "Hello PDF world", total: 3 }),
      getInfo: vi.fn().mockResolvedValue({ info: { Title: "Test Doc", Author: "Alice" } }),
      destroy: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const { extractPdf } = await import("../../src/utils/pdf.js");
    const result = await extractPdf(Buffer.from("fake"));
    expect(result.text).toBe("Hello PDF world");
    expect(result.pages).toBe(3);
    expect(result.title).toBe("Test Doc");
    expect(result.author).toBe("Alice");
  });

  it("returns result without title/author when metadata fields are empty strings", async () => {
    const { PDFParse } = await import("pdf-parse");
    vi.mocked(PDFParse).mockImplementation(() => ({
      getText: vi.fn().mockResolvedValue({ text: "No metadata here", total: 1 }),
      getInfo: vi.fn().mockResolvedValue({ info: { Title: "", Author: "" } }),
      destroy: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const { extractPdf } = await import("../../src/utils/pdf.js");
    const result = await extractPdf(Buffer.from("fake"));
    expect(result.pages).toBe(1);
    expect(result.title).toBeUndefined();
    expect(result.author).toBeUndefined();
  });

  it("handles getInfo failure gracefully (returns text without metadata)", async () => {
    const { PDFParse } = await import("pdf-parse");
    vi.mocked(PDFParse).mockImplementation(() => ({
      getText: vi.fn().mockResolvedValue({ text: "Content without info", total: 2 }),
      getInfo: vi.fn().mockRejectedValue(new Error("info fetch failed")),
      destroy: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const { extractPdf } = await import("../../src/utils/pdf.js");
    const result = await extractPdf(Buffer.from("fake"));
    expect(result.text).toBe("Content without info");
    expect(result.pages).toBe(2);
    expect(result.title).toBeUndefined();
  });
});
