import { NovadaErrorCode, makeNovadaError } from "./errors.js";

// ─── API Key ──────────────────────────────────────────────────────────────────

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
export function getApiKey(): string {
  const key = process.env.NOVADA_API_KEY;
  if (!key || key.trim() === "") {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_API_KEY,
      "NOVADA_API_KEY environment variable is not set.",
    );
  }
  return key.trim();
}

// ─── Proxy Credentials ────────────────────────────────────────────────────────

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
export function getProxyCredentials(): ProxyCredentials | null {
  const user = process.env.NOVADA_PROXY_USER?.trim();
  const pass = process.env.NOVADA_PROXY_PASS?.trim();
  const endpoint = process.env.NOVADA_PROXY_ENDPOINT?.trim();

  if (user && pass && endpoint) {
    return { user, pass, endpoint };
  }
  return null;
}

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
export function buildProxyUrl(
  creds: ProxyCredentials,
  sessionId?: string,
  country?: string,
): string {
  let user = creds.user;
  if (country) user += `-country-${country}`;
  if (sessionId) user += `-session-${sessionId}`;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(creds.pass)}@${creds.endpoint}`;
}

// ─── Browser WebSocket URL ────────────────────────────────────────────────────

/**
 * Returns the Browser API WebSocket endpoint URL.
 * Returns undefined if NOVADA_BROWSER_WS is not set (non-throwing).
 * Tools that require browser access should check for undefined and
 * surface a "not configured" status.
 */
export function getBrowserWsUrl(): string | undefined {
  return process.env.NOVADA_BROWSER_WS?.trim() || undefined;
}

// ─── Web Unblocker Key ────────────────────────────────────────────────────────

/**
 * Returns the Web Unblocker API key.
 * Returns undefined if NOVADA_WEB_UNBLOCKER_KEY is not set (non-throwing).
 */
export function getWebUnblockerKey(): string | undefined {
  return process.env.NOVADA_WEB_UNBLOCKER_KEY?.trim() || undefined;
}

// ─── Auth Token Support ───────────────────────────────────────────────────────

export interface AuthCredentials {
  username: string;
  password: string;
}

/**
 * Returns OAuth2 username/password credentials for token exchange.
 * Reads NOVADA_AUTH_USER and NOVADA_AUTH_PASS env vars.
 * Returns null if either is missing.
 */
export function getAuthCredentials(): AuthCredentials | null {
  const username = process.env.NOVADA_AUTH_USER?.trim();
  const password = process.env.NOVADA_AUTH_PASS?.trim();
  if (username && password) return { username, password };
  return null;
}
