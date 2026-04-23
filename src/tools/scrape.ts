import axios, { AxiosError } from "axios";
import { SCRAPER_API_BASE } from "../config.js";
import { formatAsMarkdown, formatAsCsv, formatAsHtml, formatAsXlsx } from "../utils/format.js";
import type { ScrapeParams } from "./types.js";

const SCRAPE_ENDPOINT = `${SCRAPER_API_BASE}/request`;

interface ScrapeApiResponse {
  code: number;
  msg?: string;
  data: unknown;
}

/** Call the Novada platform scraper API */
async function callScraper(
  apiKey: string,
  scraper_name: string,
  scraper_id: string,
  params: Record<string, unknown>
): Promise<ScrapeApiResponse> {
  const resp = await axios.post(
    SCRAPE_ENDPOINT,
    { scraper_name, scraper_id, ...params },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );
  return resp.data as ScrapeApiResponse;
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
        // Array of objects — flatten each element with indexed keys
        v.slice(0, 5).forEach((item, idx) => {
          Object.assign(result, flattenRecord(item, `${key}.${idx}`));
        });
      } else {
        result[key] = v.map(x => String(x ?? "")).join("; ").slice(0, 200);
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
    // Check common wrapper patterns
    const d = data as Record<string, unknown>;
    for (const key of ["results", "items", "records", "data", "products", "posts"]) {
      if (Array.isArray(d[key])) return extractRecords(d[key]);
    }
    return [d];
  }
  return [];
}

export async function novadaScrape(params: ScrapeParams, apiKey: string): Promise<string> {
  const { platform, operation, params: opParams, format, limit } = params;

  let apiResponse: ScrapeApiResponse;
  try {
    apiResponse = await callScraper(apiKey, platform, operation, opParams as Record<string, unknown>);
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

  // Handle API-level errors
  if (apiResponse.code !== 0) {
    const errorMessages: Record<number, string> = {
      10001: "Missing required parameters. Check platform and operation fields.",
      11000: "Invalid API key.",
      11006: "Scraper access not enabled for this account. Contact support@novada.com to enable platform scrapers.",
      11008: `Unknown platform '${platform}'. Use the exact domain (e.g. 'amazon.com', 'reddit.com').`,
    };
    const msg = errorMessages[apiResponse.code] ?? apiResponse.msg ?? "Unknown scraper error";
    throw new Error(`Scraper error (code ${apiResponse.code}): ${msg}`);
  }

  const rawRecords = extractRecords(apiResponse.data);
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
      ].join("\n");

    case "csv":
      return [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length}`,
        ``,
        "```csv",
        formatAsCsv(records),
        "```",
      ].join("\n");

    case "html":
      return formatAsHtml(records, title);

    case "xlsx": {
      const buf = formatAsXlsx(records, operation.slice(0, 31));
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
        `- View supported scrapers at: https://developer.novada.com/novada/advanced-proxy-solutions/scraper-api`,
      ].join("\n");
  }
}
