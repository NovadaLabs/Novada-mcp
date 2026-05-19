import axios, { AxiosError } from "axios";
import { z } from "zod";
import { SCRAPER_API_BASE } from "../config.js";
import { classifyError, makeNovadaError, NovadaErrorCode, sanitizeServerMsg } from "../_core/errors.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const ScraperSubmitParamsSchema = z.object({
  url: z
    .string()
    .url("A valid URL is required")
    .refine((url) => /^https?:\/\//i.test(url), "Only HTTP and HTTPS URLs are supported")
    .refine((url) => {
      try {
        let host = new URL(url).hostname;
        if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
        if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
        return !/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1|::ffff:.+|fe80:.*)$/i.test(host);
      } catch { return false; }
    }, "URLs pointing to localhost or private network ranges are not allowed")
    .describe("The URL to scrape. Must be a publicly accessible HTTP/HTTPS URL."),
  scraper_type: z
    .string()
    .regex(/^[a-zA-Z0-9_\-\.]{1,64}$/, "scraper_type must be alphanumeric with underscores/hyphens only")
    .default("universal")
    .describe(
      "Scraper type to use. Default: 'universal'. Contact Novada support at support@novada.com for available scraper types on your account."
    ),
  country: z
    .string()
    .regex(/^[a-zA-Z]{0,2}$/, "country must be a 2-letter ISO country code (e.g. 'us', 'gb') or empty")
    .default("")
    .describe(
      "Optional 2-letter ISO 3166-1 country code for geo-targeting (e.g. 'us', 'gb', 'de'). Leave empty for no geo-targeting."
    ),
});

export type ScraperSubmitParams = z.infer<typeof ScraperSubmitParamsSchema>;

export function validateScraperSubmitParams(
  args: Record<string, unknown> | undefined
): ScraperSubmitParams {
  return ScraperSubmitParamsSchema.parse(args ?? {});
}

// ─── API Response Types ──────────────────────────────────────────────────────

interface SubmitApiResponse {
  code: number;
  msg?: string;
  data?: {
    task_id?: string;
    data?: { task_id?: string };
  } | null;
  timestamp?: number;
}

// ─── Submit Endpoint ─────────────────────────────────────────────────────────

const SUBMIT_ENDPOINT = `${SCRAPER_API_BASE}/request`;

/**
 * Submit an async scraping task to the Novada Scraper API.
 * Returns a task_id that can be polled with novada_scraper_status.
 */
export async function novadaScraperSubmit(
  params: ScraperSubmitParams,
  apiKey: string
): Promise<string> {
  const { url, scraper_type, country } = params;

  let taskId: string | undefined;

  try {
    const form = new URLSearchParams();
    form.append("url", url);
    form.append("scraper_type", scraper_type);
    if (country) {
      form.append("country", country);
    }

    const resp = await axios.post(SUBMIT_ENDPOINT, form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 60000,
    });

    const body = resp.data as SubmitApiResponse;

    if (body.code !== 0) {
      const msg = body.msg ?? "Unknown scraper error";
      if (body.code === 11006) {
        throw makeNovadaError(
          NovadaErrorCode.PRODUCT_UNAVAILABLE,
          `Scraper API not activated on this account (code 11006): ${msg}`,
          "Activate the Scraper API at https://dashboard.novada.com/overview/scraper/ then retry."
        );
      }
      if (body.code === 11008) {
        throw makeNovadaError(
          NovadaErrorCode.INVALID_PARAMS,
          `Unknown scraper_type (code 11008): ${msg}`,
          "Use scraper_type='universal' or contact Novada support at support@novada.com for valid scraper type IDs on your account."
        );
      }
      const knownMessages: Record<number, string> = {
        10001: "Missing required parameters. Check that url and scraper_type are provided.",
        11000: "Invalid API key.",
      };
      const detail = knownMessages[body.code] ?? msg;
      throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper submit error (code ${body.code}): ${detail}`);
    }

    // Accept both flat { code:0, data: { task_id } } and nested { code:0, data: { data: { task_id } } }
    const inner = body.data;
    taskId =
      (inner?.task_id as string | undefined) ??
      (inner?.data?.task_id as string | undefined);

    if (!taskId) {
      // Endpoint returned success but no task_id — do NOT return a fake task_id
      // (a fake task_id would pass regex validation and cause infinite polling)
      throw makeNovadaError(
        NovadaErrorCode.API_DOWN,
        "Scraper submit succeeded (code 0) but returned no task_id. The endpoint may be in a transitional state.",
        "Do not poll — there is no task_id to poll with. Contact Novada support at support@novada.com to confirm the POST /request response format for your account. As alternatives, use novada_scrape (sync scraper for 129 platforms) or novada_extract."
      );
    }
  } catch (err: unknown) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const body = err.response?.data as SubmitApiResponse | undefined;

      if (status === 404) {
        // Endpoint unknown or not yet deployed — return structured placeholder
        return JSON.stringify(
          {
            status: "endpoint_unavailable",
            task_id: null,
            note: "POST https://scraper.novada.com/request returned 404 — endpoint pending deployment or scraper_type='universal' not yet available",
            url,
            scraper_type,
            agent_instruction:
              "The scraper submit endpoint returned 404. This tool is designed for the async Novada Scraper API. Contact Novada support at support@novada.com to confirm endpoint availability. As an alternative, use novada_scrape (sync scraper with 129 supported platforms) or novada_extract for general web extraction.",
            alternatives: [
              "novada_scrape — structured sync scraper for 129 supported platforms",
              "novada_extract — general web page content extraction",
              "novada_unblock — bot-protected page rendering",
            ],
          },
          null,
          2
        );
      }

      if (status === 401 || status === 403) {
        throw makeNovadaError(
          NovadaErrorCode.INVALID_API_KEY,
          "Invalid NOVADA_API_KEY or insufficient permissions for Scraper API."
        );
      }

      const serverMsg = sanitizeServerMsg(body?.msg ?? err.message);
      throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper submit API error (HTTP ${status}): ${serverMsg}`);
    }

    // Re-throw non-Axios errors for classifyError to handle
    throw err;
  }

  return JSON.stringify(
    {
      status: "submitted",
      task_id: taskId,
      url,
      scraper_type,
      country: country || null,
      agent_instruction: `Use novada_scraper_status with task_id="${taskId}" to check progress. Poll every 5–10 seconds until status is 'complete', then call novada_scraper_result with the same task_id to retrieve results.`,
    },
    null,
    2
  );
}
