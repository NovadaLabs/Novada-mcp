export type RenderMode = "auto" | "static" | "render" | "browser";
export type UsedMode = "static" | "render" | "browser" | "render-failed";
export type CostTier = "low" | "medium" | "high";
export interface RouteResult {
    html: string;
    mode: UsedMode;
    cost: CostTier;
}
/**
 * Smart rendering router. Fetches a URL using the cheapest viable method.
 *
 * Escalation chain (auto mode):
 *   1. Static fetch via Scraper API proxy ($0) — cheapest
 *   2. Web Unblocker with JS rendering ($0.001/req) — mid
 *   3. Browser API via CDP ($3/GB) — most expensive
 *
 * The router detects JS-heavy pages (SPAs, Cloudflare challenges) and
 * auto-escalates. Forced modes skip the chain entirely.
 */
export declare function routeFetch(url: string, options?: {
    render?: RenderMode;
    apiKey?: string;
    timeout?: number;
    waitForSelector?: string;
    country?: string;
}): Promise<RouteResult>;
/** Map UsedMode to its cost tier */
export declare function getModeCost(mode: UsedMode): CostTier;
//# sourceMappingURL=router.d.ts.map