/**
 * Output formatting tests — formatAsMarkdown, formatAsCsv, formatAsHtml, normalizeUrl, isContentLink.
 * No network calls. All pure functions.
 */

import { describe, it, expect } from "vitest";
import { formatAsMarkdown, formatAsCsv, formatAsHtml } from "../src/utils/format.js";
import { normalizeUrl, isContentLink } from "../src/utils/url.js";

// ─── formatAsMarkdown ─────────────────────────────────────────────────────────

describe("formatAsMarkdown", () => {
  it("returns _No data_ for empty array", () => {
    expect(formatAsMarkdown([])).toBe("_No data_");
  });

  it("produces header row from first record keys", () => {
    const out = formatAsMarkdown([{ name: "Alice", age: 30 }]);
    expect(out).toContain("| name | age |");
  });

  it("produces divider row", () => {
    const out = formatAsMarkdown([{ a: 1 }]);
    expect(out).toContain("| --- |");
  });

  it("produces data row", () => {
    const out = formatAsMarkdown([{ name: "Bob", score: 99 }]);
    expect(out).toContain("| Bob | 99 |");
  });

  it("truncates cells longer than 80 chars by default", () => {
    const long = "x".repeat(100);
    const out = formatAsMarkdown([{ col: long }]);
    expect(out).toContain("…");
    // Cell should be at most 80 chars (79 + ellipsis)
    const match = out.match(/\| (x+…) \|/);
    expect(match).toBeTruthy();
    expect(match![1].length).toBeLessThanOrEqual(80);
  });

  it("escapes pipe characters in cell values", () => {
    const out = formatAsMarkdown([{ col: "a|b" }]);
    expect(out).toContain("a\\|b");
  });

  it("handles null/undefined cell values as empty string", () => {
    const out = formatAsMarkdown([{ a: null, b: undefined }]);
    expect(out).not.toContain("null");
    expect(out).not.toContain("undefined");
  });

  it("handles multiple records", () => {
    const records = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const out = formatAsMarkdown(records);
    const lines = out.split("\n");
    // header + divider + 3 data rows = 5
    expect(lines).toHaveLength(5);
  });

  it("respects custom maxCellLen", () => {
    const long = "y".repeat(50);
    const out = formatAsMarkdown([{ col: long }], 20);
    expect(out).toContain("…");
  });
});

// ─── formatAsCsv ─────────────────────────────────────────────────────────────

describe("formatAsCsv", () => {
  it("returns empty string for empty array", () => {
    expect(formatAsCsv([])).toBe("");
  });

  it("produces header row", () => {
    const out = formatAsCsv([{ name: "Alice", age: 30 }]);
    expect(out.split("\n")[0]).toBe("name,age");
  });

  it("produces data row", () => {
    const out = formatAsCsv([{ name: "Alice", age: 30 }]);
    expect(out.split("\n")[1]).toBe("Alice,30");
  });

  it("wraps values with commas in quotes", () => {
    const out = formatAsCsv([{ val: "hello, world" }]);
    expect(out).toContain('"hello, world"');
  });

  it("escapes double quotes in values", () => {
    const out = formatAsCsv([{ val: 'say "hi"' }]);
    expect(out).toContain('"say ""hi"""');
  });

  it("wraps values with newlines in quotes", () => {
    const out = formatAsCsv([{ val: "line1\nline2" }]);
    expect(out).toContain('"line1\nline2"');
  });

  it("handles null values as empty string", () => {
    const out = formatAsCsv([{ a: null }]);
    const dataRow = out.split("\n")[1];
    expect(dataRow).toBe("");
  });

  it("handles multiple records", () => {
    const out = formatAsCsv([{ n: 1 }, { n: 2 }]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
  });
});

// ─── formatAsHtml ─────────────────────────────────────────────────────────────

describe("formatAsHtml", () => {
  it("returns no-data message for empty array", () => {
    expect(formatAsHtml([])).toBe("<p>No data</p>");
  });

  it("contains table element", () => {
    const out = formatAsHtml([{ a: 1 }]);
    expect(out).toContain("<table>");
    expect(out).toContain("</table>");
  });

  it("escapes HTML special characters in values", () => {
    const out = formatAsHtml([{ val: "<script>alert('xss')</script>" }]);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes ampersands", () => {
    const out = formatAsHtml([{ val: "a & b" }]);
    expect(out).toContain("a &amp; b");
  });

  it("includes title when provided", () => {
    const out = formatAsHtml([{ a: 1 }], "My Report");
    expect(out).toContain("My Report");
  });

  it("includes thead and tbody", () => {
    const out = formatAsHtml([{ col: "val" }]);
    expect(out).toContain("<thead>");
    expect(out).toContain("<tbody>");
  });
});

// ─── normalizeUrl ─────────────────────────────────────────────────────────────

describe("normalizeUrl", () => {
  it("strips trailing slash from path", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });

  it("strips www. prefix", () => {
    expect(normalizeUrl("https://www.example.com/")).toBe("https://example.com/");
  });

  it("strips URL fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("sorts query params alphabetically", () => {
    const out = normalizeUrl("https://example.com/?z=1&a=2");
    expect(out).toBe("https://example.com/?a=2&z=1");
  });

  it("returns input unchanged for invalid URL", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });

  it("preserves https scheme", () => {
    expect(normalizeUrl("https://example.com")).toContain("https://");
  });

  it("keeps root path as /", () => {
    const out = normalizeUrl("https://example.com/");
    expect(out).toBe("https://example.com/");
  });
});

// ─── isContentLink ────────────────────────────────────────────────────────────

describe("isContentLink", () => {
  it("returns false for .js file", () => {
    expect(isContentLink("https://example.com/app.js")).toBe(false);
  });

  it("returns false for .css file", () => {
    expect(isContentLink("https://example.com/style.css")).toBe(false);
  });

  it("returns false for .png image", () => {
    expect(isContentLink("https://example.com/logo.png")).toBe(false);
  });

  it("returns false for .svg", () => {
    expect(isContentLink("https://example.com/icon.svg")).toBe(false);
  });

  it("returns false for analytics domain", () => {
    expect(isContentLink("https://www.google-analytics.com/collect")).toBe(false);
  });

  it("returns false for googletagmanager", () => {
    expect(isContentLink("https://www.googletagmanager.com/gtag/js")).toBe(false);
  });

  it("returns false for fonts.googleapis.com", () => {
    expect(isContentLink("https://fonts.googleapis.com/css2?family=Roboto")).toBe(false);
  });

  it("returns false for /login path", () => {
    expect(isContentLink("https://example.com/login")).toBe(false);
  });

  it("returns false for /auth path", () => {
    expect(isContentLink("https://example.com/auth/callback")).toBe(false);
  });

  it("returns true for regular content page", () => {
    expect(isContentLink("https://example.com/blog/post-1")).toBe(true);
  });

  it("returns true for docs page", () => {
    expect(isContentLink("https://docs.example.com/api/reference")).toBe(true);
  });

  it("returns false for invalid URL", () => {
    expect(isContentLink("not-a-url")).toBe(false);
  });
});
