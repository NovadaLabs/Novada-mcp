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
export declare const AccountParamsSchema: z.ZodObject<{
    section: z.ZodDefault<z.ZodEnum<{
        summary: "summary";
        balance: "balance";
        plans: "plans";
        usage: "usage";
        traffic: "traffic";
    }>>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        card: "card";
    }>>;
    start_time: z.ZodOptional<z.ZodString>;
    end_time: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    page_size: z.ZodDefault<z.ZodNumber>;
    products: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type AccountParams = z.infer<typeof AccountParamsSchema>;
export declare function validateAccountParams(args: Record<string, unknown> | undefined): AccountParams;
/**
 * Unified account & billing tool.
 * Routes to the appropriate underlying function based on `section`.
 */
export declare function novadaAccount(params: AccountParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=account.d.ts.map