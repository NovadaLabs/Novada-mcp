import type { SearchParams, NovadaSearchResult } from "./types.js";
import { withSingleTransientRetry } from "../_core/submit-retry.js";
/**
 * NOV-682: Bound an over-long query by truncating at a word boundary instead of
 * rejecting it. Google only ranks on the first ~32 words, so cutting at 500 chars
 * loses no relevance while keeping the upstream payload bounded (huge strings
 * caused 60s+ scraper hangs). Throwing wasted the calling agent's turn on a
 * recoverable condition. Returns the bounded query plus a `truncated` marker
 * (e.g. "query_truncated:812→497") for surfacing in the tool response, or null
 * when the query was already within bounds.
 */
export declare function boundQuery(query: string): {
    query: string;
    truncated: string | null;
};
/**
 * Scrape-transient-2026-10-21: the canonical implementation moved to
 * `_core/submit-retry.ts` (`withSingleTransientRetry`) so novada_scrape's submit path
 * (scrape.ts's `submitScrapeTask`, shared by every `novada_scrape_<platform>`
 * tool) can reuse the SAME policy instead of a second, parallel one — the
 * exact "serp capture failed" / no-task_id / upstream-5xx failure modes this
 * retry absorbs are not specific to search. `withSingleSerpRetry` is kept as
 * a thin re-export so existing imports/tests (search-serp-retry.test.ts,
 * business-code-classification.test.ts) and the exported name are unchanged.
 */
export declare const withSingleSerpRetry: typeof withSingleTransientRetry;
interface SearchFilterParams {
    time_range?: string;
    start_date?: string;
    end_date?: string;
    country?: string;
    language?: string;
}
interface SubmitSearchResult {
    /** Inline results parsed directly from the submit response (avoids a download round-trip). */
    inlineResults?: Record<string, unknown>;
    /** task_id for polling the download endpoint when inline results are absent. */
    taskId?: string;
}
/** Submit a search task via the Scraper API.
 *
 * Returns inline results when the API includes them synchronously in the submit
 * response (body.data.data.json[0].rest) — this is the common path for Google/DDG.
 * Falls back to returning a task_id for async download polling when inline results
 * are absent.
 */
export declare function submitSearchScrapeTask(apiKey: string, scraperName: string, scraperId: string, query: string, num: number, queryParam?: string, supportsNum?: boolean, filterParams?: SearchFilterParams, timeoutMs?: number): Promise<SubmitSearchResult>;
/**
 * Resolve a SubmitSearchResult to NovadaSearchResult[].
 * Uses inline results when available (fast path), falls back to polling the
 * download endpoint (slow path).
 */
export declare function resolveSearchResults(apiKey: string, submitted: SubmitSearchResult): Promise<NovadaSearchResult[]>;
/** Poll the download endpoint until the search task completes or times out. */
/**
 * @param ceilingMs How long THIS call may poll before giving up — defaults to
 * `TIMEOUTS.SEARCH_TOTAL_CEILING` (unchanged behavior for `resolveSearchResults`,
 * the one LIVE call site that omits it). `submitBingSearch` also omits it, but
 * that function is dead code — never called from anywhere in `src/`;
 * `novada_search`'s own `engine` enum only accepts google/duckduckgo/yandex,
 * and bing is served entirely by the separate `novada_scrape_bing` →
 * scrape.ts path — so it carries no live scope here (final-verify-2026-10-21
 * LOW #3: this comment previously cited it as a real call site).
 * `novadaSearch` instead passes `min(TIMEOUTS.SEARCH_TOTAL_CEILING,
 * remaining-of-the-shared-callDeadline)` (scrape-transient-review2-2026-10-21
 * MEDIUM #2) so the poll phase never gets a fresh allotment on top of
 * whatever the submit(+retry) phase already consumed of the SAME deadline.
 */
export declare function pollSearchResult(apiKey: string, taskId: string, ceilingMs?: number): Promise<Record<string, unknown>>;
/** Parse scraper API result data into NovadaSearchResult[]. */
export declare function parseScraperSearchResults(data: Record<string, unknown>): NovadaSearchResult[];
export interface NovadaSearchOptions {
    /**
     * Whether the `novada_search_feedback` tool is reachable in the current
     * runtime. Defaults to `true` (npm / stdio server where the tool is always
     * registered). Set to `false` on the hosted endpoint so the agent_instruction
     * never points at a tool it cannot call (TOW2-240 / search-C fix).
     */
    feedbackToolAvailable?: boolean;
}
export declare function novadaSearch(params: SearchParams, apiKey: string, options?: NovadaSearchOptions): Promise<string>;
export {};
//# sourceMappingURL=search.d.ts.map