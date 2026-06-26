import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface OutputOptions {
  tool: string;        // "scrape", "extract", "search", "research"
  hint?: string;       // domain name or query keyword (used as topic subfolder)
  format: "json" | "csv" | "md" | "html";
  data: unknown;       // the actual content to save
  cosUrl?: string;     // COS download URL (scraper API only)
}

export interface OutputResult {
  filePath: string;    // absolute path to saved file
  cosUrl?: string;     // COS download URL if available
  recordCount?: number;
  summary: string;     // human-readable summary line
}

/**
 * Sanitize a string for safe use as a filename or folder name.
 * Removes special chars, truncates.
 */
function sanitize(s: string, maxLen = 40): string {
  return s
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen)
    || "output";
}

/**
 * Extract a short topic slug from the hint.
 * For URLs: use the domain (e.g. "machinelearningmastery")
 * For queries: use first 3 words (e.g. "agent-memory-AI")
 */
function topicSlug(hint: string): string {
  // If it looks like a URL/domain, use the domain part
  if (hint.includes(".") && !hint.includes(" ")) {
    const domain = hint.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    return sanitize(domain, 30);
  }
  // Otherwise it's a query — take first 4 words, join with hyphens
  const words = hint.trim().split(/\s+/).slice(0, 4).join("-");
  return sanitize(words, 30);
}

/**
 * Get or create the output directory.
 * Structure: ~/Downloads/novada-mcp/YYYY-MM-DD/{topic}/
 *
 * @param topic - sanitized topic slug for subfolder (optional)
 */
async function getOutputDir(topic?: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const base = join(homedir(), "Downloads", "novada-mcp", today);
  const dir = topic ? join(base, topic) : base;
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate a filename following the naming convention:
 * {YYYY-MM-DD}_{HHmmss}_{source_hint}.{format}
 *
 * Examples:
 *   2026-06-26_114219_machinelearningmastery.md
 *   2026-06-26_114207_search.json
 *   2026-06-26_114300_novada-mcp-web-scraping.md  (research)
 */
function generateFileName(hint: string, format: string): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "") + String(now.getMilliseconds()).padStart(3, "0"); // HHmmssSSS

  // For source hint: if URL, use domain only; if query, first 3 words
  let source: string;
  if (hint.includes(".") && !hint.includes(" ")) {
    // URL → domain name
    source = sanitize(
      hint.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, ""),
      25
    );
  } else {
    // Query → first 3 words
    source = sanitize(hint.trim().split(/\s+/).slice(0, 3).join("-"), 25);
  }

  return `${date}_${time}_${source}.${format}`;
}

/**
 * Convert an array of records to CSV string.
 */
export function toCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";

  const allKeys = new Set<string>();
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      allKeys.add(key);
    }
  }
  const headers = [...allKeys];

  const escapeField = (val: unknown): string => {
    const str = val === null || val === undefined ? "" : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const headerLine = headers.map(escapeField).join(",");
  const dataLines = records.map(rec =>
    headers.map(h => escapeField(rec[h])).join(",")
  );

  return [headerLine, ...dataLines].join("\n");
}

/**
 * Save output to file. Returns metadata about the saved file.
 *
 * Directory structure:
 *   ~/Downloads/novada-mcp/YYYY-MM-DD/{topic}/
 *
 * Filename convention:
 *   {YYYY-MM-DD}_{HHmmss}_{source_hint}.{format}
 *
 * Throws if the serialized content would be empty (0 bytes).
 */
export async function saveOutput(options: OutputOptions): Promise<OutputResult> {
  const { tool, hint = "output", format, data, cosUrl } = options;

  // Build topic subfolder from the hint
  const topic = topicSlug(hint);
  const dir = await getOutputDir(topic);
  const fileName = generateFileName(hint, format);
  const filePath = join(dir, fileName);

  let content: string;
  let recordCount: number | undefined;

  switch (format) {
    case "json": {
      const serialized = JSON.stringify(data, null, 2);
      content = serialized ?? "";
      if (Array.isArray(data)) recordCount = data.length;
      break;
    }
    case "csv": {
      const records = Array.isArray(data)
        ? data.map(item => typeof item === "object" && item !== null ? item as Record<string, unknown> : { value: item })
        : [typeof data === "object" && data !== null ? data as Record<string, unknown> : { value: data }];
      content = toCsv(records);
      recordCount = records.length;
      break;
    }
    case "md": {
      content = typeof data === "string" ? data : JSON.stringify(data, null, 2) ?? "";
      break;
    }
    case "html": {
      content = typeof data === "string" ? data : String(data);
      break;
    }
    default:
      content = String(data);
  }

  if (content.trim().length === 0) {
    throw new Error(`saveOutput: refusing to write empty file (tool=${tool}, format=${format})`);
  }

  await writeFile(filePath, content, "utf-8");

  const sizeKB = Math.round(Buffer.byteLength(content) / 1024);
  const parts = [`${filePath} (${sizeKB}KB)`];
  if (recordCount !== undefined) parts.push(`${recordCount} records`);
  if (cosUrl) parts.push(`Download: ${cosUrl}`);

  return {
    filePath,
    cosUrl,
    recordCount,
    summary: parts.join(" | "),
  };
}
