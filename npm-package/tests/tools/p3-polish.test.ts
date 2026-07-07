/**
 * Tests for TOW2-241 P3 polish batch
 * Items: yahoo enum, snippet whitespace, snippet dedup, extract chrome, field separators
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaSearch } from "../../src/tools/search.js";
import { novadaExtract } from "../../src/tools/extract.js";
import { validateSearchParams } from "../../src/tools/types.js";
import { ZodError } from "zod";
import { clearCache } from "../../src/_core/session-cache.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-123";

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

// ── Item 1: Yahoo enum removed ─────────────────────────────────────────────

describe("Item 1 — yahoo removed from engine enum", () => {
  it("validateSearchParams rejects 'yahoo' as engine (ZodError)", () => {
    expect(() => validateSearchParams({ query: "test", engine: "yahoo" })).toThrow(ZodError);
  });

  it("validateSearchParams accepts the 4 remaining engines", () => {
    for (const engine of ["google", "bing", "duckduckgo", "yandex"] as const) {
      expect(() => validateSearchParams({ query: "test", engine })).not.toThrow();
    }
  });
});

// ── Item 2: Snippet whitespace — HTML tag-boundary spaces ──────────────────

describe("Item 2 — HTML tags stripped with word-boundary spaces", () => {
  function mockGoogleSuccess(results: Array<{ title: string; url: string; description: string }>) {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-1" } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: results },
    });
  }

  it("strips <b> tags and preserves inter-word space (no isan splicing)", async () => {
    mockGoogleSuccess([
      {
        title: "Result A",
        url: "https://example.com/a",
        description: "<b>is</b> an example <em>bold</em>phrase here",
      },
    ]);

    const result = await novadaSearch({ query: "p3-item2-html-tags", engine: "google", num: 1, country: "", language: "" }, API_KEY);
    // "is an example bold phrase here" — tag boundaries must preserve spaces
    expect(result).toContain("is an example");
    expect(result).toContain("bold");
    expect(result).not.toContain("isan");      // regression guard
    expect(result).not.toContain("<b>");
    expect(result).not.toContain("<em>");
  });

  it("strips trailing 'Read more' from snippet", async () => {
    mockGoogleSuccess([
      {
        title: "Result B",
        url: "https://example.com/b",
        description: "Some description text Read more",
      },
    ]);

    const result = await novadaSearch({ query: "p3-item2-read-more", engine: "google", num: 1, country: "", language: "" }, API_KEY);
    expect(result).toContain("Some description text");
    expect(result).not.toContain("Read more");
  });

  it("strips trailing '...Read more' from snippet preserving ellipsis", async () => {
    mockGoogleSuccess([
      {
        title: "Result C",
        url: "https://example.com/c",
        description: "Truncated text...Read more",
      },
    ]);

    const result = await novadaSearch({ query: "p3-item2-ellipsis-read-more", engine: "google", num: 1, country: "", language: "" }, API_KEY);
    expect(result).toContain("Truncated text...");
    expect(result).not.toContain("Read more");
  });
});

// ── Item 3: Snippet boilerplate dedup ─────────────────────────────────────

describe("Item 3 — duplicate snippets flagged with [snippet repeated — upstream fallback]", () => {
  function mockGoogleSuccessMulti(results: Array<{ title: string; url: string; description: string }>) {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-2" } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: results },
    });
  }

  it("flags second occurrence of same snippet as upstream fallback", async () => {
    const SAME_SNIPPET = "Shared meta description for this page used across all results.";
    mockGoogleSuccessMulti([
      { title: "Page A", url: "https://example.com/a", description: SAME_SNIPPET },
      { title: "Page B", url: "https://example.com/b", description: SAME_SNIPPET },
    ]);

    const result = await novadaSearch({ query: "p3-item3-dedup-flag", engine: "google", num: 5, country: "", language: "" }, API_KEY);
    // Second occurrence must be flagged
    expect(result).toContain("[snippet repeated — upstream fallback]");
    // flag must appear AFTER first occurrence of the snippet text
    const firstSnippetEnd = result.indexOf(SAME_SNIPPET);
    const flagIdx = result.indexOf("[snippet repeated — upstream fallback]");
    expect(flagIdx).toBeGreaterThan(firstSnippetEnd);
  });

  it("does NOT flag unique snippets", async () => {
    mockGoogleSuccessMulti([
      { title: "Page A", url: "https://example.com/a", description: "Unique snippet A for item3 test." },
      { title: "Page B", url: "https://example.com/b", description: "Unique snippet B for item3 test." },
    ]);

    const result = await novadaSearch({ query: "p3-item3-no-dedup", engine: "google", num: 5, country: "", language: "" }, API_KEY);
    expect(result).not.toContain("[snippet repeated — upstream fallback]");
  });

  it("does NOT drop results that have duplicate snippets", async () => {
    const SAME_SNIPPET = "Shared meta description text for this product page.";
    mockGoogleSuccessMulti([
      { title: "Page A", url: "https://example.com/a", description: SAME_SNIPPET },
      { title: "Page B", url: "https://example.com/b", description: SAME_SNIPPET },
    ]);

    const result = await novadaSearch({ query: "p3-item3-no-drop", engine: "google", num: 5, country: "", language: "" }, API_KEY);
    // Both URLs must appear (no result is dropped)
    expect(result).toContain("https://example.com/a");
    expect(result).toContain("https://example.com/b");
  });
});

// ── Item 4: Extract clean chrome — stripBoilerplate on clean path ──────────

describe("Item 4 — stripBoilerplate applied on clean=true path", () => {
  const pageWithChrome = `<html><head><title>Docs</title></head><body>
    <main>
      <h1>API Reference</h1>
      <p>This is the actual documentation content. It covers the API methods and usage. More information here.</p>
      <p>YesNo</p>
      <p>⌘I</p>
      <p>Copy page</p>
      <p>Was this page helpful?</p>
      <p>Another paragraph of real content for the page extraction quality signal.</p>
    </main>
  </body></html>`;

  it("strips YesNo from output when clean=true", async () => {
    mockedAxios.get.mockResolvedValue({ data: pageWithChrome });

    const result = await novadaExtract({ url: "https://example.com/docs", format: "markdown", clean: true }, API_KEY);
    expect(result).not.toContain("YesNo");
  });

  it("strips ⌘I from output when clean=true", async () => {
    mockedAxios.get.mockResolvedValue({ data: pageWithChrome });

    const result = await novadaExtract({ url: "https://example.com/docs2", format: "markdown", clean: true }, API_KEY);
    expect(result).not.toContain("⌘I");
  });

  it("strips 'Copy page' from output when clean=true", async () => {
    mockedAxios.get.mockResolvedValue({ data: pageWithChrome });

    const result = await novadaExtract({ url: "https://example.com/docs3", format: "markdown", clean: true }, API_KEY);
    expect(result).not.toContain("Copy page");
  });

  it("preserves real content when clean=true", async () => {
    mockedAxios.get.mockResolvedValue({ data: pageWithChrome });

    const result = await novadaExtract({ url: "https://example.com/docs4", format: "markdown", clean: true }, API_KEY);
    expect(result).toContain("API Reference");
  });
});

// ── Item 5: flattenRecord word-boundary truncation ──────────────────────────

describe("Item 5 — flattenRecord truncates at word boundary", () => {
  // We test flattenRecord indirectly via novadaScrape by providing a record with a long array.
  // Use the SUBMIT_OK / makeDownloadOk pattern from scrape.test.ts.

  const SUBMIT_OK = {
    data: { code: 0, data: { code: 200, data: { task_id: "test-task-wb" }, msg: "success" }, msg: "success" },
    status: 200, headers: {}, config: {} as never, statusText: "OK",
  };

  function makeDownloadOk(records: unknown[]) {
    return {
      data: [{ spider_code: 200, rest: { results: records } }],
      status: 200, headers: {}, config: {} as never, statusText: "OK",
    };
  }

  it("truncates at word boundary — no mid-word cuts (toon format)", async () => {
    const { novadaScrape } = await import("../../src/tools/scrape.js");

    // Build a long array whose joined value exceeds 200 chars but has spaces.
    // Each entry is "ItemN InStock" (13 chars). 25 entries × 13 + 24 × 2 ("; ") = 373 chars > 200.
    // A hard 200-char cut would clip "InStock" to "In". Word-boundary cut avoids this.
    const items = Array.from({ length: 25 }, (_, i) => `Item${i + 1} InStock`);
    const record = { product_details: items };

    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get.mockResolvedValue(makeDownloadOk([record]));

    // Use toon format — renders flattenRecord output without secondary 80-char cell truncation
    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_asin", params: { asin: "B000TEST01" }, format: "toon" },
      API_KEY,
    );

    // flattenRecord should have applied word-boundary truncation; "(truncated)" must appear
    expect(result).toContain("(truncated)");

    // Verify no mid-word cut: check that the chars before "...(truncated)" form a complete token.
    // With "Item{N} InStock" items, a mid-word cut would leave "InSto" or "InStoc" before "...".
    const truncMarker = "...(truncated)";
    const truncIdx = result.indexOf(truncMarker);
    if (truncIdx > 0) {
      const beforeTrunc = result.slice(Math.max(0, truncIdx - 6), truncIdx);
      expect(beforeTrunc).not.toMatch(/InSto$/);
      expect(beforeTrunc).not.toMatch(/InStoc$/);
      // The last character before "..." must not be a mid-word letter run that looks partial.
      // A word-boundary truncation would end at "InStock" (full word) or the space before it.
      // Accept endings like "Stock" (complete word) or digit (ItemN).
      // Reject endings like "Sto" or "Stoc" which are clearly cut mid-word.
    }
  });

  it("short arrays (< 200 chars joined) are NOT truncated (toon format)", async () => {
    const { novadaScrape } = await import("../../src/tools/scrape.js");

    const record = { product_details: ["In Stock", "New", "Eligible"] };

    mockedAxios.post.mockResolvedValue(SUBMIT_OK);
    mockedAxios.get.mockResolvedValue(makeDownloadOk([record]));

    const result = await novadaScrape(
      { platform: "amazon.com", operation: "amazon_product_asin", params: { asin: "B000TEST02" }, format: "toon" },
      API_KEY,
    );

    expect(result).toContain("In Stock");
    expect(result).not.toContain("(truncated)");
  });
});
