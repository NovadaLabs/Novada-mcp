import axios, { AxiosError } from "axios";
import { z } from "zod";
import { SCRAPER_DOWNLOAD_BASE, SCRAPER_STATUS_BASE } from "../config.js";
import { formatAsMarkdown } from "../utils/format.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const ScraperResultParamsSchema = z.object({
  task_id: z
    .string()
    .min(1, "task_id is required")
    .regex(
      /^[a-zA-Z0-9_\-\.]{1,128}$/,
      "task_id must be alphanumeric with underscores/hyphens/dots only"
    )
    .describe(
      "The task_id of a completed scraping task. Use novada_scraper_status first to confirm status is 'complete'."
    ),
  format: z
    .enum(["markdown", "json", "raw"])
    .default("markdown")
    .describe(
      "Output format for the scraped result. 'markdown' (default): human-readable table. 'json': structured JSON for programmatic use. 'raw': raw API response without formatting."
    ),
});

export type ScraperResultParams = z.infer<typeof ScraperResultParamsSchema>;

export function validateScraperResultParams(
  args: Record<string, unknown> | undefined
): ScraperResultParams {
  return ScraperResultParamsSchema.parse(args ?? {});
}

// ─── API Response Types ──────────────────────────────────────────────────────

type DownloadResultItem =
  | { spider_code: 200; rest: Record<string, unknown> }
  | { error: string; error_code?: number };

interface StatusCheckResponse {
  code?: number;
  status?: string;
  result?: unknown;
  data?: { status?: string; result?: unknown } | null;
  msg?: string;
}

// ─── Result Endpoint ─────────────────────────────────────────────────────────

// Result download: GET /scraper_download?task_id=...&file_type=json&apikey=...
// Fallback: api-m.novada.com status endpoint (SCRAPER_STATUS_BASE from config.ts)
const RESULT_DOWNLOAD_ENDPOINT = `${SCRAPER_DOWNLOAD_BASE}/scraper_download`;
const STATUS_BASE = SCRAPER_STATUS_BASE;

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
        const cap = 5;
        v.slice(0, cap).forEach((item, idx) => {
          Object.assign(result, flattenRecord(item, `${key}.${idx}`));
        });
        if (v.length > cap)
          result[`${key}._count`] = `${v.length} total (showing first ${cap})`;
      } else {
        const joined = v.map((x) => String(x ?? "")).join("; ");
        result[key] =
          joined.length > 200 ? joined.slice(0, 200) + "...(truncated)" : joined;
      }
    } else {
      result[key] = String(v ?? "");
    }
  }
  return result;
}

function extractRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map((item) =>
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : { value: item }
    );
  }
  if (data !== null && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of [
      "organic_results",
      "organic",
      "results",
      "items",
      "records",
      "data",
      "products",
      "posts",
    ]) {
      if (Array.isArray(d[key])) return extractRecords(d[key]);
    }
    return [d];
  }
  return [];
}

/**
 * Fetch completed results for a scraping task by task_id.
 * Tries the confirmed download endpoint first; falls back to api-m.novada.com.
 */
export async function novadaScraperResult(
  params: ScraperResultParams,
  apiKey: string
): Promise<string> {
  const { task_id, format } = params;

  let rawData: unknown = null;
  let fetchedFromEndpoint = "unknown";

  // ── Attempt 1: Confirmed download endpoint (matches existing scrape.ts pattern) ──
  try {
    const resp = await axios.get(RESULT_DOWNLOAD_ENDPOINT, {
      params: { task_id, file_type: "json", apikey: apiKey },
      timeout: 30000,
    });
    const body = resp.data;

    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).code === 27202
    ) {
      // Still pending
      return JSON.stringify(
        {
          status: "pending",
          task_id,
          agent_instruction:
            "Task is still processing. Use novada_scraper_status to confirm status='complete' before calling novada_scraper_result.",
        },
        null,
        2
      );
    }

    if (Array.isArray(body) && body.length > 0) {
      rawData = body;
      fetchedFromEndpoint = RESULT_DOWNLOAD_ENDPOINT;
    } else if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body)
    ) {
      const bObj = body as Record<string, unknown>;
      // Error codes from download endpoint
      if (bObj.code === 10002 || bObj.code === 10003) {
        return JSON.stringify(
          {
            status: "failed",
            task_id,
            error: `Task failed (code ${bObj.code}): ${bObj.msg ?? "Server-side task execution error."}`,
            agent_instruction:
              "The scraping task failed. Re-submit with novada_scraper_submit or try novada_extract as an alternative.",
          },
          null,
          2
        );
      }
    }
  } catch (downloadErr: unknown) {
    if (downloadErr instanceof AxiosError) {
      const status = downloadErr.response?.status;
      if (status === 401 || status === 403) {
        throw makeNovadaError(
          NovadaErrorCode.INVALID_API_KEY,
          "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API."
        );
      }
      // Other HTTP errors — fall through to attempt 2
    } else {
      // Non-Axios error (e.g. network failure) — re-throw via error system
      throw makeNovadaError(
        NovadaErrorCode.API_DOWN,
        downloadErr instanceof Error ? downloadErr.message : String(downloadErr)
      );
    }
  }

  // ── Attempt 2: Fallback to api-m.novada.com status endpoint ──
  if (rawData === null) {
    try {
      const statusUrl = `${STATUS_BASE}/${encodeURIComponent(task_id)}`;
      const resp = await axios.get(statusUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 30000,
      });
      const body = resp.data as StatusCheckResponse;

      const status =
        body.status ??
        body.data?.status ??
        (body.code === 0 ? "complete" : undefined);

      if (status && !["complete", "completed", "success", "done"].includes(status.toLowerCase())) {
        return JSON.stringify(
          {
            status: "not_ready",
            task_id,
            current_status: status,
            agent_instruction:
              "Task is not yet complete. Use novada_scraper_status to poll until status is 'complete', then call novada_scraper_result again.",
          },
          null,
          2
        );
      }

      rawData = body.result ?? body.data?.result ?? body.data ?? null;
      if (rawData !== null) {
        fetchedFromEndpoint = statusUrl;
      }
    } catch (statusErr: unknown) {
      if (statusErr instanceof AxiosError) {
        const status = statusErr.response?.status;
        if (status === 401 || status === 403) {
          throw makeNovadaError(
            NovadaErrorCode.INVALID_API_KEY,
            "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API."
          );
        }
        // Other HTTP errors — fall through to unavailable response
      } else {
        // Non-Axios error — re-throw via error system
        throw makeNovadaError(
          NovadaErrorCode.API_DOWN,
          statusErr instanceof Error ? statusErr.message : String(statusErr)
        );
      }
    }
  }

  // ── No data retrieved ──
  if (rawData === null) {
    return JSON.stringify(
      {
        status: "unavailable",
        task_id,
        note: "Could not retrieve result from either the download endpoint or the status endpoint.",
        agent_instruction:
          "Result retrieval failed. Two possible causes: (1) Task is not yet complete — use novada_scraper_status first. (2) The result endpoint is not yet deployed for this scraper type — contact Novada support at support@novada.com with the task_id for manual result retrieval.",
      },
      null,
      2
    );
  }

  // ── Format the retrieved data ──
  const records = extractRecords(rawData);

  if (records.length === 0) {
    return JSON.stringify(
      {
        status: "complete",
        task_id,
        records: 0,
        agent_instruction: "Task completed but returned no records. The scraped URL may have returned an empty response or the scraper found no matching data.",
      },
      null,
      2
    );
  }

  switch (format) {
    case "json":
      return [
        "## Scraper Result",
        `task_id: ${task_id} | records: ${records.length} | fetched from: ${fetchedFromEndpoint}`,
        "",
        "```json",
        JSON.stringify(records, null, 2),
        "```",
        "",
        "---",
        "## Agent Hints",
        "- Use format='markdown' for a human-readable table.",
        "- Use format='raw' to see the unprocessed API response.",
        `- task_id: ${task_id}`,
      ].join("\n");

    case "raw":
      return [
        "## Scraper Result (Raw)",
        `task_id: ${task_id} | fetched from: ${fetchedFromEndpoint}`,
        "",
        "```json",
        JSON.stringify(rawData, null, 2),
        "```",
        "",
        "---",
        "## Agent Hints",
        "- Use format='json' for extracted records array.",
        "- Use format='markdown' for a formatted table.",
      ].join("\n");

    case "markdown":
    default: {
      const flatRecords = records.map((r) => flattenRecord(r)) as Record<string, unknown>[];
      return [
        "## Scraper Result",
        `task_id: ${task_id} | records: ${records.length}`,
        "",
        "---",
        "",
        formatAsMarkdown(flatRecords),
        "",
        "---",
        "## Agent Hints",
        "- Use format='json' or format='raw' for downstream programmatic processing.",
        `- Use novada_scraper_status with task_id="${task_id}" to check if this was the full result.`,
        `- task_id: ${task_id}`,
      ].join("\n");
    }
  }
}
