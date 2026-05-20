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

/** Active web unblocker key: SDK-scoped > NOVADA_WEB_UNBLOCKER_KEY env var. */
export function getWebUnblockerKey(): string | undefined {
  return store.getStore()?.webUnblockerKey ?? process.env.NOVADA_WEB_UNBLOCKER_KEY;
}

/** Active browser WebSocket endpoint: SDK-scoped > NOVADA_BROWSER_WS env var. */
export function getBrowserWs(): string | undefined {
  return store.getStore()?.browserWs ?? process.env.NOVADA_BROWSER_WS;
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
 * Fetch proxy sub-account credentials from the Novada management API.
 * Requires NOVADA_USERNAME + NOVADA_API_KEY. Cached 6h in memory.
 *
 * Auth flow:
 *   POST /oauth2/token  (Basic username:apiKey)  → access_token
 *   POST /proxy_account/list  (Bearer token)      → account + password
 */
export async function fetchProxyCredentials(
  apiKey: string,
  username: string
): Promise<{ account: string; password: string }> {
  if (_credCache && Date.now() - _credCache.fetchedAt < CACHE_TTL_MS) {
    return { account: _credCache.account, password: _credCache.password };
  }

  const basicToken = Buffer.from(`${username}:${apiKey}`).toString("base64");
  const tokenRes = await fetch(`${MGMT_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basicToken}` },
  });
  if (!tokenRes.ok) {
    throw new Error(`Management API auth failed: HTTP ${tokenRes.status} — check NOVADA_USERNAME and NOVADA_API_KEY`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error("Management API returned no access_token — check NOVADA_USERNAME and NOVADA_API_KEY");
  }

  const formData = new FormData();
  formData.append("product", "1");
  formData.append("page", "1");
  formData.append("limit", "1");
  formData.append("status", "1");
  const listRes = await fetch(`${MGMT_API_BASE}/proxy_account/list`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    body: formData,
  });
  if (!listRes.ok) {
    throw new Error(`Management API proxy_account/list failed: HTTP ${listRes.status}`);
  }
  const listData = (await listRes.json()) as {
    code?: number;
    data?: { list?: Array<{ account: string; password: string }> };
  };
  if (listData.code !== 0) {
    throw new Error(`Management API returned error code ${listData.code} — verify account has proxy access`);
  }
  const first = listData.data?.list?.[0];
  if (!first) {
    throw new Error("No proxy sub-accounts found — create one at https://dashboard.novada.com → Residential Proxies");
  }

  _credCache = { account: first.account, password: first.password, fetchedAt: Date.now() };
  return { account: first.account, password: first.password };
}

/**
 * Resolve proxy credentials with priority:
 * 1. Explicit env vars (NOVADA_PROXY_USER / PASS / ENDPOINT) — no API call.
 * 2. Auto-fetch via NOVADA_USERNAME + NOVADA_API_KEY from management API, cached 6h.
 *
 * NOVADA_PROXY_ENDPOINT is required in both cases.
 */
export async function resolveProxyCredentials(): Promise<{ user: string; pass: string; endpoint: string }> {
  const direct = getProxyCredentials();
  if (direct) return direct;

  const apiKey = process.env.NOVADA_API_KEY;
  const username = process.env.NOVADA_USERNAME;
  if (!apiKey) {
    throw new Error(
      "Proxy credentials not configured. Set NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT, " +
      "or set NOVADA_API_KEY + NOVADA_USERNAME + NOVADA_PROXY_ENDPOINT for automatic credential fetch."
    );
  }
  if (!username) {
    throw new Error(
      "NOVADA_USERNAME is required for automatic proxy credential fetch. " +
      "Set it to your Novada account username, or manually set NOVADA_PROXY_USER + NOVADA_PROXY_PASS + NOVADA_PROXY_ENDPOINT."
    );
  }

  const fetched = await fetchProxyCredentials(apiKey, username);
  const endpoint = process.env.NOVADA_PROXY_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      `Auto-fetched proxy credentials (account: ${fetched.account}) but NOVADA_PROXY_ENDPOINT is not set. ` +
      "Find it at https://dashboard.novada.com → Residential Proxies → Endpoint Generator."
    );
  }
  return { user: fetched.account, pass: fetched.password, endpoint };
}
