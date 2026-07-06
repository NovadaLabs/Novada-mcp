export interface ToolCredentials {
    /** Caller's API key — used as fallback for webUnblockerKey, proxy auto-fetch, and browser auto-provision. */
    apiKey?: string;
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
/** Active web unblocker key: SDK-scoped webUnblockerKey > SDK-scoped apiKey > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified). */
export declare function getWebUnblockerKey(): string | undefined;
/**
 * Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var.
 *
 * TENANT SAFETY: this reader is synchronous and has no apiKey to match against,
 * so it MUST NOT consult the per-key auto-fetch cache (_browserWsCache). On the
 * multi-tenant hosted server, returning any cached wsUrl here would serve one
 * caller's browser credentials to another. The cache is only read inside
 * fetchBrowserSubAccountCredentials(apiKey) / resolveBrowserWs(apiKey), where the
 * requesting key is known and the entry is matched by its fingerprint.
 * The store path is request-scoped and the env path is single-tenant config —
 * both are safe.
 */
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
 * Fetch the first active proxy sub-account using the caller's apiKey as a Bearer token.
 * Calls POST /v1/proxy_account/list directly — no OAuth2 exchange required.
 * Result is cached 6h in memory, keyed by the fingerprint of the fetching apiKey so
 * one caller's credentials are never returned to another (see keyFingerprint).
 */
export declare function fetchProxySubAccountCredentials(apiKey: string): Promise<{
    account: string;
    password: string;
} | null>;
/**
 * Fetch Browser API WSS endpoint using the caller's apiKey as a Bearer token.
 * Calls POST /v1/proxy_account/list with product=10 (Browser API).
 * Returns wss://{account}:{password}@upg-scbr2.novada.com
 * Cached 6h in memory, keyed by the fingerprint of the fetching apiKey so one
 * caller's browser WSS endpoint is never returned to another (see keyFingerprint).
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
 * 2. Auto-fetch sub-account via apiKey when NOVADA_PROXY_ENDPOINT is set (custom endpoint).
 * 3. Auto-fetch sub-account via apiKey with NO endpoint configured → use the universal
 *    gateway proxy.novada.pro:7777. This is the hosted-server path: the caller supplies
 *    only an API key, we derive a working {user,pass,endpoint} entirely from it.
 *
 * @param apiKey - Caller's API key. Takes priority over the store-scoped key and NOVADA_API_KEY,
 *   so hosted-server requests are billed to the caller, not the server account.
 */
export declare function resolveProxyCredentials(apiKey?: string): Promise<{
    user: string;
    pass: string;
    endpoint: string;
} | null>;
/**
 * Redact a secret string to a last-4 fingerprint for safe logging.
 * Example: "abc123xyz" → "****xyz"
 * Never logs the full value.
 */
export declare function redactSecret(value: string | undefined): string;
//# sourceMappingURL=credentials.d.ts.map