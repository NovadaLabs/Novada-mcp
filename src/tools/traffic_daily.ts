// Aggregates daily traffic consumption across all 5 Novada proxy products in parallel.

import { z } from "zod";
import { devApiParallel, withDateRangeCompat } from "../_core/developer_api.js";

// ─── Endpoint Map ────────────────────────────────────────────────────────────

const FLOW_ENDPOINTS = [
  { key: "residential", path: "/v1/residential_flow/consume_log" },
  { key: "isp",         path: "/v1/isp_flow/consume_log" },
  { key: "mobile",      path: "/v1/mobile_flow/consume_log" },
  { key: "datacenter",  path: "/v1/dc_flow/consume_log" },
  { key: "static",      path: "/v1/static_flow/consume_log" },
] as const;

type ProductKey = (typeof FLOW_ENDPOINTS)[number]["key"];

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const TrafficDailyParamsSchema = z.object({
  start_time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Inclusive start date YYYY-MM-DD. Defaults to 7 days ago server-side. Tool emits both start_time AND strat_time for server typo-compat.",
    ),
  end_time: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive end date YYYY-MM-DD. Defaults to today."),
  products: z
    .array(z.enum(["residential", "isp", "mobile", "datacenter", "static"]))
    .optional()
    .describe(
      "Subset of proxy products to query. Omit to query ALL 5 in parallel.",
    ),
}).strict();

export type TrafficDailyParams = z.infer<typeof TrafficDailyParamsSchema>;

export function validateTrafficDailyParams(
  args: Record<string, unknown> | undefined,
): TrafficDailyParams {
  return TrafficDailyParamsSchema.parse(args ?? {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sumList(list: unknown[]): number {
  let sum = 0;
  for (const item of list) {
    if (item !== null && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const v =
        obj.traffic_mb ??
        obj.mb ??
        obj.consume_mb ??
        obj.total_mb ??
        obj.value;
      if (typeof v === "number") sum += v;
    }
  }
  return sum;
}

function extractTotalMb(data: unknown): number {
  if (data === null || data === undefined) return 0;
  if (Array.isArray(data)) return sumList(data);
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const candidate of ["total_mb", "total", "consume_mb", "totalConsume"]) {
      const v = obj[candidate];
      if (typeof v === "number") return v;
    }
    const list = obj.list ?? obj.records ?? obj.items ?? obj.data;
    if (Array.isArray(list)) return sumList(list);
  }
  return 0;
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

interface PerProductSummary {
  status: "ok" | "error";
  total_mb?: number;
  raw?: unknown;
  error?: string;
}

/**
 * Fan out daily traffic consumption queries across all 5 Novada proxy products
 * (residential, isp, mobile, datacenter, static) in parallel, then aggregate
 * totals. Partial failures are tolerated — each product's outcome is reported
 * independently in per_product[<name>] and errors[].
 */
export async function novadaTrafficDaily(
  params: TrafficDailyParams,
  _apiKey?: string,
): Promise<string> {
  const selected = params.products?.length
    ? FLOW_ENDPOINTS.filter(e =>
        (params.products as ProductKey[]).includes(e.key),
      )
    : FLOW_ENDPOINTS;

  let baseBody: Record<string, unknown> = {};
  if (params.start_time !== undefined || params.end_time !== undefined) {
    baseBody = withDateRangeCompat({}, {
      start: params.start_time,
      end: params.end_time,
    });
  }

  const results = await devApiParallel(
    selected.map(e => ({ key: e.key, path: e.path, body: { ...baseBody } })),
  );

  const summary: Record<string, PerProductSummary> = {};
  let totalMb = 0;
  const errors: Array<{ product: string; error: string }> = [];

  for (const r of results) {
    if (r.ok) {
      const total = extractTotalMb(r.data);
      summary[r.key] = { status: "ok", total_mb: total, raw: r.data };
      totalMb += total;
    } else {
      const errMsg = r.error ?? "unknown error";
      summary[r.key] = { status: "error", error: errMsg };
      errors.push({ product: r.key, error: errMsg });
    }
  }

  const allFailed = errors.length === selected.length;
  const status: "ok" | "partial" | "all_failed" =
    errors.length === 0 ? "ok" : allFailed ? "all_failed" : "partial";

  return JSON.stringify(
    {
      status,
      range: {
        start_time: params.start_time ?? "(server default, ~7 days ago)",
        end_time: params.end_time ?? "(server default, today)",
      },
      total_mb_across_products: totalMb,
      per_product: summary,
      errors: errors.length ? errors : undefined,
      agent_instruction:
        errors.length === 0
          ? "Daily traffic aggregated across all 5 products. Each per_product.raw contains the original per-day breakdown returned by the developer-api."
          : "Some products failed — see errors[] for details. Successful products are in per_product[<name>].raw. Common cause: that product is not provisioned on this account.",
    },
    null,
    2,
  );
}
