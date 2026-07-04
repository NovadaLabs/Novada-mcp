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
import { novadaHealth } from "./health.js";
// ─── Zod Schema ───────────────────────────────────────────────────────────────
export const HealthAllParamsSchema = z.object({});
export function validateHealthAllParams(args) {
    return HealthAllParamsSchema.parse(args ?? {});
}
/**
 * Extended account-facts health check. Equivalent to novada_health(mode="full").
 * Reports wallet balance + proxy/browser entitlement + per-product plan balances.
 * No synthetic probes. No credit cost.
 */
export async function novadaHealthAll(apiKey) {
    return novadaHealth(apiKey, "full");
}
//# sourceMappingURL=health_all.js.map