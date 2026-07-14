/**
 * Disclaimer appended to every health output (default + probe paths).
 * Exported so the dispatch layer in core.ts can append it to novadaAccount
 * output without duplicating the wording.
 */
export declare const HEALTH_PROBE_DISCLAIMER = "> \u26A0\uFE0F Entitlement/provisioning status only \u2014 does NOT verify live render capability.\n> Pass `probe:true` for a real test (billed 1 render call to your account).";
/**
 * Format the render probe section appended when probe:true.
 * Exported so core.ts can reuse the exact same wording.
 */
export declare function formatProbeSection(result: {
    ok: boolean;
    detail: string;
}): string;
/**
 * Performs ONE minimal real render call through the caller's Novada key against
 * https://example.com via the Web Unblocker. Exported so unit tests can mock it
 * via vi.mock("../../src/utils/http.js").
 *
 * This function MUST NOT be called unless probe:true is explicitly passed — it
 * is billed to the caller's account.
 */
export declare function _performRenderProbe(apiKey: string): Promise<{
    ok: boolean;
    detail: string;
}>;
/**
 * Account-facts health check.
 *
 * mode="quick": wallet balance + proxy/browser entitlement only (fast, no plan details).
 * mode="full" : quick + per-product proxy plan balances with expiry dates.
 * probe       : when true, performs ONE real render call (billed) to verify live
 *               render capability. Defaults to false (entitlement-only, no billing).
 *
 * novada_health_all is an alias for novada_health(mode="full").
 */
export declare function novadaHealth(apiKey: string, mode?: "quick" | "full", probe?: boolean): Promise<string>;
//# sourceMappingURL=health.d.ts.map