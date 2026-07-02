/**
 * Tests for the search cluster fixes:
 * F6  (P0) — extract_options.format="json": double-encoding + "## Extract Failed" sentinel handling
 * F15 (P1) — time_range="week" should flag / drop out-of-window results
 * F16 (P1) — empty results branch must honour format="json"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaSearch } from "../../src/tools/search.js";
import * as extractModule from "../../src/tools/extract.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-cluster-fixes";

/** Wire a 2-step Google scraper flow returning specific results. */
function mockGoogleResults(results: Array<{ title: string; url: string; description: string; published?: string }>) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, data: { task_id: "task-cluster-1" } },
  });
  mockedAxios.get.mockResolvedValue({
    data: { organic_results: results },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── F6a: extract_options.format=json — no double-encoding ───────────────────

describe("F6a — extract_options.format=json: extracted_content is nested object, not string", () => {
  it("extracted_content in JSON output is a parsed object, not a JSON-encoded string", async () => {
    mockGoogleResults([
      { title: "R1", url: "https://example.com/1", description: "D1" },
    ]);

    // novadaExtract returns a JSON string (the normal behaviour when called with format=json)
    const extractPayload = { title: "Page Title", price: "$42" };
    vi.spyOn(extractModule, "novadaExtract").mockResolvedValue(
      JSON.stringify(extractPayload)
    );

    const raw = await novadaSearch(
      {
        query: "test-f6a-json-encoding-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
        extract_options: { format: "json", top_n: 1 },
      },
      API_KEY
    );

    // Outer response must be valid JSON
    const outer = JSON.parse(raw);

    // The first result's extracted_content must be an object, NOT a string
    const result0 = outer.results[0];
    expect(result0).toHaveProperty("extracted_content");
    expect(typeof result0.extracted_content).toBe("object");
    expect(result0.extracted_content).not.toBeNull();
    // The fields from the extracted payload must be accessible directly
    expect((result0.extracted_content as { title: string }).title).toBe("Page Title");
    expect((result0.extracted_content as { price: string }).price).toBe("$42");
  });
});

// ─── F6b: "## Extract Failed" sentinel handling ──────────────────────────────

describe("F6b — extract failure sentinel: outer status=partial, no raw markdown in extracted_content", () => {
  it("when extraction returns '## Extract Failed', outer status is partial and extract_error is set", async () => {
    mockGoogleResults([
      { title: "Good", url: "https://example.com/good", description: "Good page" },
      { title: "Bad",  url: "https://example.com/bad",  description: "Bad page"  },
    ]);

    vi.spyOn(extractModule, "novadaExtract").mockImplementation(async (params) => {
      const url = (params as { url: string }).url;
      if (url.includes("bad")) {
        // Simulate what novadaExtract returns when extraction fails (sentinel text)
        return "## Extract Failed\n\nCould not fetch the page.";
      }
      return "Good page content";
    });

    const raw = await novadaSearch(
      {
        query: "test-f6b-sentinel-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
        extract_options: { format: "markdown", top_n: 2 },
      },
      API_KEY
    );

    const outer = JSON.parse(raw);

    // Outer status must be downgraded
    expect(outer.status).toBe("partial");

    const goodResult = outer.results.find((r: { url: string }) => r.url === "https://example.com/good");
    const badResult  = outer.results.find((r: { url: string }) => r.url === "https://example.com/bad");

    // Good result keeps its content
    expect(goodResult.extracted_content).toBe("Good page content");
    expect(goodResult).not.toHaveProperty("extract_error");

    // Bad result: no raw markdown sentinel in extracted_content
    expect(badResult.extracted_content).toBeUndefined();
    expect(badResult.extract_error).toBeDefined();
    // The sentinel text must NOT appear in extracted_content (it may appear in extract_error — that's fine)
    const badExtracted = badResult.extracted_content;
    if (badExtracted !== undefined && badExtracted !== null) {
      expect(String(badExtracted)).not.toContain("## Extract Failed");
    }
  });

  it("when ALL extractions fail, outer status is partial with enrich_failed_count", async () => {
    mockGoogleResults([
      { title: "A", url: "https://example.com/a", description: "DA" },
      { title: "B", url: "https://example.com/b", description: "DB" },
    ]);

    vi.spyOn(extractModule, "novadaExtract").mockResolvedValue(
      "## Extract Failed\n\nTimeout."
    );

    const raw = await novadaSearch(
      {
        query: "test-f6b-all-fail-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
        extract_options: { format: "markdown", top_n: 2 },
      },
      API_KEY
    );

    const outer = JSON.parse(raw);
    expect(outer.status).toBe("partial");
    // There should be a top-level count of failures
    expect(outer.enrich_failed_count).toBeDefined();
    expect(outer.enrich_failed_count).toBeGreaterThanOrEqual(1);
  });
});

// ─── F15: time_range out-of-window flagging ───────────────────────────────────

describe("F15 — time_range: out-of-window results carry within_time_range:false + top-level warning", () => {
  it("results older than 7 days are flagged when time_range=week (format=json)", async () => {
    // Provide one fresh result and one stale result
    const now = new Date();
    const freshDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const staleDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    mockGoogleResults([
      {
        title: "Fresh",
        url: "https://example.com/fresh",
        description: "new",
        published: freshDate.toISOString().slice(0, 10),
      },
      {
        title: "Stale",
        url: "https://example.com/stale",
        description: "old",
        published: staleDate.toISOString().slice(0, 10),
      },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-f15-timerange-week-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
        time_range: "week",
      },
      API_KEY
    );

    const outer = JSON.parse(raw);

    const freshResult = outer.results.find((r: { url: string }) => r.url === "https://example.com/fresh");
    const staleResult = outer.results.find((r: { url: string }) => r.url === "https://example.com/stale");

    // Fresh result must not be flagged
    expect(freshResult.within_time_range).not.toBe(false);

    // Stale result must carry within_time_range:false
    expect(staleResult.within_time_range).toBe(false);

    // Top-level warning must be present
    expect(typeof outer.time_range_warning).toBe("string");
    expect(outer.time_range_warning.length).toBeGreaterThan(0);
  });

  it("all-fresh results: no time_range_warning emitted", async () => {
    const now = new Date();
    const d1 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const d2 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    mockGoogleResults([
      { title: "A", url: "https://example.com/a", description: "DA", published: d1.toISOString().slice(0, 10) },
      { title: "B", url: "https://example.com/b", description: "DB", published: d2.toISOString().slice(0, 10) },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-f15-allfresh-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
        time_range: "week",
      },
      API_KEY
    );

    const outer = JSON.parse(raw);
    expect(outer.time_range_warning).toBeUndefined();
    outer.results.forEach((r: { within_time_range?: unknown }) => {
      expect(r.within_time_range).not.toBe(false);
    });
  });

  it("results with unparseable dates get within_time_range:null, not false", async () => {
    mockGoogleResults([
      { title: "C", url: "https://example.com/c", description: "DC", published: "not-a-date" },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-f15-unparseable-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
        time_range: "week",
      },
      API_KEY
    );

    const outer = JSON.parse(raw);
    const result = outer.results.find((r: { url: string }) => r.url === "https://example.com/c");
    expect(result.within_time_range).toBeNull();
  });
});

// ─── F16: empty results must honour format="json" ────────────────────────────

describe("F16 — empty results branch honours format=json", () => {
  it("empty results with format=json returns valid JSON (not markdown)", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-empty-json" } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [] },
    });

    const raw = await novadaSearch(
      {
        query: "test-f16-empty-json-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",
      },
      API_KEY
    );

    // Must be parseable JSON — JSON.parse throws if it's markdown
    let outer: Record<string, unknown>;
    expect(() => { outer = JSON.parse(raw); }).not.toThrow();
    outer = JSON.parse(raw);

    expect(outer.status).toBe("ok");
    expect(outer.result_count).toBe(0);
    expect(Array.isArray(outer.results)).toBe(true);
    expect((outer.results as unknown[]).length).toBe(0);
  });

  it("empty results with format=markdown still returns markdown (unchanged behaviour)", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { task_id: "task-empty-md" } },
    });
    mockedAxios.get.mockResolvedValue({
      data: { organic_results: [] },
    });

    const raw = await novadaSearch(
      {
        query: "test-f16-empty-md-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",
      },
      API_KEY
    );

    expect(raw).toContain("No results found for:");
    // Must NOT be valid JSON (it's markdown)
    expect(() => JSON.parse(raw)).toThrow();
  });
});
