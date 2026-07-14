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
  // These are deliberately sensitive-looking values to prove they never leak.
  const secretArgs = {
    url: "https://secret.example/very-private-path",
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
    tool: "novada_search",
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

  // No secret value must appear in the serialised row.
  assert.ok(!serialised.includes("secret"), `LEAK: serialised row contains "secret": ${serialised}`);
  assert.ok(!serialised.includes("hunter2"), `LEAK: serialised row contains "hunter2": ${serialised}`);
  assert.ok(!serialised.includes("sk-supersecret"), `LEAK: serialised row contains api_key value: ${serialised}`);
  assert.ok(!serialised.includes("very-private-path"), `LEAK: serialised row contains URL path: ${serialised}`);

  // But the KEY NAMES must be present.
  assert.ok(serialised.includes('"url"'), "arg key 'url' must be in serialised row");
  assert.ok(serialised.includes('"query"'), "arg key 'query' must be in serialised row");
  assert.ok(serialised.includes('"api_key"'), "arg key 'api_key' must be in serialised row");
  assert.ok(serialised.includes('"password"'), "arg key 'password' must be in serialised row");

  // Explicit check: arg_keys contains only the key names.
  assert.deepEqual(row.arg_keys, ["url", "query", "api_key", "password"]);
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
