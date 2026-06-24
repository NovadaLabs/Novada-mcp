import type { SearchParams, NovadaSearchResult } from "./types.js";
interface SearchFilterParams {
    time_range?: string;
    start_date?: string;
    end_date?: string;
    country?: string;
    language?: string;
}
/** Submit a search task via the Scraper API and return the task_id. */
export declare function submitSearchScrapeTask(apiKey: string, scraperName: string, scraperId: string, query: string, num: number, queryParam?: string, supportsNum?: boolean, filterParams?: SearchFilterParams): Promise<string>;
/** Poll the download endpoint until the search task completes or times out. */
export declare function pollSearchResult(apiKey: string, taskId: string): Promise<Record<string, unknown>>;
/** Parse scraper API result data into NovadaSearchResult[]. */
export declare function parseScraperSearchResults(data: Record<string, unknown>): NovadaSearchResult[];
export declare function novadaSearch(params: SearchParams, apiKey: string): Promise<string>;
export {};
//# sourceMappingURL=search.d.ts.map