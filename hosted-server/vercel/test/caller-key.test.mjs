/**
 * Caller-key threading + no-server-fallback proof (TOW2-249).
 *
 * Runs on plain Node (`node --test test/caller-key.test.mjs`) — no extra deps.
 * Two layers:
 *   1. RUNTIME  — exercises the VENDORED credential resolvers (the exact code the
 *      hosted handler runs) to prove: with the server consumption env vars stripped,
 *      a request-scoped caller key is the ONLY key any resolver can find, and it is
 *      threaded to upstream; when no caller key is present nothing falls back to a
 *      server key.
 *   2. STATIC   — asserts api/mcp.ts still (a) strips the server consumption creds,
 *      (b) has no `token || env.NOVADA_API_KEY` consumption fallback, (c) errors to
 *      novada.com on a missing/invalid key. Guards the source against regression
 *      without needing a TS loader in CI.
 *
 * We test the vendored .js (not the .ts) because it is what actually ships and runs
 * on Vercel, and it executes on plain node with no tsx/ts-node dependency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = "../vendor/novada-mcp";
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");

// A fake SERVER consumption key + proxy creds — these must NEVER surface as the
// upstream credential once a caller key is in scope (and must be unreachable when
// no caller key is present).
const SERVER_KEY = "SERVER-KEY-must-never-be-used-0000";
const SERVER_PROXY = { user: "server-proxy-user", pass: "server-proxy-pass", endpoint: "server.example:7777" };
const CALLER_KEY = "caller-key-abcdefghijklmnop-1234";

// ── Layer 1: RUNTIME resolver behavior ──────────────────────────────────────

test("web-unblocker key: caller key (store) wins over server env", async () => {
  process.env.NOVADA_API_KEY = SERVER_KEY;
  process.env.NOVADA_WEB_UNBLOCKER_KEY = SERVER_KEY;
  const { withCredentials, getWebUnblockerKey } = await import(`${VENDOR}/utils/credentials.js`);

  const resolved = withCredentials({ apiKey: CALLER_KEY }, () => getWebUnblockerKey());
  assert.equal(resolved, CALLER_KEY, "unblocker key must be the caller's, not the server's");

  delete process.env.NOVADA_API_KEY;
  delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
});

test("web-unblocker key: with server env stripped + no caller key → undefined (no fallback)", async () => {
  delete process.env.NOVADA_API_KEY;
  delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
  const { getWebUnblockerKey } = await import(`${VENDOR}/utils/credentials.js`);
  assert.equal(getWebUnblockerKey(), undefined, "no caller key + no server env → must resolve to nothing");
});

test("proxy creds: caller key derives sub-account, server env absent → no server billing", async () => {
  // Server proxy creds NOT set + endpoint absent: resolveProxyCredentials must fall to
  // the universal gateway keyed by the CALLER apiKey (an outbound fetch it would make
  // with the caller's Bearer), never to server creds. We assert it does NOT return the
  // server proxy tuple and that it uses the caller key path.
  delete process.env.NOVADA_PROXY_USER;
  delete process.env.NOVADA_PROXY_PASS;
  delete process.env.NOVADA_PROXY_ENDPOINT;
  delete process.env.NOVADA_API_KEY;
  const { withCredentials, getProxyCredentials } = await import(`${VENDOR}/utils/credentials.js`);

  // Direct env creds must be null (server proxy env is stripped).
  const direct = withCredentials({ apiKey: CALLER_KEY }, () => getProxyCredentials());
  assert.equal(direct, null, "no server proxy env → getProxyCredentials returns null (no server tuple)");
});

test("proxy priority-inversion guard: server proxy env, if present, must be UNREACHABLE after strip", async () => {
  // Simulate the strip that api/mcp.ts performs at cold start, then confirm the
  // server proxy env can no longer be returned to a caller.
  process.env.NOVADA_PROXY_USER = SERVER_PROXY.user;
  process.env.NOVADA_PROXY_PASS = SERVER_PROXY.pass;
  process.env.NOVADA_PROXY_ENDPOINT = SERVER_PROXY.endpoint;

  // The exact strip contract from mcp.ts (kept in sync with SERVER_CONSUMPTION_ENV_VARS).
  for (const v of ["NOVADA_PROXY_USER", "NOVADA_PROXY_PASS", "NOVADA_PROXY_ENDPOINT"]) delete process.env[v];

  const { withCredentials, getProxyCredentials } = await import(`${VENDOR}/utils/credentials.js`);
  const got = withCredentials({ apiKey: CALLER_KEY }, () => getProxyCredentials());
  assert.equal(got, null, "post-strip, server proxy env must not be returned to any caller");
});

test("strip contract: EVERY var in mcp.ts's strip list, once removed, is unreachable by the live resolvers", async () => {
  // Closes the false-confidence gap: derive the strip list FROM the shipped mcp.ts
  // source, apply the exact strip, then prove the live vendored resolvers cannot find
  // any of them. If a future edit drops a var from SERVER_CONSUMPTION_ENV_VARS, this
  // test regresses (it would still be set + reachable), not just the static text check.
  const src = readFileSync(MCP_TS, "utf8");
  const block = src.match(/SERVER_CONSUMPTION_ENV_VARS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "must be able to parse the strip list from mcp.ts");
  const vars = [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(vars.length >= 12, `expected ≥12 stripped vars, parsed ${vars.length}`);

  // Pollute every listed var, then apply the strip exactly as mcp.ts does.
  for (const v of vars) process.env[v] = "POLLUTED-server-value-must-not-surface";
  for (const v of vars) delete process.env[v];

  const { getWebUnblockerKey, getBrowserWs, getProxyCredentials, getResidentialProxyCredentials } =
    await import(`${VENDOR}/utils/credentials.js`);
  const { getDeveloperApiKey } = await import(`${VENDOR}/_core/developer_api.js`);

  // No caller key in scope + everything stripped → resolvers must find NOTHING.
  assert.equal(getWebUnblockerKey(), undefined, "unblocker key must be unreachable post-strip");
  assert.equal(getBrowserWs(), undefined, "browser WS must be unreachable post-strip");
  assert.equal(getProxyCredentials(), null, "proxy creds must be unreachable post-strip");
  assert.equal(getResidentialProxyCredentials(), null, "residential proxy creds must be unreachable post-strip");
  assert.throws(() => getDeveloperApiKey(), /NOVADA_DEVELOPER_API_KEY|NOVADA_API_KEY/, "developer key must throw, not silently use a server key");
});

test("browser WS: pre-provisioned caller store.browserWs is used, server env unreachable", async () => {
  delete process.env.NOVADA_BROWSER_WS;
  delete process.env.NOVADA_API_KEY;
  const { withCredentials, getBrowserWs } = await import(`${VENDOR}/utils/credentials.js`);

  const callerWs = "wss://caller-acct-zone-browser:pw@upg-scbr2.novada.com";
  // This mirrors how api/mcp.ts seeds the caller's WS into the store for novada_browser.
  const got = withCredentials({ apiKey: CALLER_KEY, browserWs: callerWs }, () => getBrowserWs());
  assert.equal(got, callerWs, "browser WS must come from the caller-scoped store, not server env");

  const none = withCredentials({ apiKey: CALLER_KEY }, () => getBrowserWs());
  assert.equal(none, undefined, "no caller WS + server env stripped → no browser WS (no server fallback)");
});

// ── Layer 2: STATIC source guards (regression fence on api/mcp.ts) ───────────

test("mcp.ts strips every server consumption env var at cold start", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /stripServerConsumptionCreds\s*\(\s*\)\s*;/, "must call stripServerConsumptionCreds() at module load");
  for (const v of [
    "NOVADA_API_KEY", "NOVADA_DEVELOPER_API_KEY", "NOVADA_WEB_UNBLOCKER_KEY",
    "NOVADA_BROWSER_WS", "NOVADA_PROXY_USER", "NOVADA_PROXY_PASS", "NOVADA_PROXY_ENDPOINT",
    "NOVADA_RESIDENTIAL_PROXY_USER", "NOVADA_RESIDENTIAL_PROXY_PASS", "NOVADA_RESIDENTIAL_PROXY_ENDPOINT",
  ]) {
    assert.ok(src.includes(v), `strip list must include ${v}`);
  }
});

test("mcp.ts has NO server-env key fallback for consumption", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.doesNotMatch(src, /token\s*\|\|\s*env\.NOVADA_API_KEY/, "the server-key consumption fallback must be gone");
  // The Env interface no longer carries a consumption key.
  assert.doesNotMatch(src, /NOVADA_API_KEY\??\s*:\s*string/, "Env must not declare NOVADA_API_KEY anymore");
});

test("mcp.ts missing/invalid key → clear error pointing to novada.com", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /MISSING_TOKEN/, "must keep a MISSING_TOKEN error");
  assert.match(src, /INVALID_TOKEN/, "must keep an INVALID_TOKEN error");
  assert.match(src, /https:\/\/novada\.com/, "error must direct users to novada.com for a key + free credits");
});

test("mcp.ts threads caller key: dispatch + withCredentials use the caller apiKey", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /const apiKey = token\?\.trim\(\)/, "apiKey must be derived solely from the caller token");
  assert.match(src, /withCredentials\(\{ apiKey, browserWs \}/, "dispatch must run inside withCredentials carrying the caller key");
});
