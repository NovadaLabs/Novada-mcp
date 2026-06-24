/**
 * Request-scoped credentials store using Node.js AsyncLocalStorage.
 *
 * Solves the SDK multi-client issue: instead of mutating process.env (global state),
 * the SDK wraps each call in withCredentials(). Tool utilities read from this store
 * first, falling back to process.env for MCP server use (single-tenant).
 */
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage();
/**
 * Run a function with specific credentials in scope.
 * Used by NovadaClient SDK to isolate credentials per-request.
 */
export function withCredentials(creds, fn) {
    return store.run(creds, fn);
}
/** Active web unblocker key: SDK-scoped > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified). */
export function getWebUnblockerKey() {
    return store.getStore()?.webUnblockerKey ?? process.env.NOVADA_WEB_UNBLOCKER_KEY ?? process.env.NOVADA_API_KEY;
}
/** Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var. */
export function getBrowserWs() {
    return store.getStore()?.browserWs ?? process.env.NOVADA_BROWSER_WS;
}
/** Active proxy credentials: SDK-scoped > NOVADA_PROXY_* env vars. */
export function getProxyCredentials() {
    const scoped = store.getStore();
    const user = scoped?.proxyUser ?? process.env.NOVADA_PROXY_USER;
    const pass = scoped?.proxyPass ?? process.env.NOVADA_PROXY_PASS;
    const endpoint = scoped?.proxyEndpoint ?? process.env.NOVADA_PROXY_ENDPOINT;
    if (user && pass && endpoint)
        return { user, pass, endpoint };
    return null;
}
/**
 * Residential proxy credentials — separate from datacenter proxy.
 * Reads NOVADA_RESIDENTIAL_PROXY_USER / PASS / ENDPOINT env vars.
 * Falls back to standard proxy credentials if residential vars are not set.
 */
export function getResidentialProxyCredentials() {
    const user = process.env.NOVADA_RESIDENTIAL_PROXY_USER;
    const pass = process.env.NOVADA_RESIDENTIAL_PROXY_PASS;
    const endpoint = process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
    if (user && pass && endpoint)
        return { user, pass, endpoint };
    // Fall back to standard proxy credentials
    return getProxyCredentials();
}
// ─── Auto-fetch proxy credentials via management API ─────────────────────────
const MGMT_API_BASE = "https://api-m.novada.com/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let _credCache = null;
/**
 * Fetch the first active proxy sub-account using NOVADA_API_KEY as a Bearer token.
 * Calls POST /v1/proxy_account/list directly — no OAuth2 exchange required.
 * Result is cached 6h in memory.
 */
export async function fetchProxySubAccountCredentials(apiKey) {
    if (_credCache && Date.now() - _credCache.fetchedAt < CACHE_TTL_MS) {
        return { account: _credCache.account, password: _credCache.password };
    }
    try {
        const form = new URLSearchParams();
        form.append("product", "1"); // residential
        form.append("page", "1");
        form.append("limit", "5");
        form.append("status", "1"); // active only
        const res = await fetch(`${MGMT_API_BASE}/proxy_account/list`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        const accounts = data?.data?.list ?? [];
        if (accounts.length === 0)
            return null;
        const first = accounts[0];
        _credCache = { account: first.account, password: first.password, fetchedAt: Date.now() };
        return { account: first.account, password: first.password };
    }
    catch {
        return null;
    }
}
/**
 * Resolve proxy credentials with priority:
 * 1. Explicit env vars (NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT) — no API call.
 * 2. Auto-fetch via NOVADA_API_KEY Bearer token when only NOVADA_PROXY_ENDPOINT is set.
 *
 * NOVADA_PROXY_ENDPOINT is required in both cases.
 * Returns null if NOVADA_PROXY_ENDPOINT is not set (proxy tools disabled).
 */
export async function resolveProxyCredentials() {
    const direct = getProxyCredentials();
    if (direct)
        return direct;
    const endpoint = process.env.NOVADA_PROXY_ENDPOINT;
    if (!endpoint)
        return null;
    // NOVADA_PROXY_ENDPOINT is set but user/pass are missing — try auto-fetch
    const apiKey = process.env.NOVADA_API_KEY;
    if (!apiKey)
        return null;
    const fetched = await fetchProxySubAccountCredentials(apiKey);
    if (!fetched)
        return null;
    return { user: fetched.account, pass: fetched.password, endpoint };
}
//# sourceMappingURL=credentials.js.map