// Wraps POST /v1/capture/get_apikey and /v1/capture/reset_apikey on api-m.novada.com.
// Combined into a single tool `novada_capture_apikey` with action discriminator.
// "get" = read-only, no gate.
// "reset" = DESTRUCTIVE (invalidates old key) — gated by the shared
// APPROVAL-TOKEN flow (F2-2/G-7 fix, 2026-09): first call (no
// `approval_token`) returns a warning preview + a signed, expiring,
// payload-bound token; only a second call carrying that exact token AND the
// exact same parameters executes. `confirm: true` alone is a deprecated
// no-op — see ../utils/approval.ts.
import { z } from "zod";
import { devApiPost } from "../_core/developer_api.js";
import { evaluateApprovalGate } from "../utils/approval.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
export const CaptureApikeyParamsSchema = z
    .object({
    action: z
        .enum(["get", "reset"])
        .describe("Action to perform. 'get': retrieve the current capture/scraper API key (read-only). 'reset': regenerate the API key — DESTRUCTIVE, invalidates the old key."),
    confirm: z
        .literal(true)
        .optional()
        .describe("DEPRECATED — ignored for both actions. Setting this alone no longer authorizes 'reset' (closed 2026-09, finding F2-2: an agent could self-supply confirm:true with no prior human-reviewed preview). Use approval_token instead: call once WITHOUT approval_token to receive a preview and a token, then call again with the identical parameters plus approval_token."),
    approval_token: z
        .string()
        .min(1)
        .optional()
        .describe("Two-step approval token, required to execute 'reset'. Omit on the first call to receive a preview + a fresh approval_token (valid 10 minutes). Re-call with the EXACT SAME parameters plus this field set to that token to execute. Never invent a value — an invented or stale token is rejected. Ignored for 'get' action."),
})
    .strict();
export function validateCaptureApikeyParams(args) {
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
function maskSecretValue(value) {
    return value.length >= 4 ? `****${value.slice(-4)}` : "****";
}
/**
 * Recursively clone `input`, masking any string value stored under a key that
 * matches SECRET_KEY_RE. Non-secret fields (code, msg, timestamp, category, …)
 * pass through untouched so the agent still gets useful confirmation context.
 */
function maskSecretsDeep(input) {
    if (Array.isArray(input)) {
        return input.map((item) => maskSecretsDeep(item));
    }
    if (input !== null && typeof input === "object") {
        const out = {};
        for (const [key, val] of Object.entries(input)) {
            if (typeof val === "string" && SECRET_KEY_RE.test(key)) {
                out[key] = maskSecretValue(val);
            }
            else {
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
 * - `action: "reset"` — destructive, requires a valid `approval_token`
 *   (see ../utils/approval.ts). Without one, returns a warning preview
 *   plus a fresh token instead of hitting the API.
 */
export async function novadaCaptureApikey(params, apiKey) {
    // ── GET: read-only, no gate ────────────────────────────────────────────────
    if (params.action === "get") {
        const data = await devApiPost("/v1/capture/get_apikey", {}, { apiKey });
        return JSON.stringify({
            status: "ok",
            action: "get_apikey",
            data: maskSecretsDeep(data),
            agent_instruction: "The capture API key is MASKED (****<last4>) so it is never echoed into the agent context. Read the full key from the Novada dashboard: https://dashboard.novada.com/overview/scraper/ — it is used for scraper and unblocker API calls on scraper.novada.com / webunlocker.novada.com.",
        }, null, 2);
    }
    // ── RESET: destructive — approval-token gate ────────────────────────────────
    const resetGate = evaluateApprovalGate(params, "reset_apikey");
    if (!resetGate.authorized) {
        return JSON.stringify({
            status: "confirmation_required",
            action: "reset_apikey",
            warning: "This will invalidate your current capture API key. Any integrations using the old key will break immediately.",
            approval_token: resetGate.approvalToken,
            expires_at: new Date(resetGate.expiresAt).toISOString(),
            expires_in_seconds: resetGate.expiresInSeconds,
            agent_instruction: "DESTRUCTIVE action. Show this warning to the human user. To execute, call again with the EXACT SAME parameters plus `approval_token` set to the value above (valid 10 minutes). `confirm: true` alone does nothing — it is deprecated and ignored.",
        }, null, 2);
    }
    const data = await devApiPost("/v1/capture/reset_apikey", {}, { apiKey });
    return JSON.stringify({
        status: "ok",
        action: "reset_apikey",
        data: maskSecretsDeep(data),
        agent_instruction: "API key has been regenerated and the old key is now invalid. The new key is MASKED (****<last4>) so it is never echoed into the agent context. Read the full new key from the Novada dashboard: https://dashboard.novada.com/overview/scraper/ and update all integrations with it.",
    }, null, 2);
}
//# sourceMappingURL=capture_apikey.js.map