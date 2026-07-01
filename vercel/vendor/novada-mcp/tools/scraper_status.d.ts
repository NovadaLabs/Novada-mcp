import { z } from "zod";
export declare const ScraperStatusParamsSchema: z.ZodObject<{
    task_id: z.ZodString;
}, z.core.$strip>;
export type ScraperStatusParams = z.infer<typeof ScraperStatusParamsSchema>;
export declare function validateScraperStatusParams(args: Record<string, unknown> | undefined): ScraperStatusParams;
/**
 * Lightweight existence check for a task_id.
 * Uses the same primary devApiPost path that novadaScraperStatus uses, plus
 * the fallback GET endpoint (which returns HTTP 404 definitively for unknown ids).
 *
 * Returns:
 *   "exists"    — task is known to the API (any status: pending/running/complete/failed)
 *   "not_found" — API definitively returned 404 or explicitly indicated unknown task
 *   "unknown"   — both checks failed (network error, auth issue, etc.) — caller should
 *                 surface ambiguity honestly rather than fabricating a verdict
 */
export declare function checkTaskExists(task_id: string, apiKey: string): Promise<"exists" | "not_found" | "unknown">;
/**
 * Poll the status of an async scraping task by task_id.
 * Returns the current status and result if complete.
 */
export declare function novadaScraperStatus(params: ScraperStatusParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scraper_status.d.ts.map