/**
 * Public "well-known static text" domain-verification routes.
 *
 * First consumer: OpenAI Apps submission domain verification
 * (https://developers.openai.com/plugins/deploy/submission): "host the exact
 * challenge token as plain text at the URL shown in the portal ... Return
 * only the exact token—not JSON or a list of tokens."
 *
 * Class, not instance: a verifier is a class member, not a one-off branch —
 * the next domain-verification challenge (Google Search Console, Bing
 * Webmaster, etc.) is a new ROW in WELL_KNOWN_STATIC_TEXT_ROUTES, never a new
 * if/else in mcp.ts.
 *
 * Import-free by design (same convention as _oauth.ts, _plan.ts) so this is
 * independently unit-testable without importing mcp.ts's module-load side
 * effects (Sentry.init, @vercel/kv client construction, env-var stripping).
 * mcp.ts is the DI root: it passes `(name) => process.env[name]` as `getEnv`.
 *
 * Never logs the token: the only place the trimmed env-var value appears is
 * the 200 response body built below.
 */

export interface WellKnownStaticTextRoute {
  readonly path: string;
  readonly envVar: string;
}

/** Class table. Add a row here for the next static-text verification path. */
export const WELL_KNOWN_STATIC_TEXT_ROUTES: readonly WellKnownStaticTextRoute[] = [
  { path: "/.well-known/openai-apps-challenge", envVar: "OPENAI_APPS_CHALLENGE_TOKEN" },
];

/**
 * Handle a request against the well-known static-text route table.
 *
 * Returns `null` when `pathname` matches no row — the caller (mcp.ts) must
 * fall through to its normal routing (OAuth paths, /mcp dispatch, and
 * eventually the existing unmatched-path 404), unchanged.
 *
 * When `pathname` DOES match a row:
 *   - GET/HEAD + env var set (non-empty after trim)   → 200, text/plain,
 *     body = the exact token trimmed of surrounding whitespace, no JSON,
 *     no trailing newline added; `cache-control: no-store`.
 *   - GET/HEAD + env var unset/empty                  → 404, same JSON-RPC
 *     error shape as mcp.ts's existing unmatched-path 404
 *     (jsonError(404, "NOT_FOUND", "Unknown path. The MCP endpoint is
 *     POST/GET /mcp.")) — kept as a literal here (not imported) since
 *     _wellknown.ts must stay import-free.
 *   - any other method                                 → 405, `allow: GET, HEAD`.
 */
export function handleWellKnownStaticText(
  pathname: string,
  method: string,
  getEnv: (name: string) => string | undefined,
): Response | null {
  const route = WELL_KNOWN_STATIC_TEXT_ROUTES.find((r) => r.path === pathname);
  if (!route) return null;

  const m = (method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") {
    return new Response(null, { status: 405, headers: { "allow": "GET, HEAD" } });
  }

  const token = getEnv(route.envVar)?.trim();
  if (!token) {
    // Mirrors mcp.ts's jsonError(404, "NOT_FOUND", "Unknown path. The MCP
    // endpoint is POST/GET /mcp.") byte-for-byte — see wellknown-domain-
    // verification.test.mjs's shape-parity test if these ever drift apart.
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: 404,
          message: "Unknown path. The MCP endpoint is POST/GET /mcp.",
          data: { code: "NOT_FOUND" },
        },
        id: null,
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  return new Response(m === "HEAD" ? null : token, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
