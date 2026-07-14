import { NovadaError } from "../_core/errors.js";
import type { ScrapeParams, ScrapeParamsFullType } from "./types.js";
type DownloadResultItem = {
    spider_code: 200;
    rest: Record<string, unknown>;
} | {
    error: string;
    error_code?: number;
};
type SubmitOutcome = {
    kind: "inline";
    items: DownloadResultItem[];
} | {
    kind: "empty";
    message: string;
} | {
    kind: "task";
    taskId: string;
};
/**
 * Submit a scraper task. Returns a discriminated SubmitOutcome:
 *   - inline records (skip poll), empty serp (graceful no-results), or a task_id to poll.
 * 0.9.5 (NOV-697): previously returned only a task_id and ALWAYS polled; that both
 * wasted a round-trip on inline-result platforms and threw isError on empty serps.
 */
export declare function submitScrapeTask(apiKey: string, scraper_name: string, scraper_id: string, params: Record<string, unknown>): Promise<SubmitOutcome>;
/**
 * Reconcile price + availability on a product record in place-safe fashion
 * (returns a NEW object; never mutates the input). Fills `final_price` (and
 * `price`) from derivePrice ONLY when the flat field is currently empty/zero, and
 * makes `is_available` agree with the `availability` string when the two disagree.
 * A `_price_source` breadcrumb records where the surfaced price came from so agents
 * (and QA) can see when a value was reconciled vs passed through untouched.
 */
export declare function normalizeProductRecord(raw: Record<string, unknown>): Record<string, unknown>;
/**
 * Filter and deduplicate a raw subcategory_rank array.
 * Keeps only rows with a plausible short category name and a numeric rank.
 * Deduplicates by (rank, normalized-name) pair.
 */
export declare function filterSubcategoryRank(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>>;
/** Returns true if the description contains known UI-chrome patterns. */
export declare function descriptionHasChrome(description: string): boolean;
/**
 * Curate flattened records for tabular display (csv / excel / html):
 *   1. Drop columns whose non-empty values are majority base64 blobs (useless + fragile).
 *   2. Reorder so curated key columns (title/price/rating/url/…) lead.
 * Returns NEW record objects with the curated column set/order — never mutates input.
 * If every column would be dropped (degenerate input) the original columns are kept,
 * so we never hand back empty rows.
 */
export declare function curateTabularRecords(records: Record<string, unknown>[]): Record<string, unknown>[];
export declare const OPERATION_ALIASES: Record<string, string>;
type OpMap = Record<string, readonly string[]>;
/** Derived from SCRAPER_CATALOG — 16 active platforms. */
export declare const PLATFORM_OPERATIONS: Record<string, OpMap>;
/**
 * #6 pre-flight: reject an unknown platform, an unknown operation for a known
 * platform, or a missing required param BEFORE any backend round-trip. Returns a
 * structured NovadaError (INVALID_PARAMS) whose agent_instruction lists the valid
 * operations — so the agent self-corrects without a 60s hang → 504. Returns null
 * when the platform is not in the active map (unknown/inactive platforms fall
 * through to the existing 11006/11008 backend handling — the map only covers the
 * 16 platforms that have live operations).
 */
export declare function preflightScrape(platform: string, operation: string, params: Record<string, unknown>): NovadaError | null;
export declare function novadaScrape(params: ScrapeParams | ScrapeParamsFullType, apiKey: string): Promise<string>;
export {};
//# sourceMappingURL=scrape.d.ts.map