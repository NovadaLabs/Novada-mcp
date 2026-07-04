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

import { isHostedEnvironment } from "../config.js";
import { getBrowserWs } from "./credentials.js";

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
export function isBrowserAvailableOnRuntime(): boolean {
  // Explicit opt-in override for custom runtimes that do support persistent WS
  if (process.env.DEPLOYMENT_SUPPORTS_WS === "true") {
    return !!getBrowserWs();
  }
  // Serverless runtimes cannot hold CDP WS connections
  if (isHostedEnvironment()) return false;
  return !!getBrowserWs();
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
 */
export function getBrowserUnavailableError(paramValue?: string, fieldName = "render"): string {
  const paramContext = paramValue ? ` (${fieldName}="${paramValue}")` : "";

  if (isHostedEnvironment() && process.env.DEPLOYMENT_SUPPORTS_WS !== "true") {
    return [
      `## Browser Mode Unavailable`,
      ``,
      `${fieldName}="browser"${paramContext} requires a persistent CDP WebSocket transport that ` +
        `the hosted Novada MCP endpoint (Vercel serverless) cannot provide.`,
      ``,
      `## Why This Happens`,
      `- The hosted endpoint runs on Vercel serverless functions that terminate after each request.`,
      `- CDP (Browser API) needs a long-lived WebSocket — serverless kills the connection mid-flight.`,
      `- The raw "AuthorizationError" you may see is a transport failure, not a credentials problem.`,
      ``,
      `## Agent Action`,
      `agent_instruction: status:browser_unavailable_on_runtime | ` +
        `Use ${fieldName}="render" (Web Unblocker) for JS rendering on the hosted endpoint. ` +
        `For full browser automation, run the MCP server locally: npx -y novada-mcp@latest ` +
        `with NOVADA_BROWSER_WS configured. ` +
        `Docs: https://docs.novada.com/mcp/local-setup`,
    ].join("\n");
  }

  // Missing credentials (runtime supports WS, but no NOVADA_BROWSER_WS set)
  return [
    `## Browser Mode Unavailable`,
    ``,
    `${fieldName}="browser"${paramContext} requires NOVADA_BROWSER_WS to be configured.`,
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
  ].join("\n");
}
