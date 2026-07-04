/**
 * Account-facts health check.
 *
 * mode="quick": wallet balance + proxy/browser entitlement only (fast, no plan details).
 * mode="full" : quick + per-product proxy plan balances with expiry dates.
 *
 * novada_health_all is an alias for novada_health(mode="full").
 */
export declare function novadaHealth(apiKey: string, mode?: "quick" | "full"): Promise<string>;
//# sourceMappingURL=health.d.ts.map