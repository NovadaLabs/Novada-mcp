import axios, { AxiosError } from "axios";
import { SCRAPER_API_BASE, SCRAPER_DOWNLOAD_BASE } from "../config.js";
import { formatAsMarkdown } from "../utils/format.js";
import { NovadaError, NovadaErrorCode, makeNovadaError } from "../_core/errors.js";
import type { ScrapeParams, ScrapeParamsFullType } from "./types.js";

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
export async function submitScrapeTask(
  apiKey: string,
  scraper_name: string,
  scraper_id: string,
  params: Record<string, unknown>
): Promise<string> {
  const form = new URLSearchParams();
  form.append("scraper_name", scraper_name);
  form.append("scraper_id", scraper_id);
  form.append("scraper_errors", "true");
  form.append("is_auto_push", "false");

  // Two param formats exist in the Novada Scraper API:
  //   A) Search engines (google, bing, duckduckgo, yandex) — flat form fields + json=1
  //   B) All other platforms — scraper_params=[{...}] JSON array
  // Verified from dashboard playground 2026-05-18.
  const SEARCH_ENGINES = new Set(["google.com", "bing.com", "duckduckgo.com", "yandex.com"]);
  const RESERVED = new Set(["scraper_name", "scraper_id", "apikey", "api_key", "authorization",
    "scraper_errors", "is_auto_push"]);

  const opParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && !RESERVED.has(k.toLowerCase())) {
      opParams[k] = v;
    }
  }

  if (SEARCH_ENGINES.has(scraper_name)) {
    // Format A: flat form fields for search engines
    if (!("json" in opParams)) opParams["json"] = 1; // request JSON output format
    for (const [k, v] of Object.entries(opParams)) {
      form.append(k, String(v));
    }
  } else {
    // Format B: scraper_params array for all other platforms
    // Always include scraper_params even when empty — backend requires this field
    form.append("scraper_params", JSON.stringify([opParams]));
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
    // H5: throw typed NovadaError for 11006/11008 — no brittle string matching needed at catch site
    if (body.code === 11006) {
      throw makeNovadaError(
        NovadaErrorCode.PRODUCT_UNAVAILABLE,
        `Scraper returned code 11006 for operation '${scraper_id}'. This means either: (1) the operation ID is invalid or unsupported for this account, or (2) Scraper API access is not activated. Verify the operation ID against novada://scraper-platforms before assuming it is an account issue.`,
        "code 11006",
      );
    }
    if (body.code === 11008) {
      throw makeNovadaError(
        NovadaErrorCode.INVALID_PARAMS,
        `Unknown platform '${scraper_name}'. Use the exact domain (e.g. 'amazon.com', 'reddit.com'). To find valid operation IDs: read the novada://scraper-platforms resource — operation names are exact and cannot be guessed.`,
        "code 11008",
      );
    }
    const errorMessages: Record<number, string> = {
      10001: "Missing required parameters. Check platform and operation fields.",
      11000: "Invalid API key.",
    };
    const msg = errorMessages[body.code] ?? body.msg ?? "Unknown scraper error";
    throw new Error(`Scraper error (code ${body.code}): ${msg}`);
  }

  // Accept both flat { code:0, data: { task_id: "..." } } and nested { code:0, data: { data: { task_id: "..." } } }
  const inner = body.data as Record<string, unknown> | null;
  const taskId = (
    (inner?.task_id as string | undefined) ??
    ((inner?.data as Record<string, unknown> | undefined)?.task_id as string | undefined)
  );
  if (!taskId) {
    throw new Error(`Scraper submit succeeded but no task_id in response: ${JSON.stringify(body)}`);
  }

  return taskId;
}

/** Poll the download endpoint until the task completes or times out */
async function pollForResult(apiKey: string, taskId: string): Promise<DownloadResultItem[]> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  // H3: safe version of URL for error messages — strips the apikey value to prevent key exposure
  const safeUrl = url.replace(/apikey=[^&]+/, "apikey=***");
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

    // Known error codes from the download endpoint
    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body)
    ) {
      const bErr = body as Record<string, unknown>;
      const errCode = bErr.code as number | undefined;
      const errMsg = (bErr.msg as string | undefined) ?? "";
      if (errCode === 10001) {
        throw new Error(`Scraper download error 10001 (Invalid file type): The server could not return results as JSON for this scraper. Try a different operation, or check that the platform and operation names are correct. Use novada://scraper-platforms to find valid operations.`);
      }
      if (errCode === 10002 || errCode === 10003) {
        throw new Error(`Scraper task error (code ${errCode}): ${errMsg || "Task failed on the server side."} Retry with different parameters.`);
      }
      if (errCode === 27203) {
        throw new Error(`Scraper task failed (code 27203): Server-side task execution error. ${errMsg}. This is a transient error — retry once.`);
      }
      throw new Error(`Unexpected download response (code ${errCode ?? "?"}): ${errMsg || JSON.stringify(bErr).slice(0, 150)}`);
    }
    throw new Error(`Unexpected download response: ${JSON.stringify(body).slice(0, 200)}`);
  }

  throw new Error(`Scraper task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s. task_id="${taskId}" — the task may still be running. This is a transient error; retry the same call.`);
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

// Aliases for stale operation IDs that appeared in old docs/examples
const OPERATION_ALIASES: Record<string, string> = {
  "amazon_product_by-keywords": "amazon_product_keywords",
  "amazon_product_by-asin":     "amazon_product_asin",
};

export async function novadaScrape(params: ScrapeParams | ScrapeParamsFullType, apiKey: string): Promise<string> {
  const { platform, params: opParams, format, limit } = params;
  const operation = OPERATION_ALIASES[params.operation] ?? params.operation;

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

  // Step 3: Extract records — handle two response formats from the download endpoint:
  //   Format A (flat): array of direct record objects, e.g. [{title:"...", error:null, success:true}, ...]
  //   Format B (wrapped): [{spider_code:200, rest:{...}}, ...] or [{error:"msg", error_code:N}]
  const firstItem = resultItems[0];
  if (!firstItem) {
    return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
  }

  const firstAsRecord = firstItem as Record<string, unknown>;
  let rawRecords: Record<string, unknown>[];

  if ("spider_code" in firstAsRecord || "rest" in firstAsRecord) {
    // Format B: wrapped envelope
    const itemError = firstAsRecord.error;
    if (typeof itemError === "string" && itemError.length > 0) {
      const errCode = (firstAsRecord.error_code as number | undefined);
      throw new Error(`Scraper task failed (${errCode ?? "unknown"}): ${itemError}`);
    }
    rawRecords = extractRecords((firstAsRecord as { rest: Record<string, unknown> }).rest);
  } else {
    // Format A: flat array — filter out genuinely failed items (error is a non-empty string)
    rawRecords = resultItems
      .filter(item => {
        const err = (item as Record<string, unknown>).error;
        return typeof err !== "string" || err.length === 0;
      })
      .map(item => item as unknown as Record<string, unknown>);
  }
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

    case "toon": {
      // TOON: headers declared once, then pipe-separated rows — 40-65% token savings vs JSON/markdown
      // Union all keys across records to avoid dropping columns from heterogeneous rows
      const headerSet = new Set<string>();
      for (const r of records) Object.keys(r).forEach(k => headerSet.add(k));
      const headers = Array.from(headerSet);
      const toonRows = [
        `HEADERS: ${headers.join(" | ")}`,
        ...records.map(r => headers.map(h => String(r[h] ?? "")).join(" | ")),
      ];
      return [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length} | format: toon`,
        ``,
        toonRows.join("\n"),
        ``,
        `---`,
        `## Agent Hints`,
        `- TOON format: first line starts with "HEADERS:" listing columns, subsequent lines are pipe-separated values.`,
        `- Use format='json' for downstream code processing, format='markdown' for human-readable output.`,
        `- Increase limit (max 100) to retrieve more records.`,
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
    // H5: use typed NovadaError.code instead of brittle string matching
    if (err instanceof NovadaError && err.code === NovadaErrorCode.PRODUCT_UNAVAILABLE) {
      return JSON.stringify({
        status: "unavailable",
        code: 11006,
        reason: "Scraper returned code 11006 — invalid operation ID or Scraper API not activated.",
        agent_instruction: "First verify the operation ID against novada://scraper-platforms resource. If the operation ID is correct, activate Scraper API at dashboard.novada.com/overview/scraper/. Do not retry automatically.",
        alternatives: [
          "Use novada_extract for general web page content extraction.",
          "Use novada_unblock for bot-protected pages.",
          "Use novada_crawl for multi-page site traversal.",
        ],
        next_steps: ["Activate at: https://dashboard.novada.com/overview/scraper/"],
      }, null, 2);
    }

    if (err instanceof NovadaError && err.code === NovadaErrorCode.INVALID_PARAMS && err.detail === "code 11008") {
      return JSON.stringify({
        status: "error",
        code: 11008,
        reason: err.message,
        agent_instruction: "This is a parameter error — do not retry. Check scraper_name and scraper_id are valid. Use the novada://scraper-platforms resource to find supported platforms.",
      }, null, 2);
    }

    // All other errors (network, timeout, poll failure, missing task_id): re-throw
    // index.ts will handle them via classifyError and return isError: true
    throw err;
  }
}
