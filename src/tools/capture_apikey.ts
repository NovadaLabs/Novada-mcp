// Wraps POST /v1/capture/get_apikey and /v1/capture/reset_apikey on api-m.novada.com.
// Combined into a single tool `novada_capture_apikey` with action discriminator.
// "get" = read-only, no gate.
// "reset" = DESTRUCTIVE (invalidates old key) — requires confirm:true gate.

import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const CaptureApikeyParamsSchema = z
  .object({
    action: z
      .enum(["get", "reset"])
      .describe(
        "Action to perform. 'get': retrieve the current capture/scraper API key (read-only). 'reset': regenerate the API key — DESTRUCTIVE, invalidates the old key.",
      ),
    confirm: z
      .literal(true)
      .optional()
      .describe(
        "Required for 'reset' action. Pass `true` ONLY after the human user has confirmed they want to invalidate the current API key. Ignored for 'get' action.",
      ),
  })
  .strict();

export type CaptureApikeyParams = z.infer<typeof CaptureApikeyParamsSchema>;

export function validateCaptureApikeyParams(
  args: Record<string, unknown> | undefined,
): CaptureApikeyParams {
  return CaptureApikeyParamsSchema.parse(args ?? {});
}

// ─── Secret masking ────────────────────────────────────────────────────────────
// SECURITY (L3 review, BLOCKING): the get/reset endpoints return the live Capture
// API key in the response envelope. Echoing it verbatim leaks the key into the
// agent's context window (and any transcript/log). We deep-walk the response and
// mask any value whose key looks like a credential, using the same ****<last4>
// convention as health_all.ts. The literal key never appears in full in output.
const SECRET_KEY_RE = /(api_?key|secret|token|password|passwd)/i;

/** Mask a single secret string as ****<last4> (or **** if too short to keep 4). */
function maskSecretValue(value: string): string {
  return value.length >= 4 ? `****${value.slice(-4)}` : "****";
}

/**
 * Recursively clone `input`, masking any string value stored under a key that
 * matches SECRET_KEY_RE. Non-secret fields (code, msg, timestamp, category, …)
 * pass through untouched so the agent still gets useful confirmation context.
 */
function maskSecretsDeep(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => maskSecretsDeep(item));
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (typeof val === "string" && SECRET_KEY_RE.test(key)) {
        out[key] = maskSecretValue(val);
      } else {
        out[key] = maskSecretsDeep(val);
      }
    }
    return out;
  }
  return input;
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

/**
 * Get or reset the capture (scraper/unblocker) API key.
 *
 * - `action: "get"` — read-only, returns current key immediately.
 * - `action: "reset"` — destructive, requires `confirm: true`. Without it,
 *   returns a warning preview instead of hitting the API.
 */
export async function novadaCaptureApikey(
  params: CaptureApikeyParams,
  apiKey?: string,
): Promise<string> {
  // ── GET: read-only, no gate ────────────────────────────────────────────────
  if (params.action === "get") {
    const data = await devApiPost<unknown>("/v1/capture/get_apikey", {}, { apiKey });

    return JSON.stringify(
      {
        status: "ok",
        action: "get_apikey",
        data: maskSecretsDeep(data),
        agent_instruction:
          "The capture API key is MASKED (****<last4>) so it is never echoed into the agent context. Read the full key from the Novada dashboard: https://dashboard.novada.com/overview/scraper/ — it is used for scraper and unblocker API calls on scraper.novada.com / webunlocker.novada.com.",
      },
      null,
      2,
    );
  }

  // ── RESET: destructive — confirm gate ──────────────────────────────────────
  if (params.confirm !== true) {
    return JSON.stringify(
      {
        status: "confirmation_required",
        action: "reset_apikey",
        warning:
          "This will invalidate your current capture API key. Any integrations using the old key will break immediately. Pass confirm:true to proceed.",
        agent_instruction:
          "DESTRUCTIVE action. Show this warning to the human user. Only re-call with the same parameters PLUS `confirm: true` after explicit user approval.",
      },
      null,
      2,
    );
  }

  const data = await devApiPost<unknown>("/v1/capture/reset_apikey", {}, { apiKey });

  return JSON.stringify(
    {
      status: "ok",
      action: "reset_apikey",
      data: maskSecretsDeep(data),
      agent_instruction:
        "API key has been regenerated and the old key is now invalid. The new key is MASKED (****<last4>) so it is never echoed into the agent context. Read the full new key from the Novada dashboard: https://dashboard.novada.com/overview/scraper/ and update all integrations with it.",
    },
    null,
    2,
  );
}
