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
/** Domains with >=1 status:"ok" operation — i.e. genuinely usable through
 *  novada_scrape today. Strict subset of CATALOG_DOMAINS (which includes every
 *  catalog platform regardless of working-op status). */
export declare const WORKING_PLATFORM_DOMAINS: string[];
/** Human-readable platform names (catalog `.name`, e.g. "Amazon", "X (Twitter)")
 *  for domains with >=1 working op, in catalog order — the single source of
 *  truth for any tool/resource description that names "supported platforms". */
export declare const WORKING_PLATFORM_NAMES: string[];
/** Total count of status:"ok" operations across the whole catalog — how many
 *  distinct novada_scrape operations are genuinely callable today. Distinct
 *  from CATALOG_OP_COUNT (includes backend_broken ops, which are still
 *  reachable but documented/warned as broken, not genuinely "supported"). */
export declare const WORKING_OP_COUNT: number;
//# sourceMappingURL=scraper_catalog.d.ts.map