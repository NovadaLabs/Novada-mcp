import { z } from "zod";
export declare const ScraperResultParamsSchema: z.ZodObject<{
    task_id: z.ZodString;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        raw: "raw";
        markdown: "markdown";
    }>>;
}, z.core.$strip>;
export type ScraperResultParams = z.infer<typeof ScraperResultParamsSchema>;
export declare function validateScraperResultParams(args: Record<string, unknown> | undefined): ScraperResultParams;
/**
 * Fetch completed results for a scraping task by task_id.
 * Tries the confirmed download endpoint first; falls back to api-m.novada.com.
 */
export declare function novadaScraperResult(params: ScraperResultParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scraper_result.d.ts.map