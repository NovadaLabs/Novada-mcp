import { z } from "zod";
export declare const ScraperStatusParamsSchema: z.ZodObject<{
    task_id: z.ZodString;
}, z.core.$strip>;
export type ScraperStatusParams = z.infer<typeof ScraperStatusParamsSchema>;
export declare function validateScraperStatusParams(args: Record<string, unknown> | undefined): ScraperStatusParams;
/**
 * Poll the status of an async scraping task by task_id.
 * Returns the current status and result if complete.
 */
export declare function novadaScraperStatus(params: ScraperStatusParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scraper_status.d.ts.map