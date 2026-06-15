import { z } from "zod";
export declare const AccountSummaryParamsSchema: z.ZodObject<{}, z.core.$strict>;
export type AccountSummaryParams = z.infer<typeof AccountSummaryParamsSchema>;
export declare function validateAccountSummaryParams(args: Record<string, unknown> | undefined): AccountSummaryParams;
/**
 * One-call account-status snapshot. Parallel-runs the three READ tools and
 * folds them into a single human-readable headline plus per-section detail.
 */
export declare function novadaAccountSummary(_params: AccountSummaryParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=account_summary.d.ts.map