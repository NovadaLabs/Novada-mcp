/**
 * OAuth 2.0 authorization server (Firecrawl-parity keyless auth) — full suite.
 * Spec: ~/.claude/plans/cheeky-frolicking-flute-agent-*.md (32-test list).
 *
 * Runs on plain Node ≥22.18 (`node --test`) — imports api/_oauth.ts directly
 * via Node's built-in type stripping; no test framework, mirroring
 * paid-tier-cap.test.mjs. _oauth.ts is import-free by design, so this file
 * exercises it side-effect-free with fully mocked OAuthDeps.
 *
 * Layers:
 *   1. UNIT     — T01-T09: pure helpers (b64url, sha256, PKCE, redirect-URI
 *                 policy, escaping, issuer, metadata, AES-GCM round-trip).
 *   2. HANDLER  — T10-T26: register / authorize GET+POST / token / resolve /
 *                 rate limits with an in-memory KV honoring `ex` via an
 *                 injected clock, deterministic randomBytes, stubbed verifyKey.
 *   3. STATIC   — T27-T32: regression fences on api/mcp.ts wiring and
 *                 api/_oauth.ts hygiene (no imports, no plaintext logging,
 *                 TTL constants).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  b64urlEncode,
  b64urlDecode,
  sha256Hex,
  computeS256Challenge,
  mintToken,
  validateRedirectUri,
  escapeHtml,
  deriveIssuer,
  importEncKey,
  encryptApiKey,
  decryptApiKey,
  buildAsMetadata,
  buildPrMetadata,
  renderConsentPage,
  isOAuthPath,
  handleOAuthRequest,
  handleRegister,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleToken,
  resolveAccessToken,
} from "../api/_oauth.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const OAUTH_TS = join(__dirname, "..", "api", "_oauth.ts");

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const NOW0 = 1_760_000_000_000;
const ENC_KEY_B64 = Buffer.alloc(32, 7).toString("base64"); // std base64, 32 bytes
// RFC 7636 Appendix B test vector.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CUSTOMER_KEY = "customer-secret-key-A1B2C3D4E5";
const IP = "1.2.3.4";

/** In-memory KV honoring `ex` via the injected clock + deterministic randomness. */
function makeDeps({ verifyKey, encKeyB64 = ENC_KEY_B64 } = {}) {
  const clock = { t: NOW0 };
  const store = new Map(); // key → { value, expiresAt: ms | null }
  const sets = [];         // { key, value, opts } — for TTL assertions
  let ctr = 0;
  const live = (e) => !!e && (e.expiresAt === null || clock.t < e.expiresAt);
  const deps = {
    store,
    sets,
    clock,
    kvGet: async (key) => {
      const e = store.get(key);
      if (!live(e)) { store.delete(key); return null; }
      return e.value;
    },
    kvSet: async (key, value, opts) => {
      const expiresAt = opts && typeof opts.ex === "number" ? clock.t + opts.ex * 1000 : null;
      store.set(key, { value, expiresAt });
      sets.push({ key, value, opts });
      return "OK";
    },
    kvGetDel: async (key) => {
      const e = store.get(key);
      store.delete(key);
      return live(e) ? e.value : null;
    },
    kvIncr: async (key) => {
      const e = store.get(key);
      const cur = live(e) && typeof e.value === "number" ? e.value : 0;
      const next = cur + 1;
      store.set(key, { value: next, expiresAt: live(e) ? e.expiresAt : null });
      return next;
    },
    kvExpire: async (key, seconds) => {
      const e = store.get(key);
      if (e) e.expiresAt = clock.t + seconds * 1000;
      return 1;
    },
    verifyKey: verifyKey ?? (async () => ({ valid: true, verified: true })),
    encKeyB64,
    now: () => clock.t,
    // Deterministic but unique per call — distinct tokens and distinct IVs.
    randomBytes: (n) => {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (ctr + i * 7) % 256;
      ctr += 13;
      return b;
    },
  };
  return deps;
}

function postJson(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function postForm(url, fields) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function authorizeUrl(params) {
  const u = new URL("https://mcp.novada.com/authorize");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

async function registerClient(deps, redirectUris, clientName = "Test App") {
  const res = await handleRegister(
    postJson("https://mcp.novada.com/register", { client_name: clientName, redirect_uris: redirectUris }),
    deps,
  );
  assert.equal(res.status, 201, "test fixture registration must succeed");
  return (await res.json()).client_id;
}

/** register → authorize POST (paste key) → return the minted code. */
async function obtainCode(deps, {
  apiKey = CUSTOMER_KEY,
  redirectUri = "https://claude.ai/api/mcp/auth_callback",
  state = "st-1",
  clientName = "Flow App",
} = {}) {
  const clientId = await registerClient(deps, [redirectUri], clientName);
  const res = await handleAuthorizePost(postForm("https://mcp.novada.com/authorize", {
    api_key: apiKey,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: "S256",
    state,
  }), IP, deps);
  assert.equal(res.status, 302, "test fixture authorization must succeed");
  const loc = new URL(res.headers.get("location"));
  return { clientId, redirectUri, code: loc.searchParams.get("code") };
}

function tokenForm(fields) {
  return postForm("https://mcp.novada.com/token", fields);
}

// ─── Layer 1: UNIT — pure helpers ────────────────────────────────────────────

test("T01 mintToken: prefix + 43-char base64url, deterministic under injected randomBytes", () => {
  const ones = (n) => new Uint8Array(n).fill(1);
  const t = mintToken("nvo_at_", ones);
  assert.equal(t, "nvo_at_" + "AQEB".repeat(10) + "AQE", "32 bytes of 0x01 must mint a fixed token");
  assert.equal(t, mintToken("nvo_at_", ones), "same bytes → same token (deterministic)");
  for (const prefix of ["nvo_ac_", "nvo_at_", "nvo_rt_"]) {
    const tok = mintToken(prefix, ones);
    assert.ok(tok.startsWith(prefix), `${prefix} prefix must be preserved`);
    assert.match(tok.slice(prefix.length), /^[A-Za-z0-9_-]{43}$/, "body must be 43-char base64url");
  }
});

test("T02 b64url round-trip incl. padding-edge lengths; sha256Hex known vector", async () => {
  for (const len of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len) % 256;
    const enc = b64urlEncode(bytes);
    assert.doesNotMatch(enc, /[+/=]/, "base64url must carry no +, / or padding");
    assert.deepEqual(Array.from(b64urlDecode(enc)), Array.from(bytes), `round-trip must hold for length ${len}`);
  }
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "FIPS 180-2 known vector for sha256(abc)",
  );
});

test("T03 computeS256Challenge: RFC 7636 Appendix B vector", async () => {
  assert.equal(await computeS256Challenge(RFC_VERIFIER), RFC_CHALLENGE);
});

test("T04 validateRedirectUri: https + loopback-http accepted; everything else rejected", () => {
  for (const uri of [
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:3334/oauth/callback",
    "http://127.0.0.1:8081/cb",
  ]) {
    assert.equal(validateRedirectUri(uri), true, `${uri} must be ACCEPTED`);
  }
  for (const uri of [
    "http://evil.com/cb",
    "cursor://anysphere.cursor-mcp/callback",
    "myapp://cb",
    "javascript:alert(1)",
    "https://a.com/cb#frag",
    "",
    "not a url",
  ]) {
    assert.equal(validateRedirectUri(uri), false, `${JSON.stringify(uri)} must be REJECTED`);
  }
});

test("T05 escapeHtml neutralizes <script>; consent page never emits a raw script tag", () => {
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  const html = renderConsentPage({
    clientName: "<script>alert(1)</script>",
    redirectUri: "https://claude.ai/cb",
    clientId: "cid-1",
    codeChallenge: RFC_CHALLENGE,
    codeChallengeMethod: "S256",
    state: "\"><script>alert(2)</script>",
  });
  assert.ok(!html.includes("<script"), "no raw <script> may survive any interpolation");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "client name must render escaped");
});

test("T06 buildAsMetadata: endpoints derive from issuer; S256-only; public clients; two grants", () => {
  const issuer = "https://mcp.novada.com";
  const m = buildAsMetadata(issuer);
  assert.equal(m.issuer, issuer);
  assert.equal(m.authorization_endpoint, `${issuer}/authorize`);
  assert.equal(m.token_endpoint, `${issuer}/token`);
  assert.equal(m.registration_endpoint, `${issuer}/register`);
  assert.deepEqual(m.response_types_supported, ["code"]);
  assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(m.token_endpoint_auth_methods_supported, ["none"]);
  assert.deepEqual(m.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(m.scopes_supported, ["novada"]);
});

test("T07 buildPrMetadata: resource = issuer+/mcp, authorization_servers = [issuer]", () => {
  const issuer = "https://mcp.novada.com";
  const m = buildPrMetadata(issuer, "/mcp");
  assert.equal(m.resource, `${issuer}/mcp`);
  assert.deepEqual(m.authorization_servers, [issuer]);
  assert.deepEqual(m.bearer_methods_supported, ["header"]);
});

test("T08 deriveIssuer: localhost/127.0.0.1 → http, real hosts → https, override wins", () => {
  assert.equal(deriveIssuer("localhost:4747"), "http://localhost:4747");
  assert.equal(deriveIssuer("127.0.0.1:8081"), "http://127.0.0.1:8081");
  assert.equal(deriveIssuer("mcp.novada.com"), "https://mcp.novada.com");
  assert.equal(deriveIssuer("mcp.novada.com", "https://override.example"), "https://override.example");
});

test("T09 AES-GCM: round-trip; fresh IV per call (different iv AND ct); tamper → null; short key fails closed", async () => {
  const key = await importEncKey(ENC_KEY_B64);
  const realRand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const e1 = await encryptApiKey(CUSTOMER_KEY, key, realRand);
  const e2 = await encryptApiKey(CUSTOMER_KEY, key, realRand);
  assert.notEqual(e1.iv, e2.iv, "two encrypts of the same plaintext must use DIFFERENT IVs");
  assert.notEqual(e1.ct, e2.ct, "different IVs must produce different ciphertexts");
  assert.equal(await decryptApiKey(e1, key), CUSTOMER_KEY, "round-trip must return the plaintext");
  const tampered = b64urlDecode(e1.ct);
  tampered[0] ^= 0xff;
  assert.equal(
    await decryptApiKey({ iv: e1.iv, ct: b64urlEncode(tampered) }, key),
    null,
    "a flipped ciphertext byte must fail closed to null (GCM auth), never throw",
  );

  // AES-256 enforcement: a 16-byte key must throw at import (no silent AES-128
  // downgrade)…
  const SHORT_KEY_B64 = Buffer.alloc(16, 7).toString("base64");
  await assert.rejects(
    () => importEncKey(SHORT_KEY_B64),
    /32 bytes/,
    "importEncKey must reject keys that are not exactly 32 bytes",
  );
  // …and a grant endpoint configured with that key must fail CLOSED to the
  // operator-facing 500 server_error — same behavior as a missing key, never
  // an unhandled crash.
  const shortKeyDeps = makeDeps({ encKeyB64: SHORT_KEY_B64 });
  const res = await handleToken(
    tokenForm({ grant_type: "authorization_code", code: "nvo_ac_x", code_verifier: RFC_VERIFIER, client_id: "c", redirect_uri: "https://a.com/cb" }),
    IP,
    shortKeyDeps,
  );
  assert.equal(res.status, 500, "malformed OAUTH_ENC_KEY must yield 500, not a crash");
  assert.equal((await res.json()).error, "server_error");
});

// ─── Layer 2: HANDLER — register ─────────────────────────────────────────────

test("T10 register happy: 201, UUID client_id, NO client_secret, KV record shape + 180d TTL", async () => {
  const deps = makeDeps();
  const res = await handleRegister(postJson("https://mcp.novada.com/register", {
    client_name: "My Agent",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3334/cb"],
  }), deps);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.client_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.ok(!("client_secret" in body), "public clients only — no client_secret may ever be minted");
  assert.equal(body.token_endpoint_auth_method, "none");
  assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
  assert.deepEqual(body.response_types, ["code"]);
  assert.equal(body.client_id_issued_at, Math.floor(NOW0 / 1000));
  const set = deps.sets.find((s) => s.key === `oauthclient:${body.client_id}`);
  assert.ok(set, "client record must be written to KV");
  assert.equal(set.opts.ex, 60 * 60 * 24 * 180, "client record TTL must be 180 days");
  assert.deepEqual(set.value, {
    client_id: body.client_id,
    client_name: "My Agent",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3334/cb"],
    token_endpoint_auth_method: "none",
    created_at: NOW0,
  });
});

test("T11 register rejections: bad/custom-scheme/empty redirect_uris, secret auth method, malformed JSON", async () => {
  const url = "https://mcp.novada.com/register";
  const cases = [
    [postJson(url, { redirect_uris: ["http://evil.com/cb"] }), "invalid_redirect_uri"],
    [postJson(url, { redirect_uris: ["cursor://cb"] }), "invalid_redirect_uri"],
    [postJson(url, { redirect_uris: [] }), "invalid_redirect_uri"],
    // >2048 chars: valid https shape, but over the KV-flood length cap.
    [postJson(url, { redirect_uris: ["https://a.com/" + "x".repeat(2048)] }), "invalid_redirect_uri"],
    [postJson(url, { client_name: "x" }), "invalid_redirect_uri"], // missing redirect_uris
    [postJson(url, { redirect_uris: ["https://a.com/cb"], token_endpoint_auth_method: "client_secret_basic" }), "invalid_client_metadata"],
    [postJson(url, "not json{{"), "invalid_client_metadata"],
  ];
  for (const [req, expectedError] of cases) {
    const deps = makeDeps();
    const res = await handleRegister(req, deps);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, expectedError);
    assert.equal([...deps.store.keys()].filter((k) => k.startsWith("oauthclient:")).length, 0,
      "no client record may be written on a rejected registration");
  }
});

// ─── Layer 2: HANDLER — authorize GET ────────────────────────────────────────

test("T12 authorize GET happy: 200 HTML with escaped client_name, hidden challenge, security headers", async () => {
  const deps = makeDeps();
  const clientId = await registerClient(deps, ["https://claude.ai/cb"], "Cool & <Fancy> App");
  const res = await handleAuthorizeGet(authorizeUrl({
    client_id: clientId,
    redirect_uri: "https://claude.ai/cb",
    response_type: "code",
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
  }), deps);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const csp = res.headers.get("content-security-policy");
  assert.ok(csp, "consent page must carry a Content-Security-Policy header");
  assert.ok(csp.includes("default-src 'none'"), "CSP must lock down with default-src 'none'");
  const html = await res.text();
  assert.ok(html.includes("Cool &amp; &lt;Fancy&gt; App"), "client_name must render HTML-escaped");
  assert.ok(html.includes('name="code_challenge"') && html.includes(RFC_CHALLENGE),
    "the code_challenge must ride along as a hidden field");
  assert.ok(html.includes('name="api_key"'), "the key-paste field must be present");
});

test("T13 authorize GET: unknown client / unregistered / prefix-variant redirect_uri → 400, NEVER a redirect", async () => {
  const deps = makeDeps();
  const clientId = await registerClient(deps, ["https://app.com/cb"]);
  const cases = [
    { client_id: "not-a-registered-client", redirect_uri: "https://app.com/cb" },
    { client_id: clientId, redirect_uri: "https://evil.com/cb" },
    { client_id: clientId, redirect_uri: "https://app.com/cb2" }, // exact match only
  ];
  for (const c of cases) {
    const res = await handleAuthorizeGet(authorizeUrl({
      ...c, response_type: "code", code_challenge: RFC_CHALLENGE, code_challenge_method: "S256",
    }), deps);
    assert.equal(res.status, 400, `${JSON.stringify(c)} must yield 400`);
    assert.equal(res.headers.get("location"), null, "open-redirect protection: no Location header before validation");
    assert.match(res.headers.get("content-type"), /^text\/html/);
  }
});

test("T14 authorize GET redirect-errors: missing challenge / plain method / response_type=token", async () => {
  const deps = makeDeps();
  const clientId = await registerClient(deps, ["https://app.com/cb"]);
  const base = { client_id: clientId, redirect_uri: "https://app.com/cb", state: "xyz" };

  let res = await handleAuthorizeGet(authorizeUrl({ ...base, response_type: "code" }), deps);
  assert.equal(res.status, 302);
  let loc = new URL(res.headers.get("location"));
  assert.ok(loc.href.startsWith("https://app.com/cb"), "errors redirect only to the validated redirect_uri");
  assert.equal(loc.searchParams.get("error"), "invalid_request");
  assert.equal(loc.searchParams.get("state"), "xyz", "state must be echoed verbatim");

  res = await handleAuthorizeGet(authorizeUrl({
    ...base, response_type: "code", code_challenge: RFC_CHALLENGE, code_challenge_method: "plain",
  }), deps);
  assert.equal(res.status, 302);
  loc = new URL(res.headers.get("location"));
  assert.equal(loc.searchParams.get("error"), "invalid_request");
  assert.match(loc.searchParams.get("error_description"), /S256/);

  // ABSENT code_challenge_method must be rejected identically to "plain" —
  // PKCE is mandatory and S256-only, with no permissive default.
  res = await handleAuthorizeGet(authorizeUrl({
    ...base, response_type: "code", code_challenge: RFC_CHALLENGE,
  }), deps);
  assert.equal(res.status, 302);
  loc = new URL(res.headers.get("location"));
  assert.equal(loc.searchParams.get("error"), "invalid_request");
  assert.match(loc.searchParams.get("error_description"), /S256/);
  assert.equal(loc.searchParams.get("state"), "xyz", "state must be echoed verbatim");

  res = await handleAuthorizeGet(authorizeUrl({
    ...base, response_type: "token", code_challenge: RFC_CHALLENGE, code_challenge_method: "S256",
  }), deps);
  assert.equal(res.status, 302);
  loc = new URL(res.headers.get("location"));
  assert.equal(loc.searchParams.get("error"), "unsupported_response_type");
  assert.equal(loc.searchParams.get("state"), "xyz");
});

// ─── Layer 2: HANDLER — authorize POST ───────────────────────────────────────

test("T15 authorize POST happy: 302 with code+state, code record bound, no plaintext key in KV", async () => {
  const deps = makeDeps();
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const { clientId, code } = await obtainCode(deps, { redirectUri, state: "st-42" });
  assert.ok(code.startsWith("nvo_ac_"), "authorization code must carry the nvo_ac_ prefix");

  const rec = deps.store.get(`oauthcode:${await sha256Hex(code)}`)?.value;
  assert.ok(rec, "code record must be stored under sha256(code), never the plaintext code");
  assert.equal(rec.client_id, clientId);
  assert.equal(rec.redirect_uri, redirectUri);
  assert.equal(rec.code_challenge, RFC_CHALLENGE);
  assert.ok(rec.enc && typeof rec.enc.iv === "string" && typeof rec.enc.ct === "string",
    "the caller's key must be stored as an AES-GCM {iv, ct} record");

  const serialized = JSON.stringify([...deps.store.entries()]);
  assert.ok(!serialized.includes(CUSTOMER_KEY),
    "the plaintext API key must never appear anywhere in KV (keys or values)");
});

test("T16 authorize POST invalid key: 200 re-render with error, no redirect, no code minted", async () => {
  const deps = makeDeps({ verifyKey: async () => ({ valid: false, verified: true }) });
  const clientId = await registerClient(deps, ["https://app.com/cb"]);
  const res = await handleAuthorizePost(postForm("https://mcp.novada.com/authorize", {
    api_key: "wrong-key-1234567890",
    client_id: clientId,
    redirect_uri: "https://app.com/cb",
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
  }), IP, deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null, "a rejected key must not redirect");
  const html = await res.text();
  assert.ok(html.includes("That API key was rejected by Novada — check you copied it from your own account."));
  assert.equal([...deps.store.keys()].filter((k) => k.startsWith("oauthcode:")).length, 0,
    "no authorization code may be minted for a rejected key");
});

test("T17 authorize POST forged hidden fields (unregistered redirect_uri) → 400, no code", async () => {
  const deps = makeDeps();
  const clientId = await registerClient(deps, ["https://app.com/cb"]);
  const res = await handleAuthorizePost(postForm("https://mcp.novada.com/authorize", {
    api_key: CUSTOMER_KEY,
    client_id: clientId,
    redirect_uri: "https://attacker.example/steal", // hidden fields are UNTRUSTED
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: "S256",
  }), IP, deps);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("location"), null);
  assert.equal([...deps.store.keys()].filter((k) => k.startsWith("oauthcode:")).length, 0,
    "a forged POST must mint nothing");
});

// ─── Layer 2: HANDLER — token ────────────────────────────────────────────────

test("T18 token happy PKCE flow end-to-end: register→authorize→token → AT+RT, no-store", async () => {
  const deps = makeDeps();
  const { clientId, redirectUri, code } = await obtainCode(deps);
  const res = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code,
    code_verifier: RFC_VERIFIER,
    client_id: clientId,
    redirect_uri: redirectUri,
  }), IP, deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("pragma"), "no-cache");
  const body = await res.json();
  assert.ok(body.access_token.startsWith("nvo_at_"));
  assert.ok(body.refresh_token.startsWith("nvo_rt_"));
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.expires_in, 3600);
  assert.equal(body.scope, "novada");
});

test("T19 token wrong verifier → invalid_grant AND the code burns (correct verifier fails after)", async () => {
  const deps = makeDeps();
  const { clientId, redirectUri, code } = await obtainCode(deps);
  const bad = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code,
    code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier",
    client_id: clientId,
    redirect_uri: redirectUri,
  }), IP, deps);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_grant");
  // Single-use burns on ANY redemption attempt (RFC 6749 §4.1.2): the code is
  // already consumed, so even the correct verifier must fail now.
  const retry = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code,
    code_verifier: RFC_VERIFIER,
    client_id: clientId,
    redirect_uri: redirectUri,
  }), IP, deps);
  assert.equal(retry.status, 400);
  assert.equal((await retry.json()).error, "invalid_grant");
});

test("T20 token double redeem: second use of a correct code → invalid_grant", async () => {
  const deps = makeDeps();
  const { clientId, redirectUri, code } = await obtainCode(deps);
  const fields = {
    grant_type: "authorization_code",
    code,
    code_verifier: RFC_VERIFIER,
    client_id: clientId,
    redirect_uri: redirectUri,
  };
  const first = await handleToken(tokenForm(fields), IP, deps);
  assert.equal(first.status, 200);
  const second = await handleToken(tokenForm(fields), IP, deps);
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error, "invalid_grant");
});

test("T21 token binding: client_id mismatch and redirect_uri mismatch → invalid_grant each", async () => {
  // client_id mismatch — the OTHER client is registered (else it would 401).
  let deps = makeDeps();
  let flow = await obtainCode(deps);
  const otherClient = await registerClient(deps, ["https://other.example/cb"], "Other App");
  let res = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code: flow.code,
    code_verifier: RFC_VERIFIER,
    client_id: otherClient,
    redirect_uri: flow.redirectUri,
  }), IP, deps);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_grant");

  // redirect_uri mismatch.
  deps = makeDeps();
  flow = await obtainCode(deps);
  res = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code: flow.code,
    code_verifier: RFC_VERIFIER,
    client_id: flow.clientId,
    redirect_uri: "https://claude.ai/other_callback",
  }), IP, deps);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_grant");
});

test("T22 token unknown client (no oauthclient record) → 401 invalid_client", async () => {
  const deps = makeDeps();
  const res = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code: "nvo_ac_bogus",
    code_verifier: RFC_VERIFIER,
    client_id: "never-registered",
    redirect_uri: "https://app.com/cb",
  }), IP, deps);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "invalid_client");
});

test("T23 resolveAccessToken: minted AT → plaintext key; garbage → null; expiry via mock clock → null", async () => {
  const deps = makeDeps();
  const { clientId, redirectUri, code } = await obtainCode(deps);
  const res = await handleToken(tokenForm({
    grant_type: "authorization_code",
    code,
    code_verifier: RFC_VERIFIER,
    client_id: clientId,
    redirect_uri: redirectUri,
  }), IP, deps);
  const { access_token: at } = await res.json();

  assert.equal(await resolveAccessToken(at, deps), CUSTOMER_KEY,
    "the AT must resolve back to the exact key the user pasted");
  assert.equal(await resolveAccessToken("nvo_at_unknown", deps), null);
  assert.equal(await resolveAccessToken("complete-garbage", deps), null);

  deps.clock.t += 3601 * 1000; // mock KV honors ex — the AT record is now expired
  assert.equal(await resolveAccessToken(at, deps), null, "an expired AT must resolve to null");
});

test("T24 RT rotation: refresh → NEW pair; OLD rt dead; NEW rt works", async () => {
  const deps = makeDeps();
  const { clientId, redirectUri, code } = await obtainCode(deps);
  const first = await (await handleToken(tokenForm({
    grant_type: "authorization_code",
    code,
    code_verifier: RFC_VERIFIER,
    client_id: clientId,
    redirect_uri: redirectUri,
  }), IP, deps)).json();

  const refreshed = await handleToken(tokenForm({
    grant_type: "refresh_token",
    refresh_token: first.refresh_token,
    client_id: clientId,
  }), IP, deps);
  assert.equal(refreshed.status, 200);
  const second = await refreshed.json();
  assert.notEqual(second.access_token, first.access_token, "rotation must mint a NEW access token");
  assert.notEqual(second.refresh_token, first.refresh_token, "rotation must mint a NEW refresh token");

  const replay = await handleToken(tokenForm({
    grant_type: "refresh_token",
    refresh_token: first.refresh_token,
    client_id: clientId,
  }), IP, deps);
  assert.equal(replay.status, 400, "the OLD refresh token must be invalidated atomically on use");
  assert.equal((await replay.json()).error, "invalid_grant");

  const third = await handleToken(tokenForm({
    grant_type: "refresh_token",
    refresh_token: second.refresh_token,
    client_id: clientId,
  }), IP, deps);
  assert.equal(third.status, 200, "the NEW refresh token must work");
});

test("T25 rate limits: 21st POST /token in one bucket → 429; register limit is 10/min", async () => {
  // Token endpoint: 20/min/IP — the rate limit runs before any parsing.
  const deps = makeDeps();
  for (let i = 1; i <= 20; i++) {
    const res = await handleToken(tokenForm({}), "9.9.9.9", deps);
    assert.notEqual(res.status, 429, `call #${i} must not be rate-limited yet`);
  }
  const blocked = await handleToken(tokenForm({}), "9.9.9.9", deps);
  assert.equal(blocked.status, 429, "the 21st call in one minute bucket must be blocked");
  assert.equal((await blocked.json()).error, "rate_limited");

  // Register endpoint: 10/min/IP — enforced by the router (it owns the IP).
  const regDeps = makeDeps();
  const regReq = () => postJson("https://mcp.novada.com/register", { redirect_uris: ["https://a.com/cb"] });
  for (let i = 1; i <= 10; i++) {
    const res = await handleOAuthRequest(regReq(), new URL("https://mcp.novada.com/register"), "8.8.8.8", regDeps);
    assert.notEqual(res.status, 429, `register #${i} must not be rate-limited yet`);
  }
  const regBlocked = await handleOAuthRequest(regReq(), new URL("https://mcp.novada.com/register"), "8.8.8.8", regDeps);
  assert.equal(regBlocked.status, 429, "the 11th register in one minute bucket must be blocked");
});

test("T26 every 4xx/5xx JSON body carries agent_instruction", async () => {
  const deps = makeDeps();
  const clientId = await registerClient(deps, ["https://app.com/cb"]);
  // Pre-seed the rate-limit bucket so one call yields a 429 without 20 warmups.
  const bucket = Math.floor(NOW0 / 60_000);
  await deps.kvSet(`rl:oauth:7.7.7.7:${bucket}`, 100, { ex: 120 });
  const noKeyDeps = makeDeps();
  noKeyDeps.encKeyB64 = undefined; // simulate a deployment without OAUTH_ENC_KEY

  const responses = [
    ["register malformed JSON (400)", await handleRegister(postJson("https://mcp.novada.com/register", "{{"), deps)],
    ["register bad redirect (400)", await handleRegister(postJson("https://mcp.novada.com/register", { redirect_uris: ["http://evil.com/cb"] }), deps)],
    ["token unsupported grant (400)", await handleToken(tokenForm({ grant_type: "password" }), IP, deps)],
    ["token missing params (400)", await handleToken(tokenForm({ grant_type: "authorization_code" }), IP, deps)],
    ["token unknown client (401)", await handleToken(tokenForm({ grant_type: "authorization_code", code: "x", code_verifier: "y", client_id: "ghost", redirect_uri: "https://a.com/cb" }), IP, deps)],
    ["token dead code (400)", await handleToken(tokenForm({ grant_type: "authorization_code", code: "nvo_ac_dead", code_verifier: RFC_VERIFIER, client_id: clientId, redirect_uri: "https://app.com/cb" }), IP, deps)],
    ["dead refresh token (400)", await handleToken(tokenForm({ grant_type: "refresh_token", refresh_token: "nvo_rt_dead", client_id: clientId }), IP, deps)],
    ["wrong method (405)", await handleOAuthRequest(new Request("https://mcp.novada.com/token", { method: "GET" }), new URL("https://mcp.novada.com/token"), IP, deps)],
    ["rate limited (429)", await handleToken(tokenForm({}), "7.7.7.7", deps)],
    ["enc key missing (500)", await handleOAuthRequest(postJson("https://mcp.novada.com/register", { redirect_uris: ["https://a.com/cb"] }), new URL("https://mcp.novada.com/register"), IP, noKeyDeps)],
  ];
  for (const [label, res] of responses) {
    assert.ok(res.status >= 400, `${label}: expected an error status, got ${res.status}`);
    const body = await res.json();
    assert.equal(typeof body.agent_instruction, "string", `${label}: agent_instruction must be present`);
    assert.ok(body.agent_instruction.length > 0, `${label}: agent_instruction must be non-empty`);
  }
});

// ─── Layer 3: STATIC — fences on mcp.ts wiring + _oauth.ts hygiene ───────────

test("T27 mcp.ts imports ./_oauth.js and routes OAuth paths BEFORE the 404", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /from "\.\/_oauth\.js"/, "mcp.ts must import from ./_oauth.js");
  const call = src.indexOf("handleOAuthRequest(");
  const notFound = src.indexOf('jsonError(404');
  assert.ok(call !== -1 && notFound !== -1 && call < notFound,
    "handleOAuthRequest must be wired before the 404 branch");
  assert.match(src, /isOAuthPath\(pathname\)/, "routing must gate on isOAuthPath");
});

test("T28 mcp.ts: WWW-Authenticate with resource_metadata on all three 401 sites", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(src.includes("resource_metadata="), "the RFC 9728 discovery pointer must be advertised");
  const occurrences = src.split("www-authenticate").length - 1;
  assert.ok(occurrences >= 3, `expected ≥3 www-authenticate sites, found ${occurrences}`);
});

test("T29 mcp.ts: AT resolution wired before key validation inside fetchHandler", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const fh = src.slice(src.indexOf("async function fetchHandler"));
  const resolveIdx = fh.indexOf("resolveAccessToken(");
  const validateIdx = fh.indexOf("await validateToken(");
  assert.ok(resolveIdx !== -1, "fetchHandler must resolve nvo_at_ tokens");
  assert.ok(validateIdx !== -1, "fetchHandler must still validate the (resolved) token");
  assert.ok(resolveIdx < validateIdx, "AT resolution must run BEFORE validateToken");
  // The carrier variable is REBOUND to the resolved key (rather than renamed
  // downstream) so caller-key.test.mjs's `const apiKey = token?.trim()` fence
  // keeps holding — all downstream consumers see the caller's actual key.
  assert.match(fh, /let token = extractToken\(request\)/, "token must be rebindable for AT resolution");
  assert.match(fh, /^\s*token = resolved;$/m, "the resolved key must replace the carrier for ALL downstream uses");
});

test("T30 mcp.ts: OAUTH_ENC_KEY wired through Env + readEnv", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /OAUTH_ENC_KEY\?: string/, "Env interface must declare OAUTH_ENC_KEY");
  assert.match(src, /OAUTH_ENC_KEY: process\.env\.OAUTH_ENC_KEY/, "readEnv must read OAUTH_ENC_KEY");
});

test("T31 _oauth.ts hygiene: zero imports, no vendor/kv coupling, no plaintext-secret logging", () => {
  const src = readFileSync(OAUTH_TS, "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m, "_oauth.ts must have ZERO import statements (DI only)");
  assert.ok(!src.includes('"@vercel/kv"'), "_oauth.ts must not couple to @vercel/kv");
  assert.ok(!src.includes("../vendor/"), "_oauth.ts must not couple to the vendored package");
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*\b(apiKey|api_key|code_verifier|access_token)\b/,
    "no console call may interpolate a plaintext key/verifier/token — fingerprints only");
});

test("T32 _oauth.ts TTL fences: codes 120s, access tokens 3600s", () => {
  const src = readFileSync(OAUTH_TS, "utf8");
  assert.match(src, /CODE_TTL_S = 120;/, "authorization-code TTL must stay 120s");
  assert.match(src, /AT_TTL_S = 3600;/, "access-token TTL must stay 3600s");
  assert.ok(src.includes("{ ex: CODE_TTL_S }"), "code records must be stored with the 120s TTL");
  assert.ok(src.includes("{ ex: AT_TTL_S }"), "AT records must be stored with the 3600s TTL");
  assert.ok(src.includes("expires_in: AT_TTL_S"), "expires_in must report the same 3600s constant");
});
