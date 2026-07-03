import { z } from "zod";
export declare const ScraperStatusParamsSchema: z.ZodObject<{
    task_id: z.ZodString;
}, z.core.$strip>;
export type ScraperStatusParams = z.infer<typeof ScraperStatusParamsSchema>;
export declare function validateScraperStatusParams(args: Record<string, unknown> | undefined): ScraperStatusParams;
/**
 * Lightweight existence check for a task_id.
 * Uses the primary devApiPost path (POST /v1/scraper/task_status).
 *
 * Note: The legacy GET endpoint (api-m.novada.com/v1/scraper/{task_id}) was removed
 * because it returns HTTP 404 for all requests (dead route). The POST endpoint is the
 * only active status path.
 *
 * Returns:
 *   "exists"    — task is known to the API (any status: pending/running/complete/failed)
 *   "not_found" — API indicated unknown task (empty status with code=0)
 *   "unknown"   — network error or auth issue — caller should surface ambiguity honestly
 */
export declare function checkTaskExists(task_id: string, apiKey: string): Promise<"exists" | "not_found" | "unknown">;
/**
 * Poll the status of an async scraping task by task_id.
 * Returns the current status and result if complete.
 */
export declare function novadaScraperStatus(params: ScraperStatusParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scraper_status.d.ts.map