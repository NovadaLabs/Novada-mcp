/**
 * Request-scoped credentials store using Node.js AsyncLocalStorage.
 *
 * Solves the SDK multi-client issue: instead of mutating process.env (global state),
 * the SDK wraps each call in withCredentials(). Tool utilities read from this store
 * first, falling back to process.env for MCP server use (single-tenant).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export interface ToolCredentials {
  /** Caller's API key — used as fallback for webUnblockerKey, proxy auto-fetch, and browser auto-provision. */
  apiKey?: string;
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

/** Active web unblocker key: SDK-scoped webUnblockerKey > SDK-scoped apiKey > NOVADA_WEB_UNBLOCKER_KEY > NOVADA_API_KEY (unified). */
export function getWebUnblockerKey(): string | undefined {
  const ctx = store.getStore();
  return ctx?.webUnblockerKey ?? ctx?.apiKey ?? process.env.NOVADA_WEB_UNBLOCKER_KEY ?? process.env.NOVADA_API_KEY;
}

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

/**
 * Fingerprint an apiKey for use as a cache map key. SHA-256, first 16 hex chars.
 *
 * TENANT SAFETY: the auto-fetch caches are process-global and shared across every
 * caller on the hosted (multi-tenant) server. Keying each entry by this fingerprint
 * — and returning a cached value ONLY when the requesting key's fingerprint matches —
 * prevents caller A's fetched proxy/browser credentials from being served to caller B
 * within the 6h TTL. The raw key is never stored (only its hash), so the map key is
 * safe to log; the credential VALUES it maps to are still secrets and must not be logged.
 */
function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

interface FetchedProxyCreds {
  account: string;
  password: string;
  fetchedAt: number;
}

/** Per-key proxy sub-account cache, keyed by keyFingerprint(apiKey). */
const _credCache = new Map<string, FetchedProxyCreds>();

/**
 * Fetch the first active proxy sub-account using the caller's apiKey as a Bearer token.
 * Calls POST /v1/proxy_account/list directly — no OAuth2 exchange required.
 * Result is cached 6h in memory, keyed by the fingerprint of the fetching apiKey so
 * one caller's credentials are never returned to another (see keyFingerprint).
 */
export async function fetchProxySubAccountCredentials(
  apiKey: string
): Promise<{ account: string; password: string } | null> {
  const fp = keyFingerprint(apiKey);
  const cached = _credCache.get(fp);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { account: cached.account, password: cached.password };
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
    _credCache.set(fp, { account: first.account, password: first.password, fetchedAt: Date.now() });
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

/** Per-key Browser API WSS cache, keyed by keyFingerprint(apiKey). */
const _browserWsCache = new Map<string, FetchedBrowserCreds>();

const BROWSER_WS_HOST = "upg-scbr2.novada.com"; // confirmed from credentials file

/**
 * Fetch Browser API WSS endpoint using the caller's apiKey as a Bearer token.
 * Calls POST /v1/proxy_account/list with product=10 (Browser API).
 * Returns wss://{account}:{password}@upg-scbr2.novada.com
 * Cached 6h in memory, keyed by the fingerprint of the fetching apiKey so one
 * caller's browser WSS endpoint is never returned to another (see keyFingerprint).
 */
export async function fetchBrowserSubAccountCredentials(
  apiKey: string
): Promise<string | null> {
  const fp = keyFingerprint(apiKey);
  const cached = _browserWsCache.get(fp);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.wsUrl;
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
    _browserWsCache.set(fp, { wsUrl, fetchedAt: Date.now() });
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
 * 2. Auto-fetch via caller-supplied apiKey (or NOVADA_API_KEY) when only NOVADA_PROXY_ENDPOINT is set.
 *
 * NOVADA_PROXY_ENDPOINT is required in both cases.
 * Returns null if NOVADA_PROXY_ENDPOINT is not set (proxy tools disabled).
 *
 * @param apiKey - Caller's API key. Takes priority over NOVADA_API_KEY for the auto-fetch call.
 *   Pass the per-request key here so hosted-server requests are billed to the caller, not the server account.
 */
export async function resolveProxyCredentials(apiKey?: string): Promise<{ user: string; pass: string; endpoint: string } | null> {
  const direct = getProxyCredentials();
  if (direct) return direct;

  const endpoint = process.env.NOVADA_PROXY_ENDPOINT;
  if (!endpoint) return null;

  // NOVADA_PROXY_ENDPOINT is set but user/pass are missing — try auto-fetch.
  // Prefer the caller-supplied key; fall back to the server-level env var.
  const effectiveApiKey = apiKey ?? process.env.NOVADA_API_KEY;
  if (!effectiveApiKey) return null;

  const fetched = await fetchProxySubAccountCredentials(effectiveApiKey);
  if (!fetched) return null;

  return { user: fetched.account, pass: fetched.password, endpoint };
}

/**
 * Redact a secret string to a last-4 fingerprint for safe logging.
 * Example: "abc123xyz" → "****xyz"
 * Never logs the full value.
 */
export function redactSecret(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}
