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
/** Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var > auto-provisioned. */
export declare function getBrowserWs(): string | undefined;
/** Active proxy credentials: SDK-scoped > NOVADA_PROXY_* env vars. */
export declare function getProxyCredentials(): {
    user: string;
    pass: string;
    endpoint: string;
} | null;
/**
 * Residential proxy credentials — separate from datacenter proxy.
 * Reads NOVADA_RESIDENTIAL_PROXY_USER / PASS / ENDPOINT env vars.
 * Falls back to standard proxy credentials if residential vars are not set.
 */
export declare function getResidentialProxyCredentials(): {
    user: string;
    pass: string;
    endpoint: string;
} | null;
/**
 * Fetch the first active proxy sub-account using NOVADA_API_KEY as a Bearer token.
 * Calls POST /v1/proxy_account/list directly — no OAuth2 exchange required.
 * Result is cached 6h in memory.
 */
export declare function fetchProxySubAccountCredentials(apiKey: string): Promise<{
    account: string;
    password: string;
} | null>;
/**
 * Fetch Browser API WSS endpoint using NOVADA_API_KEY as Bearer token.
 * Calls POST /v1/proxy_account/list with product=10 (Browser API).
 * Returns wss://{account}:{password}@upg-scbr2.novada.com
 * Cached 6h in memory.
 */
export declare function fetchBrowserSubAccountCredentials(apiKey: string): Promise<string | null>;
/**
 * Resolve Browser API WebSocket URL with priority:
 * 1. SDK-scoped browserWs
 * 2. NOVADA_BROWSER_WS env var
 * 3. Auto-fetch via NOVADA_API_KEY (product=10)
 */
export declare function resolveBrowserWs(apiKey?: string): Promise<string | null>;
/**
 * Resolve proxy credentials with priority:
 * 1. Explicit env vars (NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT) — no API call.
 * 2. Auto-fetch via NOVADA_API_KEY Bearer token when only NOVADA_PROXY_ENDPOINT is set.
 *
 * NOVADA_PROXY_ENDPOINT is required in both cases.
 * Returns null if NOVADA_PROXY_ENDPOINT is not set (proxy tools disabled).
 */
export declare function resolveProxyCredentials(): Promise<{
    user: string;
    pass: string;
    endpoint: string;
} | null>;
//# sourceMappingURL=credentials.d.ts.map