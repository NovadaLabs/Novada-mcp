// Aggregates per-product balances across all Novada flow products (4 flow-metered
// proxy products + capture) in parallel, plus a per-IP lifecycle summary for static ISP.
//
// static ISP is NOT a flow-metered product — it's billed per-IP
// (static_house/{open,list,export,renew} track which IPs you own + expiry), unlike
// the other 4 proxy products which are billed by traffic volume via *_flow/balance.
// Calling /v1/static_flow/balance 404s even for accounts with active static_house
// orders (confirmed via raw devApiPost smoke test), so it's handled separately below
// via static_house/list instead of the generic flow-balance fan-out.

import { z } from "zod";
import { devApiParallel, devApiPost } from "../_core/developer_api.js";
import { NovadaError } from "../_core/errors.js";

// ─── Endpoint table ──────────────────────────────────────────────────────────
//
// THE product → flow-ledger table — the single source of truth for every
// callsite that needs "which ledger backs this product" (this file's balance
// fan-out AND the F11 credential preflight in tools/proxy_preflight.ts).
// CLASS-shaped on purpose: adding a new flow-metered product is a new ROW here
// (key + path + label + proxy flag) — never a new branch anywhere else.
//   label — human name used in refusal evidence ("Your Residential proxy plan…").
//   proxy — true when novada_proxy(type=key) issues credentials billed against
//           this ledger (capture is flow-metered but not a proxy product).
export const FLOW_BALANCE_ENDPOINTS = [
  { key: "residential", path: "/v1/residential_flow/balance",        label: "Residential", proxy: true },
  { key: "isp",         path: "/v1/isp_flow/balance",                label: "ISP",         proxy: true },
  { key: "mobile",      path: "/v1/mobile_flow/mobile_flow_balance", label: "Mobile",      proxy: true },
  { key: "datacenter",  path: "/v1/dc_flow/balance",                 label: "Datacenter",  proxy: true },
  { key: "capture",     path: "/v1/capture/get_balance",             label: "Capture",     proxy: false },
] as const;

const ALL_PRODUCT_KEYS = ["residential", "isp", "mobile", "datacenter", "static", "capture"] as const;

type ProductKey = typeof ALL_PRODUCT_KEYS[number];

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const PlanBalanceAllParamsSchema = z
  .object({
    products: z
      .array(z.enum(ALL_PRODUCT_KEYS))
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
  /** True when the plan has zero remaining balance (shape-aware — see deriveBalanceEvidence). */
  exhausted?: boolean;
  /** Human-readable remaining balance ("3.5 GB", "12/100 req", "132.91 credits"). */
  balance_human?: string;
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
 * Shape-aware "how much is left" derivation — the F11 evidence source. The
 * developer API returns three balance shapes (see account.ts's renderer for
 * the live-confirmed catalog):
 *   1. bare number                     — capture credits
 *   2. { total, used, ... }            — mobile request-count plans
 *   3. { balance: <bytes>, ... }       — residential/isp/datacenter bytes plans
 * `exhausted` means "zero remaining" — the ledger state that makes the gateway
 * accept auth and then refuse to route (HTTP 402, curl exit 56) while the
 * credentials themselves still look perfectly valid.
 */
export function deriveBalanceEvidence(raw: unknown): { exhausted?: boolean; balance_human?: string } {
  if (typeof raw === "number") {
    return { exhausted: raw <= 0, balance_human: `${raw.toFixed(2)} credits` };
  }
  if (raw === null || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  if (typeof b.total === "number" && typeof b.used === "number") {
    // total=0 means unprovisioned/fresh — not exhausted; only flag when total>0 && used>=total
    return { exhausted: b.total > 0 && b.used >= b.total, balance_human: `${b.used}/${b.total} req` };
  }
  if (typeof b.balance === "number") {
    const mb = b.balance / (1024 * 1024);
    const balance_human = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
    return { exhausted: b.balance <= 0, balance_human };
  }
  return {};
}

/**
 * THE CLASS ("not provisioned") — SINGLE SOURCE OF TRUTH for every callsite
 * that needs to tell "this product isn't on the account" apart from a
 * genuine/transient error: HTTP 404 (message literal, existing) OR business
 * code 11009 (structural — live-captured 2026-08, confirmed for
 * residential/isp/datacenter: a flow-balance endpoint for a plan the account
 * lacks returns HTTP 200 with envelope `{code:11009, msg:"Failed to obtain
 * user information"}`). Used by BOTH the flow-loop classifier below AND
 * fetchStaticIpSummary's catch — one helper, so the two callsites can never
 * drift apart. Do NOT broaden beyond these two class members.
 */
function isNotProvisioned(code: number | undefined, msg: string): boolean {
  return code === 11009 || msg.includes("Product not provisioned") || msg.includes("HTTP 404");
}

/**
 * static ISP is billed per-IP (not by traffic volume) — summarize ownership
 * via static_house/list instead of a flow-balance call. Region breakdown is
 * best-effort: the list-item shape isn't documented beyond page/limit/total,
 * so we only aggregate a `region` field if the server actually includes one.
 */
async function fetchStaticIpSummary(apiKey?: string): Promise<PerProductResult> {
  try {
    const data = await devApiPost<{ list?: unknown[] | null; total?: number }>(
      "/v1/static_house/list",
      { page: 1, limit: 200 },
      { apiKey },
    );
    const list = Array.isArray(data.list) ? data.list : [];
    const region_breakdown: Record<string, number> = {};
    for (const item of list) {
      if (item !== null && typeof item === "object") {
        const region = (item as Record<string, unknown>).region;
        if (typeof region === "string" && region) {
          region_breakdown[region] = (region_breakdown[region] ?? 0) + 1;
        }
      }
    }
    const active_ip_count = typeof data.total === "number" ? data.total : list.length;
    return {
      status: "ok",
      balance: {
        billing_model: "per_ip_lifecycle",
        active_ip_count,
        region_breakdown,
        raw: data,
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const businessCode = err instanceof NovadaError ? err.businessCode : undefined;
    if (isNotProvisioned(businessCode, errMsg)) {
      return {
        status: "error",
        error: `No static ISP IPs provisioned (billed per-IP, not by traffic — see novada_static_ip_mgmt to open one). Underlying error: ${errMsg}`,
        unavailable: true,
      };
    }
    // NOT the not-provisioned class (e.g. transient 5xx, auth failure, network
    // error) — surface as a genuine error. Do NOT mislabel it "not
    // provisioned": that would hide a real outage/misconfiguration behind a
    // reassuring "known account state" signal.
    return {
      status: "error",
      error: errMsg,
    };
  }
}

/**
 * Query balance endpoints across all (or a chosen subset of) Novada flow
 * products in parallel, plus a per-IP lifecycle summary for static ISP. Never
 * hard-fails — partial errors are surfaced in `errors[]` while successful
 * per-product balances are returned alongside.
 */
export async function novadaPlanBalanceAll(
  params: PlanBalanceAllParams,
  apiKey?: string,
): Promise<string> {
  const wantStatic = !params.products?.length || params.products.includes("static");
  const requested = params.products?.length
    ? FLOW_BALANCE_ENDPOINTS.filter(e => params.products!.includes(e.key as ProductKey))
    : FLOW_BALANCE_ENDPOINTS;

  const selected = requested.map(e => ({ key: e.key, path: e.path, body: {} }));

  const [flowResults, staticResult] = await Promise.all([
    devApiParallel<unknown>(selected, { apiKey }),
    wantStatic ? fetchStaticIpSummary(apiKey) : null,
  ]);

  const summary: Record<string, PerProductResult> = {};
  const errors: Array<{ product: string; error: string }> = [];
  const expired_products: string[] = [];
  const unavailable_products: string[] = [];
  const active_products: string[] = [];

  for (const r of flowResults) {
    if (r.ok) {
      const enriched = enrichBalance(r.data);
      summary[r.key] = { status: "ok", balance: r.data, ...enriched, ...deriveBalanceEvidence(r.data) };
      if (enriched.expired) expired_products.push(r.key);
      else active_products.push(r.key);
    } else {
      const errMsg = r.error ?? "unknown error";
      const isUnavailable = isNotProvisioned(r.code, errMsg);
      summary[r.key] = { status: "error", error: errMsg, ...(isUnavailable ? { unavailable: true } : {}) };
      if (isUnavailable) {
        // Not-provisioned is known account state, not a transient failure —
        // it's already surfaced via `unavailable_products`/`per_product[key]
        // .unavailable`. Do NOT also push it into `errors[]`: a downstream
        // consumer (account.ts) would otherwise render BOTH "⛔ not
        // provisioned" (table, keyed off the structured flag) AND a generic
        // "service error" line (errors list) for the same product — two
        // contradictory signals for one piece of account state.
        unavailable_products.push(r.key);
      } else {
        errors.push({ product: r.key, error: errMsg });
      }
    }
  }

  if (staticResult) {
    summary.static = staticResult;
    if (staticResult.status === "ok") {
      active_products.push("static");
    } else if (staticResult.unavailable) {
      // Mirror the flow-loop: not-provisioned is known account state, already
      // signaled via `unavailable_products`/`per_product.static.unavailable` —
      // do NOT also push it into `errors[]` (see the flow-loop comment above
      // for why a double signal is contradictory downstream).
      unavailable_products.push("static");
    } else {
      errors.push({ product: "static", error: staticResult.error });
    }
  }

  const totalSelected = selected.length + (wantStatic ? 1 : 0);

  // Treat unavailable-products as not a "real" error for status-summarising
  // purposes — they're known account state, not transient failures. NOTE:
  // this filter is currently a no-op by construction — both loops above
  // deliberately never push an unavailable product into `errors[]` (see
  // their own comments) — but it's kept (rather than replaced with `errors`
  // directly) as a defensive invariant guard for `overall` below: if a
  // future edit ever did push an unavailable product into `errors[]`, this
  // line is what would keep it from corrupting the "all_failed"/"partial"
  // classification.
  const realErrors = errors.filter(e => !unavailable_products.includes(e.product));
  const overall =
    realErrors.length === 0
      ? "ok"
      : realErrors.length === totalSelected - unavailable_products.length
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
          ? `Products ${expired_products.join(", ")} have EXPIRED plans (balance=0, expired=true). Master wallet currency still available — call novada_account(section="balance"). To restock, the user needs to purchase a new plan at https://dashboard.novada.com.`
          : "Per-product balances. Each balance includes derived expired/expires_at_human fields. For master wallet (currency) use novada_account(section=\"balance\").",
    },
    null,
    2,
  );
}
