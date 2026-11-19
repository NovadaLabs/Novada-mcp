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
    /**
     * B1 (2026-11-18 reliability program): `status`/`verified` above are a
     * ONE-TIME snapshot from the 2026-07-13 catalog capture — they never get
     * re-checked, so a tool's description can keep asserting "status ok" long
     * after the live success rate has degraded (x.com's 3 ops: 2 independent
     * live calls on 2026-11-18, two different ops, both throttled within
     * seconds of each other — a real backend reliability signal the static
     * snapshot has no way to express). Optional, per-op, and ORTHOGONAL to
     * `status`: `status:"ok"` + `last_live_check_result:"fail"` means "this op
     * is not known to be permanently broken, but its most recent live probe
     * did not succeed" — a narrower, more recent, more actionable signal than
     * `backend_broken`, surfaced the same way (scrape.ts's brokenWarning-style
     * check, extended with one more branch — see that function's doc comment).
     * Intended to be written by a NIGHTLY CANARY (not built here): a scheduled
     * job that runs each catalog op's cheapest live probe once a day and
     * PATCHes this field (pass → clears it back to `undefined`; a failure sets
     * it to "fail"/"intermittent" per its own retry policy) — this field is the
     * write target that job would update; no such job exists yet.
     */
    last_live_check_result?: "pass" | "intermittent" | "fail";
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