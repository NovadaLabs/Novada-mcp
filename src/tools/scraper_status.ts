import axios, { AxiosError } from "axios";
import { z } from "zod";
import { makeNovadaError, NovadaErrorCode, sanitizeServerMsg } from "../_core/errors.js";
import { SCRAPER_STATUS_BASE } from "../config.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const ScraperStatusParamsSchema = z.object({
  task_id: z
    .string()
    .min(1, "task_id is required")
    .regex(
      /^[a-zA-Z0-9_\-\.]{1,128}$/,
      "task_id must be alphanumeric with underscores/hyphens/dots only"
    )
    .describe(
      "The task_id returned by novada_scraper_submit. Used to poll scraping task progress."
    ),
});

export type ScraperStatusParams = z.infer<typeof ScraperStatusParamsSchema>;

export function validateScraperStatusParams(
  args: Record<string, unknown> | undefined
): ScraperStatusParams {
  return ScraperStatusParamsSchema.parse(args ?? {});
}

// ─── API Response Types ──────────────────────────────────────────────────────

type TaskStatus = "pending" | "running" | "complete" | "failed";

interface StatusApiResponse {
  code?: number;
  status?: string;
  msg?: string;
  data?: {
    status?: string;
    result?: unknown;
    task_id?: string;
    created_at?: string;
    updated_at?: string;
  } | null;
}

// ─── Status Endpoint ─────────────────────────────────────────────────────────

// Primary status endpoint — imported from config.ts (centralized)
const STATUS_BASE = SCRAPER_STATUS_BASE;

/**
 * Normalize raw API status string to our canonical TaskStatus union.
 * Handles variations like "COMPLETE", "in_progress", "processing", etc.
 */
function normalizeStatus(raw: string | undefined): TaskStatus {
  if (!raw) return "pending";
  const s = raw.toLowerCase();
  if (s === "complete" || s === "completed" || s === "success" || s === "done") return "complete";
  if (s === "failed" || s === "error" || s === "failure") return "failed";
  if (s === "running" || s === "processing" || s === "in_progress") return "running";
  return "pending";
}

/**
 * Poll the status of an async scraping task by task_id.
 * Returns the current status and result if complete.
 */
export async function novadaScraperStatus(
  params: ScraperStatusParams,
  apiKey: string
): Promise<string> {
  const { task_id } = params;

  // The confirmed download/status pattern uses apikey query param
  // Try the api-m.novada.com endpoint first, fall back to download base pattern
  const STATUS_ENDPOINT = `${STATUS_BASE}/${encodeURIComponent(task_id)}`;

  let normalStatus: TaskStatus;
  let rawResult: unknown = null;
  let errorDetail: string | undefined;

  try {
    const resp = await axios.get(STATUS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    });

    const body = resp.data as StatusApiResponse;

    // Handle Novada's code-based envelope (code=27202 = pending)
    if (typeof body === "object" && body !== null && "code" in body) {
      if (body.code === 27202) {
        normalStatus = "pending";
      } else if (body.code === 10002 || body.code === 10003) {
        normalStatus = "failed";
        errorDetail = body.msg ?? `Task failed with code ${body.code}`;
      } else if (body.code === 0) {
        // Success — extract status from data
        normalStatus = normalizeStatus(body.data?.status);
        rawResult = body.data?.result ?? body.data ?? null;
      } else {
        // Unknown code — surface as failed rather than pending to prevent infinite retry loops
        normalStatus = "failed";
        errorDetail = `Unexpected API response code ${body.code}: ${body.msg ?? "no message"}`;
      }
    } else if (typeof body === "object" && body !== null && "status" in body) {
      // Flat response shape: { status: "complete", result: {...} }
      const bodyFlat = body as { status?: string; result?: unknown; msg?: string };
      normalStatus = normalizeStatus(bodyFlat.status);
      rawResult = bodyFlat.result ?? null;
    } else if (Array.isArray(body)) {
      // Array response = download complete (matches scrape.ts pollForResult pattern)
      normalStatus = "complete";
      rawResult = body;
    } else {
      normalStatus = "pending";
    }
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const body = err.response?.data as StatusApiResponse | undefined;

      if (status === 404) {
        // Fallback: try the download endpoint (same backend scraper_result uses)
        try {
          const DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";
          const dlResp = await axios.get(`${DOWNLOAD_BASE}/scraper_download`, {
            params: { task_id, file_type: "json", apikey: apiKey },
            timeout: 15000,
          });
          const dlBody = dlResp.data;
          if (
            Array.isArray(dlBody) &&
            dlBody.length > 0 &&
            dlBody[0] !== null &&
            typeof dlBody[0] === "object"
          ) {
            return JSON.stringify(
              {
                status: "complete",
                task_id,
                agent_instruction: `Task complete. Call novada_scraper_result with task_id="${task_id}" to retrieve formatted results.`,
              },
              null,
              2
            );
          }
          if (
            typeof dlBody === "object" &&
            dlBody !== null &&
            (dlBody as { code?: number }).code === 27202
          ) {
            return JSON.stringify(
              {
                status: "pending",
                task_id,
                agent_instruction:
                  "Task is queued. Retry novada_scraper_status in 5-10 seconds.",
              },
              null,
              2
            );
          }
        } catch (fallbackErr: unknown) {
          // Surface auth failures from fallback endpoint, swallow others
          if (fallbackErr instanceof AxiosError) {
            const fbStatus = fallbackErr.response?.status;
            if (fbStatus === 401 || fbStatus === 403) {
              throw makeNovadaError(
                NovadaErrorCode.INVALID_API_KEY,
                "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API."
              );
            }
          }
          /* other fallback failures — fall through to not_found */
        }
        return JSON.stringify(
          {
            status: "not_found",
            task_id,
            agent_instruction:
              "Task not found on either endpoint. Verify task_id from a successful novada_scraper_submit call. Tasks expire after 24 hours.",
          },
          null,
          2
        );
      }

      if (status === 401 || status === 403) {
        throw makeNovadaError(
          NovadaErrorCode.INVALID_API_KEY,
          "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API."
        );
      }

      // Network error or endpoint not yet deployed
      const serverMsg = sanitizeServerMsg(body?.msg ?? err.message);
      return JSON.stringify(
        {
          status: "endpoint_error",
          task_id,
          error: `HTTP ${status ?? "network"}: ${serverMsg}`,
          agent_instruction:
            "Could not reach the scraper status endpoint. If this persists, contact Novada support at support@novada.com to confirm the GET /v1/scraper/{task_id} endpoint is available on your account. Do not retry more than 3 times.",
        },
        null,
        2
      );
    }

    throw err;
  }

  // Build response based on normalized status
  switch (normalStatus) {
    case "complete":
      return JSON.stringify(
        {
          status: "complete",
          task_id,
          result: rawResult,
          agent_instruction: `Task complete. Call novada_scraper_result with task_id="${task_id}" to retrieve formatted results. Or read the result field above directly if it contains the data you need.`,
        },
        null,
        2
      );

    case "failed":
      return JSON.stringify(
        {
          status: "failed",
          task_id,
          error: errorDetail ?? "Task failed on the server side.",
          agent_instruction: `Task failed. Re-submit with novada_scraper_submit using the same or different parameters. If the error persists, try novada_extract or novada_unblock as alternatives for this URL.`,
        },
        null,
        2
      );

    case "running":
      return JSON.stringify(
        {
          status: "running",
          task_id,
          agent_instruction: `Task is actively running. Retry novada_scraper_status in 5–10 seconds. Use exponential backoff: poll at 5s, 10s, 20s, 40s intervals.`,
        },
        null,
        2
      );

    case "pending":
    default:
      return JSON.stringify(
        {
          status: "pending",
          task_id,
          agent_instruction: `Task is queued and not yet started. Retry novada_scraper_status in 5–10 seconds. Use exponential backoff: poll at 5s, 10s, 20s, 40s intervals.`,
        },
        null,
        2
      );
  }
}
