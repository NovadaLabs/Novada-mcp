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
export declare function submitScrapeTask(apiKey: string, scraper_name: string, scraper_id: string, params: Record<string, unknown>, timeoutMs?: number): Promise<SubmitOutcome>;
type PollOutcome = {
    kind: "done";
    items: DownloadResultItem[];
} | {
    kind: "pending";
    taskId: string;
};
/**
 * Poll the download endpoint until the task completes or `timeoutMs` elapses.
 * TOW2-257 Phase 1: `timeoutMs` defaults to POLL_TIMEOUT_MS (unchanged local
 * behavior) but callers pass `syncPollCeilingMs()` so hosted gets the short
 * ~10s first-try ceiling instead of always riding the full 45s.
 * Fix-round-2 (TOW2-382 HIGH#1): `htmlRequested` tells the TOW2-382 html-page
 * guard below whether the caller explicitly asked for HTML — see
 * isHtmlRequested(). Defaults to false so every other existing call site
 * behavior (there is only one — novadaScrape) is unaffected unless it opts in.
 */
export declare function pollForResult(apiKey: string, taskId: string, timeoutMs?: number, htmlRequested?: boolean): Promise<PollOutcome>;
/**
 * Escalating resume guidance keyed to how long ago the task was originally submitted.
 * Pure (no I/O, no wall-clock read) so tests can assert exact boundary behavior with a
 * synthetic age_s instead of faking real timers through the whole submit→poll→resume
 * pipeline. Exported for direct unit coverage; also used by processingEnvelope() below.
 */
export declare function ageBucketInstruction(ageS: number): string;
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
interface RequiredKeys {
    readonly keys: readonly string[];
    readonly mode: "any" | "all";
    readonly extraAll?: readonly string[];
}
type OpMap = Record<string, RequiredKeys>;
/** Derived from SCRAPER_CATALOG — all 16 catalog platforms (including any
 *  fully backend_broken ones, which still get a forward+warn rather than no
 *  route at all). See WORKING_PLATFORM_DOMAINS for the subset with >=1 working op. */
export declare const PLATFORM_OPERATIONS: Record<string, OpMap>;
/**
 * #6 pre-flight: reject an unknown platform, an unknown operation for a known
 * platform, or a missing required param BEFORE any backend round-trip. Returns a
 * structured NovadaError (INVALID_PARAMS) whose agent_instruction lists the valid
 * operations — so the agent self-corrects without a 60s hang → 504. Returns null
 * when the platform is not in the active map (unknown/inactive platforms fall
 * through to the existing 11006/11008 backend handling — the map only covers
 * SCRAPER_CATALOG's 16 platforms; 2 of those (SHEIN, ChatGPT) have zero
 * status:"ok" operations today, so PLATFORM_OPERATIONS[domain] still resolves
 * for them but every one of their ops routes to the backend_broken warn-and-
 * forward path, not a genuine "live" success — see PLATFORM_OPERATIONS above).
 */
export declare function preflightScrape(platform: string, operation: string, params: Record<string, unknown>): NovadaError | null;
type ScrapeEngineParams = (ScrapeParams | ScrapeParamsFullType) & {
    displayName?: string;
};
/** Extract an 11-char YouTube video id from a `video_id` param or a video URL, else null. */
export declare function extractYouTubeVideoId(params: Record<string, unknown> | undefined): string | null;
/**
 * Throws a wrong-target NovadaError when a single-video YouTube op returns records that do
 * NOT contain the requested video id. No-op for any other platform/op, when no id can be
 * extracted, or when records are empty — so a valid result is never rejected.
 */
export declare function assertYouTubeIdentity(platform: string, operation: string, params: Record<string, unknown> | undefined, records: Record<string, unknown>[]): void;
export declare function novadaScrape(params: ScrapeEngineParams, apiKey: string): Promise<string>;
export {};
//# sourceMappingURL=scrape.d.ts.map