import { z } from "zod";
export declare const WalletBalanceParamsSchema: z.ZodObject<{}, z.core.$strict>;
export type WalletBalanceParams = z.infer<typeof WalletBalanceParamsSchema>;
export declare function validateWalletBalanceParams(args: Record<string, unknown> | undefined): WalletBalanceParams;
/**
 * Fetch the master wallet balance for the current developer-api account.
 * Returns the unwrapped envelope `data` payload alongside an agent hint.
 */
export declare function novadaWalletBalance(_params: WalletBalanceParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=wallet_balance.d.ts.map