/**
 * Request-scoped credentials store using Node.js AsyncLocalStorage.
 *
 * Solves the SDK multi-client issue: instead of mutating process.env (global state),
 * the SDK wraps each call in withCredentials(). Tool utilities read from this store
 * first, falling back to process.env for MCP server use (single-tenant).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ToolCredentials {
  webUnblockerKey?: string;
  browserWs?: string;
  proxyUser?: string;
  proxyPass?: string;
  proxyEndpoint?: string;
}

const store = new AsyncLocalStorage<ToolCredentials>();

/**
 * Run a function with specific credentials in scope.
 * Used by NovadaClient SDK to isolate credentials per-request.
 */
export function withCredentials<T>(creds: ToolCredentials, fn: () => T): T {
  return store.run(creds, fn);
}

/** Active web unblocker key: SDK-scoped > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified). */
export function getWebUnblockerKey(): string | undefined {
  return store.getStore()?.webUnblockerKey ?? process.env.NOVADA_WEB_UNBLOCKER_KEY ?? process.env.NOVADA_API_KEY;
}

/** Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var > auto-provisioned. */
export function getBrowserWs(): string | undefined {
  return store.getStore()?.browserWs ?? process.env.NOVADA_BROWSER_WS ?? _browserWsCache?.wsUrl;
}

/** Active proxy credentials: SDK-scoped > NOVADA_PROXY_* env vars. */
export function getProxyCredentials(): { user: string; pass: string; endpoint: string } | null {
  const scoped = store.getStore();
  const user = scoped?.proxyUser ?? process.env.NOVADA_PROXY_USER;
  const pass = scoped?.proxyPass ?? process.env.NOVADA_PROXY_PASS;
  const endpoint = scoped?.proxyEndpoint ?? process.env.NOVADA_PROXY_ENDPOINT;
  if (user && pass && endpoint) return { user, pass, endpoint };
  return null;
}

/**
 * Residential proxy credentials — separate from datacenter proxy.
 * Reads NOVADA_RESIDENTIAL_PROXY_USER / PASS / ENDPOINT env vars.
 * Falls back to standard proxy credentials if residential vars are not set.
 */
export function getResidentialProxyCredentials(): { user: string; pass: string; endpoint: string } | null {
  const user = process.env.NOVADA_RESIDENTIAL_PROXY_USER;
  const pass = process.env.NOVADA_RESIDENTIAL_PROXY_PASS;
  const endpoint = process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
  if (user && pass && endpoint) return { user, pass, endpoint };
  // Fall back to standard proxy credentials
  return getProxyCredentials();
}

// ─── Auto-fetch proxy credentials via management API ─────────────────────────

const MGMT_API_BASE = "https://api-m.novada.com/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface FetchedProxyCreds {
  account: string;
  password: string;
  fetchedAt: number;
}

let _credCache: FetchedProxyCreds | null = null;

/**
 * Fetch the first active proxy sub-account using NOVADA_API_KEY as a Bearer token.
 * Calls POST /v1/proxy_account/list directly — no OAuth2 exchange required.
 * Result is cached 6h in memory.
 */
export async function fetchProxySubAccountCredentials(
  apiKey: string
): Promise<{ account: string; password: string } | null> {
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: number;
      data?: { list?: Array<{ account: string; password: string }> };
    };
    const accounts = data?.data?.list ?? [];
    if (accounts.length === 0) return null;
    const first = accounts[0];
    _credCache = { account: first.account, password: first.password, fetchedAt: Date.now() };
    return { account: first.account, password: first.password };
  } catch {
    return null;
  }
}

// ─── Auto-fetch Browser API credentials via management API ──────────────────

interface FetchedBrowserCreds {
  wsUrl: string;
  fetchedAt: number;
}

let _browserWsCache: FetchedBrowserCreds | null = null;

const BROWSER_WS_HOST = "upg-scbr2.novada.com"; // confirmed from credentials file

/**
 * Fetch Browser API WSS endpoint using NOVADA_API_KEY as Bearer token.
 * Calls POST /v1/proxy_account/list with product=10 (Browser API).
 * Returns wss://{account}:{password}@upg-scbr2.novada.com
 * Cached 6h in memory.
 */
export async function fetchBrowserSubAccountCredentials(
  apiKey: string
): Promise<string | null> {
  if (_browserWsCache && Date.now() - _browserWsCache.fetchedAt < CACHE_TTL_MS) {
    return _browserWsCache.wsUrl;
  }

  try {
    const form = new URLSearchParams();
    form.append("product", "10"); // Browser API product code
    form.append("page", "1");
    form.append("limit", "5");
    form.append("status", "1");
    const res = await fetch(`${MGMT_API_BASE}/proxy_account/list`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: number;
      data?: { list?: Array<{ account: string; password: string }> };
    };
    const accounts = data?.data?.list ?? [];
    if (accounts.length === 0) return null;
    const { account, password } = accounts[0];
    const wsUrl = `wss://${account}:${password}@${BROWSER_WS_HOST}`;
    _browserWsCache = { wsUrl, fetchedAt: Date.now() };
    return wsUrl;
  } catch {
    return null;
  }
}

/**
 * Resolve Browser API WebSocket URL with priority:
 * 1. SDK-scoped browserWs
 * 2. NOVADA_BROWSER_WS env var
 * 3. Auto-fetch via NOVADA_API_KEY (product=10)
 */
export async function resolveBrowserWs(apiKey?: string): Promise<string | null> {
  const direct = getBrowserWs();
  if (direct) return direct;

  const key = apiKey ?? process.env.NOVADA_API_KEY;
  if (!key) return null;

  return fetchBrowserSubAccountCredentials(key);
}

/**
 * Resolve proxy credentials with priority:
 * 1. Explicit env vars (NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT) — no API call.
 * 2. Auto-fetch via NOVADA_API_KEY Bearer token when only NOVADA_PROXY_ENDPOINT is set.
 *
 * NOVADA_PROXY_ENDPOINT is required in both cases.
 * Returns null if NOVADA_PROXY_ENDPOINT is not set (proxy tools disabled).
 */
export async function resolveProxyCredentials(): Promise<{ user: string; pass: string; endpoint: string } | null> {
  const direct = getProxyCredentials();
  if (direct) return direct;

  const endpoint = process.env.NOVADA_PROXY_ENDPOINT;
  if (!endpoint) return null;

  // NOVADA_PROXY_ENDPOINT is set but user/pass are missing — try auto-fetch
  const apiKey = process.env.NOVADA_API_KEY;
  if (!apiKey) return null;

  const fetched = await fetchProxySubAccountCredentials(apiKey);
  if (!fetched) return null;

  return { user: fetched.account, pass: fetched.password, endpoint };
}
