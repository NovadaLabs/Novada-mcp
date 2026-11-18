/**
 * Runtime capability gate for the Browser/CDP tier.
 *
 * The Browser API transport is CDP-over-WebSocket, which requires a persistent
 * long-lived WebSocket connection. Serverless runtimes (Vercel, AWS Lambda) cannot
 * hold such a connection — connectOverCDP fails immediately with an opaque
 * "AuthorizationError" that looks like a credentials problem but is actually a
 * transport limitation.
 *
 * This module provides a single source of truth for whether the CDP/browser tier
 * is available on the current runtime. It is consumed by:
 *  - extract.ts: explicit render="browser" pre-check (Bug1/Bug3 fix)
 *  - utils/browser.ts: isBrowserConfigured() and fetchViaBrowser() (existing gates)
 *  - W4's browser transport (consumed from here, not duplicated)
 *
 * Key distinction from isBrowserConfigured() (utils/browser.ts):
 *   isBrowserConfigured() → "are credentials available AND is the runtime capable?"
 *   isBrowserAvailableOnRuntime() → "is this runtime capable of CDP at all?"
 *   The two are related: isBrowserConfigured() already reads RUNTIME.canHoldWebSocket internally.
 *   This module exposes the runtime check separately so extract.ts can provide
 *   different error messages depending on WHICH condition fails (no runtime vs no creds).
 *
 * Round 5 (owner direction): reads RUNTIME.canHoldWebSocket (config.ts) — the
 * ONE computed-once capability snapshot — instead of re-deriving serverless
 * detection here. See config.ts's RUNTIME doc comment for the full
 * NOVADA_RUNTIME_KIND / DEPLOYMENT_SUPPORTS_WS resolution order.
 */
import { RUNTIME } from "../config.js";
import { getBrowserWs } from "./credentials.js";
import { toolFailure } from "../_core/errors.js";
/**
 * F1 round 5 (independent A/B verifier): the TRANSPORT half of the browser
 * capability gate, split out as its own exported predicate so every caller —
 * this module's isBrowserAvailableOnRuntime() below AND utils/browser.ts's
 * isBrowserConfigured()/fetchViaBrowser() — shares ONE implementation instead
 * of each re-deriving "is this runtime capable of holding a persistent CDP
 * WebSocket" inline. Before this round, utils/browser.ts had TWO separate
 * inline copies of a hosted/serverless check (ignoring DEPLOYMENT_SUPPORTS_WS
 * entirely) that silently diverged from this file's logic the moment the
 * override flag was introduced — isBrowserAvailableOnRuntime() correctly
 * returned true on hosted+DEPLOYMENT_SUPPORTS_WS=true (so extract.ts took the
 * "browser available" arm), but fetchViaBrowser() then threw its own stale
 * "serverless (Vercel) cannot provide" error immediately, with no try/catch
 * at that call site to catch it — bypassing F1's render fallback entirely.
 * Round 5: both now read the SAME RUNTIME.canHoldWebSocket field, computed
 * once, so this class of drift is structurally impossible going forward.
 *
 * Deliberately does NOT consider credentials — that is a SEPARATE concern
 * with its own distinct error message (see fetchViaBrowser()'s wsEndpoint
 * check) and must not be conflated into this one predicate.
 */
export function isBrowserTransportAvailable() {
    return RUNTIME.canHoldWebSocket;
}
/**
 * Returns true ONLY when the current runtime can maintain a persistent WebSocket
 * connection required by the CDP (Browser API) tier AND credentials are set.
 *
 * On Vercel serverless / AWS Lambda:
 *   - returns false (CDP WS cannot be maintained)
 *   - UNLESS DEPLOYMENT_SUPPORTS_WS=true is explicitly set (custom runtime override)
 *
 * This is the canonical capability gate for the browser tier in extract.ts.
 * utils/browser.ts's isBrowserConfigured() DELEGATES to this exact function
 * (round 5: it used to duplicate the logic inline, which drifted) — both live
 * in different modules only because extract.ts needs to gate without
 * importing from browser.ts directly (avoiding a circular dep); browser.ts
 * importing FROM runtime.ts is fine (runtime.ts imports nothing from browser.ts).
 */
export function isBrowserAvailableOnRuntime() {
    return isBrowserTransportAvailable() && !!getBrowserWs();
}
/**
 * Returns a structured, agent-actionable error string for when the browser tier
 * is unavailable. Provides different messages based on WHY it's unavailable:
 *  1. Serverless runtime: explains the WS transport limitation + local MCP guidance
 *  2. Missing credentials: explains how to configure NOVADA_BROWSER_WS
 *
 * @param paramValue  The value of the triggering param (e.g. "browser")
 * @param fieldName   The param field name for the calling tool.
 *                    novada_extract uses `render=`; novada_unblock uses `method=`.
 *                    Defaults to "render" for backward-compat.
 * @param renderAttempt  F1 (2026-11-18): when the caller already tried the render
 *                    (Web Unblocker) tier as a fallback before giving up on browser,
 *                    pass `{ tried: true, error? }` so the message is honest about
 *                    what was actually attempted instead of reading like a
 *                    zero-attempt failure.
 */
export function getBrowserUnavailableError(paramValue, fieldName = "render", renderAttempt) {
    const paramContext = paramValue ? ` (${fieldName}="${paramValue}")` : "";
    // F1: the error text used to claim "Vercel serverless functions" specifically —
    // false on the current production deployment (EC2, see repo CLAUDE.md) even
    // though RUNTIME.kind alone can't distinguish EC2 from genuine Vercel today
    // (both report "hosted" — see config.ts). Describe the
    // TRANSPORT LIMITATION (serverless-style request isolation), not a specific
    // platform name, so this stays accurate regardless of which host is serving it.
    const renderAttemptLine = renderAttempt?.tried
        ? renderAttempt.error
            ? `- A render (Web Unblocker) fallback was attempted first and also failed: ${renderAttempt.error}`
            : `- A render (Web Unblocker) fallback was attempted first but did not return usable content.`
        : null;
    if (!RUNTIME.canHoldWebSocket) {
        return toolFailure([
            `## Browser Mode Unavailable`,
            ``,
            `${fieldName}="browser"${paramContext} requires a persistent CDP WebSocket transport that ` +
                `the hosted Novada MCP endpoint cannot provide in its current configuration.`,
            ``,
            `## Why This Happens`,
            `- The hosted endpoint's request-handling model terminates/isolates each request, so it cannot hold a long-lived CDP WebSocket.`,
            `- The raw "AuthorizationError" you may see is a transport failure, not a credentials problem.`,
            ...(renderAttemptLine ? [renderAttemptLine] : []),
            ``,
            `## Agent Action`,
            `agent_instruction: status:browser_unavailable_on_runtime | ` +
                `Use ${fieldName}="render" (Web Unblocker) for JS rendering on the hosted endpoint${renderAttempt?.tried ? " — already tried above and did not succeed on this URL" : ""}. ` +
                `For full browser automation, run the MCP server locally: npx -y novada-mcp@latest ` +
                `with NOVADA_BROWSER_WS configured. ` +
                `Docs: https://docs.novada.com/mcp/local-setup`,
        ].join("\n"));
    }
    // Missing credentials (runtime supports WS, but no NOVADA_BROWSER_WS set)
    return toolFailure([
        `## Browser Mode Unavailable`,
        ``,
        `${fieldName}="browser"${paramContext} requires NOVADA_BROWSER_WS to be configured.`,
        ...(renderAttemptLine ? ["", renderAttemptLine] : []),
        ``,
        `## Setup`,
        `Set NOVADA_BROWSER_WS=wss://username:password@host in your MCP environment:`,
        `  claude mcp add novada \\`,
        `    -e NOVADA_API_KEY=your_key \\`,
        `    -e NOVADA_BROWSER_WS=wss://USER:PASS@YOUR_BROWSER_WS_HOST \\`,
        `    -- npx -y novada-mcp`,
        ``,
        `Get credentials at: https://dashboard.novada.com/overview/browser/`,
        ``,
        `## Agent Action`,
        `agent_instruction: status:browser_not_configured | ` +
            `Set NOVADA_BROWSER_WS env var to enable browser mode. ` +
            `Get credentials at dashboard.novada.com/overview/browser/. ` +
            `Alternatively, use ${fieldName}="render" (Web Unblocker) for JS rendering — no extra config needed.`,
    ].join("\n"));
}
/**
 * Markdown-heading prefixes that novadaExtract (and its browser-tier fallback)
 * emit as a STRING instead of throwing, to signal a failed extraction:
 *  - "## Extract Failed"        — extract.ts caught-exception path
 *  - "## Extraction Error"      — extract.ts TOTAL_REQUEST_CEILING timeout path
 *  - "## Browser Mode Unavailable" — getBrowserUnavailableError() above (hosted/no-WS)
 *
 * Consumers that baseline or diff extract output (monitor.ts) MUST treat any of
 * these as a failure, NOT as page content — otherwise the error text gets hashed
 * and stored as a baseline, producing false "changed" reports on the next call.
 *
 * Single source of truth: add any future sentinel prefix here and every consumer
 * using isExtractionFailureSentinel() picks it up automatically.
 */
export const EXTRACTION_FAILURE_SENTINELS = [
    "## Extract Failed",
    "## Extraction Error",
    "## Browser Mode Unavailable",
];
/** True when `content` is one of the extraction-failure sentinel strings above. */
export function isExtractionFailureSentinel(content) {
    return EXTRACTION_FAILURE_SENTINELS.some((s) => content.startsWith(s));
}
//# sourceMappingURL=runtime.js.map