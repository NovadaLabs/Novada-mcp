/**
 * novada_account — unified account & billing tool.
 *
 * Folds 7 tools into one `section` param:
 *   summary  (default) — full dashboard: wallet + plans + capture logs + health entitlements
 *   balance             — wallet balance only
 *   usage               — paginated wallet usage record
 *   plans               — per-product plan balances (all 6 products)
 *   traffic             — daily traffic consumption (5 proxy products)
 *
 * Composes the EXISTING functions — does NOT re-implement any fetches.
 * Aliases (wallet_balance, wallet_usage_record, plan_balance_all, traffic_daily,
 * capture_logs, account_summary, health, health_all) route here in the dispatch
 * layer (src/index.ts + mcpserver mcp.ts).
 */
import { z } from "zod";
import { novadaAccountSummary } from "./account_summary.js";
import { novadaWalletBalance } from "./wallet_balance.js";
import { novadaWalletUsageRecord } from "./wallet_usage_record.js";
import { novadaPlanBalanceAll } from "./plan_balance_all.js";
import { novadaTrafficDaily } from "./traffic_daily.js";
import { novadaHealth } from "./health.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const AccountParamsSchema = z
    .object({
    section: z
        .enum(["summary", "balance", "usage", "plans", "traffic"])
        .default("summary")
        .describe("Which account data to fetch. " +
        "'summary' (default): full dashboard — wallet balance + plan balances + recent capture logs + health entitlements (proxy/browser). " +
        "'balance': master wallet balance (currency). " +
        "'usage': paginated wallet usage/transaction history. " +
        "'plans': per-product plan balances (residential/isp/mobile/datacenter/static/capture). " +
        "'traffic': daily proxy traffic consumption."),
    // Forwarded to the underlying tools when section != summary
    start_time: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Inclusive start date YYYY-MM-DD (usage/traffic sections only)."),
    end_time: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Inclusive end date YYYY-MM-DD (usage/traffic sections only)."),
    page: z
        .number()
        .int()
        .positive()
        .default(1)
        .describe("1-based page index (usage section only)."),
    page_size: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(50)
        .describe("Page size, max 200 (usage section only)."),
    products: z
        .array(z.string())
        .optional()
        .describe("Subset of products to query (plans/traffic sections only). " +
        "plans: residential|isp|mobile|datacenter|static|capture. " +
        "traffic: residential|isp|mobile|datacenter|static."),
    mode: z
        .enum(["quick", "full"])
        .optional()
        .describe("Health check depth (summary section only). " +
        "'full' includes per-product proxy plan balances. Defaults to 'full' for summary."),
})
    .strict();
export function validateAccountParams(args) {
    return AccountParamsSchema.parse(args ?? {});
}
// ─── Tool Implementation ─────────────────────────────────────────────────────
/**
 * Unified account & billing tool.
 * Routes to the appropriate underlying function based on `section`.
 */
export async function novadaAccount(params, apiKey) {
    const section = params.section ?? "summary";
    switch (section) {
        case "summary": {
            // The summary merges account_summary (wallet+plans+capture) + health entitlements.
            // Run both in parallel; health mode defaults to "full" for complete picture.
            const mode = params.mode ?? "full";
            const [summaryResult, healthResult] = await Promise.all([
                novadaAccountSummary({}, apiKey),
                novadaHealth(apiKey ?? "", mode),
            ]);
            // Compose: wrap health as a subsection appended to the summary JSON
            let summaryData;
            try {
                summaryData = JSON.parse(summaryResult);
            }
            catch {
                summaryData = { raw: summaryResult };
            }
            return JSON.stringify({
                ...summaryData,
                sections: {
                    ...(typeof summaryData.sections === "object" && summaryData.sections !== null
                        ? summaryData.sections
                        : {}),
                    entitlements: healthResult,
                },
                agent_instruction: summaryData.agent_instruction ??
                    "Full account snapshot: wallet balance, plan quotas, recent capture activity, and product entitlements (proxy/browser/wallet-funded).",
            }, null, 2);
        }
        case "balance":
            return novadaWalletBalance({}, apiKey);
        case "usage":
            return novadaWalletUsageRecord({
                start_time: params.start_time,
                end_time: params.end_time,
                page: params.page ?? 1,
                page_size: params.page_size ?? 50,
            }, apiKey);
        case "plans": {
            // Validate products subset (plan-specific values)
            const validPlanProducts = ["residential", "isp", "mobile", "datacenter", "static", "capture"];
            const products = params.products?.filter((p) => validPlanProducts.includes(p));
            return novadaPlanBalanceAll({ products: products && products.length > 0 ? products : undefined }, apiKey);
        }
        case "traffic": {
            // Validate products subset (traffic-specific values)
            const validTrafficProducts = ["residential", "isp", "mobile", "datacenter", "static"];
            const products = params.products?.filter((p) => validTrafficProducts.includes(p));
            return novadaTrafficDaily({
                start_time: params.start_time,
                end_time: params.end_time,
                products: products && products.length > 0 ? products : undefined,
            }, apiKey);
        }
        default: {
            // Exhaustiveness guard — TypeScript should prevent this, but guard at runtime too.
            const exhaustive = section;
            return JSON.stringify({
                status: "error",
                error: `Unknown section: ${String(exhaustive)}`,
                agent_instruction: "Valid sections: summary, balance, usage, plans, traffic.",
            }, null, 2);
        }
    }
}
//# sourceMappingURL=account.js.map