/**
 * End-to-end through the BUILT EC2 entrypoint (dist/server.mjs) with
 * REDIS_URL pointing at a REAL redis-server (redis-memory-server devDependency).
 *
 *  1. happy path: register → authorize → token → /mcp tools/list (nvo_at_),
 *     refresh-token rotation (old RT dead, new RT works), and persistence
 *     across a server restart (tokens live in redis, not process memory).
 *  2. fault path: redis killed mid-run →
 *       /register, /token       → 503 JSON {error:"temporarily_unavailable",
 *                                 error_description, agent_instruction} + Retry-After
 *       /mcp with nvo_at_ token → 503 (NOT 401) + Retry-After
 *       /mcp with a raw API key → still 200 (rate-limit/verify KV calls fail open)
 *     then redis revived on the same port → the server reconnects by itself
 *     (/register 201), and a token that is genuinely gone is a 401 MISS, not 503.
 *
 * The Novada wallet probe is stubbed (support/stub-upstream.mjs) — nothing
 * leaves 127.0.0.1. Skips loudly if dist/server.mjs or a redis binary is missing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tryStartRedis } from "./support/redis-fixture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST_SERVER = join(ROOT, "dist", "server.mjs");
const STUB_UPSTREAM = pathToFileURL(join(__dirname, "support", "stub-upstream.mjs")).href;

const ENC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const API_KEY = "redisE2eTestKey0123456789"; // format-valid, probe is stubbed
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function waitForLog(child, pattern, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let out = "";
    const onData = (c) => { out += c.toString(); if (pattern.test(out)) { cleanup(); resolve(); } };
    const onExit = (code) => { cleanup(); reject(new Error(`exited (${code}) before ${pattern}; out=${out}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${pattern}; out=${out}`)); }, timeoutMs);
    function cleanup() { clearTimeout(timer); child.stdout.off("data", onData); child.off("exit", onExit); }
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

async function startServer(redisUrl) {
  const port = await freePort();
  const child = spawn(process.execPath, [DIST_SERVER], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      NODE_OPTIONS: `--import ${STUB_UPSTREAM}`,
      HOST: "127.0.0.1",
      PORT: String(port),
      WEB_CONCURRENCY: "1",
      STUB_AUTH_WARNING_ACCEPTED: "true",
      REDIS_URL: redisUrl,
      CRON_SECRET: "dummy-test-cron-secret-not-real",
      OAUTH_ENC_KEY: ENC_KEY_B64,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  await waitForLog(child, /listening on/);
  return {
    base: `http://127.0.0.1:${port}`,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await exited;
    },
  };
}

async function register(base) {
  return fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "redis-e2e", redirect_uris: [REDIRECT] }),
  });
}

async function fullFlow(base) {
  const reg = await register(base);
  assert.equal(reg.status, 201, `register: ${await reg.clone().text()}`);
  const clientId = (await reg.json()).client_id;
  const authz = await fetch(`${base}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      api_key: API_KEY, client_id: clientId, redirect_uri: REDIRECT,
      code_challenge: CHALLENGE, code_challenge_method: "S256", state: "e2e",
    }).toString(),
  });
  assert.equal(authz.status, 302, `authorize: ${await authz.text()}`);
  const code = new URL(authz.headers.get("location")).searchParams.get("code");
  const tok = await postToken(base, { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id: clientId });
  assert.equal(tok.status, 200, `token: ${await tok.clone().text()}`);
  return { clientId, ...(await tok.json()) };
}

function postToken(base, fields) {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function mcpCall(base, bearer, method = "tools/list") {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
}

async function assertKv503(res, label) {
  const text = await res.text();
  assert.equal(res.status, 503, `${label}: expected 503, got ${res.status} ${text}`);
  assert.ok(Number(res.headers.get("retry-after")) > 0, `${label}: Retry-After header`);
  assert.equal(res.headers.get("content-type")?.startsWith("application/json"), true, `${label}: JSON`);
  return JSON.parse(text);
}

const skipReason = !existsSync(DIST_SERVER) && "dist/server.mjs missing — run npm run build:server";

test("redis-backed OAuth: happy path, rotation, persistence; redis kill → 503; revive → recovers", { skip: skipReason, timeout: 120000 }, async (t) => {
  const redis = await tryStartRedis();
  if (!redis) return t.skip("NO REDIS BINARY — redis e2e NOT run");
  let server;
  try {
    server = await startServer(redis.url);
    const { base } = server;

    const first = await fullFlow(base);
    assert.match(first.access_token, /^nvo_at_/);
    assert.ok(first.refresh_token);

    await t.test("tools/list with the nvo_at_ token works against redis", async () => {
      const res = await mcpCall(base, first.access_token);
      assert.equal(res.status, 200, await res.clone().text());
      const body = await res.json();
      assert.ok(body.result.tools.length > 5);
    });

    let rotated;
    await t.test("refresh rotation: new pair works, old refresh token is dead", async () => {
      const r1 = await postToken(base, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId });
      assert.equal(r1.status, 200, await r1.clone().text());
      rotated = await r1.json();
      assert.notEqual(rotated.refresh_token, first.refresh_token);
      const replay = await postToken(base, { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId });
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).error, "invalid_grant");
      const ok = await mcpCall(base, rotated.access_token);
      assert.equal(ok.status, 200);
    });

    await t.test("persistence: restarting the server keeps OAuth tokens (state is in redis)", async () => {
      await server.stop();
      server = await startServer(redis.url);
      const res = await mcpCall(server.base, rotated.access_token);
      assert.equal(res.status, 200, await res.clone().text());
    });

    // ── fault path ──────────────────────────────────────────────────────────
    await redis.stop();

    await t.test("redis down: /register → 503 temporarily_unavailable (not 500)", async () => {
      const t0 = Date.now();
      const res = await register(server.base);
      const body = await assertKv503(res, "/register");
      assert.equal(body.error, "temporarily_unavailable");
      assert.ok(body.error_description && body.agent_instruction, "structured body");
      assert.ok(Date.now() - t0 < 6000, "must not hang on a dead redis");
    });

    await t.test("redis down: /token → 503", async () => {
      const res = await postToken(server.base, { grant_type: "refresh_token", refresh_token: rotated.refresh_token, client_id: first.clientId });
      const body = await assertKv503(res, "/token");
      assert.equal(body.error, "temporarily_unavailable");
    });

    await t.test("redis down: /mcp with nvo_at_ → 503 (NOT 401 — clients must keep their tokens)", async () => {
      const res = await mcpCall(server.base, rotated.access_token);
      const body = await assertKv503(res, "/mcp nvo_at_");
      assert.equal(body.error.data.code, "KV_UNAVAILABLE");
      assert.ok(body.error.data.agent_instruction);
    });

    await t.test("redis down: /mcp with a raw API key still serves 200 (KV calls fail open)", async () => {
      const t0 = Date.now();
      const res = await mcpCall(server.base, API_KEY);
      assert.equal(res.status, 200, await res.clone().text());
      assert.ok((await res.json()).result.tools.length > 5);
      assert.ok(Date.now() - t0 < 6000, "must not hang on a dead redis");
    });

    await t.test("discovery metadata needs no KV and stays 200", async () => {
      const res = await fetch(`${server.base}/.well-known/oauth-authorization-server`);
      assert.equal(res.status, 200);
    });

    await t.test("redis revived: server reconnects by itself; a genuinely-missing token is 401 (miss), not 503", async () => {
      await redis.start(); // fresh empty redis on the same port → all old tokens are gone
      let status = 0;
      for (let i = 0; i < 40 && status !== 201; i++) {
        status = (await register(server.base)).status;
        if (status !== 201) await new Promise((r) => setTimeout(r, 250));
      }
      assert.equal(status, 201, "register recovers after redis returns");
      const res = await mcpCall(server.base, rotated.access_token);
      assert.equal(res.status, 401, "KV miss stays a 401 INVALID_TOKEN");
    });

    assert.doesNotMatch(server.stderr(), /UnhandledPromiseRejection|Unhandled 'error' event/, "no crash-class noise");
  } finally {
    await server?.stop();
    await redis.stop();
  }
});
