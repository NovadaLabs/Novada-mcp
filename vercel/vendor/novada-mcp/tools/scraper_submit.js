import { z } from "zod";
import { submitScrapeTask } from "./scrape.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const ScraperSubmitParamsSchema = z.object({
    platform: z
        .string().min(1)
        .describe("Platform domain to scrape. E.g. 'amazon.com', 'linkedin.com', 'tiktok.com'. Read novada://scraper-platforms for the full list."),
    operation: z
        .string().min(1)
        .describe("Operation ID for this platform. E.g. 'amazon_product_asin', 'linkedin_company_information_url'. Read novada://scraper-platforms for valid IDs."),
    params: z
        .record(z.string(), z.unknown()).default({})
        .describe("Operation-specific parameters. E.g. { asin: 'B09...' } for amazon_product_asin, { url: 'https://...' } for URL-based ops."),
});
export function validateScraperSubmitParams(args) {
    return ScraperSubmitParamsSchema.parse(args ?? {});
}
/**
 * Submit an async scraping task to the Novada Scraper API.
 * Returns a task_id that can be polled with novada_scraper_status.
 */
export async function novadaScraperSubmit(params, apiKey) {
    const { platform, operation, params: opParams } = params;
    let taskId;
    try {
        taskId = await submitScrapeTask(apiKey, platform, operation, opParams);
    }
    catch (err) {
        throw err;
    }
    return JSON.stringify({
        status: "submitted",
        task_id: taskId,
        platform,
        operation,
        agent_instruction: `Use novada_scraper_status with task_id="${taskId}" to check progress. Poll every 5–10 seconds until status is 'complete', then call novada_scraper_result with the same task_id to retrieve results.`,
    }, null, 2);
}
//# sourceMappingURL=scraper_submit.js.map