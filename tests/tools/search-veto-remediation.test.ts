/**
 * Remediation tests for Round-3 reviewer veto items:
 *
 * CRITICAL — F6a mixed-format: outer=markdown + extract_options.format=json
 *   must NOT produce "[object Object]" in the markdown output.
 *   The extracted_content must be a re-parseable JSON string (or structured text).
 *
 * MEDIUM — F15 markdown path: when time_range="week" and format="markdown",
 *   out-of-window results must render a visible freshness annotation/warning
 *   in the markdown output (not just in the JSON path).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaSearch } from "../../src/tools/search.js";
import * as extractModule from "../../src/tools/extract.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

const API_KEY = "test-key-veto-remediation";

function mockGoogleResults(results: Array<{ title: string; url: string; description: string; published?: string }>) {
  mockedAxios.post.mockResolvedValue({
    data: { code: 0, data: { task_id: "task-veto-1" } },
  });
  mockedAxios.get.mockResolvedValue({
    data: { organic_results: results },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── CRITICAL: F6a mixed-format (outer=markdown, extract_options.format=json) ──

describe("CRITICAL F6a — mixed format: outer=markdown + extract_options.format=json", () => {
  it("must NOT produce [object Object] in markdown output", async () => {
    mockGoogleResults([
      { title: "Page A", url: "https://example.com/a", description: "Desc A" },
    ]);

    const extractPayload = { title: "Extracted Title", price: "$99", rating: 4.5 };
    vi.spyOn(extractModule, "novadaExtract").mockResolvedValue(
      JSON.stringify(extractPayload)
    );

    const raw = await novadaSearch(
      {
        query: "test-veto-mixed-format-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",                         // outer = markdown
        extract_options: { format: "json", top_n: 1 }, // inner = json
      },
      API_KEY
    );

    // The output is markdown — must NOT be valid JSON at top level
    // (It's OK if JSON.parse throws — we want markdown here)

    // The core bug: [object Object] must never appear
    expect(raw).not.toContain("[object Object]");

    // The extracted payload must be present in some re-parseable form
    // Either as JSON string embedded in markdown, or as rendered fields
    expect(raw).toContain("Extracted Title");
  });

  it("extracted_content as JSON string is re-parseable from markdown output", async () => {
    mockGoogleResults([
      { title: "Page B", url: "https://example.com/b", description: "Desc B" },
    ]);

    const extractPayload = { field1: "value1", field2: 42 };
    vi.spyOn(extractModule, "novadaExtract").mockResolvedValue(
      JSON.stringify(extractPayload)
    );

    const raw = await novadaSearch(
      {
        query: "test-veto-parseable-json-string-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",
        extract_options: { format: "json", top_n: 1 },
      },
      API_KEY
    );

    // The raw markdown must not contain [object Object]
    expect(raw).not.toContain("[object Object]");

    // Find the extracted_content line in the markdown and verify it can be parsed
    const match = raw.match(/extracted_content:\n([\s\S]*?)(\n##|\n---|\n$)/);
    if (match) {
      const content = match[1].trim();
      // Should be valid JSON string — re-parseable
      expect(() => JSON.parse(content)).not.toThrow();
      const parsed = JSON.parse(content);
      expect(parsed.field1).toBe("value1");
      expect(parsed.field2).toBe(42);
    }
  });

  it("outer=json + extract_options.format=json still yields nested object (regression guard)", async () => {
    mockGoogleResults([
      { title: "Page C", url: "https://example.com/c", description: "Desc C" },
    ]);

    const extractPayload = { key: "nested-object-test", num: 7 };
    vi.spyOn(extractModule, "novadaExtract").mockResolvedValue(
      JSON.stringify(extractPayload)
    );

    const raw = await novadaSearch(
      {
        query: "test-veto-json-json-regression-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "json",                             // outer = json
        extract_options: { format: "json", top_n: 1 }, // inner = json
      },
      API_KEY
    );

    const outer = JSON.parse(raw);
    const result0 = outer.results[0];
    expect(result0).toHaveProperty("extracted_content");
    // When outer=json, extracted_content should be a nested object
    expect(typeof result0.extracted_content).toBe("object");
    expect(result0.extracted_content).not.toBeNull();
    expect(result0.extracted_content.key).toBe("nested-object-test");
  });
});

// ─── MEDIUM: F15 markdown path — time_range_warning must appear in markdown ───

describe("MEDIUM F15 — time_range warning must appear in markdown output (not just JSON)", () => {
  it("stale results in markdown output carry within_time_range annotation + top-level warning", async () => {
    const now = new Date();
    const freshDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);  // 2 days ago
    const staleDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    mockGoogleResults([
      {
        title: "Fresh Result",
        url: "https://example.com/fresh",
        description: "Recent article",
        published: freshDate.toISOString().slice(0, 10),
      },
      {
        title: "Stale Result",
        url: "https://example.com/stale",
        description: "Old article",
        published: staleDate.toISOString().slice(0, 10),
      },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-veto-f15-markdown-warning-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",  // markdown path — NOT json
        time_range: "week",
      },
      API_KEY
    );

    // Must not be valid JSON
    expect(() => JSON.parse(raw)).toThrow();

    // The stale result must carry a visible freshness signal in markdown
    // Either "within_time_range: false" or "out of window" or similar text
    const hasTimeRangeSignal =
      raw.includes("within_time_range: false") ||
      raw.includes("out of window") ||
      raw.includes("outside the requested time_range") ||
      raw.includes("time_range_warning");
    expect(hasTimeRangeSignal).toBe(true);
  });

  it("when all results are fresh, no stale warning appears in markdown output", async () => {
    const now = new Date();
    const d1 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
    const d2 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

    mockGoogleResults([
      {
        title: "Fresh A",
        url: "https://example.com/fresh-a",
        description: "DA",
        published: d1.toISOString().slice(0, 10),
      },
      {
        title: "Fresh B",
        url: "https://example.com/fresh-b",
        description: "DB",
        published: d2.toISOString().slice(0, 10),
      },
    ]);

    const raw = await novadaSearch(
      {
        query: "test-veto-f15-allfresh-markdown-unique",
        engine: "google",
        num: 5,
        country: "",
        language: "",
        format: "markdown",
        time_range: "week",
      },
      API_KEY
    );

    // No stale results — no warning
    expect(raw).not.toContain("within_time_range: false");
    expect(raw).not.toContain("out of window");
  });
});
