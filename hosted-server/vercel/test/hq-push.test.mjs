/**
 * HQ log push unit tests — api/_hq_push.ts
 *
 * Contract: /Users/tongwu/mcp_log_create_接口文档.md (LAW).
 *
 * Covers:
 *   1. buildHqPayload — skip rules (non-tool_call rows, null hq_identity)
 *   2. buildHqPayload — exact field types/values (ts is ms number, retryable/
 *      charged are 0/1 numbers, error_code/failure_class are "" not null, ...)
 *   3. hqStatusBucket — governed 3-bucket mapping table (§ HQ spec)
 *   4. pushToHq — env gating (no NOVADA_HQ_LOG_URL -> zero fetch calls)
 *   5. pushToHq — 10001 (invalid params) -> single attempt, no retry
 *   6. pushToHq — 10000 (decrypt/DB failure) -> retries up to 3 attempts, ends failed
 *   7. pushToHq — success path (HTTP 200 + code 0) -> single attempt, pushed
 *
 * Mocks globalThis.fetch throughout — NO real network calls are made.
 * Runs on plain Node ≥22.18 (`node --test`) — no extra deps. Imports api/_hq_push.ts
 * and api/_telemetry.ts directly via Node's built-in TypeScript type stripping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildToolCallEvent, buildInitializeEvent } from "../api/_telemetry.ts";
import { buildHqPayload, hqStatusBucket, pushToHq } from "../api/_hq_push.ts";
import { NovadaErrorCode } from "../vendor/novada-mcp/_core/errors.js";

// ─── fixtures ──────────────────────────────────────────────────────────────────

function makeToolCallRow(overrides = {}) {
  const {
    outcome = "ok",
    hq_identity = "encrypted-blob:abc:def",
    error_code = null,
    retryable = null,
    rejection_stage = undefined,
    is_hosted_limitation = undefined,
    gateway_ceiling_hit = undefined,
    tool = "novada_search",
    args = { query: "hello" },
    latency_ms = 42,
    charged = true,
    plan = "free",
    ...rest
  } = overrides;
  return buildToolCallEvent({
    request_id: rest.request_id ?? "req-hq-1",
    token_hash: "hash-token",
    plan,
    client_name: null,
    client_version: null,
    protocol_version: null,
    tool,
    args,
    outcome,
    latency_ms,
    charged,
    over_cap_allowed: false,
    quota_remaining: 998,
    server_version: "0.9.99-hosted",
    region: "iad1",
    error_code,
    retryable,
    rejection_stage,
    is_hosted_limitation,
    gateway_ceiling_hit,
    auth_method: "bearer",
    user_agent: "test-agent/1.0",
    hq_identity,
    key_version: hq_identity ? "aes-gcm-v1" : null,
  });
}

// ─── 1 + 2. buildHqPayload ─────────────────────────────────────────────────────

test("buildHqPayload: skips initialize rows -> null", () => {
  const row = buildInitializeEvent({
    request_id: "req-init-1",
    token_hash: "hash",
    plan: "free",
    client_name: "claude",
    client_version: "1.0",
    protocol_version: "2024-11-05",
    server_version: "0.9.99-hosted",
    region: "iad1",
    auth_method: "bearer",
    user_agent: "test-agent",
    hq_identity: "encrypted-blob:abc:def",
    key_version: "aes-gcm-v1",
  });
  assert.equal(row.event_type, "initialize");
  assert.equal(buildHqPayload(row), null);
});

test("buildHqPayload: skips tool_call rows with null hq_identity -> null", () => {
  const row = makeToolCallRow({ hq_identity: null });
  assert.equal(row.hq_identity, null);
  assert.equal(buildHqPayload(row), null);
});

test("buildHqPayload: tool_call row with hq_identity produces a payload", () => {
  const row = makeToolCallRow();
  const payload = buildHqPayload(row);
  assert.ok(payload, "payload must not be null");
});

test("buildHqPayload: ts is the EVENT timestamp passed by the caller, verbatim", () => {
  // Leo's contract: ts = 事件发生时间 (event-occurrence time), NOT push time.
  // The caller (mcp.ts) passes its own `started` — build must echo it exactly.
  const eventTs = 1721836800123;
  const payload = buildHqPayload(makeToolCallRow(), eventTs);
  assert.equal(typeof payload.ts, "number");
  assert.ok(Number.isInteger(payload.ts), "ts must be an integer");
  assert.equal(payload.ts, eventTs, "ts must equal the eventTsMs argument, not a fresh Date.now()");
});

test("buildHqPayload: retryable/charged are 0/1 numbers, never booleans", () => {
  const truthy = buildHqPayload(makeToolCallRow({ retryable: true, charged: true }));
  assert.equal(truthy.retryable, 1);
  assert.equal(typeof truthy.retryable, "number");
  assert.equal(truthy.charged, 1);
  assert.equal(typeof truthy.charged, "number");

  const falsy = buildHqPayload(makeToolCallRow({ retryable: false, charged: false }));
  assert.equal(falsy.retryable, 0);
  assert.equal(falsy.charged, 0);

  const nullRetryable = buildHqPayload(makeToolCallRow({ retryable: null }));
  assert.equal(nullRetryable.retryable, 0, "null retryable must coerce to 0, never null");
});

test("buildHqPayload: error_code/failure_class are '' (not null) on a success row", () => {
  const payload = buildHqPayload(makeToolCallRow({ outcome: "ok", error_code: null }));
  assert.equal(payload.error_code, "");
  assert.equal(payload.failure_class, "");
  assert.notEqual(payload.error_code, null);
  assert.notEqual(payload.failure_class, null);
});

test("buildHqPayload: error_code/failure_class carry the row's values on a failure row", () => {
  const payload = buildHqPayload(makeToolCallRow({ outcome: NovadaErrorCode.URL_UNREACHABLE, error_code: NovadaErrorCode.URL_UNREACHABLE }));
  assert.equal(payload.error_code, "URL_UNREACHABLE");
  assert.equal(payload.failure_class, "transient");
});

test("buildHqPayload: optional string fields fall back to '' (never null) when the row value is null", () => {
  const payload = buildHqPayload(makeToolCallRow({ tool: null, args: null }));
  assert.equal(payload.tool, "");
  assert.equal(payload.operation, "");
  assert.equal(payload.product, "");
  assert.equal(payload.target_domain, "");
  assert.equal(payload.user_agent, "test-agent/1.0"); // still present when the row carries one
  assert.equal(typeof payload.tool, "string");
});

test("buildHqPayload: event_type is the literal string 'POST /request'", () => {
  const payload = buildHqPayload(makeToolCallRow());
  assert.equal(payload.event_type, "POST /request");
});

test("buildHqPayload: request_id and hq_identity are echoed verbatim", () => {
  const payload = buildHqPayload(makeToolCallRow({ request_id: "req-echo-1", hq_identity: "nonce:cipher:tag" }));
  assert.equal(payload.request_id, "req-echo-1");
  assert.equal(payload.hq_identity, "nonce:cipher:tag");
});

test("buildHqPayload: no extra fields beyond Leo's exact list (no key_version)", () => {
  const payload = buildHqPayload(makeToolCallRow());
  const expectedKeys = [
    "ts", "tool", "operation", "product", "target_domain", "status_bucket",
    "user_agent", "request_id", "event_type", "auth_method", "error_code",
    "failure_class", "retryable", "latency_ms", "charged", "plan", "hq_identity",
  ].sort();
  assert.deepEqual(Object.keys(payload).sort(), expectedKeys);
  assert.ok(!("key_version" in payload), "key_version must never be sent to HQ");
});

// ─── 3. hqStatusBucket — governed mapping table ────────────────────────────────

test("hqStatusBucket: governed mapping table (row-field combinations -> bucket)", () => {
  const cases = [
    // success
    [{ status_bucket: "success", error_code: null, rejection_stage: null, gateway_ceiling_hit: false }, "success", "ok"],

    // client_error
    [{ status_bucket: "failed", error_code: null, rejection_stage: "pre_auth", gateway_ceiling_hit: false }, "client_error", "MISSING_TOKEN / INVALID_TOKEN (pre_auth)"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.INVALID_API_KEY, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "INVALID_API_KEY"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.INVALID_PARAMS, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "INVALID_PARAMS"],
    [{ status_bucket: "failed", error_code: null, rejection_stage: "cap_blocked", gateway_ceiling_hit: false }, "client_error", "cap_blocked"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.WRONG_TARGET, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "WRONG_TARGET"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.PRODUCT_UNAVAILABLE, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "PRODUCT_UNAVAILABLE"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.SPA_NO_URLS_FOUND, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "SPA_NO_URLS_FOUND (map hit a JS SPA — target condition, not a Novada outage)"],
    [{ status_bucket: "blocked", error_code: null, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "TARGET_BLOCKED"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.URL_UNREACHABLE, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "URL_UNREACHABLE"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.RATE_LIMITED, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "target 429 / RATE_LIMITED"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.TASK_NOT_FOUND, rejection_stage: null, gateway_ceiling_hit: false }, "client_error", "TASK_NOT_FOUND"],
    [{ status_bucket: "not_applicable", error_code: null, rejection_stage: "tool_filtered", gateway_ceiling_hit: false }, "client_error", "NOT_AVAILABLE_ON_HOSTED / TOOL_NOT_ENABLED"],

    // server_error
    [{ status_bucket: "failed", error_code: NovadaErrorCode.API_DOWN, rejection_stage: null, gateway_ceiling_hit: false }, "server_error", "API_DOWN"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.PROXY_AUTH_FAILURE, rejection_stage: null, gateway_ceiling_hit: false }, "server_error", "PROXY_AUTH_FAILURE"],
    [{ status_bucket: "failed", error_code: null, rejection_stage: null, gateway_ceiling_hit: true }, "server_error", "gateway_ceiling_hit=true"],
    [{ status_bucket: "failed", error_code: NovadaErrorCode.SESSION_EXPIRED, rejection_stage: null, gateway_ceiling_hit: false }, "server_error", "SESSION_EXPIRED"],

    // unmapped -> fail toward server_error, NEVER success
    [{ status_bucket: "failed", error_code: NovadaErrorCode.UNKNOWN, rejection_stage: null, gateway_ceiling_hit: false }, "server_error", "UNKNOWN / generic 'error'"],
    [{ status_bucket: "pending", error_code: NovadaErrorCode.TASK_PENDING, rejection_stage: null, gateway_ceiling_hit: false }, "server_error", "non-ceiling TASK_PENDING (no 'pending' bucket in Leo's vocab)"],
    [{ status_bucket: "failed", error_code: null, rejection_stage: "rate_limited", gateway_ceiling_hit: false }, "client_error", "GATEWAY_RATE_LIMITED (our own per-IP throttle — HTTP 4xx semantics, caller too fast)"],
    [{ status_bucket: "failed", error_code: null, rejection_stage: "dispatched", gateway_ceiling_hit: false }, "server_error", "in-band TIMEOUT (indistinguishable from generic failure at row level)"],
  ];
  for (const [row, expected, label] of cases) {
    assert.equal(hqStatusBucket(row), expected, `outcome=${label}`);
  }
});

test("hqStatusBucket: end-to-end via buildToolCallEvent for a real ZodError-shaped row", () => {
  const row = makeToolCallRow({ outcome: "INVALID_PARAMS", error_code: NovadaErrorCode.INVALID_PARAMS });
  const payload = buildHqPayload(row);
  assert.equal(payload.status_bucket, "client_error");
});

test("hqStatusBucket: end-to-end via buildToolCallEvent for a successful row", () => {
  const row = makeToolCallRow({ outcome: "ok" });
  const payload = buildHqPayload(row);
  assert.equal(payload.status_bucket, "success");
});

// ─── 4-7. pushToHq — I/O behaviour (fetch fully mocked, zero real network calls) ──

function withFetchMock(impl, fn) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET" });
    return impl(url, opts);
  };
  return (async () => {
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = saved;
    }
  })();
}

test("pushToHq: no NOVADA_HQ_LOG_URL -> zero fetch calls (dark-deploy safe)", async () => {
  await withFetchMock(
    () => { throw new Error("fetch must not be called when NOVADA_HQ_LOG_URL is absent"); },
    async (calls) => {
      const row = makeToolCallRow();
      await assert.doesNotReject(pushToHq(row, {}));
      assert.equal(calls.length, 0);
    },
  );
});

test("pushToHq: empty-string NOVADA_HQ_LOG_URL -> zero fetch calls", async () => {
  await withFetchMock(
    () => { throw new Error("fetch must not be called when NOVADA_HQ_LOG_URL is empty"); },
    async (calls) => {
      const row = makeToolCallRow();
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "   " }));
      assert.equal(calls.length, 0);
    },
  );
});

test("pushToHq: not a tool_call / no hq_identity -> zero fetch calls even with env set", async () => {
  await withFetchMock(
    () => { throw new Error("fetch must not be called for a non-pushable row"); },
    async (calls) => {
      const row = makeToolCallRow({ hq_identity: null });
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
      assert.equal(calls.length, 0);
    },
  );
});

test("pushToHq: code 10001 (invalid params) -> single attempt, NEVER retried", async () => {
  await withFetchMock(
    async () => ({
      status: 200,
      json: async () => ({ code: 10001, data: null, msg: "無效參數", timestamp: 1721836800 }),
    }),
    async (calls) => {
      const row = makeToolCallRow();
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
      const postCalls = calls.filter((c) => c.url.includes("/mcp/log/create"));
      assert.equal(postCalls.length, 1, "10001 is OUR bug — must not retry");
    },
  );
});

test("pushToHq: code 10000 (decrypt/DB failure, HTTP 400) -> retries up to 3 attempts total, ends failed", async () => {
  await withFetchMock(
    async () => ({
      status: 400,
      json: async () => ({ code: 10000, data: null, msg: "create mcp log failed", timestamp: 1721836800 }),
    }),
    async (calls) => {
      const row = makeToolCallRow();
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
      const postCalls = calls.filter((c) => c.url.includes("/mcp/log/create"));
      assert.equal(postCalls.length, 3, "10000 is retryable — expect initial attempt + 2 retries");
    },
  );
});

test("pushToHq: success (HTTP 200 + code 0) -> single attempt, no retry", async () => {
  await withFetchMock(
    async () => ({
      status: 200,
      json: async () => ({ code: 0, data: null, msg: "success", timestamp: 1721836800 }),
    }),
    async (calls) => {
      const row = makeToolCallRow();
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
      const postCalls = calls.filter((c) => c.url.includes("/mcp/log/create"));
      assert.equal(postCalls.length, 1);
    },
  );
});

test("pushToHq: network error (fetch throws) -> retried like a transient failure, never throws", async () => {
  await withFetchMock(
    async () => { throw new Error("ECONNREFUSED"); },
    async (calls) => {
      const row = makeToolCallRow();
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
      const postCalls = calls.filter((c) => c.url.includes("/mcp/log/create"));
      assert.equal(postCalls.length, 3);
    },
  );
});

test("pushToHq: pushed/failed status PATCH is skipped silently when telemetry env vars absent", async () => {
  await withFetchMock(
    async (url) => {
      if (String(url).includes("/mcp/log/create")) {
        return { status: 200, json: async () => ({ code: 0, data: null, msg: "success", timestamp: 1 }) };
      }
      throw new Error(`unexpected fetch to ${url} — TELEMETRY_SUPABASE_URL/KEY are absent`);
    },
    async () => {
      const row = makeToolCallRow();
      // env has NOVADA_HQ_LOG_URL but no TELEMETRY_SUPABASE_URL/KEY.
      await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
    },
  );
});

test("pushToHq: wire contract — POST body/headers to /mcp/log/create match buildHqPayload exactly", async () => {
  const eventTs = 1721836800456;
  const row = makeToolCallRow({ request_id: "req-wire-1" });
  const expected = buildHqPayload(row, eventTs);
  await withFetchMock(
    async (url, opts) => {
      const u = String(url);
      if (u.includes("/mcp/log/create")) {
        assert.ok(u.endsWith("/mcp/log/create"), "URL must end with /mcp/log/create");
        assert.equal(opts.method, "POST");
        const ctype = opts.headers?.["Content-Type"] ?? opts.headers?.["content-type"];
        assert.equal(ctype, "application/json");
        assert.deepEqual(JSON.parse(opts.body), expected, "wire body must equal buildHqPayload output");
        assert.equal(JSON.parse(opts.body).ts, eventTs, "wire ts must be the threaded event timestamp");
        return { status: 200, json: async () => ({ code: 0, data: null, msg: "success", timestamp: 1 }) };
      }
      if (u.includes("/rest/v1/mcp_events")) return { ok: true, status: 200 };
      throw new Error(`unexpected fetch to ${u}`);
    },
    async (calls) => {
      await assert.doesNotReject(pushToHq(row, {
        NOVADA_HQ_LOG_URL: "https://hq.example.test",
        TELEMETRY_SUPABASE_URL: "https://tel.example.test",
        TELEMETRY_SUPABASE_KEY: "tel-key",
      }, eventTs));
      assert.equal(calls.filter((c) => c.url.includes("/mcp/log/create")).length, 1);
    },
  );
});

test("pushToHq: on success, PATCHes push_status='pushed' with pushed_at set", async () => {
  await withFetchMock(
    async (url, opts) => {
      const u = String(url);
      if (u.includes("/mcp/log/create")) {
        return { status: 200, json: async () => ({ code: 0, data: null, msg: "success", timestamp: 1 }) };
      }
      if (u.includes("/rest/v1/mcp_events")) {
        assert.equal(opts.method, "PATCH");
        const body = JSON.parse(opts.body);
        assert.equal(body.push_status, "pushed");
        assert.ok(typeof body.pushed_at === "string" && body.pushed_at.length > 0);
        assert.ok(u.includes("request_id=eq."));
        assert.ok(u.includes("event_type=eq.tool_call"));
        return { ok: true, status: 200 };
      }
      throw new Error(`unexpected fetch to ${u}`);
    },
    async (calls) => {
      const row = makeToolCallRow({ request_id: "req-patch-1" });
      await assert.doesNotReject(pushToHq(row, {
        NOVADA_HQ_LOG_URL: "https://hq.example.test",
        TELEMETRY_SUPABASE_URL: "https://tel.example.test",
        TELEMETRY_SUPABASE_KEY: "tel-key",
      }));
      const patchCalls = calls.filter((c) => c.url.includes("/rest/v1/mcp_events"));
      assert.equal(patchCalls.length, 1);
    },
  );
});

test("pushToHq: on exhausted retries, PATCHes push_status='failed'", async () => {
  await withFetchMock(
    async (url, opts) => {
      const u = String(url);
      if (u.includes("/mcp/log/create")) {
        return { status: 400, json: async () => ({ code: 10000, data: null, msg: "fail", timestamp: 1 }) };
      }
      if (u.includes("/rest/v1/mcp_events")) {
        const body = JSON.parse(opts.body);
        assert.equal(body.push_status, "failed");
        assert.ok(!("pushed_at" in body), "pushed_at must not be set on a failed push");
        return { ok: true, status: 200 };
      }
      throw new Error(`unexpected fetch to ${u}`);
    },
    async (calls) => {
      const row = makeToolCallRow({ request_id: "req-patch-2" });
      await assert.doesNotReject(pushToHq(row, {
        NOVADA_HQ_LOG_URL: "https://hq.example.test",
        TELEMETRY_SUPABASE_URL: "https://tel.example.test",
        TELEMETRY_SUPABASE_KEY: "tel-key",
      }));
      const patchCalls = calls.filter((c) => c.url.includes("/rest/v1/mcp_events"));
      assert.equal(patchCalls.length, 1);
    },
  );
});

test("pushToHq: never throws even if fetch itself is undefined (catch-all)", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    const row = makeToolCallRow();
    await assert.doesNotReject(pushToHq(row, { NOVADA_HQ_LOG_URL: "https://hq.example.test" }));
  } finally {
    globalThis.fetch = saved;
  }
});
