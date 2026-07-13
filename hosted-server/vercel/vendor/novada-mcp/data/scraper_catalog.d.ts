export interface CatalogParam {
    key: string;
    label: string;
    required: boolean;
    dflt?: string;
    opts?: string[];
}
export interface CatalogOp {
    slug: string;
    api_id: number;
    api_name: string;
    format: "flat" | "params";
    params: CatalogParam[];
    status: "ok" | "backend_broken";
    broken_reason?: string;
    verified: "2026-07-13";
}
export interface CatalogPlatform {
    domain: string;
    name: string;
    platform_id: number;
    ops: CatalogOp[];
}
export declare const SCRAPER_CATALOG: CatalogPlatform[];
/** Map: domain → op slug → CatalogOp. Used for per-op format routing. */
export declare const CATALOG_BY_DOMAIN: Map<string, Map<string, CatalogOp>>;
/** All 16 active platform domains. */
export declare const CATALOG_DOMAINS: string[];
/** Total operation count across all platforms (includes broken). */
export declare const CATALOG_OP_COUNT: number;
//# sourceMappingURL=scraper_catalog.d.ts.map