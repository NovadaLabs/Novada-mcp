/**
 * Returns the active Novada API key.
 *
 * Priority: NOVADA_API_KEY env var.
 * Throws NovadaError(INVALID_API_KEY) with agent_instruction if missing.
 *
 * Note: The utils/credentials.ts AsyncLocalStorage layer handles SDK-scoped
 * overrides for per-request credential isolation. For MCP server usage, reading
 * process.env here is the correct single-tenant path.
 */
export declare function getApiKey(): string;
export interface ProxyCredentials {
    user: string;
    pass: string;
    endpoint: string;
}
/**
 * Returns proxy credentials from environment variables.
 * Returns null if any of the three required vars are missing (non-throwing).
 * Tools should treat a null return as "proxy not configured" and emit
 * a PRODUCT_UNAVAILABLE or not_configured status rather than throwing.
 */
export declare function getProxyCredentials(): ProxyCredentials | null;
/**
 * Builds a proxy URL string from credentials.
 *
 * @param creds - Proxy credentials
 * @param sessionId - Optional sticky session ID. Alphanumeric + hyphens/underscores only.
 *   Validated at the Zod schema layer before reaching here — no additional sanitization needed.
 * @param country - Optional 2-letter ISO country code.
 * @returns Formatted proxy URL string.
 *
 * Security note: sessionId flows into a URL string here. Callers MUST validate with
 * .regex(/^[a-zA-Z0-9_\-]+$/) at the Zod schema level before passing here.
 * This function does NOT re-validate since it is an internal utility called only
 * from tool layer code where schema validation has already run.
 */
export declare function buildProxyUrl(creds: ProxyCredentials, sessionId?: string, country?: string): string;
/**
 * Returns the Browser API WebSocket endpoint URL.
 * Returns undefined if NOVADA_BROWSER_WS is not set (non-throwing).
 * Tools that require browser access should check for undefined and
 * surface a "not configured" status.
 */
export declare function getBrowserWsUrl(): string | undefined;
/**
 * Returns the Web Unblocker API key.
 * Returns undefined if NOVADA_WEB_UNBLOCKER_KEY is not set (non-throwing).
 */
export declare function getWebUnblockerKey(): string | undefined;
export interface AuthCredentials {
    username: string;
    password: string;
}
/**
 * Returns OAuth2 username/password credentials for token exchange.
 * Reads NOVADA_AUTH_USER and NOVADA_AUTH_PASS env vars.
 * Returns null if either is missing.
 */
export declare function getAuthCredentials(): AuthCredentials | null;
//# sourceMappingURL=auth.d.ts.map