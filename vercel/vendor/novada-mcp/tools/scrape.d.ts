import type { ScrapeParams, ScrapeParamsFullType } from "./types.js";
/** Submit a scraper task and return the task_id */
export declare function submitScrapeTask(apiKey: string, scraper_name: string, scraper_id: string, params: Record<string, unknown>): Promise<string>;
export declare function novadaScrape(params: ScrapeParams | ScrapeParamsFullType, apiKey: string): Promise<string>;
//# sourceMappingURL=scrape.d.ts.map