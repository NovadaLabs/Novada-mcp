import { z } from "zod";
export declare const WalletUsageRecordParamsSchema: z.ZodObject<{
    start_time: z.ZodOptional<z.ZodString>;
    end_time: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    page_size: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type WalletUsageRecordParams = z.infer<typeof WalletUsageRecordParamsSchema>;
export declare function validateWalletUsageRecordParams(args: Record<string, unknown> | undefined): WalletUsageRecordParams;
/**
 * Fetch paginated wallet usage / transaction records from the developer-api.
 * Emits both `start_time` and the server's typo'd `strat_time` for forward compat.
 */
export declare function novadaWalletUsageRecord(params: WalletUsageRecordParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=wallet_usage_record.d.ts.map