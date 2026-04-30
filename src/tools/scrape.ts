import axios, { AxiosError } from "axios";
import { SCRAPER_API_BASE, SCRAPER_DOWNLOAD_BASE, EXCEL_MAX_SHEET_NAME } from "../config.js";
import { formatAsMarkdown, formatAsCsv, formatAsHtml, formatAsXlsx } from "../utils/format.js";
import type { ScrapeParams } from "./types.js";

const SCRAPE_ENDPOINT = `${SCRAPER_API_BASE}/request`;

// How long to wait for a task to complete before giving up
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

interface SubmitApiResponse {
  code: number;
  msg?: string;
  data: unknown;
  timestamp?: number;
}

type DownloadResultItem =
  | { spider_code: 200; rest: Record<string, unknown> }
  | { error: string; error_code?: number };

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Submit a scraper task and return the task_id */
async function submitScrapeTask(
  apiKey: string,
  scraper_name: string,
  scraper_id: string,
  params: Record<string, unknown>
): Promise<string> {
  const form = new URLSearchParams();
  form.append("scraper_name", scraper_name);
  form.append("scraper_id", scraper_id);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }

  const resp = await axios.post(SCRAPE_ENDPOINT, form, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 60000,
  });

  const body = resp.data as SubmitApiResponse;

  if (body.code !== 0) {
    const errorMessages: Record<number, string> = {
      10001: "Missing required parameters. Check platform and operation fields.",
      11000: "Invalid API key.",
      11006: "Scraper API not yet activated on this account. Go to dashboard.novada.com/overview/scraper/ to activate instantly — no email needed.",
      11008: `Unknown platform '${scraper_name}'. Use the exact domain (e.g. 'amazon.com', 'reddit.com').\nTo find valid operation IDs: read the novada://scraper-platforms resource — operation names are exact and cannot be guessed.`,
    };
    const msg = errorMessages[body.code] ?? body.msg ?? "Unknown scraper error";
    throw new Error(`Scraper error (code ${body.code}): ${msg}`);
  }

  // Response nesting: { code:0, data: { code:200, data: { task_id: "..." } } }
  const inner = body.data as Record<string, unknown> | null;
  const taskId = (inner?.data as Record<string, unknown> | undefined)?.task_id as string | undefined;
  if (!taskId) {
    throw new Error(`Scraper submit succeeded but no task_id in response: ${JSON.stringify(body)}`);
  }

  return taskId;
}

/** Poll the download endpoint until the task completes or times out */
async function pollForResult(apiKey: string, taskId: string): Promise<DownloadResultItem[]> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const resp = await axios.get(url, { timeout: 30000 });
    const body = resp.data;

    // Pending: { code: 27202, data: null, msg: "" }
    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).code === 27202
    ) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Complete: array of result items
    if (Array.isArray(body)) {
      return body as DownloadResultItem[];
    }

    throw new Error(`Unexpected download response: ${JSON.stringify(body).slice(0, 200)}`);
  }

  throw new Error(`Scraper task ${taskId} did not complete within ${POLL_TIMEOUT_MS / 1000}s. Check dashboard for status.`);
}

/** Flatten a potentially nested object for tabular display */
function flattenRecord(obj: unknown, prefix = ""): Record<string, string> {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== "object" || Array.isArray(obj)) {
    return { [prefix || "value"]: String(obj) };
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenRecord(v, key));
    } else if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
        // Array of objects — flatten first 5; add truncation hint if more exist
        const cap = 5;
        v.slice(0, cap).forEach((item, idx) => {
          Object.assign(result, flattenRecord(item, `${key}.${idx}`));
        });
        if (v.length > cap) result[`${key}._count`] = `${v.length} total (showing first ${cap})`;
      } else {
        const joined = v.map(x => String(x ?? "")).join("; ");
        result[key] = joined.length > 200 ? joined.slice(0, 200) + "...(truncated)" : joined;
      }
    } else {
      result[key] = String(v ?? "");
    }
  }
  return result;
}

function extractRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(item =>
      typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { value: item }
    );
  }
  if (data !== null && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["organic_results", "organic", "results", "items", "records", "data", "products", "posts"]) {
      if (Array.isArray(d[key])) return extractRecords(d[key]);
    }
    return [d];
  }
  return [];
}

export async function novadaScrape(params: ScrapeParams, apiKey: string): Promise<string> {
  const { platform, operation, params: opParams, format, limit } = params;

  try {
  // Step 1: Submit task
  let taskId: string;
  try {
    taskId = await submitScrapeTask(apiKey, platform, operation, opParams as Record<string, unknown>);
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const body = error.response?.data;
      if (status === 401 || status === 403) {
        throw new Error("Invalid NOVADA_API_KEY or insufficient permissions for platform scrapers.");
      }
      throw new Error(`Scraper API error (HTTP ${status}): ${JSON.stringify(body)}`);
    }
    throw error;
  }

  // Step 2: Poll for result
  let resultItems: DownloadResultItem[];
  try {
    resultItems = await pollForResult(apiKey, taskId);
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(`Failed to retrieve scraper results: ${error.message}`);
    }
    throw error;
  }

  // Step 3: Check for task-level errors
  const firstItem = resultItems[0];
  if (!firstItem) {
    return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
  }

  if ("error" in firstItem) {
    const { error: errMsg, error_code: errCode } = firstItem as { error: string; error_code?: number };
    throw new Error(`Scraper task failed (${errCode ?? "unknown"}): ${errMsg}`);
  }

  const successItem = firstItem as { spider_code: 200; rest: Record<string, unknown> };
  const rawRecords = extractRecords(successItem.rest);
  const records = rawRecords.slice(0, limit).map(r => flattenRecord(r)) as Record<string, unknown>[];

  if (records.length === 0) {
    return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
  }

  const title = `${platform} — ${operation}`;

  switch (format) {
    case "json":
      return [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length}`,
        ``,
        "```json",
        JSON.stringify(rawRecords.slice(0, limit), null, 2),
        "```",
        ``,
        `---`,
        `## Agent Hints`,
        `- Increase limit (max 100) to retrieve more records.`,
        `- For human-readable output: use format='markdown' instead.`,
        `- Read novada://scraper-platforms resource to discover other operations on this platform.`,
      ].join("\n");

    case "csv":
      return [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length}`,
        ``,
        "```csv",
        formatAsCsv(records),
        "```",
        ``,
        `---`,
        `## Agent Hints`,
        `- First row is headers. Parse as CSV for downstream processing.`,
        `- Increase limit (max 100) to retrieve more records.`,
        `- For structured JSON output: use format='json' instead.`,
      ].join("\n");

    case "html":
      return formatAsHtml(records, title);

    case "xlsx": {
      const buf = await formatAsXlsx(records, operation.slice(0, EXCEL_MAX_SHEET_NAME));
      const b64 = buf.toString("base64");
      return [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length}`,
        ``,
        `Excel data (base64-encoded xlsx):`,
        "```",
        b64,
        "```",
        ``,
        `_Save the base64 content to a .xlsx file to open in Excel._`,
      ].join("\n");
    }

    case "markdown":
    default:
      return [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length}${records.length >= limit ? ` (limit:${limit})` : ""}`,
        ``,
        `---`,
        ``,
        formatAsMarkdown(records),
        ``,
        `---`,
        `## Agent Hints`,
        `- Use format='json' or format='csv' for downstream processing.`,
        `- Increase limit (max 100) to retrieve more records.`,
        `- For structured scraping of other platforms, change platform and operation.`,
        `- Discover all 129 supported platforms and their operations: read novada://scraper-platforms resource.`,
      ].join("\n");
  }
  } catch (err: unknown) {
    const code = (typeof err === 'object' && err !== null && 'code' in err)
      ? (err as { code: unknown }).code
      : null;
    const message = err instanceof Error ? err.message : String(err);

    // Check for 11006 (not activated) specifically — require specific pattern to avoid false positives
    const is11006 = code === 11006 ||
      message.includes('code 11006') ||
      message.includes('(code: 11006)') ||
      message.includes('error 11006');

    return JSON.stringify({
      status: "unavailable",
      code: is11006 ? 11006 : (code ?? "unknown"),
      reason: is11006
        ? "Scraper API not yet activated on this account."
        : message,
      agent_instruction: is11006
        ? "Activate Scraper API at dashboard.novada.com/overview/scraper/ before retrying. Do not retry this call automatically — this is a plan-tier gate, not a transient error."
        : message.includes("11008") || message.includes("invalid") || message.includes("not found")
          ? "This is a parameter error — do not retry. Check scraper_name and scraper_id are valid. Use the novada://scraper-platforms resource to find supported platforms."
          : "Transient error — retry once after a short delay. If the error persists, contact support.",
      alternatives: [
        "Use novada_extract for general web page content extraction.",
        "Use novada_unblock for bot-protected pages that require anti-bot bypass.",
        "Use novada_crawl for multi-page site traversal.",
      ],
      next_steps: ["Activate at: https://dashboard.novada.com/overview/scraper/"],
    }, null, 2);
  }
}
