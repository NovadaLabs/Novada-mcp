// Wraps POST /v1/wallet/usage_record on developer-api.novada.com.

import { z } from "zod";
import { devApiPost, withDateRangeCompat } from "../_core/developer_api.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const WalletUsageRecordParamsSchema = z.object({
  start_time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Inclusive start date in YYYY-MM-DD. Defaults to 30 days ago on the server side. NOTE: this tool transparently emits both `start_time` and the server's typo'd `strat_time` for forward compat."
    ),
  end_time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive end date YYYY-MM-DD. Defaults to today."),
  page: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe("1-based page index."),
  page_size: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(50)
    .describe("Page size, max 200."),
});

export type WalletUsageRecordParams = z.infer<typeof WalletUsageRecordParamsSchema>;

export function validateWalletUsageRecordParams(
  args: Record<string, unknown> | undefined
): WalletUsageRecordParams {
  return WalletUsageRecordParamsSchema.parse(args ?? {});
}

/**
 * Fetch paginated wallet usage / transaction records from the developer-api.
 * Emits both `start_time` and the server's typo'd `strat_time` for forward compat.
 */
export async function novadaWalletUsageRecord(
  params: WalletUsageRecordParams,
  _apiKey?: string
): Promise<string> {
  const { start_time, end_time, page, page_size } = params;

  let body: Record<string, unknown> = { page, page_size };
  if (start_time !== undefined || end_time !== undefined) {
    body = withDateRangeCompat(body, { start: start_time, end: end_time });
  }

  const data = await devApiPost<unknown>("/v1/wallet/usage_record", body);

  // Anomaly check: server sometimes returns count > 0 but an empty list
  // (smoke-verified 2026-06-03). Surface this so agents don't conclude
  // "no data" when there actually IS data on a different page.
  let data_anomaly: string | undefined;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const count = typeof obj.count === "number" ? obj.count : undefined;
    const list = Array.isArray(obj.list) ? (obj.list as unknown[]) : undefined;
    if (count !== undefined && count > 0 && list !== undefined && list.length === 0) {
      data_anomaly = `Server reports count=${count} but page ${page} list is empty. Try a lower page index, larger page_size, or a wider date range. The count value comes from server.`;
    }
  }

  return JSON.stringify(
    {
      status: "ok",
      data,
      ...(data_anomaly ? { data_anomaly } : {}),
      agent_instruction:
        "Returns paginated wallet transactions. For total spend per product use novada_traffic_daily; for current product balances use novada_plan_balance_all.",
    },
    null,
    2
  );
}
