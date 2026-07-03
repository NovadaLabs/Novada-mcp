/**
 * Check which Novada API products are active on the given API key.
 * Runs probes in parallel via Promise.allSettled.
 */
export declare function novadaHealth(apiKey: string, mode?: "quick" | "full"): Promise<string>;
//# sourceMappingURL=health.d.ts.map