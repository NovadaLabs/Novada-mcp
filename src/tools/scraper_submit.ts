import { z } from "zod";
import { submitScrapeTask, OPERATION_ALIASES } from "./scrape.js";
import { makeNovadaError, NovadaError, NovadaErrorCode } from "../_core/errors.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

// FIX-2: Cap the serialized params payload to prevent a 60KB→60s hang on the upstream scraper API.
// Any individual param value (string) is capped at 2000 chars; total JSON must be under 60KB.
const PARAMS_MAX_TOTAL_BYTES = 60_000;
const PARAMS_MAX_STRING_BYTES = 2_000;

function validateParamsSize(params: Record<string, unknown>): void {
  const totalBytes = JSON.stringify(params).length;
  if (totalBytes > PARAMS_MAX_TOTAL_BYTES) {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      `params payload is too large (${totalBytes} chars). Maximum is ${PARAMS_MAX_TOTAL_BYTES} chars. Reduce the size of individual param values.`,
      `params_bytes:${totalBytes} max:${PARAMS_MAX_TOTAL_BYTES}`
    );
  }
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === "string" && val.length > PARAMS_MAX_STRING_BYTES) {
      throw makeNovadaError(
        NovadaErrorCode.INVALID_PARAMS,
        `params.${key} is too long (${val.length} chars). Maximum string length is ${PARAMS_MAX_STRING_BYTES} chars.`,
        `param:${key} length:${val.length} max:${PARAMS_MAX_STRING_BYTES}`
      );
    }
  }
}

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

export type ScraperSubmitParams = z.infer<typeof ScraperSubmitParamsSchema>;

export function validateScraperSubmitParams(
  args: Record<string, unknown> | undefined
): ScraperSubmitParams {
  return ScraperSubmitParamsSchema.parse(args ?? {});
}

/**
 * Submit an async scraping task to the Novada Scraper API.
 * Returns a task_id that can be polled with novada_scraper_status.
 */
export async function novadaScraperSubmit(
  params: ScraperSubmitParams,
  apiKey: string
): Promise<string> {
  const { platform, params: opParams } = params;
  // FIX-2: Validate params payload size before submitting to prevent upstream hangs.
  validateParamsSize(opParams as Record<string, unknown>);
  // H-6: Apply same alias resolution as novada_scrape for consistent behavior
  const resolvedOp = Object.prototype.hasOwnProperty.call(OPERATION_ALIASES, params.operation)
    ? OPERATION_ALIASES[params.operation]
    : params.operation;

  let outcome: Awaited<ReturnType<typeof submitScrapeTask>>;
  try {
    outcome = await submitScrapeTask(apiKey, platform, resolvedOp, opParams as Record<string, unknown>);
  } catch (err: unknown) {
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

  // 0.9.5 (NOV-697): submitScrapeTask now returns a discriminated outcome. The
  // upstream frequently resolves inline (no task_id to poll) or with an empty serp.
  // This exported helper is retained for back-compat; the live novada_scraper_submit
  // tool routes to novadaScrape (index.ts). Normalize each outcome to a benign,
  // parseable status so no caller sees an error for a valid submit.
  if (outcome.kind === "empty") {
    return JSON.stringify(
      {
        status: "ok",
        records: 0,
        platform,
        operation: resolvedOp,
        ...aliasInfo,
        message: `No results found (upstream: ${outcome.message}).`,
        agent_instruction: "This is not an error — the query matched nothing. Retry with a broader query or verify the param value.",
      },
      null,
      2
    );
  }

  if (outcome.kind === "inline") {
    return JSON.stringify(
      {
        status: "complete",
        records: outcome.items.length,
        platform,
        operation: resolvedOp,
        ...aliasInfo,
        message: "Results returned inline in the submit response — no polling needed.",
        agent_instruction: "Call novada_scrape with the same { platform, operation, params } to receive the parsed records directly.",
      },
      null,
      2
    );
  }

  const taskId = outcome.taskId;
  return JSON.stringify(
    {
      status: "submitted",
      task_id: taskId,
      platform,
      operation: resolvedOp,
      ...aliasInfo,
      agent_instruction: `Call novada_scrape with the same { platform, operation, params } to get results in one synchronous call (recommended). The async status/result flow was retired in 0.9.4.`,
    },
    null,
    2
  );
}
