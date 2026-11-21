/**
 * KV ERROR vs KV MISS classification in api/_oauth.ts (no redis needed).
 * An erroring KV must yield a structured, retryable 503 on every grant
 * endpoint (including a failure MID-request, after the rate-limit incr
 * succeeded) and must make access-token resolution THROW (mcp.ts → 503),
 * while a clean miss still resolves null (→ 401).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOAuthRequest, resolveAccessTokenRecord, KvUnavailableError } from "../api/_oauth.ts";

const ENC = Buffer.alloc(32, 7).toString("base64");

function deps(overrides = {}) {
  const boom = async () => { throw new Error("redis down"); };
  return {
    kvGet: boom, kvSet: boom, kvGetDel: boom, kvIncr: boom, kvExpire: boom,
    verifyKey: async () => ({ valid: true, verified: true }),
    encKeyB64: ENC,
    ...overrides,
  };
}

const call = (path, method, body, d) => handleOAuthRequest(
  new Request(`https://mcp.test${path}`, { method, headers: { "content-type": "application/json" }, body }),
  new URL(`https://mcp.test${path}`), "203.0.113.9", d,
);

async function assert503(res, label) {
  const text = await res.text();
  assert.equal(res.status, 503, `${label}: ${res.status} ${text}`);
  assert.equal(res.headers.get("retry-after"), "5");
  const j = JSON.parse(text);
  assert.equal(j.error, "temporarily_unavailable");
  assert.ok(j.error_description && j.agent_instruction);
}

test("every grant endpoint → 503 when the rate-limit incr itself errors / KV errors", async () => {
  const reg = JSON.stringify({ client_name: "x", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  await assert503(await call("/register", "POST", reg, deps()), "/register");
  await assert503(await call("/token", "POST", "grant_type=refresh_token&refresh_token=x&client_id=c", deps()), "/token");
  await assert503(await call("/authorize?client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256", "GET", undefined, deps()), "/authorize GET");
});

test("mid-request failure: incr succeeds, the following kvSet errors → 503 (not 500)", async () => {
  const reg = JSON.stringify({ client_name: "x", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  const d = deps({ kvIncr: async () => 1, kvExpire: async () => 1 });
  await assert503(await call("/register", "POST", reg, d), "/register mid-request");
});

test("non-KV bugs are NOT masked as 503 (they still throw)", async () => {
  const bad = deps({ kvIncr: async () => 1, kvExpire: async () => 1, now: () => { throw new TypeError("bug"); } });
  await assert.rejects(() => call("/register", "POST", "{}", bad), TypeError);
});

test("discovery metadata is served with KV fully down", async () => {
  const res = await call("/.well-known/oauth-authorization-server", "GET", undefined, deps());
  assert.equal(res.status, 200);
});

test("resolveAccessTokenRecord: KV error → throws KvUnavailableError; KV miss → null", async () => {
  await assert.rejects(() => resolveAccessTokenRecord("nvo_at_abc", deps()), KvUnavailableError);
  assert.equal(await resolveAccessTokenRecord("nvo_at_abc", deps({ kvGet: async () => null })), null);
});
