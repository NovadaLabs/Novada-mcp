/**
 * Behavior telemetry unit tests — api/_telemetry.ts
 *
 * Covers:
 *   1. buildToolCallEvent — pure builder, field mapping, arg_keys extraction
 *   2. LEAK FENCE — arg values must never appear in the emitted row or its JSON
 *   3. buildInitializeEvent — pure builder
 *   4. telemetryEnabled — env gating
 *   5. emitEvent — disabled when env absent; fetch-throw swallowed; timeout path
 *   6. Wire check — mcp.ts source contains cap_blocked emit and scheduleToolEvent helper
 *
 * Runs on plain Node ≥22.18 (`node --test`) — no extra deps.
 * Imports api/_telemetry.ts directly via Node's built-in type stripping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildToolCallEvent,
  buildInitializeEvent,
  telemetryEnabled,
  emitEvent,
  extractTargetDomain,
} from "../api/_telemetry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");

// ─── 1. buildToolCallEvent — field mapping ────────────────────────────────────

test("buildToolCallEvent: event_type is tool_call", () => {
  const row = buildToolCallEvent({
    request_id: "req-1",
    token_hash: "abc123",
    plan: "free",
    client_name: null,
    client_version: null,
    protocol_version: null,
    tool: "novada_search",
    args: { query: "hello", limit: 10 },
    outcome: "ok",
    latency_ms: 42,
    charged: true,
    over_cap_allowed: false,
    quota_remaining: 998,
    server_version: "0.9.27-hosted",
    region: "iad1",
  });
  assert.equal(row.event_type, "tool_call");
});

test("buildToolCallEvent: scalar fields passed through correctly", () => {
  const row = buildToolCallEvent({
    request_id: "req-2",
    token_hash: "hash-token",
    plan: "pro",
    client_name: null,
    client_version: null,
    protocol_version: null,
    tool: "novada_extract",
    args: { url: "https://example.com" },
    outcome: "ok",
    latency_ms: 120,
    charged: false,
    over_cap_allowed: true,
    quota_remaining: 0,
    server_version: "1.0.0-hosted",
    region: "fra1",
  });
  assert.equal(row.request_id, "req-2");
  assert.equal(row.token_hash, "hash-token");
  assert.equal(row.plan, "pro");
  assert.equal(row.tool, "novada_extract");
  assert.equal(row.outcome, "ok");
  assert.equal(row.latency_ms, 120);
  assert.equal(row.charged, false);
  assert.equal(row.over_cap_allowed, true);
  assert.equal(row.quota_remaining, 0);
  assert.equal(row.server_version, "1.0.0-hosted");
  assert.equal(row.region, "fra1");
});

test("buildToolCallEvent: arg_keys contains only key names, not values", () => {
  const row = buildToolCallEvent({
    request_id: "req-3",
    token_hash: null,
    plan: null,
    client_name: null,
    client_version: null,
    protocol_version: null,
    tool: "novada_search",
    args: { query: "secret phrase", url: "https://private.example/path", limit: 5 },
    outcome: "ok",
    latency_ms: 10,
    charged: true,
    over_cap_allowed: false,
    quota_remaining: 900,
    server_version: null,
    region: null,
  });
  assert.deepEqual(row.arg_keys, ["query", "url", "limit"]);
});

test("buildToolCallEvent: null args produces empty arg_keys array", () => {
  const row = buildToolCallEvent({
    request_id: "r", token_hash: null, plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_discover", args: null, outcome: "ok",
    latency_ms: 5, charged: false, over_cap_allowed: false, quota_remaining: 0,
    server_version: null, region: null,
  });
  assert.deepEqual(row.arg_keys, []);
});

// ─── 2. LEAK FENCE — arg VALUES must NEVER appear in the row or its JSON ──────

test("LEAK FENCE: arg values containing secrets do not appear in JSON-serialised row", () => {
  // Deliberately sensitive-looking VALUES to prove they never leak. The URL's
  // HOSTNAME is intentionally collected as target_domain (Tier 2) — the secret
  // material here lives in the path/query/fragment and other param values.
  const secretArgs = {
    url: "https://sub.shop.example.com/secret-path?q=secret+words#frag",
    query: "secret words that must not appear",
    api_key: "sk-supersecret-12345",
    password: "hunter2",
  };

  const row = buildToolCallEvent({
    request_id: "req-leak",
    token_hash: null,
    plan: null,
    client_name: null,
    client_version: null,
    protocol_version: null,
    tool: "novada_extract",
    args: secretArgs,
    outcome: "ok",
    latency_ms: 1,
    charged: false,
    over_cap_allowed: false,
    quota_remaining: 999,
    server_version: null,
    region: null,
  });

  const serialised = JSON.stringify(row);

  // target_domain is the HOSTNAME ONLY.
  assert.equal(row.target_domain, "sub.shop.example.com");

  // No secret value must appear ANYWHERE in the serialised row.
  assert.ok(!serialised.includes("secret"), `LEAK: serialised row contains "secret": ${serialised}`);
  assert.ok(!serialised.includes("/secret-path"), `LEAK: serialised row contains URL path: ${serialised}`);
  assert.ok(!serialised.includes("q="), `LEAK: serialised row contains query string: ${serialised}`);
  assert.ok(!serialised.includes("#frag"), `LEAK: serialised row contains fragment: ${serialised}`);
  assert.ok(!serialised.includes("hunter2"), `LEAK: serialised row contains "hunter2": ${serialised}`);
  assert.ok(!serialised.includes("sk-supersecret"), `LEAK: serialised row contains api_key value: ${serialised}`);

  // But the KEY NAMES must be present.
  assert.ok(serialised.includes('"url"'), "arg key 'url' must be in serialised row");
  assert.ok(serialised.includes('"query"'), "arg key 'query' must be in serialised row");
  assert.ok(serialised.includes('"api_key"'), "arg key 'api_key' must be in serialised row");
  assert.ok(serialised.includes('"password"'), "arg key 'password' must be in serialised row");

  // Explicit check: arg_keys contains only the key names.
  assert.deepEqual(row.arg_keys, ["url", "query", "api_key", "password"]);
});

// ─── 2b. extractTargetDomain — hostname-only extraction ──────────────────────

test("extractTargetDomain: hostname only — lowercase, www stripped", () => {
  assert.equal(extractTargetDomain({ url: "https://WWW.Example.COM/Path?x=1" }), "example.com");
  assert.equal(extractTargetDomain({ url: "https://sub.shop.example.com/a/b" }), "sub.shop.example.com");
});

test("extractTargetDomain: never port, credentials, path, query, or fragment", () => {
  const d = extractTargetDomain({ url: "https://user:pass@host.example.com:8443/deep/path?tok=abc#sec" });
  assert.equal(d, "host.example.com");
});

test("extractTargetDomain: batch url array → FIRST URL's hostname", () => {
  assert.equal(
    extractTargetDomain({ url: ["https://first.example.com/a", "https://second.example.org/b"] }),
    "first.example.com",
  );
});

test("extractTargetDomain: urls alias array → FIRST URL's hostname", () => {
  assert.equal(
    extractTargetDomain({ urls: ["https://alias.example.net/x"] }),
    "alias.example.net",
  );
});

test("extractTargetDomain: novada_scrape nested params.url", () => {
  assert.equal(
    extractTargetDomain({ platform: "amazon.com", operation: "op", params: { url: "https://www.amazon.com/dp/B0TEST" } }),
    "amazon.com",
  );
});

test("extractTargetDomain: novada_browser actions[].url (first navigate)", () => {
  assert.equal(
    extractTargetDomain({ actions: [{ action: "wait", ms: 500 }, { action: "navigate", url: "https://app.example.io/login" }] }),
    "app.example.io",
  );
});

test("extractTargetDomain: novada_search (query only, no url) → null", () => {
  assert.equal(extractTargetDomain({ query: "how to test telemetry", engine: "google" }), null);
});

test("extractTargetDomain: null / empty / unparseable → null, never throws", () => {
  assert.equal(extractTargetDomain(null), null);
  assert.equal(extractTargetDomain({}), null);
  assert.equal(extractTargetDomain({ url: "" }), null);
  assert.equal(extractTargetDomain({ url: "not a url at all" }), null);
  assert.equal(extractTargetDomain({ url: 42 }), null);
  assert.equal(extractTargetDomain({ url: [] }), null);
  assert.equal(extractTargetDomain({ urls: [] }), null);
});

test("buildToolCallEvent: target_domain populated from args url", () => {
  const row = buildToolCallEvent({
    request_id: "r", token_hash: null, plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_extract", args: { url: "https://www.docs.example.com/page" }, outcome: "ok",
    latency_ms: 5, charged: true, over_cap_allowed: false, quota_remaining: 10,
    server_version: null, region: null,
  });
  assert.equal(row.target_domain, "docs.example.com");
});

test("buildToolCallEvent: target_domain null for non-URL tools and null args", () => {
  const searchRow = buildToolCallEvent({
    request_id: "r", token_hash: null, plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_search", args: { query: "anything" }, outcome: "ok",
    latency_ms: 5, charged: true, over_cap_allowed: false, quota_remaining: 10,
    server_version: null, region: null,
  });
  assert.equal(searchRow.target_domain, null);
  const nullRow = buildToolCallEvent({
    request_id: "r", token_hash: null, plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_discover", args: null, outcome: "ok",
    latency_ms: 5, charged: false, over_cap_allowed: false, quota_remaining: 0,
    server_version: null, region: null,
  });
  assert.equal(nullRow.target_domain, null);
});

// ─── 3. buildInitializeEvent ─────────────────────────────────────────────────

test("buildInitializeEvent: event_type is initialize, tool fields are null", () => {
  const row = buildInitializeEvent({
    request_id: "init-1",
    token_hash: "tokenhash",
    plan: null,
    client_name: "claude-code",
    client_version: "1.2.3",
    protocol_version: null,
    server_version: "0.9.27-hosted",
    region: "iad1",
  });
  assert.equal(row.event_type, "initialize");
  assert.equal(row.client_name, "claude-code");
  assert.equal(row.client_version, "1.2.3");
  assert.equal(row.tool, null);
  assert.equal(row.arg_keys, null);
  assert.equal(row.outcome, null);
  assert.equal(row.charged, null);
});

// ─── 4. telemetryEnabled — env gating ─────────────────────────────────────────

test("telemetryEnabled: false when both env vars absent", () => {
  delete process.env.TELEMETRY_SUPABASE_URL;
  delete process.env.TELEMETRY_SUPABASE_KEY;
  assert.equal(telemetryEnabled(), false);
});

test("telemetryEnabled: false when only URL set", () => {
  process.env.TELEMETRY_SUPABASE_URL = "https://example.supabase.co";
  delete process.env.TELEMETRY_SUPABASE_KEY;
  assert.equal(telemetryEnabled(), false);
  delete process.env.TELEMETRY_SUPABASE_URL;
});

test("telemetryEnabled: false when only KEY set", () => {
  delete process.env.TELEMETRY_SUPABASE_URL;
  process.env.TELEMETRY_SUPABASE_KEY = "service_role_key";
  assert.equal(telemetryEnabled(), false);
  delete process.env.TELEMETRY_SUPABASE_KEY;
});

test("telemetryEnabled: true when both env vars present", () => {
  process.env.TELEMETRY_SUPABASE_URL = "https://example.supabase.co";
  process.env.TELEMETRY_SUPABASE_KEY = "service_role_key";
  assert.equal(telemetryEnabled(), true);
  delete process.env.TELEMETRY_SUPABASE_URL;
  delete process.env.TELEMETRY_SUPABASE_KEY;
});

// ─── 5. emitEvent behaviour ───────────────────────────────────────────────────

test("emitEvent: no-op (no fetch) when telemetry env vars absent", async () => {
  delete process.env.TELEMETRY_SUPABASE_URL;
  delete process.env.TELEMETRY_SUPABASE_KEY;

  // If fetch is called it would throw (no real endpoint) — the test would fail.
  // Since we can't easily intercept globalThis.fetch without a mock framework,
  // we rely on the fact that emitEvent returns immediately when disabled, and
  // that no unhandled rejection is produced.
  const row = buildToolCallEvent({
    request_id: "r", token_hash: null, plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_search", args: { q: "test" }, outcome: "ok",
    latency_ms: 10, charged: false, over_cap_allowed: false, quota_remaining: 0,
    server_version: null, region: null,
  });
  // Must resolve without throwing.
  await assert.doesNotReject(emitEvent(row));
});

test("emitEvent: fetch-throw is swallowed when env vars present", async () => {
  process.env.TELEMETRY_SUPABASE_URL = "https://does-not-exist.invalid.novada.internal";
  process.env.TELEMETRY_SUPABASE_KEY = "test-key";

  const row = buildToolCallEvent({
    request_id: "r2", token_hash: null, plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_search", args: { q: "test" }, outcome: "ok",
    latency_ms: 10, charged: false, over_cap_allowed: false, quota_remaining: 0,
    server_version: null, region: null,
  });
  // The fetch will fail (network unreachable / DNS failure) — must not throw.
  // The 3s timeout means this resolves quickly on a real network failure.
  await assert.doesNotReject(emitEvent(row));

  delete process.env.TELEMETRY_SUPABASE_URL;
  delete process.env.TELEMETRY_SUPABASE_KEY;
});

// ─── 6. Wire-level static check: cap_blocked path emits telemetry ─────────────

test("mcp.ts source: scheduleToolEvent helper present in CallToolRequestSchema handler", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /const scheduleToolEvent/, "scheduleToolEvent helper must be defined in the tool handler");
  assert.ok(src.includes("buildToolCallEvent"), "mcp.ts must import/call buildToolCallEvent");
  assert.ok(src.includes("emitEvent"), "mcp.ts must call emitEvent");
});

test("mcp.ts source: cap_blocked path emits scheduleToolEvent", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The cap_blocked emit must appear before the cap-blocked return.
  const capBlockedIdx = src.indexOf('scheduleToolEvent("cap_blocked"');
  const capReturnIdx = src.indexOf('"## Free Gateway Cap Reached"');
  assert.ok(capBlockedIdx >= 0, 'cap_blocked scheduleToolEvent call must exist');
  assert.ok(capReturnIdx >= 0, '"## Free Gateway Cap Reached" must exist');
  assert.ok(capBlockedIdx < capReturnIdx, "cap_blocked telemetry must be scheduled BEFORE the cap-blocked return");
});

test("mcp.ts source: success path emits scheduleToolEvent with outcome ok", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /scheduleToolEvent\(\s*["']ok["']/, "success path must call scheduleToolEvent with 'ok'");
});

test("mcp.ts source: error path emits scheduleToolEvent", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // Error path: scheduleToolEvent with a NovadaError code or generic "error".
  assert.match(src, /scheduleToolEvent\([\s\S]{0,100}error instanceof NovadaError/, "error path must call scheduleToolEvent with NovadaError code");
});

test("mcp.ts source: browser_flow hosted-rejection path emits NOT_AVAILABLE_ON_HOSTED", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The emit must sit inside the novada_browser_flow refusal block, BEFORE its return.
  const flowIdx = src.indexOf('if (name === "novada_browser_flow")');
  assert.ok(flowIdx >= 0, "novada_browser_flow refusal block must exist");
  const returnIdx = src.indexOf("Error [NOT_AVAILABLE_ON_HOSTED]: novada_browser_flow", flowIdx);
  assert.ok(returnIdx >= 0, "browser_flow refusal return must exist");
  const emitIdx = src.indexOf('scheduleToolEvent(', flowIdx);
  assert.ok(emitIdx >= 0 && emitIdx < returnIdx, "browser_flow path must schedule telemetry BEFORE the refusal return");
  // The outcome for this path must be NOT_AVAILABLE_ON_HOSTED.
  const outcomeIdx = src.indexOf('"NOT_AVAILABLE_ON_HOSTED"', flowIdx);
  assert.ok(outcomeIdx >= 0 && outcomeIdx < returnIdx, "browser_flow telemetry outcome must be NOT_AVAILABLE_ON_HOSTED");
});

test("mcp.ts source: TELEMETRY_SUPABASE_URL/KEY not in SERVER_CONSUMPTION_ENV_VARS strip list", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const block = src.match(/SERVER_CONSUMPTION_ENV_VARS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "must be able to parse SERVER_CONSUMPTION_ENV_VARS from mcp.ts");
  const stripList = block[1];
  assert.ok(!stripList.includes("TELEMETRY_SUPABASE_URL"), "TELEMETRY_SUPABASE_URL must NOT be in the server consumption strip list");
  assert.ok(!stripList.includes("TELEMETRY_SUPABASE_KEY"), "TELEMETRY_SUPABASE_KEY must NOT be in the server consumption strip list");
});

test("mcp.ts source: waitUntil imported from @vercel/functions", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /from ["']@vercel\/functions["']/, "@vercel/functions must be imported in mcp.ts");
  assert.match(src, /waitUntil.*@vercel\/functions|@vercel\/functions.*waitUntil/, "waitUntil must be imported from @vercel/functions");
});

test("mcp.ts source: requestId generated per request via crypto.randomUUID", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /requestId.*=.*crypto\.randomUUID\(\)/, "requestId must be generated with crypto.randomUUID()");
});

// ─── Fix 1: emitEvent must surface non-2xx ────────────────────────────────────

test("emitEvent: non-2xx response triggers console.warn with status (no throw)", async () => {
  // Arrange — stub fetch to return a 400 with ok:false (no network; resolve immediately).
  const savedFetch = globalThis.fetch;
  const warnCalls = [];
  const savedWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  globalThis.fetch = async () => ({ ok: false, status: 400 });

  process.env.TELEMETRY_SUPABASE_URL = "https://test.supabase.co";
  process.env.TELEMETRY_SUPABASE_KEY = "test-key-fix1";

  const row = buildToolCallEvent({
    request_id: "fix1-req", token_hash: "h1", plan: "free",
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_search", args: { q: "x" }, outcome: "ok",
    latency_ms: 5, charged: false, over_cap_allowed: false, quota_remaining: 0,
    server_version: null, region: null,
  });

  try {
    await assert.doesNotReject(emitEvent(row), "emitEvent must not throw on non-2xx");
    const telWarn = warnCalls.find(w => String(w[0]).includes("telemetry insert failed"));
    assert.ok(telWarn, "console.warn must be called with 'telemetry insert failed'");
    assert.equal(telWarn[1], 400, "console.warn must receive the HTTP status code (400)");
  } finally {
    globalThis.fetch = savedFetch;
    console.warn = savedWarn;
    delete process.env.TELEMETRY_SUPABASE_URL;
    delete process.env.TELEMETRY_SUPABASE_KEY;
  }
});

test("emitEvent: 2xx response does NOT trigger console.warn for telemetry insert", async () => {
  const savedFetch = globalThis.fetch;
  const warnCalls = [];
  const savedWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  globalThis.fetch = async () => ({ ok: true, status: 201 });

  process.env.TELEMETRY_SUPABASE_URL = "https://test.supabase.co";
  process.env.TELEMETRY_SUPABASE_KEY = "test-key-fix1b";

  const row = buildToolCallEvent({
    request_id: "fix1b-req", token_hash: "h2", plan: null,
    client_name: null, client_version: null, protocol_version: null,
    tool: "novada_extract", args: {}, outcome: "ok",
    latency_ms: 10, charged: true, over_cap_allowed: false, quota_remaining: 5,
    server_version: null, region: null,
  });

  try {
    await assert.doesNotReject(emitEvent(row));
    const telWarn = warnCalls.find(w => String(w[0]).includes("telemetry insert failed"));
    assert.ok(!telWarn, "console.warn must NOT be called for a 2xx response");
  } finally {
    globalThis.fetch = savedFetch;
    console.warn = savedWarn;
    delete process.env.TELEMETRY_SUPABASE_URL;
    delete process.env.TELEMETRY_SUPABASE_KEY;
  }
});

// ─── Fix 2: novada_setup block must emit telemetry ───────────────────────────

test("mcp.ts source: novada_setup block calls scheduleToolEvent before its return", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // Find the novada_setup block and assert scheduleToolEvent is present inside it.
  const setupBlockStart = src.indexOf('if (name === "novada_setup")');
  assert.ok(setupBlockStart >= 0, 'novada_setup block must exist in mcp.ts');
  // The block ends at the next top-level if/const after it (gateway cap gate).
  // scheduleToolEvent must appear between the block start and the first post-setup code.
  const afterSetupIdx = src.indexOf('const monthlyQuota', setupBlockStart);
  assert.ok(afterSetupIdx > setupBlockStart, 'post-setup code must exist after novada_setup block');
  const setupSrc = src.slice(setupBlockStart, afterSetupIdx);
  assert.ok(
    setupSrc.includes("scheduleToolEvent("),
    "novada_setup block must call scheduleToolEvent before its early return",
  );
});

// ─── Fix 3: oninitialized comment must be honest about stateless-mode ─────────

test("mcp.ts source: oninitialized comment does NOT claim getClientVersion IS populated", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The old misleading comment said "IS populated (it's set by _oninitialize)".
  // In stateless mode this is false: the notification arrives on a different HTTP
  // request with a fresh server where _clientVersion is always undefined.
  assert.ok(
    !src.includes("getClientVersion() IS populated"),
    "Misleading 'IS populated' comment must be removed from oninitialized block",
  );
});

test("mcp.ts source: oninitialized block documents stateless-mode limitation honestly", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The honest truth: in stateless mode initialized arrives on a separate HTTP
  // request (fresh server) so getClientVersion() always returns undefined.
  // Capture the comment + handler region between the section header and the
  // next setRequestHandler call.
  const sectionStart = src.indexOf("Telemetry: initialize event");
  const sectionEnd = src.indexOf("server.setRequestHandler(CallToolRequestSchema");
  assert.ok(sectionStart >= 0, "oninitialized section header must exist");
  const oninitBlock = src.slice(sectionStart, sectionEnd);
  assert.ok(
    oninitBlock.includes("stateless") && oninitBlock.includes("undefined"),
    "oninitialized block comment must document that getClientVersion returns undefined in stateless mode",
  );
});

// ─── Fix 4: ceiling timeout result must emit TIMEOUT not ok ──────────────────

test("mcp.ts source: success path checks for ceiling error before emitting outcome", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The fix must classify a result starting with "## Extraction Error" as TIMEOUT.
  // Assert that both the detection expression and TIMEOUT outcome literal exist near
  // the main dispatch result handling (after withWallClock / dispatch call).
  assert.ok(
    src.includes("## Extraction Error") || src.includes("Extraction Error"),
    "mcp.ts must reference the ceiling error marker string for classification",
  );
  assert.ok(
    src.includes('"TIMEOUT"'),
    'mcp.ts success path must have a "TIMEOUT" outcome for ceiling-hit results',
  );
});

test("mcp.ts source: TIMEOUT outcome appears near the main scheduleToolEvent ok call", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The TIMEOUT classification must sit in the same region as the main dispatch path
  // (after withWallClock). Find the dispatch call and the following scheduleToolEvent.
  const dispatchIdx = src.indexOf("withWallClock(\n        name,");
  assert.ok(dispatchIdx >= 0, "withWallClock dispatch call must exist");
  // Scan forward from dispatch for the TIMEOUT literal.
  const regionEnd = src.indexOf("} catch (error)", dispatchIdx);
  const subSrc = src.slice(dispatchIdx, regionEnd);
  assert.ok(subSrc.includes('"TIMEOUT"'), '"TIMEOUT" outcome must be set in the dispatch success region');
});
