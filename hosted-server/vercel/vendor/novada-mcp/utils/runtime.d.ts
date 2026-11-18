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
 * detection here. Round 8: canHoldWebSocket is now simply `kind !==
 * "serverless"` — no separate opt-in flag. See config.ts's RUNTIME doc
 * comment for the full NOVADA_RUNTIME_KIND resolution order.
 */
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
export declare function isBrowserTransportAvailable(): boolean;
/**
 * Returns true ONLY when the current runtime can maintain a persistent WebSocket
 * connection required by the CDP (Browser API) tier AND credentials are set.
 *
 * On genuine serverless (RUNTIME.kind === "serverless" — real Vercel/Lambda
 * per-request isolates, auto-detected): returns false (CDP WS cannot be
 * maintained). On "hosted" (a long-lived Node server, e.g. EC2's
 * server.mts): returns true unconditionally — no opt-in flag needed, since
 * "hosted" means this runtime CAN hold a persistent WS by definition.
 *
 * This is the canonical capability gate for the browser tier in extract.ts.
 * utils/browser.ts's isBrowserConfigured() DELEGATES to this exact function
 * (round 5: it used to duplicate the logic inline, which drifted) — both live
 * in different modules only because extract.ts needs to gate without
 * importing from browser.ts directly (avoiding a circular dep); browser.ts
 * importing FROM runtime.ts is fine (runtime.ts imports nothing from browser.ts).
 */
export declare function isBrowserAvailableOnRuntime(): boolean;
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
export declare function getBrowserUnavailableError(paramValue?: string, fieldName?: string, renderAttempt?: {
    tried: boolean;
    error?: string;
}): string;
//# sourceMappingURL=runtime.d.ts.map