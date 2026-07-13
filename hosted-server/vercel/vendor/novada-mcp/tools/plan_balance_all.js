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
// ─── Endpoint table ──────────────────────────────────────────────────────────
const FLOW_BALANCE_ENDPOINTS = [
    { key: "residential", path: "/v1/residential_flow/balance" },
    { key: "isp", path: "/v1/isp_flow/balance" },
    { key: "mobile", path: "/v1/mobile_flow/mobile_flow_balance" },
    { key: "datacenter", path: "/v1/dc_flow/balance" },
    { key: "capture", path: "/v1/capture/get_balance" },
];
const ALL_PRODUCT_KEYS = ["residential", "isp", "mobile", "datacenter", "static", "capture"];
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const PlanBalanceAllParamsSchema = z
    .object({
    products: z
        .array(z.enum(ALL_PRODUCT_KEYS))
        .optional()
        .describe("Subset of products to query. Omit to query ALL 6 in parallel."),
})
    .strict();
export function validatePlanBalanceAllParams(args) {
    return PlanBalanceAllParamsSchema.parse(args ?? {});
}
/**
 * Server returns `expire_time` as a unix timestamp (seconds). Compute the
 * derived `expired` flag and a human-readable date so agents don't have to.
 */
function enrichBalance(raw) {
    if (raw === null || typeof raw !== "object")
        return {};
    const obj = raw;
    const exp = obj.expire_time;
    if (typeof exp !== "number" || exp <= 0)
        return {};
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = exp < nowSec;
    const expires_at_human = new Date(exp * 1000).toISOString().slice(0, 10);
    return { expired, expires_at_human };
}
/**
 * static ISP is billed per-IP (not by traffic volume) — summarize ownership
 * via static_house/list instead of a flow-balance call. Region breakdown is
 * best-effort: the list-item shape isn't documented beyond page/limit/total,
 * so we only aggregate a `region` field if the server actually includes one.
 */
async function fetchStaticIpSummary(apiKey) {
    try {
        const data = await devApiPost("/v1/static_house/list", { page: 1, limit: 200 }, { apiKey });
        const list = Array.isArray(data.list) ? data.list : [];
        const region_breakdown = {};
        for (const item of list) {
            if (item !== null && typeof item === "object") {
                const region = item.region;
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
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
            status: "error",
            error: `No static ISP IPs provisioned (billed per-IP, not by traffic — see novada_static_ip_mgmt to open one). Underlying error: ${errMsg}`,
            unavailable: true,
        };
    }
}
/**
 * Query balance endpoints across all (or a chosen subset of) Novada flow
 * products in parallel, plus a per-IP lifecycle summary for static ISP. Never
 * hard-fails — partial errors are surfaced in `errors[]` while successful
 * per-product balances are returned alongside.
 */
export async function novadaPlanBalanceAll(params, apiKey) {
    const wantStatic = !params.products?.length || params.products.includes("static");
    const requested = params.products?.length
        ? FLOW_BALANCE_ENDPOINTS.filter(e => params.products.includes(e.key))
        : FLOW_BALANCE_ENDPOINTS;
    const selected = requested.map(e => ({ key: e.key, path: e.path, body: {} }));
    const [flowResults, staticResult] = await Promise.all([
        devApiParallel(selected, { apiKey }),
        wantStatic ? fetchStaticIpSummary(apiKey) : null,
    ]);
    const summary = {};
    const errors = [];
    const expired_products = [];
    const unavailable_products = [];
    const active_products = [];
    for (const r of flowResults) {
        if (r.ok) {
            const enriched = enrichBalance(r.data);
            summary[r.key] = { status: "ok", balance: r.data, ...enriched };
            if (enriched.expired)
                expired_products.push(r.key);
            else
                active_products.push(r.key);
        }
        else {
            const errMsg = r.error ?? "unknown error";
            const isUnavailable = errMsg.includes("Product not provisioned") || errMsg.includes("HTTP 404");
            summary[r.key] = { status: "error", error: errMsg, ...(isUnavailable ? { unavailable: true } : {}) };
            if (isUnavailable)
                unavailable_products.push(r.key);
            errors.push({ product: r.key, error: errMsg });
        }
    }
    if (staticResult) {
        summary.static = staticResult;
        if (staticResult.status === "ok") {
            active_products.push("static");
        }
        else {
            if (staticResult.unavailable)
                unavailable_products.push("static");
            errors.push({ product: "static", error: staticResult.error });
        }
    }
    const totalSelected = selected.length + (wantStatic ? 1 : 0);
    // Treat unavailable-products as not a "real" error for status-summarising
    // purposes — they're known account state, not transient failures.
    const realErrors = errors.filter(e => !unavailable_products.includes(e.product));
    const overall = realErrors.length === 0
        ? "ok"
        : realErrors.length === totalSelected - unavailable_products.length
            ? "all_failed"
            : "partial";
    return JSON.stringify({
        status: overall,
        summary: {
            active_products,
            expired_products,
            unavailable_products,
            all_plans_expired: active_products.length === 0 && expired_products.length > 0,
        },
        per_product: summary,
        errors: errors.length ? errors : undefined,
        agent_instruction: expired_products.length > 0
            ? `Products ${expired_products.join(", ")} have EXPIRED plans (balance=0, expired=true). Master wallet currency still available — call novada_account(section="balance"). To restock, the user needs to purchase a new plan at https://dashboard.novada.com.`
            : "Per-product balances. Each balance includes derived expired/expires_at_human fields. For master wallet (currency) use novada_account(section=\"balance\").",
    }, null, 2);
}
//# sourceMappingURL=plan_balance_all.js.map