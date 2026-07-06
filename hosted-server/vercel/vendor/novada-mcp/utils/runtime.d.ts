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
 *   The two are related: isBrowserConfigured() already calls isHostedEnvironment() internally.
 *   This module exposes the runtime check separately so extract.ts can provide
 *   different error messages depending on WHICH condition fails (no runtime vs no creds).
 *
 * Serverless detection: checks VERCEL / VERCEL_ENV / AWS_LAMBDA_FUNCTION_NAME env vars.
 * An explicit opt-in override flag (DEPLOYMENT_SUPPORTS_WS=true) allows future
 * environments with persistent WS support (e.g. a custom long-running container) to
 * opt in without changing this logic.
 */
/**
 * Returns true ONLY when the current runtime can maintain a persistent WebSocket
 * connection required by the CDP (Browser API) tier AND credentials are set.
 *
 * On Vercel serverless / AWS Lambda:
 *   - returns false (CDP WS cannot be maintained)
 *   - UNLESS DEPLOYMENT_SUPPORTS_WS=true is explicitly set (custom runtime override)
 *
 * This is the canonical capability gate for the browser tier in extract.ts.
 * utils/browser.ts's isBrowserConfigured() performs the same check but is
 * defined in the browser utility module — this export allows extract.ts to
 * gate without importing from browser.ts directly, avoiding circular deps.
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
 */
export declare function getBrowserUnavailableError(paramValue?: string, fieldName?: string): string;
//# sourceMappingURL=runtime.d.ts.map