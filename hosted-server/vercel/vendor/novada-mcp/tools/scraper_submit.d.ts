import { z } from "zod";
export declare const ScraperSubmitParamsSchema: z.ZodObject<{
    platform: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type ScraperSubmitParams = z.infer<typeof ScraperSubmitParamsSchema>;
export declare function validateScraperSubmitParams(args: Record<string, unknown> | undefined): ScraperSubmitParams;
/**
 * Submit an async scraping task to the Novada Scraper API.
 * Returns a task_id that can be polled with novada_scraper_status.
 */
export declare function novadaScraperSubmit(params: ScraperSubmitParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scraper_submit.d.ts.map