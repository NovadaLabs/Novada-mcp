import axios, { AxiosError } from "axios";
import { z } from "zod";
import { classifyError, makeNovadaError, NovadaErrorCode } from "../_core/errors.js";
// ─── Schema & Types ──────────────────────────────────────────────────────────
const BrowserFlowActionSchema = z.object({
    type: z
        .enum(["click", "scroll", "wait", "type", "screenshot"])
        .describe("Action type to perform on the page."),
    selector: z
        .string()
        .optional()
        .describe("CSS selector for click/type actions. Not required for scroll/wait/screenshot."),
    value: z
        .string()
        .optional()
        .describe("Text to type (for 'type' action) or scroll direction (for 'scroll': 'up'|'down')."),
    delay: z
        .number()
        .int()
        .min(0)
        .max(30000)
        .optional()
        .describe("Delay in milliseconds before executing this action. Max 30000ms."),
});
export const BrowserFlowParamsSchema = z.object({
    url: z
        .string()
        .url("A valid URL is required")
        .refine((url) => /^https?:\/\//i.test(url), "Only HTTP and HTTPS URLs are supported")
        .refine((url) => {
        try {
            let host = new URL(url).hostname;
            if (host.startsWith("[") && host.endsWith("]"))
                host = host.slice(1, -1);
            if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host))
                return false;
            return !/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1|::ffff:.+|fe80:.*)$/i.test(host);
        }
        catch {
            return false;
        }
    }, "URLs pointing to localhost or private network ranges are not allowed")
        .describe("The URL to open in the cloud browser. Must be a publicly accessible HTTP/HTTPS URL."),
    actions: z
        .array(BrowserFlowActionSchema)
        .min(1, "At least one action is required")
        .max(20, "Maximum 20 actions per call")
        .describe("Ordered sequence of browser actions to execute. Each action has a type and optional selector/value/delay."),
    country: z
        .string()
        .regex(/^[a-zA-Z]{0,2}$/, "country must be a 2-letter ISO country code or empty")
        .default("")
        .describe("Optional 2-letter ISO 3166-1 country code for geo-targeting the browser session (e.g. 'us', 'gb', 'de')."),
    session_id: z
        .string()
        .regex(/^[a-zA-Z0-9_\-\.]{0,64}$/, "session_id must be alphanumeric with underscores/hyphens only, max 64 chars")
        .optional()
        .describe("Optional session ID for sticky sessions. When provided, the same browser session is reused across calls — preserving cookies, login state, and localStorage. Sessions expire after 10 minutes of inactivity."),
});
export function validateBrowserFlowParams(args) {
    return BrowserFlowParamsSchema.parse(args ?? {});
}
// ─── API Configuration ───────────────────────────────────────────────────────
const BROWSER_FLOW_ENDPOINT = "https://api-m.novada.com/v1/browser_flow/browser_flow_use";
// ─── Tool Implementation ─────────────────────────────────────────────────────
/**
 * Execute a multi-step browser automation sequence via Novada's cloud browser.
 * Calls POST https://api-m.novada.com/v1/browser_flow/browser_flow_use with the
 * action sequence and returns per-action results as markdown.
 *
 * Supports sticky sessions via session_id for multi-call login flows.
 * On failure: returns agent_instruction with novada_browser as fallback.
 */
export async function novadaBrowserFlow(params, apiKey) {
    const { url, actions, country, session_id } = params;
    let apiResponse;
    try {
        const payload = {
            url,
            actions: actions.map((a) => ({
                type: a.type,
                ...(a.selector !== undefined && { selector: a.selector }),
                ...(a.value !== undefined && { value: a.value }),
                ...(a.delay !== undefined && { delay: a.delay }),
            })),
        };
        if (country) {
            payload.country = country;
        }
        if (session_id) {
            payload.session_id = session_id;
        }
        const resp = await axios.post(BROWSER_FLOW_ENDPOINT, payload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            timeout: 120000, // 2 min — browser flows can be slow
        });
        apiResponse = resp.data;
    }
    catch (err) {
        if (err instanceof AxiosError) {
            const status = err.response?.status;
            if (status === 404) {
                return formatEndpointUnavailable(url, actions);
            }
            if (status === 401 || status === 403) {
                throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, "Invalid NOVADA_API_KEY or insufficient permissions for Browser Flow API.");
            }
            if (status === 429) {
                throw makeNovadaError(NovadaErrorCode.RATE_LIMITED, "Browser Flow API rate limit exceeded.");
            }
            const serverMsg = err.response?.data?.msg ?? err.message;
            if (status && status >= 500) {
                throw makeNovadaError(NovadaErrorCode.API_DOWN, `Browser Flow API error (HTTP ${status}): ${serverMsg}`);
            }
            throw makeNovadaError(NovadaErrorCode.URL_UNREACHABLE, `Browser Flow API unreachable (HTTP ${status ?? "network error"}): ${serverMsg}`);
        }
        // Non-Axios errors — classify generically
        throw classifyError(err);
    }
    // ─── Response Parsing ────────────────────────────────────────────────────
    if (!apiResponse) {
        throw makeNovadaError(NovadaErrorCode.UNKNOWN, "Browser Flow API returned an empty response.");
    }
    if (apiResponse.code !== 0) {
        const errorMessages = {
            10000: "Authentication failure — NOVADA_API_KEY is invalid or missing. Verify the key at https://dashboard.novada.com/overview/.",
            10001: "Missing required parameters. Check that url and actions are provided.",
            11000: "Invalid API key.",
            11006: "Browser Flow API not activated on this account. Activate at https://dashboard.novada.com/overview/browser/ before retrying.",
            // API returns HTTP 200 but JSON code 401 for auth failures
            401: "Browser Flow API authentication failure — the API key may lack Browser Flow permissions. Use novada_browser (CDP) as an alternative, or activate Browser Flow at https://dashboard.novada.com/overview/browser/.",
        };
        if (apiResponse.code === 10000 || apiResponse.code === 401) {
            // Return formatted error (not throw) so the agent sees the fallback instructions
            return formatApiError(url, actions, errorMessages[apiResponse.code] ?? apiResponse.msg ?? "Authentication failure", session_id);
        }
        const msg = errorMessages[apiResponse.code] ??
            apiResponse.msg ??
            `API returned code ${apiResponse.code}`;
        return formatApiError(url, actions, msg, session_id);
    }
    const resultData = apiResponse.data;
    const actionResults = resultData?.results ?? resultData?.actions ?? [];
    const returnedSessionId = resultData?.session_id ?? session_id;
    return formatSuccessResponse(url, actions, actionResults, returnedSessionId);
}
// ─── Formatters ──────────────────────────────────────────────────────────────
function formatSuccessResponse(url, actions, results, sessionId) {
    const succeeded = results.filter((r) => r.status === "ok").length;
    const failed = results.length - succeeded;
    const lines = [
        `## Browser Flow Results`,
        `url: ${url}`,
        `actions: ${actions.length} | executed: ${results.length} | succeeded: ${succeeded} | failed: ${failed}${sessionId ? ` | session_id: ${sessionId}` : ""}`,
        ``,
        `---`,
        ``,
    ];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const actionType = r.action_type ?? actions[i]?.type ?? `action_${i + 1}`;
        lines.push(`### Action ${i + 1}: ${actionType} [${r.status ?? "unknown"}]`);
        if (r.error) {
            lines.push(`Error: ${r.error}`);
        }
        else if (r.screenshot) {
            // Return screenshot as data URI for agent use
            const dataUri = r.screenshot.startsWith("data:")
                ? r.screenshot
                : `data:image/png;base64,${r.screenshot}`;
            lines.push(dataUri);
        }
        else if (r.content) {
            const content = r.content.length > 10000 ? r.content.slice(0, 10000) + "\n<!-- truncated -->" : r.content;
            lines.push(content);
        }
        else {
            lines.push(`(completed)`);
        }
        lines.push(``);
    }
    lines.push(`---`, `## Agent Hints`);
    if (sessionId) {
        lines.push(`- Session active: session_id="${sessionId}" — reuse this ID in subsequent novada_browser_flow calls to maintain state.`);
        lines.push(`- Sessions expire after 10 minutes of inactivity.`);
    }
    else {
        lines.push(`- Each call starts a fresh browser session — no cookies or state from prior calls.`);
        lines.push(`- Pass session_id to maintain login state and cookies across multiple novada_browser_flow calls.`);
    }
    lines.push(`- For CDP-based interactive automation with more action types, use novada_browser instead.`);
    if (failed > 0) {
        lines.push(`- ${failed} action(s) failed. If the issue persists, use novada_browser as a fallback — it supports more action types and richer error detail.`);
    }
    return lines.join("\n");
}
function formatApiError(url, actions, message, sessionId) {
    return [
        `## Browser Flow — API Error`,
        `url: ${url}`,
        `actions_requested: ${actions.length}${sessionId ? ` | session_id: ${sessionId}` : ""}`,
        ``,
        `Error: ${message}`,
        ``,
        `---`,
        `## Agent Hints`,
        `agent_instruction: The Browser Flow API returned an error. Try the following:`,
        `  1. Verify the URL is publicly accessible (not behind auth or on a private network).`,
        `  2. Check that the Browser Flow product is activated: https://dashboard.novada.com/overview/browser/`,
        `  3. Fallback: Use novada_browser with the same actions — it uses CDP and has higher reliability.`,
        `  4. Fallback: Use novada_proxy_residential to route your own requests if you just need IP geo-targeting.`,
    ].join("\n");
}
function formatEndpointUnavailable(url, actions) {
    return [
        `## Browser Flow — Endpoint Unavailable`,
        `url: ${url}`,
        `actions_requested: ${actions.length}`,
        ``,
        `The browser_flow endpoint returned 404. The API may not yet be deployed on this account.`,
        ``,
        `---`,
        `## Agent Hints`,
        `agent_instruction: novada_browser_flow endpoint is not available. Use one of these fallbacks:`,
        `  - novada_browser: CDP-based browser automation with navigate, click, type, screenshot, aria_snapshot — more action types, same cloud browser infrastructure.`,
        `  - novada_unblock: Render a single URL without interaction (faster, lower cost).`,
        `  - novada_proxy_residential: Get a residential proxy to route your own HTTP client through.`,
    ].join("\n");
}
//# sourceMappingURL=browser_flow.js.map