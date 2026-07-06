import type { SearchParams, NovadaSearchResult } from "./types.js";
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
export declare function submitSearchScrapeTask(apiKey: string, scraperName: string, scraperId: string, query: string, num: number, queryParam?: string, supportsNum?: boolean, filterParams?: SearchFilterParams): Promise<SubmitSearchResult>;
/**
 * Resolve a SubmitSearchResult to NovadaSearchResult[].
 * Uses inline results when available (fast path), falls back to polling the
 * download endpoint (slow path).
 */
export declare function resolveSearchResults(apiKey: string, submitted: SubmitSearchResult): Promise<NovadaSearchResult[]>;
/** Poll the download endpoint until the search task completes or times out. */
export declare function pollSearchResult(apiKey: string, taskId: string): Promise<Record<string, unknown>>;
/** Parse scraper API result data into NovadaSearchResult[]. */
export declare function parseScraperSearchResults(data: Record<string, unknown>): NovadaSearchResult[];
export declare function novadaSearch(params: SearchParams, apiKey: string): Promise<string>;
export {};
//# sourceMappingURL=search.d.ts.map