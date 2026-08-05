/**
 * OAuth 2.0 authorization server for the hosted Novada MCP endpoint
 * (Firecrawl-parity keyless auth). Implements:
 *   RFC 8414 — Authorization Server Metadata (/.well-known/oauth-authorization-server)
 *   RFC 9728 — Protected Resource Metadata   (/.well-known/oauth-protected-resource)
 *   RFC 7591 — Dynamic Client Registration   (POST /register — public clients only)
 *   RFC 6749 — Authorization Code grant       (GET|POST /authorize, POST /token)
 *   RFC 7636 — PKCE, S256 only (plain and absent method are rejected)
 *   RFC 8707 — the `resource` request parameter is accepted and bound into the
 *              code record (RFC 8414 defines no AS-metadata flag for it).
 *
 * ZERO module dependencies by design (not even @vercel/kv): every side effect
 * is injected through OAuthDeps (mirrors ./_plan.ts PlanDeps) so the whole
 * module is unit-testable side-effect-free under `node --test` — see
 * test/oauth.test.mjs. WebCrypto (globalThis.crypto), atob/btoa, URL and
 * Request/Response are all globals on Node ≥18 and the Vercel Node runtime.
 * mcp.ts wires the real deps via buildOAuthDeps(env).
 *
 * Token model: opaque 32 random bytes → base64url (43 chars) with prefixes
 *   nvo_ac_  authorization code — 120 s, single-use (atomic kvGetDel)
 *   nvo_at_  access token       — 1 h
 *   nvo_rt_  refresh token      — 30 d, rotated (invalidated) on every use
 *
 * Storage (values are JSON objects; plaintext tokens/keys are NEVER KV keys —
 * sha256-hex only, same rule as mcp.ts tokenKvHash):
 *   oauthclient:<client_id>        registered client            TTL 180 d
 *   oauthcode:<sha256(code)>       code + encrypted caller key  TTL 120 s
 *   oauthat:<sha256(at)>           access-token record          TTL 3600 s
 *   oauthrt:<sha256(rt)>           refresh-token record         TTL 30 d
 *   rl:oauth:<ip>:<minuteBucket>   per-IP rate-limit counter    TTL 120 s
 * Expiry = KV TTL only: a kvGet miss means expired/unknown — one error path.
 *
 * The caller's Novada API key is AES-256-GCM encrypted at rest (env
 * OAUTH_ENC_KEY, injected as deps.encKeyB64) with a FRESH random 12-byte IV
 * per record — enc objects are never copied between records; minting/rotating
 * always decrypts then re-encrypts.
 *
 * Security invariant: NEVER log a plaintext token, API key, or PKCE verifier —
 * only sha256-prefix fingerprints (first 12 hex chars), same rule as mcp.ts.
 */

// ─── DI interface ─────────────────────────────────────────────────────────────

export interface OAuthVerifyResult { valid: boolean; verified: boolean }

export interface OAuthDeps {
  kvGet(key: string): Promise<unknown>;
  kvSet(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
  /** Atomic read+delete — single-use codes and RT rotation. mcp.ts wires kv.getdel. */
  kvGetDel(key: string): Promise<unknown>;
  kvIncr(key: string): Promise<number>;
  kvExpire(key: string, seconds: number): Promise<unknown>;
  /** Wallet-probe key verification — mcp.ts wires validateToken(key, env).
   *  Same availability semantics as /mcp auth: {valid:true, verified:false} on
   *  upstream flake is ACCEPTED (format-only fallback), exactly like the
   *  raw-key path. Only `valid` gates the consent decision. */
  verifyKey(apiKey: string): Promise<OAuthVerifyResult>;
  /** Raw base64 (std) of the 32-byte AES-256-GCM key — env OAUTH_ENC_KEY. */
  encKeyB64: string | undefined;
  /** env OAUTH_ISSUER — overrides host-derived issuer when set. */
  issuerOverride?: string;
  now?(): number;
  /** Injectable randomness for deterministic tests. Default: crypto.getRandomValues. */
  randomBytes?(n: number): Uint8Array;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Authorization codes — single-use, must be redeemed within this window. */
const CODE_TTL_S = 120;
/** Access tokens — short-lived; refresh via grant_type=refresh_token. */
const AT_TTL_S = 3600;
/** Refresh tokens — rotated (old one invalidated) on every use. */
const RT_TTL_S = 60 * 60 * 24 * 30;
/** Registered clients — DCR records expire after 180 days of KV retention. */
const CLIENT_TTL_S = 60 * 60 * 24 * 180;

/** Rate-limit bucket TTL — mirrors the rl: pattern in mcp.ts (2 min GC headroom). */
const RL_BUCKET_TTL_S = 120;
/** POST /register — unauthenticated KV writes, keep the flood ceiling low. */
const REGISTER_RATE_LIMIT_PER_MIN = 10;
/** POST /authorize + POST /token — brute-force guard on key pasting / redemption. */
const GRANT_RATE_LIMIT_PER_MIN = 20;

const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME_CHARS = 100;
/** Defensive ceiling on client_id lookups — UUIDs are 36 chars; anything huge
 *  is garbage and must not become an oversized KV key. */
const MAX_CLIENT_ID_CHARS = 128;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** RFC 7636 §4.2: code_challenge = BASE64URL(SHA-256(ASCII(code_verifier))). */
export async function computeS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64urlEncode(new Uint8Array(digest));
}

/** Short stable identifier for a secret, safe to log (SHA-256 first 12 hex chars). */
async function fingerprint(secret: string): Promise<string> {
  return (await sha256Hex(secret)).slice(0, 12);
}

export function mintToken(
  prefix: "nvo_ac_" | "nvo_at_" | "nvo_rt_",
  randomBytes: (n: number) => Uint8Array,
): string {
  return prefix + b64urlEncode(randomBytes(32));
}

/**
 * Redirect-URI policy (Firecrawl parity): HTTPS on any host, or plain HTTP
 * strictly on localhost / 127.0.0.1 loopback. Fragments are forbidden
 * (RFC 6749 §3.1.2). Custom schemes (cursor://, myapp://) and javascript: are
 * rejected. Exact-match against the registration happens at authorize time.
 */
export function validateRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash !== "") return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  return false;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Derive the issuer origin from the request host. localhost / 127.0.0.1 get
 * http:// — REQUIRED because nodeReqToWebReq in mcp.ts hardcodes https:// (the
 * original scheme is lost), so local-harness metadata would otherwise
 * advertise https://localhost:4747 and break `npx mcp-remote`. An explicit
 * OAUTH_ISSUER override wins over host derivation.
 */
export function deriveIssuer(host: string, override?: string): string {
  if (override) return override;
  const hostname = host.split(":")[0].toLowerCase();
  const scheme = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";
  return `${scheme}://${host}`;
}

// ─── AES-256-GCM at-rest encryption of the caller's API key ──────────────────

/** Copy into a fresh, non-shared ArrayBuffer-backed view — WebCrypto's
 *  BufferSource rejects ArrayBufferLike-typed views (an injected randomBytes
 *  may be typed over SharedArrayBuffer). Buffers here are ≤64 bytes. */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

/** Decode a standard-base64 32-byte key (openssl rand -base64 32) into a CryptoKey. */
export async function importEncKey(b64: string): Promise<CryptoKey> {
  const bin = atob(b64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  // Enforce AES-256: a shorter key would silently downgrade to AES-128/192.
  // loadEncKey catches this throw and fails closed to the server_error path.
  if (raw.length !== 32) throw new Error("OAUTH_ENC_KEY must decode to exactly 32 bytes (AES-256)");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt with a FRESH random 12-byte IV per call — never reuse an IV or copy
 *  an {iv, ct} pair between records. Fields are base64url strings. */
export async function encryptApiKey(
  plaintext: string,
  key: CryptoKey,
  randomBytes: (n: number) => Uint8Array,
): Promise<{ iv: string; ct: string }> {
  const iv = toBufferSource(randomBytes(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ct)) };
}

/** Returns null on any failure (tampered ciphertext, wrong key, malformed
 *  fields) — callers turn that into 400 invalid_grant, never a 500 oracle. */
export async function decryptApiKey(
  rec: { iv: string; ct: string },
  key: CryptoKey,
): Promise<string | null> {
  try {
    const iv = toBufferSource(b64urlDecode(rec.iv));
    const ct = toBufferSource(b64urlDecode(rec.ct));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Import deps.encKeyB64, or null when absent/malformed — the caller fails
 *  closed with the operator-facing server_error response. */
async function loadEncKey(deps: OAuthDeps): Promise<CryptoKey | null> {
  if (!deps.encKeyB64) return null;
  try {
    return await importEncKey(deps.encKeyB64);
  } catch {
    return null;
  }
}

// ─── Metadata builders (RFC 8414 / RFC 9728) ─────────────────────────────────

/**
 * RFC 8414 Authorization Server Metadata. RFC 8707 note: the `resource`
 * request parameter is ACCEPTED on /authorize and bound into the code record,
 * but RFC 8414 defines no AS-metadata flag to advertise resource-indicator
 * support, so none is emitted here.
 */
export function buildAsMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["novada"],
  };
}

/**
 * RFC 9728 Protected Resource Metadata. The MCP endpoint at <issuer>/mcp IS
 * the protected resource — both discovery paths (bare and /mcp suffixed) must
 * agree on it, so the router always passes resourcePath "/mcp".
 */
export function buildPrMetadata(issuer: string, resourcePath: "/mcp" | ""): Record<string, unknown> {
  return {
    resource: `${issuer}${resourcePath}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["novada"],
    resource_documentation: "https://novada.com/products/novada-mcp/",
  };
}

// ─── Consent page (Option A: user pastes their own Novada API key) ───────────

/**
 * Full inline-HTML consent page — the first (and only) text/html surface on
 * this endpoint. EVERY interpolation goes through escapeHtml; the page carries
 * no script and is served with a default-src 'none' CSP plus
 * X-Frame-Options DENY (clickjacking).
 */
export function renderConsentPage(p: {
  clientName: string; redirectUri: string; clientId: string; codeChallenge: string;
  codeChallengeMethod: string; state?: string; resource?: string; scope?: string;
  errorMessage?: string;
}): string {
  const name = escapeHtml(p.clientName);
  let redirectHost: string;
  try {
    redirectHost = escapeHtml(new URL(p.redirectUri).host);
  } catch {
    redirectHost = escapeHtml(p.redirectUri);
  }
  const hidden = (n: string, v: string): string =>
    `<input type="hidden" name="${escapeHtml(n)}" value="${escapeHtml(v)}">`;
  const hiddenFields = [
    hidden("client_id", p.clientId),
    hidden("redirect_uri", p.redirectUri),
    hidden("code_challenge", p.codeChallenge),
    hidden("code_challenge_method", p.codeChallengeMethod),
    ...(p.state ? [hidden("state", p.state)] : []),
    ...(p.resource ? [hidden("resource", p.resource)] : []),
    ...(p.scope ? [hidden("scope", p.scope)] : []),
  ].join("\n      ");
  const errorBlock = p.errorMessage
    ? `<p class="error">${escapeHtml(p.errorMessage)}</p>\n      `
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${name} — Novada MCP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #f5f6f8; color: #1a1d21; margin: 0; padding: 2rem 1rem; }
    main { max-width: 26rem; margin: 0 auto; background: #fff; border: 1px solid #e2e5e9;
           border-radius: 8px; padding: 1.5rem; }
    h1 { font-size: 1.15rem; margin: 0 0 0.75rem; }
    p { font-size: 0.9rem; line-height: 1.5; }
    label { display: block; font-size: 0.85rem; font-weight: 600; margin: 1rem 0 0.25rem; }
    input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.5rem;
           border: 1px solid #c9ced4; border-radius: 6px; font-size: 0.9rem; }
    button { margin-top: 1rem; width: 100%; padding: 0.6rem; border: 0; border-radius: 6px;
           background: #1a1d21; color: #fff; font-size: 0.9rem; cursor: pointer; }
    .error { background: #fdecec; border: 1px solid #f5b5b5; border-radius: 6px;
           padding: 0.5rem 0.75rem; color: #8f1f1f; }
    .hint { color: #5c6570; font-size: 0.8rem; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize access</h1>
    ${errorBlock}<p><strong>${name}</strong> wants to access Novada MCP on your behalf. Calls will be billed to YOUR Novada account balance. You will be redirected to <strong>${redirectHost}</strong>.</p>
    <form method="POST" action="/authorize">
      <label for="api_key">Your Novada API key</label>
      <input type="password" id="api_key" name="api_key" autocomplete="off" required>
      ${hiddenFields}
      <button type="submit">Authorize</button>
    </form>
    <p class="hint">Get a key at <a href="https://novada.com">https://novada.com</a></p>
  </main>
</body>
</html>
`;
}

/** Minimal HTML error page for /authorize failures that must NEVER redirect
 *  (unknown client, unregistered redirect_uri — open-redirect protection). */
function renderErrorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Novada MCP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #f5f6f8; color: #1a1d21; margin: 0; padding: 2rem 1rem; }
    main { max-width: 26rem; margin: 0 auto; background: #fff; border: 1px solid #e2e5e9;
           border-radius: 8px; padding: 1.5rem; }
    h1 { font-size: 1.15rem; margin: 0 0 0.75rem; }
    p { font-size: 0.9rem; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </main>
</body>
</html>
`;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

/** Security headers for every text/html response (consent page + error pages).
 *  content-security-policy here is the DEFAULT (form-action 'self' only) —
 *  the authorize consent page overrides it per-response via buildAuthorizeCsp
 *  once its redirect_uri is validated (see htmlResponse's cspOverride param). */
const HTML_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

/**
 * form-action CSP for the authorize consent page's <form>. Browsers enforce
 * form-action against the WHOLE navigation resulting from a form submission,
 * including any redirect that follows — not just the (same-origin,
 * action="/authorize") submission target. Plain 'self' therefore silently
 * blocks the 302 this flow eventually issues back to the client's
 * cross-origin redirect_uri, so clicking "Authorize" appears to do nothing in
 * Safari/Chrome (P0, 2026-08 — affects every DCR client: claude.ai, Cursor,
 * etc). Widen form-action to the redirect_uri's origin ONLY when
 * validatedRedirectUri is passed in — callers MUST NOT call this with a
 * redirect_uri that has not already passed the registered-client exact-match
 * check (handleAuthorizeGet steps 1-2, and handleAuthorizePost's re-run of the
 * same checks); doing so would let this header itself green-light an
 * attacker-chosen redirect target.
 */
export function buildAuthorizeCsp(validatedRedirectUri: string): string {
  let formAction = "'self'";
  try {
    formAction = `'self' ${new URL(validatedRedirectUri).origin}`;
  } catch {
    // Malformed input: keep plain 'self'. Unreachable via the public
    // handlers today (redirect_uri is URL-parsed by validateRedirectUri at
    // registration and exact-string-matched again at authorize time), but
    // this function fails safe rather than throwing if that ever changes.
  }
  return `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'`;
}

function htmlResponse(status: number, html: string, cspOverride?: string): Response {
  return new Response(html, {
    status,
    headers: {
      ...HTML_HEADERS,
      ...(cspOverride ? { "content-security-policy": cspOverride } : {}),
    },
  });
}

/** Every JSON response (metadata included) carries CORS * + no-store. */
function oauthJson(status: number, body: Record<string, unknown>, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/** Token-endpoint responses additionally carry pragma: no-cache (RFC 6749 §5.1). */
function tokenJson(status: number, body: Record<string, unknown>): Response {
  return oauthJson(status, body, { pragma: "no-cache" });
}

function methodNotAllowed(allow: string): Response {
  return oauthJson(405, {
    error: "invalid_request",
    error_description: "Method not allowed on this endpoint.",
    agent_instruction: "Use one of the methods listed in the `allow` response header.",
  }, { allow });
}

function rateLimitedResponse(limit: number): Response {
  return oauthJson(429, {
    error: "rate_limited",
    error_description: `Too many OAuth requests from your IP — the limit is ${limit}/minute.`,
    agent_instruction: "Wait 60 seconds and retry — OAuth endpoints are rate-limited per IP.",
  });
}

/** Grant endpoints fail closed when the at-rest encryption key is absent or
 *  malformed — metadata discovery keeps working (pure functions, no config). */
function encKeyMissingResponse(): Response {
  return oauthJson(500, {
    error: "server_error",
    error_description: "OAuth is not configured on this deployment (OAUTH_ENC_KEY missing).",
    agent_instruction: "Operator: set OAUTH_ENC_KEY (base64, 32 bytes) in Vercel env and redeploy. Callers: use a raw Novada API key as Bearer instead.",
  });
}

/** 302 back to a VALIDATED redirect_uri with error(+description) and the
 *  caller's state echoed verbatim. Only reachable AFTER client_id and
 *  redirect_uri passed registration checks — never for unvalidated targets. */
function redirectError(redirectUri: string, error: string, description: string | undefined, state: string | undefined): Response {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { location: u.toString(), "cache-control": "no-store" },
  });
}

// ─── Rate limiting (mirrors the rl: pattern in mcp.ts) ───────────────────────

async function oauthRateLimited(deps: OAuthDeps, ip: string, limit: number): Promise<boolean> {
  if (!ip || ip === "unknown") return false;
  const nowMs = deps.now?.() ?? Date.now();
  const bucket = Math.floor(nowMs / 60_000);
  const key = `rl:oauth:${ip}:${bucket}`;
  // Atomic increment — read-modify-write would let concurrent requests in the
  // same minute bucket each read a stale count and all slip past the limit.
  const count = await deps.kvIncr(key);
  if (count === 1) await deps.kvExpire(key, RL_BUCKET_TTL_S);
  return count > limit;
}

// ─── KV record parsing (KV returns unknown — validate shape, never trust) ────

interface ClientRecord {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  created_at: number;
}

function parseClientRecord(raw: unknown): ClientRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.client_id !== "string" || !Array.isArray(r.redirect_uris)) return null;
  if (!r.redirect_uris.every((u) => typeof u === "string")) return null;
  return {
    client_id: r.client_id,
    client_name: typeof r.client_name === "string" ? r.client_name : "",
    redirect_uris: r.redirect_uris as string[],
    token_endpoint_auth_method: "none",
    created_at: typeof r.created_at === "number" ? r.created_at : 0,
  };
}

interface EncRecord { iv: string; ct: string }

function parseEnc(raw: unknown): EncRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.iv !== "string" || typeof r.ct !== "string") return null;
  return { iv: r.iv, ct: r.ct };
}

interface CodeRecord {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource?: string;
  scope?: string;
  enc: EncRecord;
  created_at: number;
}

function parseCodeRecord(raw: unknown): CodeRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const enc = parseEnc(r.enc);
  if (typeof r.client_id !== "string" || typeof r.redirect_uri !== "string"
    || typeof r.code_challenge !== "string" || !enc) return null;
  return {
    client_id: r.client_id,
    redirect_uri: r.redirect_uri,
    code_challenge: r.code_challenge,
    resource: typeof r.resource === "string" ? r.resource : undefined,
    scope: typeof r.scope === "string" ? r.scope : undefined,
    enc,
    created_at: typeof r.created_at === "number" ? r.created_at : 0,
  };
}

interface TokenRecord {
  client_id: string;
  enc: EncRecord;
  created_at: number;
}

function parseTokenRecord(raw: unknown): TokenRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const enc = parseEnc(r.enc);
  if (typeof r.client_id !== "string" || !enc) return null;
  return {
    client_id: r.client_id,
    enc,
    created_at: typeof r.created_at === "number" ? r.created_at : 0,
  };
}

/** Look up a registered client — null on absent/oversized id or malformed record. */
async function lookupClient(clientId: string, deps: OAuthDeps): Promise<ClientRecord | null> {
  if (!clientId || clientId.length > MAX_CLIENT_ID_CHARS) return null;
  return parseClientRecord(await deps.kvGet(`oauthclient:${clientId}`));
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function isOAuthPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-authorization-server/mcp" ||
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp" ||
    pathname === "/register" ||
    pathname === "/authorize" ||
    pathname === "/token"
  );
}

/**
 * Dispatch an OAuth-path request. Metadata GETs are pure functions and work
 * WITHOUT KV or OAUTH_ENC_KEY; the grant endpoints (/register, /authorize,
 * /token) fail closed with server_error when OAUTH_ENC_KEY is missing.
 * Claude.ai's browser sends CORS preflights to /register and /token, so
 * OPTIONS short-circuits first (mirrors the /mcp preflight in mcp.ts).
 */
export async function handleOAuthRequest(request: Request, url: URL, ip: string, deps: OAuthDeps): Promise<Response> {
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
        "access-control-max-age": "86400",
      },
    });
  }

  const issuer = deriveIssuer(url.host, deps.issuerOverride);

  if (
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-authorization-server/mcp"
  ) {
    if (method !== "GET") return methodNotAllowed("GET, OPTIONS");
    return oauthJson(200, buildAsMetadata(issuer));
  }
  if (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp"
  ) {
    if (method !== "GET") return methodNotAllowed("GET, OPTIONS");
    // Both discovery paths advertise the SAME resource: <issuer>/mcp IS the
    // protected resource (the bare path is an alias, not a different resource).
    return oauthJson(200, buildPrMetadata(issuer, "/mcp"));
  }

  // Grant endpoints below all persist or read encrypted caller keys — without
  // the encryption key the whole flow is unusable, so fail closed up front.
  if (!deps.encKeyB64) return encKeyMissingResponse();

  if (pathname === "/register") {
    if (method !== "POST") return methodNotAllowed("POST, OPTIONS");
    if (await oauthRateLimited(deps, ip, REGISTER_RATE_LIMIT_PER_MIN)) {
      return rateLimitedResponse(REGISTER_RATE_LIMIT_PER_MIN);
    }
    return handleRegister(request, deps);
  }
  if (pathname === "/authorize") {
    if (method === "GET") return handleAuthorizeGet(url, deps);
    if (method === "POST") return handleAuthorizePost(request, ip, deps);
    return methodNotAllowed("GET, POST, OPTIONS");
  }
  if (pathname === "/token") {
    if (method !== "POST") return methodNotAllowed("POST, OPTIONS");
    return handleToken(request, ip, deps);
  }

  // Unreachable while isOAuthPath gates entry — defensive completeness.
  return oauthJson(404, {
    error: "invalid_request",
    error_description: "Unknown OAuth path.",
    agent_instruction: "Discover the endpoints at /.well-known/oauth-authorization-server.",
  });
}

// ─── POST /register — RFC 7591 Dynamic Client Registration ───────────────────

/**
 * Public clients only (token_endpoint_auth_method "none", PKCE-protected).
 * No client_secret is ever minted. Flood posture: 10/min/IP rate limit
 * (enforced by the router, which owns the IP), ≤10 redirect_uris, 100-char
 * client_name, 180-day KV TTL.
 */
export async function handleRegister(request: Request, deps: OAuthDeps): Promise<Response> {
  const nowMs = deps.now?.() ?? Date.now();

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return oauthJson(400, {
      error: "invalid_client_metadata",
      error_description: "Request body must be a JSON object.",
      agent_instruction: "POST a JSON body like {\"client_name\":\"My App\",\"redirect_uris\":[\"https://example.com/callback\"]}.",
    });
  }
  const meta = body as Record<string, unknown>;

  const redirectUris = meta.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return oauthJson(400, {
      error: "invalid_redirect_uri",
      error_description: `redirect_uris must be a non-empty array of at most ${MAX_REDIRECT_URIS} URIs.`,
      agent_instruction: "Provide 1-10 redirect URIs — HTTPS, or http://localhost / http://127.0.0.1 loopback.",
    });
  }
  for (const uri of redirectUris) {
    // 2048-char cap closes a KV-storage flood vector — registrations persist
    // for 180 days, so unbounded URIs would let one client bloat storage.
    if (typeof uri !== "string" || uri.length > 2048 || !validateRedirectUri(uri)) {
      return oauthJson(400, {
        error: "invalid_redirect_uri",
        error_description: `${String(uri)}: redirect URIs must be HTTPS, or http://localhost / http://127.0.0.1 loopback, and at most 2048 characters`,
        agent_instruction: "Register HTTPS redirect URIs only (any host), or plain HTTP strictly on localhost / 127.0.0.1 for local development. Custom schemes are not accepted.",
      });
    }
  }

  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== "none") {
    return oauthJson(400, {
      error: "invalid_client_metadata",
      error_description: "only public clients are supported",
      agent_instruction: "Omit token_endpoint_auth_method or set it to \"none\" — this server issues no client_secret; PKCE (S256) protects the code exchange.",
    });
  }

  const allowedGrants = new Set(["authorization_code", "refresh_token"]);
  if (meta.grant_types !== undefined) {
    if (!Array.isArray(meta.grant_types) || !meta.grant_types.every((g) => typeof g === "string" && allowedGrants.has(g))) {
      return oauthJson(400, {
        error: "invalid_client_metadata",
        error_description: "grant_types may only contain authorization_code and refresh_token.",
        agent_instruction: "Register with grant_types [\"authorization_code\",\"refresh_token\"] or omit the field.",
      });
    }
  }
  if (meta.response_types !== undefined) {
    if (!Array.isArray(meta.response_types) || !meta.response_types.every((r) => r === "code")) {
      return oauthJson(400, {
        error: "invalid_client_metadata",
        error_description: "response_types may only contain code.",
        agent_instruction: "Register with response_types [\"code\"] or omit the field.",
      });
    }
  }

  if (meta.client_name !== undefined && typeof meta.client_name !== "string") {
    return oauthJson(400, {
      error: "invalid_client_metadata",
      error_description: "client_name must be a string.",
      agent_instruction: "Pass client_name as a plain string (max 100 characters) or omit it.",
    });
  }
  const clientName = typeof meta.client_name === "string"
    ? meta.client_name.slice(0, MAX_CLIENT_NAME_CHARS)
    : "";

  const clientId = crypto.randomUUID();
  const record: ClientRecord = {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris as string[],
    token_endpoint_auth_method: "none",
    created_at: nowMs,
  };
  await deps.kvSet(`oauthclient:${clientId}`, record, { ex: CLIENT_TTL_S });

  console.log(JSON.stringify({ evt: "oauth_client_registered", clientId, redirectUriCount: redirectUris.length }));

  return oauthJson(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(nowMs / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}

// ─── GET /authorize — validation + consent page ──────────────────────────────

/**
 * Validation ORDER is load-bearing (open-redirect protection): until BOTH the
 * client_id is registered AND the redirect_uri exactly matches a registered
 * entry, errors return a 400 HTML page and NEVER redirect. Only after both
 * pass may errors 302 back to the (now-trusted) redirect_uri.
 */
export async function handleAuthorizeGet(url: URL, deps: OAuthDeps): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const state = q.get("state") || undefined;

  // 1. client_id must reference a registered client — else 400 HTML, no redirect.
  const client = await lookupClient(clientId, deps);
  if (!client) {
    return htmlResponse(400, renderErrorPage(
      "Unknown client",
      "The client_id is missing or not registered. Register the client first via dynamic client registration (POST /register), then restart the authorization flow.",
    ));
  }

  // 2. redirect_uri must EXACTLY match a registered entry — else 400 HTML.
  //    Exact string equality: prefix/suffix variants of a registered URI are
  //    attacker-controlled destinations and must not receive a redirect.
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return htmlResponse(400, renderErrorPage(
      "Invalid redirect URI",
      "The redirect_uri does not exactly match any URI registered for this client. Update the client registration or fix the authorization request.",
    ));
  }

  // 3. redirect_uri is now trusted — remaining errors 302 back with state verbatim.
  if (q.get("response_type") !== "code") {
    return redirectError(redirectUri, "unsupported_response_type", undefined, state);
  }
  const codeChallenge = q.get("code_challenge") ?? "";
  if (!codeChallenge) {
    return redirectError(redirectUri, "invalid_request", "code_challenge required", state);
  }
  // PKCE is mandatory and S256-only: an absent method is rejected the same as
  // "plain" (mcp-remote and every Firecrawl-parity client always send it).
  if (q.get("code_challenge_method") !== "S256") {
    return redirectError(redirectUri, "invalid_request", "only S256 supported", state);
  }

  // 4. Happy path — render the consent page (Option A: user pastes their key).
  // redirectUri is validated above (step 2: exact match against the client's
  // registered redirect_uris) — safe to widen form-action to its origin so
  // the browser follows the eventual cross-origin 302 (see buildAuthorizeCsp).
  return htmlResponse(200, renderConsentPage({
    clientName: client.client_name || "An MCP client",
    redirectUri,
    clientId,
    codeChallenge,
    codeChallengeMethod: "S256",
    state,
    resource: q.get("resource") || undefined,
    scope: q.get("scope") || undefined,
  }), buildAuthorizeCsp(redirectUri));
}

// ─── POST /authorize — verify key, mint the authorization code ───────────────

/**
 * CSRF decision: NO separate CSRF form token, deliberately. The consent POST
 * carries no ambient authority — there are no cookies or sessions on this
 * endpoint; the only secret (the API key) is typed by the user into the form
 * per submission. A cross-site auto-submitted form cannot include the victim's
 * key, so the classic CSRF vector (riding an ambient credential) does not
 * exist. The code is additionally bound at mint time to {client_id,
 * redirect_uri, code_challenge} and unusable without the attacker-unknowable
 * code_verifier. Residual UI risks are covered by X-Frame-Options DENY +
 * frame-ancestors 'none' (clickjacking) and exact redirect_uri matching (no
 * open redirect).
 *
 * The hidden form fields are UNTRUSTED input — a forged POST re-runs the full
 * GET-authorize validation and must fail identically.
 */
export async function handleAuthorizePost(request: Request, ip: string, deps: OAuthDeps): Promise<Response> {
  if (await oauthRateLimited(deps, ip, GRANT_RATE_LIMIT_PER_MIN)) {
    return rateLimitedResponse(GRANT_RATE_LIMIT_PER_MIN);
  }

  // Form-urlencoded body. Do NOT read nodeCtx.parsedBody in mcp.ts — the Node
  // adapter only JSON-parses; the raw body is preserved on the web Request.
  const form = new URLSearchParams(await request.text());
  const clientId = form.get("client_id") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const codeChallenge = form.get("code_challenge") ?? "";
  const codeChallengeMethod = form.get("code_challenge_method") ?? "";
  const state = form.get("state") || undefined;
  const resource = form.get("resource") || undefined;
  const scope = form.get("scope") || undefined;

  // Re-run GET-authorize validation steps 1-3 on the hidden fields.
  const client = await lookupClient(clientId, deps);
  if (!client) {
    return htmlResponse(400, renderErrorPage(
      "Unknown client",
      "The client_id is missing or not registered. Register the client first via dynamic client registration (POST /register), then restart the authorization flow.",
    ));
  }
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return htmlResponse(400, renderErrorPage(
      "Invalid redirect URI",
      "The redirect_uri does not exactly match any URI registered for this client. Update the client registration or fix the authorization request.",
    ));
  }
  if (!codeChallenge) {
    return redirectError(redirectUri, "invalid_request", "code_challenge required", state);
  }
  if (codeChallengeMethod !== "S256") {
    return redirectError(redirectUri, "invalid_request", "only S256 supported", state);
  }

  const encKey = await loadEncKey(deps);
  if (!encKey) return encKeyMissingResponse();

  const reRender = (errorMessage: string): Response =>
    htmlResponse(200, renderConsentPage({
      clientName: client.client_name || "An MCP client",
      redirectUri,
      clientId,
      codeChallenge,
      codeChallengeMethod,
      state,
      resource,
      scope,
      errorMessage,
      // Same CSP widening as the GET consent page: redirectUri is exact-match
      // validated against the registered client above, and without this the
      // retry-after-typo submit hits the same silently-blocked cross-origin
      // redirect this fix exists to prevent (TOW2-377).
    }), buildAuthorizeCsp(redirectUri));

  const pastedKey = (form.get("api_key") ?? "").trim();
  if (!pastedKey) {
    return reRender("Enter your Novada API key to authorize this client.");
  }

  // Wallet-probe verification via deps (same validateToken path as /mcp auth;
  // an upstream flake yields {valid:true, verified:false} which is accepted).
  const verdict = await deps.verifyKey(pastedKey);
  if (!verdict.valid) {
    // No redirect, no code minted — the user retries on the same page.
    return reRender("That API key was rejected by Novada — check you copied it from your own account.");
  }

  const nowMs = deps.now?.() ?? Date.now();
  const rand = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const code = mintToken("nvo_ac_", rand);
  const record: CodeRecord = {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    ...(resource ? { resource } : {}),
    ...(scope ? { scope } : {}),
    enc: await encryptApiKey(pastedKey, encKey, rand),
    created_at: nowMs,
  };
  await deps.kvSet(`oauthcode:${await sha256Hex(code)}`, record, { ex: CODE_TTL_S });

  console.log(JSON.stringify({ evt: "oauth_code_issued", clientId, codeFp: await fingerprint(code) }));

  const location = new URL(redirectUri);
  location.searchParams.set("code", code);
  if (state) location.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { location: location.toString(), "cache-control": "no-store" },
  });
}

// ─── POST /token — authorization_code (PKCE) + refresh_token grants ──────────

/** Parse the token-request parameters: form-urlencoded canonically, with a
 *  JSON fallback when content-type says so (some MCP clients send JSON). */
async function readTokenParams(request: Request): Promise<Record<string, string>> {
  const text = await request.text();
  const ctype = (request.headers.get("content-type") ?? "").toLowerCase();
  if (ctype.includes("application/json")) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
        }
        return out;
      }
    } catch { /* fall through to form parsing */ }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

const CODE_INVALID_GRANT = {
  error: "invalid_grant",
  error_description: "authorization code is invalid, expired, or already used",
  agent_instruction: "Restart the OAuth flow from /authorize — codes are single-use and expire in 120 seconds.",
};

const RT_INVALID_GRANT = {
  error: "invalid_grant",
  error_description: "refresh token is invalid, expired, or already rotated — restart the OAuth flow",
  agent_instruction: "Refresh tokens rotate on every use and expire after 30 days. Restart the OAuth flow via /.well-known/oauth-authorization-server discovery.",
};

export async function handleToken(request: Request, ip: string, deps: OAuthDeps): Promise<Response> {
  if (await oauthRateLimited(deps, ip, GRANT_RATE_LIMIT_PER_MIN)) {
    return rateLimitedResponse(GRANT_RATE_LIMIT_PER_MIN);
  }

  const encKey = await loadEncKey(deps);
  if (!encKey) return encKeyMissingResponse();

  const p = await readTokenParams(request);
  const grantType = p.grant_type;
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return tokenJson(400, {
      error: "unsupported_grant_type",
      error_description: "grant_type must be authorization_code or refresh_token.",
      agent_instruction: "Use grant_type=authorization_code (with code, code_verifier, client_id, redirect_uri) or grant_type=refresh_token (with refresh_token, client_id).",
    });
  }

  const nowMs = deps.now?.() ?? Date.now();
  const rand = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));

  /** Decrypt the record's key and mint a fresh AT+RT pair, each re-encrypted
   *  with a FRESH IV (enc objects are never copied between records).
   *  `invalidGrantBody` is the grant's own generic miss message so a decrypt
   *  failure (tampered ciphertext) is indistinguishable from an expired grant
   *  — invalid_grant, never a 500 oracle. */
  const mintTokenPair = async (rec: { enc: EncRecord }, clientId: string, grant: string, invalidGrantBody: Record<string, unknown>): Promise<Response> => {
    const plainKey = await decryptApiKey(rec.enc, encKey);
    if (plainKey === null) {
      return tokenJson(400, { ...invalidGrantBody });
    }
    const at = mintToken("nvo_at_", rand);
    const rt = mintToken("nvo_rt_", rand);
    const atRecord: TokenRecord = { client_id: clientId, enc: await encryptApiKey(plainKey, encKey, rand), created_at: nowMs };
    const rtRecord: TokenRecord = { client_id: clientId, enc: await encryptApiKey(plainKey, encKey, rand), created_at: nowMs };
    await deps.kvSet(`oauthat:${await sha256Hex(at)}`, atRecord, { ex: AT_TTL_S });
    await deps.kvSet(`oauthrt:${await sha256Hex(rt)}`, rtRecord, { ex: RT_TTL_S });
    console.log(JSON.stringify({ evt: "oauth_token_issued", grant, clientId, atFp: await fingerprint(at) }));
    return tokenJson(200, {
      access_token: at,
      token_type: "Bearer",
      expires_in: AT_TTL_S,
      refresh_token: rt,
      scope: "novada",
    });
  };

  if (grantType === "authorization_code") {
    const { code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: redirectUri } = p;
    if (!code || !codeVerifier || !clientId || !redirectUri) {
      return tokenJson(400, {
        error: "invalid_request",
        error_description: "code, code_verifier, client_id and redirect_uri are required.",
        agent_instruction: "Send all four parameters from the authorization response: code, code_verifier (the PKCE plaintext), client_id, redirect_uri.",
      });
    }
    // Unknown client → 401 invalid_client: DCR clients (mcp-remote) treat this
    // as "registration lost" and auto-re-register, then restart the flow.
    const client = await lookupClient(clientId, deps);
    if (!client) {
      return tokenJson(401, {
        error: "invalid_client",
        error_description: "client_id is not registered.",
        agent_instruction: "Re-register the client at POST /register (dynamic client registration), then restart the OAuth flow from /authorize.",
      });
    }

    // ATOMIC single-use: the code is consumed on ANY redemption attempt,
    // including failed PKCE below (RFC 6749 §4.1.2 — replay protection).
    const rec = parseCodeRecord(await deps.kvGetDel(`oauthcode:${await sha256Hex(code)}`));
    if (!rec) {
      return tokenJson(400, { ...CODE_INVALID_GRANT });
    }
    if (rec.client_id !== clientId || rec.redirect_uri !== redirectUri) {
      return tokenJson(400, {
        error: "invalid_grant",
        error_description: "authorization code was issued to a different client_id or redirect_uri",
        agent_instruction: "Restart the OAuth flow from /authorize — the code is bound to the exact client_id and redirect_uri used at authorization, and has now been consumed.",
      });
    }
    if (await computeS256Challenge(codeVerifier) !== rec.code_challenge) {
      return tokenJson(400, {
        error: "invalid_grant",
        error_description: "PKCE verification failed",
        agent_instruction: "Restart the OAuth flow from /authorize — the code_verifier must be the exact value whose S256 hash was sent as code_challenge, and the code has now been consumed (single-use).",
      });
    }
    return mintTokenPair(rec, clientId, "authorization_code", CODE_INVALID_GRANT);
  }

  // grant_type === "refresh_token"
  const { refresh_token: refreshToken, client_id: rtClientId } = p;
  if (!refreshToken || !rtClientId) {
    return tokenJson(400, {
      error: "invalid_request",
      error_description: "refresh_token and client_id are required.",
      agent_instruction: "Send the refresh_token from the last token response together with your client_id.",
    });
  }
  const rtClient = await lookupClient(rtClientId, deps);
  if (!rtClient) {
    return tokenJson(401, {
      error: "invalid_client",
      error_description: "client_id is not registered.",
      agent_instruction: "Re-register the client at POST /register (dynamic client registration), then restart the OAuth flow from /authorize.",
    });
  }

  // ROTATION: the old RT is invalidated atomically on use. The old AT is NOT
  // revoked (it expires within 1 h via its KV TTL — accepted trade-off).
  const rtRec = parseTokenRecord(await deps.kvGetDel(`oauthrt:${await sha256Hex(refreshToken)}`));
  if (!rtRec) {
    return tokenJson(400, { ...RT_INVALID_GRANT });
  }
  if (rtRec.client_id !== rtClientId) {
    return tokenJson(400, {
      error: "invalid_grant",
      error_description: "refresh token was issued to a different client_id",
      agent_instruction: "Use the client_id the token was issued to, or restart the OAuth flow from /authorize.",
    });
  }
  return mintTokenPair(rtRec, rtClientId, "refresh_token", RT_INVALID_GRANT);
}

// ─── Access-token resolution (wired into the /mcp auth path by mcp.ts) ───────

/**
 * Resolve a Bearer nvo_at_* access token to the underlying plaintext Novada
 * API key. Returns null on KV miss (expired/unknown), decrypt failure, or a
 * missing/malformed encryption key — mcp.ts turns null into a 401 with a
 * refresh instruction. Never throws.
 */
export async function resolveAccessToken(token: string, deps: OAuthDeps): Promise<string | null> {
  const encKey = await loadEncKey(deps);
  if (!encKey) return null;
  let raw: unknown;
  try {
    raw = await deps.kvGet(`oauthat:${await sha256Hex(token)}`);
  } catch {
    return null; // KV hiccup → fail closed to 401 (client refreshes/retries)
  }
  const rec = parseTokenRecord(raw);
  if (!rec) return null;
  return decryptApiKey(rec.enc, encKey);
}
