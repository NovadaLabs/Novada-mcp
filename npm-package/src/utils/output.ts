import { writeFile, mkdir } from "fs/promises";
import { join, resolve, sep } from "path";
import { homedir } from "os";

/** Absolute root every Novada output must live under. Hard SSRF/path-traversal boundary. */
export const DOWNLOADS_ROOT = join(homedir(), "Downloads", "novada-mcp");

export interface OutputOptions {
  tool: string;        // "scrape", "extract", "search", "research"
  hint?: string;       // domain name or query keyword (used as topic subfolder)
  format: "json" | "csv" | "md" | "html";
  data: unknown;       // the actual content to save
  cosUrl?: string;     // COS download URL (scraper API only)
  project?: string;    // optional project name to group outputs in a subfolder
}

export interface OutputResult {
  filePath: string;    // absolute path to saved file
  cosUrl?: string;     // COS download URL if available
  recordCount?: number;
  summary: string;     // human-readable summary line
}

/**
 * Sanitize a string for safe use as a filename or folder name.
 * Removes special chars, truncates. Drops every path separator and "." run, so
 * `..`, `/etc/passwd`, and `C:\x` all collapse to safe single-segment slugs —
 * the first line of defence for the site-copy path-traversal guard.
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
 * Public alias of {@link sanitize} for callers (e.g. site_copy) that build their
 * own per-page filenames. Always returns a single safe path segment.
 */
export function sanitizeSlug(s: string, maxLen = 80): string {
  return sanitize(s, maxLen);
}

/**
 * Resolve (and create) a site-copy output directory, hard-constrained to live
 * under {@link DOWNLOADS_ROOT}. Arbitrary absolute output paths are NOT accepted:
 * `project` and `domain` are sanitized to single segments before joining, and the
 * resolved path is re-checked to be inside the root (defence-in-depth SSRF/path-
 * traversal guard). Throws if anything would escape the root.
 *
 * Structure: ~/Downloads/novada-mcp/YYYY-MM-DD/<project|domain>/site-copy/
 */
export async function resolveSiteCopyDir(domain: string, project?: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const group = project ? sanitize(project, 30) : sanitize(domain, 30);
  const dir = join(DOWNLOADS_ROOT, today, group, "site-copy");

  // Defence-in-depth: ensure the resolved path never escapes DOWNLOADS_ROOT.
  const resolved = resolve(dir);
  const rootResolved = resolve(DOWNLOADS_ROOT);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    throw new Error(`resolveSiteCopyDir: refusing to write outside Downloads root (${resolved})`);
  }

  await mkdir(resolved, { recursive: true });
  return resolved;
}

/**
 * Join a sanitized per-page filename onto an already-resolved site-copy dir, and
 * re-verify the final file path stays inside {@link DOWNLOADS_ROOT}. Returns the
 * safe absolute path. Throws on escape.
 *
 * `slug` is sanitized to a single safe segment; `ext` (default "md") is whitelisted
 * to alphanumerics so it can never inject a path separator.
 */
export function safeSiteCopyFilePath(dir: string, slug: string, ext = "md"): string {
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "md";
  const fileName = `${sanitizeSlug(slug, 80)}.${safeExt}`;
  const filePath = resolve(join(dir, fileName));
  const rootResolved = resolve(DOWNLOADS_ROOT);
  if (!filePath.startsWith(rootResolved + sep)) {
    throw new Error(`safeSiteCopyFilePath: refusing to write outside Downloads root (${filePath})`);
  }
  return filePath;
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
async function getOutputDir(topic?: string, project?: string): Promise<string> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  let dir = join(homedir(), "Downloads", "novada-mcp", today);
  if (project) dir = join(dir, sanitize(project, 30));
  if (topic) dir = join(dir, topic);
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

  // Serverless guard (Vercel = read-only FS outside /tmp): never write to disk; return
  // a no-op result so tool calls don't crash. This puts the hosted-safe behavior in the
  // source so re-vendoring to novada-mcpserver no longer needs a manual output.js stub.
  // Local / CLI usage (no VERCEL env) is unaffected and still writes to ~/Downloads.
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    const recordCount = Array.isArray(data) ? data.length : undefined;
    const parts = ["(hosted mode — output not saved to disk)"];
    if (recordCount !== undefined) parts.push(`${recordCount} records`);
    if (cosUrl) parts.push(`Download: ${cosUrl}`);
    return { filePath: "", cosUrl, recordCount, summary: parts.join(" | ") };
  }

  // Build topic subfolder from the hint
  const topic = topicSlug(hint);
  const dir = await getOutputDir(topic, options.project ? sanitize(options.project, 30) : undefined);
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
