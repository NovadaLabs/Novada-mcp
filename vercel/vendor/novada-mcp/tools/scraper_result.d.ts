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
 * Primary: 2-step COS download via POST /v1/scraper/task_download.
 * Fallback: legacy GET download endpoint (api.novada.com/g/api/proxy/scraper_download).
 * (The old api-m.novada.com status route was removed — it was a dead 404 route.)
 */
export declare function novadaScraperResult(params: ScraperResultParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scraper_result.d.ts.map