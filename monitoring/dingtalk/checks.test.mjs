// monitoring/dingtalk/checks.test.mjs
//
// node:test coverage for checks.mjs, fully offline against a stub
// `fetchFn` — no NOVADA_TEST_KEY, no network. Covers: initialize shape,
// tools/list vs golden-baseline count, OAuth discovery required fields,
// the unauthenticated-401 sign-in probe, and structured-error-code
// extraction from a billable tool's `isError: true` text (the
// "Error [CODE]: message" convention from npm-package's
// NovadaError.toAgentString()).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  probeInitialize,
  probeToolsList,
  probeOAuthDiscovery,
  probeUnauthenticated401,
  probeNovadaSetup,
  probeNovadaSearch,
  probeNovadaExtract,
  probeScrapeGoogle,
  probeScrapeBing,
  probeNovadaAccount,
  runChecks,
  CHECK_TABLE,
  API_KEY_ENV_VAR,
  requiredEnvVarsForCosts,
} from "./checks.mjs";

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

// ── initialize ───────────────────────────────────────────────────────────────

test("probeInitialize: ok when serverInfo.version present", async () => {
  const fetchFn = async () => jsonResponse(200, { jsonrpc: "2.0", id: 1, result: { serverInfo: { version: "0.9.42" } } });
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, true);
  assert.equal(r.detail.version, "0.9.42");
});

test("probeInitialize: fails when serverInfo.version missing", async () => {
  const fetchFn = async () => jsonResponse(200, { jsonrpc: "2.0", id: 1, result: {} });
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "shape");
});

test("probeInitialize: fails on non-200", async () => {
  const fetchFn = async () => jsonResponse(402, { error: "DEPLOYMENT_DISABLED" });
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "http");
});

test("probeInitialize: fails on network error", async () => {
  const fetchFn = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "network");
});

// ── CRITICAL finding (2026-10-23 review): initialize/tools_list/novada_setup
// are "free" (no billing) but the hosted server still requires an API key to
// authenticate. Missing ctx.apiKey must report a distinct "config"
// misconfiguration, never attempt the call, and never look like a real
// outage (network/http/shape) — see checks.mjs's requireApiKey().
test("probeInitialize: config-fails (not network-fails) when apiKey is missing, and never calls fetchFn", async () => {
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", fetchFn: async () => { throw new Error("must not be called"); } });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "config");
  assert.match(r.note, /monitor misconfigured/);
  assert.match(r.note, new RegExp(API_KEY_ENV_VAR));
});

test("probeToolsList: config-fails (not network-fails) when apiKey is missing, and never calls fetchFn", async () => {
  const r = await probeToolsList({ mcpUrl: "https://x/mcp", fetchFn: async () => { throw new Error("must not be called"); } });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "config");
  assert.match(r.note, /monitor misconfigured/);
});

test("probeNovadaSetup: config-fails (not network-fails) when apiKey is missing, and never calls fetchFn", async () => {
  const r = await probeNovadaSetup({ mcpUrl: "https://x/mcp", fetchFn: async () => { throw new Error("must not be called"); } });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "config");
  assert.match(r.note, /monitor misconfigured/);
});

test("probeNovadaExtract/probeScrapeGoogle/probeScrapeBing: all config-fail the same way when apiKey is missing (class-not-instance — not a per-tool special case)", async () => {
  const neverCall = async () => { throw new Error("must not be called"); };
  for (const probe of [probeNovadaExtract, probeScrapeGoogle, probeScrapeBing]) {
    const r = await probe({ mcpUrl: "https://x/mcp", fetchFn: neverCall });
    assert.equal(r.ok, false);
    assert.equal(r.errorClass, "config");
    assert.match(r.note, /monitor misconfigured/);
  }
});

test("probeInitialize: succeeds normally once apiKey IS present (guard doesn't block real calls)", async () => {
  const fetchFn = async () => jsonResponse(200, { result: { serverInfo: { version: "0.9.42" } } });
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, true);
});

// ── tools/list vs golden baseline ───────────────────────────────────────────

test("probeToolsList: ok when count matches expectedToolCount", async () => {
  const fetchFn = async () => jsonResponse(200, { result: { tools: [{ name: "a" }, { name: "b" }] } });
  const r = await probeToolsList({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn, expectedToolCount: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.detail.count, 2);
});

test("probeToolsList: fails when count diverges from golden baseline", async () => {
  const fetchFn = async () => jsonResponse(200, { result: { tools: [{ name: "a" }] } });
  const r = await probeToolsList({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn, expectedToolCount: 28 });
  assert.equal(r.ok, false);
  assert.match(r.note, /count 1 != golden baseline 28/);
});

test("probeToolsList: skips the count check (passes) when expectedToolCount is unknown", async () => {
  const fetchFn = async () => jsonResponse(200, { result: { tools: [{ name: "a" }] } });
  const r = await probeToolsList({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn }); // no expectedToolCount
  assert.equal(r.ok, true);
});

// ── OAuth discovery ──────────────────────────────────────────────────────────

test("probeOAuthDiscovery: ok when both metadata documents carry required fields", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes("oauth-protected-resource")) {
      return jsonResponse(200, { resource: "https://mcp.novada.com/mcp", authorization_servers: ["https://mcp.novada.com"] });
    }
    return jsonResponse(200, {
      issuer: "https://mcp.novada.com",
      authorization_endpoint: "https://mcp.novada.com/authorize",
      token_endpoint: "https://mcp.novada.com/token",
    });
  };
  const r = await probeOAuthDiscovery({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test("probeOAuthDiscovery: fails when a required field is missing", async () => {
  const fetchFn = async (url) => {
    if (url.includes("oauth-protected-resource")) return jsonResponse(200, { resource: "x" }); // missing authorization_servers
    return jsonResponse(200, { issuer: "x", authorization_endpoint: "y", token_endpoint: "z" });
  };
  const r = await probeOAuthDiscovery({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn });
  assert.equal(r.ok, false);
  assert.match(r.note, /authorization_servers/);
});

test("probeOAuthDiscovery: fails when either endpoint is unreachable", async () => {
  const fetchFn = async (url) => {
    if (url.includes("oauth-authorization-server")) throw new Error("ECONNREFUSED");
    return jsonResponse(200, { resource: "x", authorization_servers: ["x"] });
  };
  const r = await probeOAuthDiscovery({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "network");
});

// ── unauthenticated 401 ──────────────────────────────────────────────────────

test("probeUnauthenticated401: ok on 401 + WWW-Authenticate with resource_metadata", async () => {
  const fetchFn = async () => ({
    status: 401,
    headers: { get: (k) => (k.toLowerCase() === "www-authenticate" ? 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource/mcp"' : null) },
  });
  const r = await probeUnauthenticated401({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn });
  assert.equal(r.ok, true);
});

test("probeUnauthenticated401: fails when status isn't 401 (sign-in gate not enforced)", async () => {
  const fetchFn = async () => ({ status: 200, headers: { get: () => null } });
  const r = await probeUnauthenticated401({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn });
  assert.equal(r.ok, false);
});

test("probeUnauthenticated401: fails when WWW-Authenticate header missing", async () => {
  const fetchFn = async () => ({ status: 401, headers: { get: () => null } });
  const r = await probeUnauthenticated401({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn });
  assert.equal(r.ok, false);
  assert.match(r.note, /WWW-Authenticate/);
});

// ── Structured error-code extraction (billable tool calls) ─────────────────

test("probeNovadaSearch: extracts NovadaErrorCode from the tool's isError text", async () => {
  const errorText = [
    "Error [RATE_LIMITED]: Rate limit exceeded. API is throttling your requests.",
    "failure_class: transient",
    "retry_recommended: true",
    'agent_instruction: "wait and retry"',
  ].join("\n");
  const fetchFn = async () => jsonResponse(200, { result: { isError: true, content: [{ type: "text", text: errorText }] } });
  const r = await probeNovadaSearch({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "RATE_LIMITED");
  assert.equal(r.errorClass, "tool");
});

test("probeNovadaSearch: ok on a clean (non-isError) result", async () => {
  const fetchFn = async () => jsonResponse(200, { result: { content: [{ type: "text", text: "search results..." }] } });
  const r = await probeNovadaSearch({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.ok, true);
});

test("probeNovadaSearch: config-fails (not network-fails) when apiKey is missing", async () => {
  const r = await probeNovadaSearch({ mcpUrl: "https://x/mcp", fetchFn: async () => { throw new Error("must not be called"); } });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "config");
});

test("probeNovadaAccount: extracts errorCode the same way", async () => {
  const fetchFn = async () =>
    jsonResponse(200, { result: { isError: true, content: [{ type: "text", text: "Error [INVALID_API_KEY]: Invalid or missing API key." }] } });
  const r = await probeNovadaAccount({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn });
  assert.equal(r.errorCode, "INVALID_API_KEY");
});

// ── CHECK_TABLE / runChecks plumbing ─────────────────────────────────────────

test("CHECK_TABLE: every row has a unique id and a valid cost/severity", () => {
  const ids = new Set();
  for (const row of CHECK_TABLE) {
    assert.ok(!ids.has(row.id), `duplicate check id: ${row.id}`);
    ids.add(row.id);
    assert.ok(["free", "billable"].includes(row.cost), `${row.id}: invalid cost`);
    assert.ok(["P0", "P1", "P2", "P3"].includes(row.severity), `${row.id}: invalid severity`);
    assert.equal(typeof row.probe, "function");
  }
});

test("CHECK_TABLE: every row has an English id/label AND a non-empty Chinese labelZh (DingTalk-facing surface stays Chinese, code stays English)", () => {
  for (const row of CHECK_TABLE) {
    assert.equal(typeof row.id, "string");
    assert.ok(/^[a-z][a-z0-9_]*$/.test(row.id), `${row.id}: id must stay a plain English identifier`);
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.labelZh, "string");
    assert.ok(row.labelZh.length > 0, `${row.id}: labelZh must not be empty`);
    assert.ok(/[一-鿿]/.test(row.labelZh), `${row.id}: labelZh must actually contain Chinese characters`);
  }
});

test("CHECK_TABLE: requiredEnvVars is a class-level declaration, not a per-id guess — every auth-requiring probe (and ONLY those) declares NOVADA_TEST_KEY", () => {
  const authFreeIds = new Set(["oauth_discovery", "unauthenticated_401"]);
  for (const row of CHECK_TABLE) {
    assert.ok(Array.isArray(row.requiredEnvVars), `${row.id}: requiredEnvVars must be an array`);
    if (authFreeIds.has(row.id)) {
      assert.deepEqual(row.requiredEnvVars, [], `${row.id}: this check is intentionally unauthenticated by design, must declare no required env vars`);
    } else {
      assert.ok(row.requiredEnvVars.includes(API_KEY_ENV_VAR), `${row.id}: this check needs ${API_KEY_ENV_VAR} to authenticate, must declare it`);
    }
  }
});

test("requiredEnvVarsForCosts(['free']): only the free rows that actually need it include NOVADA_TEST_KEY", () => {
  const vars = requiredEnvVarsForCosts(["free"]);
  assert.ok(vars.has(API_KEY_ENV_VAR), "alert-check mode runs initialize/tools_list/novada_setup, all of which need the test key");
});

test("requiredEnvVarsForCosts(['free','billable']): daily mode's set is a superset of alert mode's", () => {
  const alertVars = requiredEnvVarsForCosts(["free"]);
  const dailyVars = requiredEnvVarsForCosts(["free", "billable"]);
  for (const v of alertVars) assert.ok(dailyVars.has(v));
});

test("runChecks(['free']) only runs free rows, runChecks(['free','billable']) runs everything", async () => {
  const fetchFn = async (url, opts) => {
    if (!opts || opts.method === "GET") return jsonResponse(200, { resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" });
    return jsonResponse(200, { result: { serverInfo: { version: "0.9.42" }, tools: [] } });
  };
  const freeOnly = await runChecks({ mcpUrl: "https://x/mcp", fetchFn }, ["free"]);
  assert.equal(freeOnly.length, CHECK_TABLE.filter((r) => r.cost === "free").length);

  const everything = await runChecks({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn }, ["free", "billable"]);
  assert.equal(everything.length, CHECK_TABLE.length);
});

test("runChecks: a throwing probe is caught and reported as a failed row, not a crash", async () => {
  const fetchFn = async () => {
    throw new Error("boom");
  };
  const results = await runChecks({ mcpUrl: "https://x/mcp", fetchFn }, ["free"]);
  assert.equal(results.length, CHECK_TABLE.filter((r) => r.cost === "free").length);
  assert.ok(results.every((r) => r.ok === false));
});
