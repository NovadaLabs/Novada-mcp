// Wraps POST /v1/capture/logs on developer-api.novada.com.

import { z } from "zod";
import { devApiPost, withDateRangeCompat } from "../_core/developer_api.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const CaptureLogsParamsSchema = z
  .object({
    start_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "Inclusive start date YYYY-MM-DD. Tool emits both start_time AND strat_time (server typo compat).",
      ),
    end_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Inclusive end date YYYY-MM-DD."),
    page: z.number().int().positive().default(1),
    page_size: z.number().int().positive().max(200).default(50),
    status: z
      .enum(["success", "failed", "all"])
      .default("all")
      .optional()
      .describe("Filter by capture task status."),
  })
  .strict();

export type CaptureLogsParams = z.infer<typeof CaptureLogsParamsSchema>;

export function validateCaptureLogsParams(
  args: Record<string, unknown> | undefined,
): CaptureLogsParams {
  return CaptureLogsParamsSchema.parse(args ?? {});
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

/**
 * Fetch paginated capture task logs. Date range is forwarded with the
 * `strat_time`/`start_time` typo-compat shim so this tool keeps working
 * whether or not Novada fixes the server-side spelling.
 */
export async function novadaCaptureLogs(
  params: CaptureLogsParams,
  _apiKey?: string,
): Promise<string> {
  const baseBody: Record<string, unknown> = {
    page: params.page,
    page_size: params.page_size,
  };
  if (params.status && params.status !== "all") {
    baseBody.status = params.status;
  }

  const body =
    params.start_time !== undefined || params.end_time !== undefined
      ? withDateRangeCompat(baseBody, { start: params.start_time, end: params.end_time })
      : baseBody;

  const data = await devApiPost<unknown>("/v1/capture/logs", body);

  return JSON.stringify(
    {
      status: "ok",
      data,
      agent_instruction:
        "Paginated capture task logs. For aggregate capture balance use novada_plan_balance_all (product=capture).",
    },
    null,
    2,
  );
}
