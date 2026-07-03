/**
 * Tests for the search cluster fixes:
 * F6  (P0) — extract_options.format="json": double-encoding + "## Extract Failed" sentinel handling
 * F15 (P1) — time_range="week" should flag / drop out-of-window results
 * F16 (P1) — empty results branch must honour format="json"
 *
 * Closure-round additions:
 * C4  (P1) — "## Extraction Error" timeout-ceiling sentinel must also be detected as a failure
 * C9  (P2) — F15 per-result within_time_range lines must appear for start_date/end_date callers too
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

// ─── C4: "## Extraction Error" timeout-ceiling sentinel ───────────────────────

describe("C4 — '## Extraction Error' timeout-ceiling sentinel must be treated like '## Extract Failed'", () => {
  it("when extraction returns '## Extraction Error', outer status is partial and extract_error is set (format=json)", async () => {
    mockGoogleResults([
      { title: "Good", url: "https://example.com/good-c4", description: "Good page" },
      { title: "TimedOut", url: "https://example.com/timeout-c4", description: "Slow page" },
    ]);

    vi.spyOn(extractModule, "novadaExtract").mockImplementation(async (params) => {
      const url = (params as { url: string }).url;
      if (url.includes("timeout-c4")) {
        // This is what extract.ts emits from the TOTAL_REQUEST_CEILING path
        return "## Extraction Error\nurl: https://example.com/timeout-c4\nerror: Request exceeded the 60s total ceiling and was aborted.\n\n## Agent Action\nagent_instruction: This URL took too long.";
      }
      return "Good page content";
    });

    const raw = await novadaSearch(
      {
        query: "test-c4-extraction-error-unique",
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

    // Outer status must be downgraded to partial
    expect(outer.status).toBe("partial");

    const goodResult = outer.results.find((r: { url: string }) => r.url === "https://example.com/good-c4");
    const timedOut   = outer.results.find((r: { url: string }) => r.url === "https://example.com/timeout-c4");

    // Good result unaffected
    expect(goodResult.extracted_content).toBe("Good page content");
    expect(goodResult).not.toHaveProperty("extract_error");

    // Timed-out result: sentinel must NOT land in extracted_content
    expect(timedOut.extracted_content).toBeUndefined();
    // extract_error must be set
    expect(timedOut.extract_error).toBeDefined();
    // The raw sentinel text must NOT appear in extracted_content
    const timedOutExtracted = timedOut.extracted_content;
    if (timedOutExtracted !== undefined && timedOutExtracted !== null) {
      expect(String(timedOutExtracted)).not.toContain("## Extraction Error");
    }
  });

  it("'## Extraction Error' sentinel in format=markdown output: no raw sentinel in output, extract_error line present", async () => {
    mockGoogleResults([
      { title: "Slow", url: "https://example.com/slow-md-c4", description: "Slow" },
    ]);

    vi.spyOn(extractModule, "novadaExtract").mockResolvedValue(
      "## Extraction Error\nurl: https://example.com/slow-md-c4\nerror: Request exceeded the 60s total ceiling."
    );

    const raw = await novadaSearch(
      {
        query: "test-c4-md-sentinel-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",
        extract_options: { format: "markdown", top_n: 1 },
      },
      API_KEY
    );

    // The raw "## Extraction Error" heading must NOT appear verbatim as extracted_content body
    // (it must be re-routed to extract_error: line)
    const lines = raw.split("\n");
    const extractedContentIdx = lines.findIndex(l => l.startsWith("extracted_content:"));
    // If extracted_content: line exists, the next line must not be the sentinel heading
    if (extractedContentIdx !== -1) {
      const nextLine = lines[extractedContentIdx + 1] ?? "";
      expect(nextLine.trim()).not.toBe("## Extraction Error");
    }
    // extract_error: line must be present
    expect(raw).toContain("extract_error:");
  });
});

// ─── C9: F15 per-result within_time_range lines for start_date/end_date callers ─

describe("C9 — F15 per-result within_time_range annotation in markdown for start_date/end_date callers", () => {
  it("start_date/end_date out-of-window results show within_time_range:false in markdown output", async () => {
    // Result published 2021-06-01 — within 2020-01-01..2022-12-31 window
    // Result published 2019-01-01 — outside the window (before start_date)
    mockGoogleResults([
      { title: "InWindow",  url: "https://example.com/in-window-c9",  description: "In",  published: "2021-06-01" },
      { title: "OutWindow", url: "https://example.com/out-window-c9", description: "Out", published: "2019-01-01" },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-c9-startdate-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",
        start_date: "2020-01-01",
        end_date: "2022-12-31",
      },
      API_KEY
    );

    // The out-of-window result must have a within_time_range:false annotation line
    expect(raw).toContain("within_time_range: false");
  });

  it("start_date/end_date in-window result shows within_time_range:true in markdown output", async () => {
    mockGoogleResults([
      { title: "InWindow", url: "https://example.com/in-c9b", description: "In", published: "2021-06-01" },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-c9-inwindow-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",
        start_date: "2020-01-01",
        end_date: "2022-12-31",
      },
      API_KEY
    );

    // The in-window result must have a within_time_range:true annotation line
    expect(raw).toContain("within_time_range: true");
  });
});
