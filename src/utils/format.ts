import * as XLSX from "xlsx";

export type OutputFormat = "markdown" | "json" | "csv" | "html" | "xlsx";

/** Convert records to CSV string */
export function formatAsCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";
  const headers = Object.keys(records[0]);

  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = [
    headers.join(","),
    ...records.map(r => headers.map(h => escape(r[h])).join(",")),
  ];
  return rows.join("\n");
}

/** Convert records to HTML table */
export function formatAsHtml(records: Record<string, unknown>[], title?: string): string {
  if (records.length === 0) return "<p>No data</p>";
  const headers = Object.keys(records[0]);

  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const head = headers.map(h => `<th>${esc(h)}</th>`).join("");
  const body = records
    .map(r => `<tr>${headers.map(h => `<td>${esc(r[h])}</td>`).join("")}</tr>`)
    .join("\n");

  return [
    "<!DOCTYPE html>",
    "<html><head>",
    '<meta charset="UTF-8">',
    '<style>',
    'body{font-family:sans-serif;padding:1rem}',
    'table{border-collapse:collapse;width:100%}',
    'th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}',
    'th{background:#f4f4f4;font-weight:bold}',
    'tr:nth-child(even){background:#fafafa}',
    '</style>',
    title ? `<title>${esc(title)}</title>` : "<title>Data</title>",
    "</head><body>",
    title ? `<h2>${esc(title)}</h2>` : "",
    "<table>",
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${body}</tbody>`,
    "</table>",
    "</body></html>",
  ].join("\n");
}

/** Convert records to XLSX buffer */
export function formatAsXlsx(records: Record<string, unknown>[], sheetName = "Data"): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(records);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}

/** Convert records to markdown table */
export function formatAsMarkdown(records: Record<string, unknown>[], maxCellLen = 80): string {
  if (records.length === 0) return "_No data_";
  const headers = Object.keys(records[0]);

  const cell = (v: unknown) => {
    const s = String(v ?? "");
    const truncated = s.length > maxCellLen ? s.slice(0, maxCellLen - 1) + "…" : s;
    return truncated.replace(/\|/g, "\\|");
  };

  const headerRow = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const rows = records.map(r => `| ${headers.map(h => cell(r[h])).join(" | ")} |`);
  return [headerRow, divider, ...rows].join("\n");
}

/**
 * Format structured records into the requested output format.
 * Returns { content: string | Buffer, mimeType: string }
 */
export function formatRecords(
  records: Record<string, unknown>[],
  format: OutputFormat,
  options: { title?: string; sheetName?: string } = {}
): { content: string | Buffer; mimeType: string; ext: string } {
  switch (format) {
    case "json":
      return { content: JSON.stringify(records, null, 2), mimeType: "application/json", ext: "json" };
    case "csv":
      return { content: formatAsCsv(records), mimeType: "text/csv", ext: "csv" };
    case "html":
      return { content: formatAsHtml(records, options.title), mimeType: "text/html", ext: "html" };
    case "xlsx":
      return { content: formatAsXlsx(records, options.sheetName), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    case "markdown":
    default:
      return { content: formatAsMarkdown(records), mimeType: "text/markdown", ext: "md" };
  }
}
