/**
 * novada_health_all — alias for novada_health(mode="full").
 *
 * Kept for backward-compatibility. All logic lives in health.ts.
 * The synthetic probe functions (probeSearchAll, probeExtractAll, probeScraperAll,
 * probeUnblockAll, probeProxyAll, probeBrowserAll) have been removed — they fired
 * real API calls that burned credits, returned false-negatives on cold-start, and
 * drifted from reality. novada_health_all now reports authoritative account facts.
 */
import { z } from "zod";
export declare const HealthAllParamsSchema: z.ZodObject<{}, z.core.$strip>;
export type HealthAllParams = z.infer<typeof HealthAllParamsSchema>;
export declare function validateHealthAllParams(args: Record<string, unknown> | undefined): HealthAllParams;
/**
 * Extended account-facts health check. Equivalent to novada_health(mode="full").
 * Reports wallet balance + proxy/browser entitlement + per-product plan balances.
 * No synthetic probes. No credit cost.
 */
export declare function novadaHealthAll(apiKey: string): Promise<string>;
//# sourceMappingURL=health_all.d.ts.map