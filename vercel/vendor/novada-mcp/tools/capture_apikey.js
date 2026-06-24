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
        .describe("Action to perform. 'get': retrieve the current capture/scraper API key (read-only). 'reset': regenerate the API key — DESTRUCTIVE, invalidates the old key."),
    confirm: z
        .literal(true)
        .optional()
        .describe("Required for 'reset' action. Pass `true` ONLY after the human user has confirmed they want to invalidate the current API key. Ignored for 'get' action."),
})
    .strict();
export function validateCaptureApikeyParams(args) {
    return CaptureApikeyParamsSchema.parse(args ?? {});
}
// ─── Tool Implementation ─────────────────────────────────────────────────────
/**
 * Get or reset the capture (scraper/unblocker) API key.
 *
 * - `action: "get"` — read-only, returns current key immediately.
 * - `action: "reset"` — destructive, requires `confirm: true`. Without it,
 *   returns a warning preview instead of hitting the API.
 */
export async function novadaCaptureApikey(params, apiKey) {
    // ── GET: read-only, no gate ────────────────────────────────────────────────
    if (params.action === "get") {
        const data = await devApiPost("/v1/capture/get_apikey", {}, { apiKey });
        return JSON.stringify({
            status: "ok",
            action: "get_apikey",
            data,
            agent_instruction: "Current capture API key returned. This key is used for scraper and unblocker API calls on scraper.novada.com / webunlocker.novada.com.",
        }, null, 2);
    }
    // ── RESET: destructive — confirm gate ──────────────────────────────────────
    if (params.confirm !== true) {
        return JSON.stringify({
            status: "confirmation_required",
            action: "reset_apikey",
            warning: "This will invalidate your current capture API key. Any integrations using the old key will break immediately. Pass confirm:true to proceed.",
            agent_instruction: "DESTRUCTIVE action. Show this warning to the human user. Only re-call with the same parameters PLUS `confirm: true` after explicit user approval.",
        }, null, 2);
    }
    const data = await devApiPost("/v1/capture/reset_apikey", {}, { apiKey });
    return JSON.stringify({
        status: "ok",
        action: "reset_apikey",
        data,
        agent_instruction: "API key has been regenerated. The old key is now invalid. Update all integrations with the new key returned in `data`.",
    }, null, 2);
}
//# sourceMappingURL=capture_apikey.js.map