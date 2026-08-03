import { AxiosError } from "axios";
import { z } from "zod";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";
import { TASK_ID_REGEX, TASK_ID_REGEX_MSG } from "./types.js";
import { devApiPost } from "../_core/developer_api.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const ScraperStatusParamsSchema = z.object({
  task_id: z
    .string()
    .min(1, "task_id is required")
    .regex(TASK_ID_REGEX, TASK_ID_REGEX_MSG)
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

// ─── Status Endpoint ─────────────────────────────────────────────────────────

/**
 * Normalize raw API status string to our canonical TaskStatus union.
 * Handles variations like "COMPLETE", "in_progress", "processing", etc.
 */
function normalizeStatus(raw: string | undefined): TaskStatus {
  if (!raw) return "pending";
  const s = raw.toLowerCase();
  if (s === "ready" || s === "complete" || s === "completed" || s === "success" || s === "done") return "complete";
  if (s === "failed" || s === "error" || s === "failure") return "failed";
  if (s === "running" || s === "processing" || s === "in_progress") return "running";
  if (s === "pending" || s === "waiting") return "pending";
  return "pending";
}

export interface RawTaskStatusItem { task_id?: string; status?: string; msg?: string }
export interface RawTaskStatusResp { task_id?: string; status?: string; msg?: string; list?: RawTaskStatusItem[] }
/**
 * Single source of truth for the POST /v1/scraper/task_status response shape.
 * LIVE API returns { list: [{ task_id, status }] } (verified 2026-08-03:
 * {"list":[{"status":"Running","task_id":"…"}]}); legacy callers assumed a flat
 * { status }. Handle BOTH; prefer the list entry matching taskId. Every caller of
 * this endpoint MUST parse via this helper — never read `.status` directly.
 */
export function extractRawTaskStatus(resp: RawTaskStatusResp | undefined, taskId?: string): { status?: string; msg?: string } {
  const item = taskId ? (resp?.list?.find((t) => t?.task_id === taskId) ?? resp?.list?.[0]) : resp?.list?.[0];
  return { status: resp?.status ?? item?.status, msg: resp?.msg ?? item?.msg };
}

/**
 * Lightweight existence check for a task_id.
 * Uses the primary devApiPost path (POST /v1/scraper/task_status).
 *
 * Note: The legacy GET endpoint (api-m.novada.com/v1/scraper/{task_id}) was removed
 * because it returns HTTP 404 for all requests (dead route). The POST endpoint is the
 * only active status path.
 *
 * Returns:
 *   "exists"    — task is known to the API (any status: pending/running/complete/failed)
 *   "not_found" — API indicated unknown task (empty status with code=0)
 *   "unknown"   — network error or auth issue — caller should surface ambiguity honestly
 */
export async function checkTaskExists(
  task_id: string,
  apiKey: string
): Promise<"exists" | "not_found" | "unknown"> {
  try {
    const statusResp = await devApiPost<RawTaskStatusResp>(
      "/v1/scraper/task_status",
      { task_ids: task_id },
      { apiKey, timeoutMs: 10_000 }
    );
    const { status: rawStatus } = extractRawTaskStatus(statusResp, task_id);
    // Non-empty status = task exists.
    if (rawStatus) return "exists";
    // Empty status with code=0 — API returned success but no status data: task not found.
    return "not_found";
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      const s = err.response?.status;
      if (s === 401 || s === 403) return "unknown"; // auth failure
    }
    return "unknown";
  }
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

  // Primary: POST to correct status endpoint
  // POST /v1/scraper/task_status — returns { code: 200, data: { task_id, status, ... } }
  // status values: "Pending" | "Running" | "Ready" | "Failed"
  try {
    const statusResp = await devApiPost<RawTaskStatusResp>(
      "/v1/scraper/task_status",
      { task_ids: task_id },
      { apiKey }
    );

    const { status: rawStatus, msg: rawMsg } = extractRawTaskStatus(statusResp, task_id);
    const normalized = normalizeStatus(rawStatus);

    // NOV-666: if the API returned successfully (code=0) but status is absent/null,
    // the task_id may not exist (some APIs return { code:0, data:{} } for unknown ids
    // rather than an error code). Treat as not_found rather than silently returning "pending".
    if (!rawStatus) {
      return JSON.stringify(
        {
          status: "not_found",
          task_id,
          agent_instruction:
            "Task not found. Two possibilities: " +
            "(1) If you JUST called novada_scraper_submit (within the last 10 seconds), this is normal propagation delay — wait 5-10 seconds and call novada_scraper_status ONE more time. " +
            "(2) If you already retried once and still see not_found, the task_id is invalid or expired (tasks expire after 24 hours). Do NOT retry further — re-submit with novada_scraper_submit or switch to novada_extract.",
        },
        null,
        2
      );
    }

    switch (normalized) {
      case "complete":
        return JSON.stringify({
          status: "complete",
          task_id,
          agent_instruction: `Task complete. Call novada_scraper_result with task_id="${task_id}" to retrieve formatted results.`,
        }, null, 2);
      case "failed":
        return JSON.stringify({
          status: "failed",
          task_id,
          error: rawMsg ?? "Task failed on the server side.",
          agent_instruction: `Task failed. Re-submit with novada_scraper_submit or try novada_extract as an alternative.`,
        }, null, 2);
      case "running":
        return JSON.stringify({
          status: "running",
          task_id,
          agent_instruction: "Task is actively executing. Retry novada_scraper_status in 10-20 seconds.",
        }, null, 2);
      case "pending":
      default:
        return JSON.stringify({
          status: "pending",
          task_id,
          agent_instruction: "Task is queued. Retry novada_scraper_status in 5-10 seconds.",
        }, null, 2);
    }
  } catch (primaryErr: unknown) {
    if (primaryErr instanceof AxiosError) {
      const s = primaryErr.response?.status;
      if (s === 401 || s === 403) {
        throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API.");
      }
    }
    // Primary endpoint failed (network error or non-auth HTTP error).
    // The legacy GET fallback (api-m.novada.com/v1/scraper/{task_id}) was removed
    // because it returns HTTP 404 for all requests (dead route as of 2026-07).
    // Surface a classified connectivity error so the agent has actionable guidance.
    return JSON.stringify(
      {
        status: "endpoint_error",
        task_id,
        error: "Primary scraper status endpoint unreachable.",
        agent_instruction:
          "Could not reach the Novada scraper status endpoint. " +
          "Try novada_account(section=\"summary\") to diagnose connectivity. " +
          "If the endpoint is reachable, retry once after 30 seconds. " +
          "If it persists after 3 attempts, switch to novada_extract or novada_crawl as alternatives. " +
          "Support: support@novada.com.",
      },
      null,
      2
    );
  }
}
