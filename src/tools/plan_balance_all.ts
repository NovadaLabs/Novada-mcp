// Aggregates per-product balances across all Novada flow products (5 proxy + 1 capture) in parallel.

import { z } from "zod";
import { devApiParallel } from "../_core/developer_api.js";

// ─── Endpoint table ──────────────────────────────────────────────────────────

const BALANCE_ENDPOINTS = [
  { key: "residential", path: "/v1/residential_flow/balance" },
  { key: "isp",         path: "/v1/isp_flow/balance" },
  { key: "mobile",      path: "/v1/mobile_flow/balance" },
  { key: "datacenter",  path: "/v1/dc_flow/balance" },
  { key: "static",      path: "/v1/static_flow/balance" },
  { key: "capture",     path: "/v1/capture/get_balance" },
] as const;

type ProductKey = typeof BALANCE_ENDPOINTS[number]["key"];

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const PlanBalanceAllParamsSchema = z
  .object({
    products: z
      .array(z.enum(["residential", "isp", "mobile", "datacenter", "static", "capture"]))
      .optional()
      .describe("Subset of products to query. Omit to query ALL 6 in parallel."),
  })
  .strict();

export type PlanBalanceAllParams = z.infer<typeof PlanBalanceAllParamsSchema>;

export function validatePlanBalanceAllParams(
  args: Record<string, unknown> | undefined,
): PlanBalanceAllParams {
  return PlanBalanceAllParamsSchema.parse(args ?? {});
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

interface PerProductOk {
  status: "ok";
  balance: unknown;
  /** True when the product's expire_time is in the past (computed by us, not by server). */
  expired?: boolean;
  /** Human-readable expiry date (ISO YYYY-MM-DD) — derived from numeric expire_time. */
  expires_at_human?: string;
}
interface PerProductError {
  status: "error";
  error: string;
  /** Set when this product is not provisioned for the account (HTTP 404). Lets the agent skip it instead of surfacing as a transient bug. */
  unavailable?: boolean;
}
type PerProductResult = PerProductOk | PerProductError;

/**
 * Server returns `expire_time` as a unix timestamp (seconds). Compute the
 * derived `expired` flag and a human-readable date so agents don't have to.
 */
function enrichBalance(raw: unknown): { expired?: boolean; expires_at_human?: string } {
  if (raw === null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const exp = obj.expire_time;
  if (typeof exp !== "number" || exp <= 0) return {};
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = exp < nowSec;
  const expires_at_human = new Date(exp * 1000).toISOString().slice(0, 10);
  return { expired, expires_at_human };
}

/**
 * Query balance endpoints across all (or a chosen subset of) Novada flow
 * products in parallel. Never hard-fails — partial errors are surfaced in
 * `errors[]` while successful per-product balances are returned alongside.
 */
export async function novadaPlanBalanceAll(
  params: PlanBalanceAllParams,
  _apiKey?: string,
): Promise<string> {
  const requested = params.products?.length
    ? BALANCE_ENDPOINTS.filter(e => params.products!.includes(e.key as ProductKey))
    : BALANCE_ENDPOINTS;

  const selected = requested.map(e => ({ key: e.key, path: e.path, body: {} }));

  const results = await devApiParallel<unknown>(selected);

  const summary: Record<string, PerProductResult> = {};
  const errors: Array<{ product: string; error: string }> = [];
  const expired_products: string[] = [];
  const unavailable_products: string[] = [];
  const active_products: string[] = [];

  for (const r of results) {
    if (r.ok) {
      const enriched = enrichBalance(r.data);
      summary[r.key] = { status: "ok", balance: r.data, ...enriched };
      if (enriched.expired) expired_products.push(r.key);
      else active_products.push(r.key);
    } else {
      const errMsg = r.error ?? "unknown error";
      const isUnavailable = errMsg.includes("Product not provisioned") || errMsg.includes("HTTP 404");
      summary[r.key] = { status: "error", error: errMsg, ...(isUnavailable ? { unavailable: true } : {}) };
      if (isUnavailable) unavailable_products.push(r.key);
      errors.push({ product: r.key, error: errMsg });
    }
  }

  // Treat unavailable-products as not a "real" error for status-summarising
  // purposes — they're known account state, not transient failures.
  const realErrors = errors.filter(e => !unavailable_products.includes(e.product));
  const overall =
    realErrors.length === 0
      ? "ok"
      : realErrors.length === selected.length - unavailable_products.length
        ? "all_failed"
        : "partial";

  return JSON.stringify(
    {
      status: overall,
      summary: {
        active_products,
        expired_products,
        unavailable_products,
        all_plans_expired: active_products.length === 0 && expired_products.length > 0,
      },
      per_product: summary,
      errors: errors.length ? errors : undefined,
      agent_instruction:
        expired_products.length > 0
          ? `Products ${expired_products.join(", ")} have EXPIRED plans (balance=0, expired=true). Master wallet currency still available — call novada_wallet_balance. To restock, the user needs to purchase a new plan at https://dashboard.novada.com.`
          : "Per-product balances. Each balance includes derived expired/expires_at_human fields. For master wallet (currency) use novada_wallet_balance.",
    },
    null,
    2,
  );
}
