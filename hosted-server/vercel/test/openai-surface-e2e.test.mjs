/**
 * End-to-end: the per-client surface through the BUILT EC2 entrypoint
 * (dist/server.mjs) over real HTTP, with a real OAuth flow.
 *
 * A local Upstash-REST stub (support/kv-stub.mjs, spawned on a free port)
 * stands in for KV. The only seeded entry is the key-verification cache
 * verdict for the fake API key below, so validateToken never calls the real
 * Novada API — no request in this file leaves 127.0.0.1.
 *
 * Flow per client: POST /register → POST /authorize (paste key) → POST /token
 * → POST /mcp. The ChatGPT-registered client uses client_secret_post at
 * registration and HTTP Basic at /token (what OpenAI's portal sends), so this
 * also covers spec §4.1.
 *
 * Skips (not fails) if dist/server.mjs is missing — run `npm run build:server`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST_SERVER = join(ROOT, "dist", "server.mjs");
const KV_STUB = join(__dirname, "support", "kv-stub.mjs");

const ENC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const FAKE_API_KEY = "e2eSurfaceTestKey0123456789"; // format-valid, never sent upstream
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const OPENAI_17 = [
  "novada_search", "novada_extract", "novada_crawl", "novada_research",
  "novada_scrape_google", "novada_scrape_bing", "novada_scrape_duckduckgo", "novada_scrape_yandex",
  "novada_scrape_amazon", "novada_scrape_walmart", "novada_scrape_perplexity", "novada_scrape_youtube",
  "novada_scrape_github", "novada_proxy", "novada_ai_monitor", "novada_account", "novada_proxy_account_list",
];

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function waitForLog(child, pattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let out = "";
    const onData = (chunk) => {
      out += chunk.toString();
      if (pattern.test(out)) { cleanup(); resolve(); }
    };
    const onExit = (code) => { cleanup(); reject(new Error(`process exited (code=${code}) before ${pattern}; out=${out}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timed out waiting for ${pattern}; out=${out}`)); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

async function kvCommand(kvBase, cmd) {
  const res = await fetch(kvBase, {
    method: "POST",
    headers: { authorization: "Bearer stub", "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return (await res.json()).result;
}

async function oauthToken(base, redirectUri, { authMethod, basicAtToken } = {}) {
  const reg = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "e2e",
      redirect_uris: [redirectUri],
      ...(authMethod ? { token_endpoint_auth_method: authMethod } : {}),
    }),
  });
  assert.equal(reg.status, 201, `register: ${await reg.clone().text()}`);
  const regBody = await reg.json();
  assert.equal(regBody.token_endpoint_auth_method, "none");
  assert.equal(regBody.client_secret, undefined, "no client_secret is ever issued");
  const clientId = regBody.client_id;

  const authz = await fetch(`${base}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      api_key: FAKE_API_KEY,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: "S256",
      state: "e2e",
    }).toString(),
  });
  assert.equal(authz.status, 302, `authorize: ${await authz.text()}`);
  const code = new URL(authz.headers.get("location")).searchParams.get("code");

  const tokenFields = { grant_type: "authorization_code", code, code_verifier: RFC_VERIFIER, redirect_uri: redirectUri };
  const tokenHeaders = { "content-type": "application/x-www-form-urlencoded" };
  if (basicAtToken) {
    tokenHeaders.authorization = `Basic ${Buffer.from(`${clientId}:unused-secret`).toString("base64")}`;
  } else {
    tokenFields.client_id = clientId;
  }
  const tok = await fetch(`${base}/token`, { method: "POST", headers: tokenHeaders, body: new URLSearchParams(tokenFields).toString() });
  assert.equal(tok.status, 200, `token: ${await tok.clone().text()}`);
  return (await tok.json()).access_token;
}

async function mcp(base, bearer, method, params = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(res.status, 200, `${method}: HTTP ${res.status} ${await res.clone().text()}`);
  const body = await res.json();
  assert.equal(body.error, undefined, `${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

test("per-client tool surface through the built server", { skip: !existsSync(DIST_SERVER) && "dist/server.mjs missing — run npm run build:server" }, async (t) => {
  const kvPort = await getFreePort();
  const kv = spawn(process.execPath, [KV_STUB], { env: { PATH: process.env.PATH, KV_STUB_PORT: String(kvPort) }, stdio: ["ignore", "pipe", "pipe"] });
  const port = await getFreePort();
  let server;
  try {
    await waitForLog(kv, /listening on/);
    const kvBase = `http://127.0.0.1:${kvPort}`;
    const keyHash = createHash("sha256").update(FAKE_API_KEY).digest("hex");
    await kvCommand(kvBase, ["set", `tokver:${keyHash}`, JSON.stringify({ valid: true, verified: true }), "ex", 600]);

    server = spawn(process.execPath, [DIST_SERVER], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOST: "127.0.0.1",
        PORT: String(port),
        WEB_CONCURRENCY: "1",
        STUB_AUTH_WARNING_ACCEPTED: "true",
        KV_REST_API_URL: kvBase,
        KV_REST_API_TOKEN: "stub",
        CRON_SECRET: "dummy-test-cron-secret-not-real",
        OAUTH_ENC_KEY: ENC_KEY_B64,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForLog(server, /listening on/);
    const base = `http://127.0.0.1:${port}`;

    const chatgptToken = await oauthToken(base, CHATGPT_REDIRECT, { authMethod: "client_secret_post", basicAtToken: true });
    const claudeToken = await oauthToken(base, CLAUDE_REDIRECT);

    await t.test("ChatGPT-registered client: initialize carries routing instructions and advertises tools only", async () => {
      const init = await mcp(base, chatgptToken, "initialize", {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openai-mcp", version: "1.0.0" },
      });
      assert.match(init.instructions ?? "", /novada_search/);
      assert.deepEqual(Object.keys(init.capabilities).sort(), ["tools"]);
    });

    await t.test("ChatGPT-registered client: tools/list is exactly the 17, scrapers not read-only", async () => {
      const { tools } = await mcp(base, chatgptToken, "tools/list");
      assert.deepEqual(tools.map((x) => x.name).sort(), [...OPENAI_17].sort());
      const google = tools.find((x) => x.name === "novada_scrape_google");
      assert.equal(google.annotations.readOnlyHint, false);
      assert.equal(google.annotations.destructiveHint, false);
      assert.equal(tools.find((x) => x.name === "novada_search").annotations.readOnlyHint, true);
      const text = JSON.stringify(tools);
      assert.doesNotMatch(text, /novada_scrape\(|novada_map|novada_discover|\{\{sibling/);
      assert.doesNotMatch(text, /free credits|cheaper|fastest/i);
    });

    for (const name of ["novada_scrape", "novada_static_ip_mgmt", "novada_health", "novada_scraper_submit"]) {
      await t.test(`ChatGPT-registered client: calling ${name} is refused without pointing at another client`, async () => {
        const result = await mcp(base, chatgptToken, "tools/call", { name, arguments: {} });
        assert.equal(result.isError, true);
        const text = result.content[0].text;
        assert.match(text, /not available in this app/);
        assert.doesNotMatch(text, /npx|npm|local MCP/i);
      });
    }

    await t.test("Claude-registered client: unchanged 29-tool surface, scrapers still read-only, no instructions", async () => {
      const init = await mcp(base, claudeToken, "initialize", {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1.0.0" },
      });
      assert.equal(init.instructions, undefined);
      assert.ok(init.capabilities.prompts && init.capabilities.resources);
      const { tools } = await mcp(base, claudeToken, "tools/list");
      assert.equal(tools.length, 29);
      assert.ok(tools.some((x) => x.name === "novada_scrape"));
      assert.equal(tools.find((x) => x.name === "novada_scrape_google").annotations.readOnlyHint, true);
    });

    await t.test("raw API key: unchanged 29-tool surface", async () => {
      const { tools } = await mcp(base, FAKE_API_KEY, "tools/list");
      assert.equal(tools.length, 29);
    });

    await t.test("/mcp CORS preflight allows mcp-protocol-version", async () => {
      const res = await fetch(`${base}/mcp`, { method: "OPTIONS" });
      assert.equal(res.status, 204);
      assert.match(res.headers.get("access-control-allow-headers") ?? "", /mcp-protocol-version/);
    });
  } finally {
    server?.kill("SIGTERM");
    kv.kill("SIGTERM");
  }
});
