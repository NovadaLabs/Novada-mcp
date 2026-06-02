export interface ToolCredentials {
    webUnblockerKey?: string;
    browserWs?: string;
    proxyUser?: string;
    proxyPass?: string;
    proxyEndpoint?: string;
}
/**
 * Run a function with specific credentials in scope.
 * Used by NovadaClient SDK to isolate credentials per-request.
 */
export declare function withCredentials<T>(creds: ToolCredentials, fn: () => T): T;
/** Active web unblocker key: SDK-scoped > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified). */
export declare function getWebUnblockerKey(): string | undefined;
/** Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var. */
export declare function getBrowserWs(): string | undefined;
/** Active proxy credentials: SDK-scoped > NOVADA_PROXY_* env vars. */
export declare function getProxyCredentials(): {
    user: string;
    pass: string;
    endpoint: string;
} | null;
/**
 * Fetch proxy sub-account credentials from the Novada management API.
 * Requires NOVADA_USERNAME + NOVADA_API_KEY. Cached 6h in memory.
 *
 * Auth flow:
 *   POST /oauth2/token  (Basic username:apiKey)  → access_token
 *   POST /proxy_account/list  (Bearer token)      → account + password
 */
export declare function fetchProxyCredentials(apiKey: string, username: string): Promise<{
    account: string;
    password: string;
}>;
/**
 * Resolve proxy credentials with priority:
 * 1. Explicit env vars (NOVADA_PROXY_USER / PASS / ENDPOINT) — no API call.
 * 2. Auto-fetch via NOVADA_USERNAME + NOVADA_API_KEY from management API, cached 6h.
 *
 * NOVADA_PROXY_ENDPOINT is required in both cases.
 */
export declare function resolveProxyCredentials(): Promise<{
    user: string;
    pass: string;
    endpoint: string;
}>;
//# sourceMappingURL=credentials.d.ts.map