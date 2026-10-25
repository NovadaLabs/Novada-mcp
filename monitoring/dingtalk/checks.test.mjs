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
  runChecksWithConfirmation,
  REPROBE_DELAY_MS,
  CHECK_TABLE,
  API_KEY_ENV_VAR,
  requiredEnvVarsForCosts,
  HOSTED_FUNCTION_LIMIT_MS,
  BILLABLE_CHECK_TIMEOUT_MS,
} from "./checks.mjs";

/** A stub fetchFn that actually RESPECTS `opts.signal` the way real
 * fetch/undici does — resolves with `body` after `delayMs`, but rejects
 * early (with the signal's own abort reason, or a synthesized AbortError)
 * the instant the AbortController/AbortSignal fires. Needed to test timeout
 * behavior deterministically and fast: most of these tests use a tiny
 * `timeoutMs` so the abort always wins the race against `delayMs`. */
function slowFetch(delayMs, body) {
  return (url, opts) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(body), delayMs);
      opts?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(opts.signal.reason instanceof Error ? opts.signal.reason : Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
}

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

// ── Probe-side timeout gets its OWN errorClass (2026-10-23 fix) ─────────────
//
// The first real daily run reported novada_scrape_bing as FAIL "timeout
// after 10000ms" when the upstream call was merely slow (6-15s), not down —
// a probe-side AbortController/AbortSignal firing must never be reported
// with the SAME errorClass ("network") as a real DNS/connection failure, so
// it can get a distinct "monitor timed out, server may still be working"
// annotation (run.mjs's ERROR_CLASS_CLASSIFICATION) instead of "服务端/网络".

test("probeInitialize: a probe-side timeout gets errorClass 'timeout' (distinct from a real network failure), latency is still reported", async () => {
  const fetchFn = slowFetch(200, jsonResponse(200, { result: { serverInfo: { version: "0.9.42" } } }));
  const r = await probeInitialize({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "timeout");
  assert.match(r.note, /timeout after 20ms/);
  assert.ok(r.latencyMs >= 15 && r.latencyMs < 200, `latency should be ~20ms (abort), got ${r.latencyMs}ms`);
});

test("probeToolsList: a probe-side timeout gets errorClass 'timeout'", async () => {
  const fetchFn = slowFetch(200, jsonResponse(200, { result: { tools: [] } }));
  const r = await probeToolsList({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "timeout");
});

test("probeOAuthDiscovery: a probe-side timeout gets errorClass 'timeout'", async () => {
  const fetchFn = slowFetch(200, { status: 200, headers: { get: () => null }, text: async () => "{}" });
  const r = await probeOAuthDiscovery({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "timeout");
});

test("probeUnauthenticated401: a probe-side timeout gets errorClass 'timeout' (exercises the native AbortSignal.timeout() path, a different API than httpGet/rpcCall's manual AbortController)", async () => {
  const fetchFn = slowFetch(200, { status: 401, headers: { get: () => null } });
  const r = await probeUnauthenticated401({ mcpUrl: "https://mcp.novada.com/mcp", fetchFn, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "timeout");
});

test("probeNovadaSearch (billable tool call via interpretToolCallResult): a probe-side timeout gets errorClass 'timeout', not 'network'", async () => {
  const fetchFn = slowFetch(200, jsonResponse(200, { result: { content: [{ type: "text", text: "ok" }] } }));
  const r = await probeNovadaSearch({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "timeout");
});

// ── Per-check timeout as a CHECK_TABLE column (2026-10-23 fix) ──────────────

test("CHECK_TABLE: every billable check's timeoutMs is >= the hosted server's own HOSTED_FUNCTION_LIMIT_MS ceiling — the probe must never give up before the server itself would", () => {
  for (const row of CHECK_TABLE.filter((r) => r.cost === "billable")) {
    assert.ok(
      row.timeoutMs >= HOSTED_FUNCTION_LIMIT_MS,
      `${row.id}: timeoutMs ${row.timeoutMs} must be >= HOSTED_FUNCTION_LIMIT_MS ${HOSTED_FUNCTION_LIMIT_MS}`
    );
    assert.equal(row.timeoutMs, BILLABLE_CHECK_TIMEOUT_MS, `${row.id}: billable rows share ONE class-level timeout, never a per-tool instance value`);
  }
});

test("CHECK_TABLE: free checks keep the original short timeout (metadata/discovery against the gateway itself is cheap — unchanged behavior)", () => {
  for (const row of CHECK_TABLE.filter((r) => r.cost === "free")) {
    assert.equal(row.timeoutMs, 10_000, `${row.id}: free-check timeout must stay 10s`);
  }
});

test("CHECK_TABLE: every row declares a numeric slowThresholdMs strictly under its own timeoutMs, class-level by cost", () => {
  for (const row of CHECK_TABLE) {
    assert.equal(typeof row.slowThresholdMs, "number", `${row.id}: slowThresholdMs must be a number`);
    assert.ok(row.slowThresholdMs > 0 && row.slowThresholdMs < row.timeoutMs, `${row.id}: slowThresholdMs must sit strictly between 0 and timeoutMs`);
  }
});

test("runChecks: per-row CHECK_TABLE timeoutMs overrides a short/stale ctx.timeoutMs — the EXACT 2026-10-23 regression (a slow-but-real billable response must still succeed)", async () => {
  // Every billable row's real latency (6-15s measured) would have been
  // killed by the OLD flat ctx.timeoutMs=10000; here it's a 5ms ctx-level
  // value (even more hostile) against a fetch that resolves in 50ms — this
  // only passes if runChecks lets row.timeoutMs (65000) win over ctx.timeoutMs.
  const fetchFn = slowFetch(50, jsonResponse(200, { result: { content: [{ type: "text", text: "ok" }] } }));
  const results = await runChecks({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn, timeoutMs: 5 }, ["billable"]);
  assert.equal(results.length, CHECK_TABLE.filter((r) => r.cost === "billable").length);
  for (const r of results) {
    assert.equal(r.ok, true, `${r.id} unexpectedly failed under the per-row timeout fix: ${r.note}`);
  }
});

test("runChecks: lowering ONE row's CHECK_TABLE.timeoutMs changes only that check's effective budget — no cross-talk between rows sharing one batch", async () => {
  const initializeRow = CHECK_TABLE.find((r) => r.id === "initialize");
  const originalTimeout = initializeRow.timeoutMs;
  initializeRow.timeoutMs = 20; // artificially tight, well under the real 10s default
  try {
    const fetchFn = slowFetch(200, jsonResponse(200, { result: { serverInfo: { version: "0.9.42" }, tools: [] } }));
    const results = await runChecks({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn }, ["free"]);
    const initializeResult = results.find((r) => r.id === "initialize");
    const toolsListResult = results.find((r) => r.id === "tools_list");
    assert.equal(initializeResult.ok, false);
    assert.equal(initializeResult.errorClass, "timeout");
    // tools_list keeps its OWN (unmutated) row.timeoutMs=10000, so the same
    // 200ms-delayed fetchFn still succeeds for it — proves the timeout is
    // genuinely per-row, not one shared mutable default.
    assert.equal(toolsListResult.ok, true, `tools_list should be unaffected by initialize's row-level timeout override: ${toolsListResult.note}`);
  } finally {
    initializeRow.timeoutMs = originalTimeout;
  }
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

test("runChecks({ids}): restricts to just the given ids, intersected with costs", async () => {
  const fetchFn = async (url, opts) => {
    if (opts.method === "GET") return jsonResponse(200, { resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" });
    return jsonResponse(200, { result: { serverInfo: { version: "0.9.42" }, tools: [] } });
  };
  const results = await runChecks({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn }, ["free"], { ids: ["initialize", "oauth_discovery"] });
  assert.deepEqual(results.map((r) => r.id).sort(), ["initialize", "oauth_discovery"]);

  // A billable id is never run when costs=["free"], even if listed in ids.
  const filtered = await runChecks({ mcpUrl: "https://x/mcp", apiKey: "k", fetchFn }, ["free"], { ids: ["novada_search"] });
  assert.equal(filtered.length, 0);
});

// ── runChecksWithConfirmation (2026-10-25 cadence change) ───────────────────
// alert-check moved from every-15-min to 4x/day; the old "2 consecutive
// 15-min-apart runs" dedupe would delay a real outage alert by 6-12h at
// that cadence. Replacement: ONE in-run re-probe, after REPROBE_DELAY_MS,
// for any check that fails on the first pass (config-class/missing-secret
// failures excepted — see checks.mjs's own comment on why those are never
// worth re-probing).

test("runChecksWithConfirmation: no failures -> returns the first pass unchanged, sleep never called (no wasted wait)", async () => {
  let sleepCalled = false;
  const fetchFn = async (url, opts) => {
    if (opts.method === "GET") return jsonResponse(200, { resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" });
    if (!opts.headers.authorization) return jsonResponse(401, {}, { "www-authenticate": 'Bearer resource_metadata="x"' });
    const body = JSON.parse(opts.body);
    if (body.method === "initialize") return jsonResponse(200, { result: { serverInfo: { version: "0.9.42" } } });
    if (body.method === "tools/list") return jsonResponse(200, { result: { tools: [] } });
    return jsonResponse(200, { result: { content: [{ type: "text", text: "ok" }] } });
  };
  const results = await runChecksWithConfirmation(
    { mcpUrl: "https://x/mcp", apiKey: "k", fetchFn },
    ["free"],
    { sleep: async () => { sleepCalled = true; } }
  );
  assert.ok(results.every((r) => r.ok), "every free check should pass with this fetchFn");
  assert.equal(sleepCalled, false);
});

test("runChecksWithConfirmation: a transient failure that PASSES on re-probe -> final result is ok (one blip tolerated), re-probed exactly once", async () => {
  let initializeCalls = 0;
  const sleepCalls = [];
  const fetchFn = async (url, opts) => {
    if (opts.method === "GET") return jsonResponse(200, { resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" });
    if (!opts.headers.authorization) return jsonResponse(401, {}, { "www-authenticate": 'Bearer resource_metadata="x"' });
    const body = JSON.parse(opts.body);
    if (body.method === "initialize") {
      initializeCalls += 1;
      return initializeCalls === 1 ? jsonResponse(500, { error: "boom" }) : jsonResponse(200, { result: { serverInfo: { version: "0.9.42" } } });
    }
    if (body.method === "tools/list") return jsonResponse(200, { result: { tools: [] } });
    return jsonResponse(200, { result: { content: [{ type: "text", text: "ok" }] } });
  };
  const results = await runChecksWithConfirmation(
    { mcpUrl: "https://x/mcp", apiKey: "k", fetchFn },
    ["free"],
    { sleep: async (ms) => { sleepCalls.push(ms); } }
  );
  assert.deepEqual(sleepCalls, [REPROBE_DELAY_MS], "exactly one wait, for exactly REPROBE_DELAY_MS");
  assert.equal(initializeCalls, 2, "initialize must be probed exactly twice: first pass + one re-probe");
  const initRow = results.find((r) => r.id === "initialize");
  assert.equal(initRow.ok, true, "re-probe passed -> no alert-worthy failure this run");
});

test("runChecksWithConfirmation: a failure CONFIRMED on re-probe stays failing (this is what should alert, same run)", async () => {
  let initializeCalls = 0;
  const fetchFn = async (url, opts) => {
    if (opts.method === "GET") return jsonResponse(200, { resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" });
    if (!opts.headers.authorization) return jsonResponse(401, {}, { "www-authenticate": 'Bearer resource_metadata="x"' });
    const body = JSON.parse(opts.body);
    if (body.method === "initialize") {
      initializeCalls += 1;
      return jsonResponse(500, { error: "boom" });
    }
    if (body.method === "tools/list") return jsonResponse(200, { result: { tools: [] } });
    return jsonResponse(200, { result: { content: [{ type: "text", text: "ok" }] } });
  };
  const results = await runChecksWithConfirmation(
    { mcpUrl: "https://x/mcp", apiKey: "k", fetchFn },
    ["free"],
    { sleep: async () => {} }
  );
  assert.equal(initializeCalls, 2, "re-probed exactly once (not retried forever)");
  const initRow = results.find((r) => r.id === "initialize");
  assert.equal(initRow.ok, false, "confirmed failure stays failing");
});

test("runChecksWithConfirmation: config-class (missing-secret) failures are never re-probed; an unrelated real failure alongside them still is", async () => {
  const getCallCounts = {};
  const fetchFn = async (url, opts) => {
    if (opts.method === "GET") {
      getCallCounts[url] = (getCallCounts[url] || 0) + 1;
      // The protected-resource doc fails on its first fetch, succeeds on
      // its second (the re-probe) — everything else is always valid.
      if (url.includes("oauth-protected-resource") && getCallCounts[url] === 1) return jsonResponse(500, {});
      return jsonResponse(200, { resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" });
    }
    // No ctx.apiKey below -> initialize/tools_list/novada_setup never reach
    // here (requireApiKey() short-circuits first) — only
    // unauthenticated_401's bare POST does.
    return jsonResponse(401, {}, { "www-authenticate": 'Bearer resource_metadata="x"' });
  };
  let sleepCalls = 0;
  const results = await runChecksWithConfirmation(
    { mcpUrl: "https://x/mcp", fetchFn } /* no apiKey */,
    ["free"],
    { sleep: async () => { sleepCalls += 1; } }
  );
  assert.equal(sleepCalls, 1, "exactly one re-probe wait, for the one real (non-config) failure");

  const byId = new Map(results.map((r) => [r.id, r]));
  for (const id of ["initialize", "tools_list", "novada_setup"]) {
    assert.equal(byId.get(id).ok, false);
    assert.equal(byId.get(id).errorClass, "config", `${id} must stay a config-class failure, untouched by the re-probe`);
  }
  assert.equal(byId.get("oauth_discovery").ok, true, "the real failure recovered on re-probe -> no alert-worthy failure this run");
  assert.equal(byId.get("unauthenticated_401").ok, true);
});

// Drift guard: checks.mjs carries a copy of HOSTED_FUNCTION_LIMIT_MS because it
// can't import TypeScript. This test reads the source of truth and fails the
// moment the two disagree, so the billable probe timeout can't silently fall
// below the hosted server's own limit again.
test("HOSTED_FUNCTION_LIMIT_MS mirrors npm-package/src/config.ts exactly", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = await readFile(path.join(here, "../../npm-package/src/config.ts"), "utf8");
  const m = src.match(/export const HOSTED_FUNCTION_LIMIT_MS\s*=\s*([\d_]+)\s*;/);
  assert.ok(m, "HOSTED_FUNCTION_LIMIT_MS not found in npm-package/src/config.ts — update this drift guard");
  assert.equal(HOSTED_FUNCTION_LIMIT_MS, Number(m[1].replace(/_/g, "")));
});
