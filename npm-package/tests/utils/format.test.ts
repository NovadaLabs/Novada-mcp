import { describe, it, expect } from "vitest";
import { formatAsCsv, formatAsHtml, formatAsXlsx, formatAsMarkdown, formatRecords } from "../../src/utils/format.js";

const SAMPLE = [
  { name: "iPhone 16", price: "999", rating: "4.8" },
  { name: 'Samsung Galaxy, "Pro"', price: "899", rating: "4.5" },
];

describe("formatAsCsv", () => {
  it("produces header row and data rows", () => {
    const csv = formatAsCsv(SAMPLE);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("name,price,rating");
    expect(lines[1]).toBe("iPhone 16,999,4.8");
  });

  it("escapes commas and quotes in values", () => {
    const csv = formatAsCsv(SAMPLE);
    expect(csv).toContain('"Samsung Galaxy, ""Pro"""');
  });

  it("returns empty string for empty records", () => {
    expect(formatAsCsv([])).toBe("");
  });
});

describe("formatAsHtml", () => {
  it("produces a complete HTML table", () => {
    const html = formatAsHtml(SAMPLE, "Products");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>name</th>");
    expect(html).toContain("iPhone 16");
    expect(html).toContain("<title>Products</title>");
  });

  it("escapes HTML special characters", () => {
    const html = formatAsHtml([{ field: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns fallback for empty records", () => {
    expect(formatAsHtml([])).toContain("No data");
  });
});

describe("formatAsXlsx", () => {
  it("returns a non-empty Buffer", async () => {
    const buf = await formatAsXlsx(SAMPLE);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("produces valid xlsx magic bytes (PK zip header)", async () => {
    const buf = await formatAsXlsx(SAMPLE);
    // xlsx is a zip file — magic bytes 50 4B 03 04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

describe("formatAsMarkdown", () => {
  it("produces header, divider, and data rows", () => {
    const md = formatAsMarkdown(SAMPLE);
    const lines = md.split("\n");
    expect(lines[0]).toContain("name");
    expect(lines[1]).toMatch(/^\|[\s-|]+\|$/);
    expect(md).toContain("iPhone 16");
  });

  it("truncates long values", () => {
    const md = formatAsMarkdown([{ text: "A".repeat(200) }], 80);
    expect(md).toContain("…");
    expect(md.includes("A".repeat(100))).toBe(false);
  });

  it("returns fallback for empty records", () => {
    expect(formatAsMarkdown([])).toBe("_No data_");
  });

  it("escapes pipe characters in cell values", () => {
    const md = formatAsMarkdown([{ col: "a|b|c", other: "normal" }]);
    const dataRow = md.split("\n")[2];  // skip header and divider rows
    expect(dataRow).toContain("a\\|b\\|c");
    expect(dataRow).not.toContain("a|b|c");  // raw pipe must not appear
  });
});

describe("formatRecords", () => {
  it("json format returns JSON string with correct mimeType", async () => {
    const { content, mimeType, ext } = await formatRecords(SAMPLE, "json");
    expect(mimeType).toBe("application/json");
    expect(ext).toBe("json");
    const parsed = JSON.parse(content as string);
    expect(parsed).toHaveLength(2);
  });

  it("csv format returns csv content", async () => {
    const { content, mimeType, ext } = await formatRecords(SAMPLE, "csv");
    expect(mimeType).toBe("text/csv");
    expect(ext).toBe("csv");
    expect(content as string).toContain("name,price,rating");
  });

  it("html format returns html content", async () => {
    const { content, mimeType, ext } = await formatRecords(SAMPLE, "html", { title: "Test" });
    expect(mimeType).toBe("text/html");
    expect(ext).toBe("html");
    expect(content as string).toContain("<table>");
  });

  it("xlsx format returns Buffer", async () => {
    const { content, ext } = await formatRecords(SAMPLE, "xlsx");
    expect(ext).toBe("xlsx");
    expect(Buffer.isBuffer(content)).toBe(true);
  });

  it("markdown format is the default", async () => {
    const { content, mimeType } = await formatRecords(SAMPLE, "markdown");
    expect(mimeType).toBe("text/markdown");
    expect(content as string).toContain("|");
  });
});
