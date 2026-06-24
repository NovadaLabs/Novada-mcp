import { z } from "zod";
import { submitScrapeTask, OPERATION_ALIASES } from "./scrape.js";
import { NovadaError, NovadaErrorCode } from "../_core/errors.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const ScraperSubmitParamsSchema = z.object({
    platform: z
        .string().min(1).max(100)
        .regex(/^[a-zA-Z0-9._\-]+$/, "platform must be a valid domain name")
        .describe("Platform domain to scrape. E.g. 'amazon.com', 'linkedin.com', 'tiktok.com'. Read novada://scraper-platforms for the full list."),
    operation: z
        .string().min(1).max(100)
        .regex(/^[a-zA-Z0-9_\-]+$/, "operation must be alphanumeric with underscores/hyphens")
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
    const { platform, params: opParams } = params;
    // H-6: Apply same alias resolution as novada_scrape for consistent behavior
    const resolvedOp = Object.prototype.hasOwnProperty.call(OPERATION_ALIASES, params.operation)
        ? OPERATION_ALIASES[params.operation]
        : params.operation;
    let taskId;
    try {
        taskId = await submitScrapeTask(apiKey, platform, resolvedOp, opParams);
    }
    catch (err) {
        // Enrich 11006 errors with alias context (same pattern as novada_scrape)
        if (err instanceof NovadaError && err.code === NovadaErrorCode.PRODUCT_UNAVAILABLE) {
            const aliasNote = resolvedOp !== params.operation
                ? ` The operation '${params.operation}' was auto-resolved to '${resolvedOp}' but still rejected.`
                : "";
            throw new NovadaError({
                code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
                message: err.message + aliasNote,
                agent_instruction: `${err.agent_instruction} Read novada://scraper-platforms to confirm the exact operation ID for platform '${platform}'.`,
                retryable: false,
                detail: err.detail,
            });
        }
        throw err;
    }
    const aliasInfo = resolvedOp !== params.operation
        ? { alias_resolved: `${params.operation} → ${resolvedOp}` }
        : {};
    return JSON.stringify({
        status: "submitted",
        task_id: taskId,
        platform,
        operation: resolvedOp,
        ...aliasInfo,
        agent_instruction: `Use novada_scraper_status with task_id="${taskId}" to check progress. Poll every 5–10 seconds until status is 'complete', then call novada_scraper_result with the same task_id to retrieve results.`,
    }, null, 2);
}
//# sourceMappingURL=scraper_submit.js.map