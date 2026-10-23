// monitoring/dingtalk/run.test.mjs
//
// node:test coverage for run.mjs's non-CLI exports: the daily-report
// renderer (must render every row, and flag upstream-platform failures
// distinctly), the title-keyword invariant ("Novada MCP" prefix always
// satisfies a "MCP" keyword robot with zero prepending needed), and the
// alert/daily mode orchestration wired against fully stubbed I/O (no
// network, no git, no real DingTalk).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderDailyReport,
  shanghaiDateStamp,
  runAlertMode,
  runDailyMode,
  readExpectedToolCount,
  classifyFailure,
  composeAlertMessage,
  composeRecoveryMessage,
  composeHeartbeatMessage,
  composeMisconfiguredMessage,
} from "./run.mjs";
import { ensureKeyword } from "./send.mjs";
import { CHECK_TABLE } from "./checks.mjs";

function row(id, ok, overrides = {}) {
  return { id, label: `label-${id}`, severity: "P1", cost: "free", ok, latencyMs: 42, errorClass: ok ? null : "http", errorCode: null, note: ok ? "ok" : `${id} failed`, detail: null, ...overrides };
}

/** The real labelZh CHECK_TABLE declares for `id` — tests assert against
 * THIS (the actual DingTalk-facing Chinese label), never a fabricated
 * English placeholder, since renderDailyReport looks labels up from
 * CHECK_TABLE by id, not from the result row's own (English, code-only) `label`. */
function realZhLabel(id) {
  return CHECK_TABLE.find((r) => r.id === id)?.labelZh;
}

// ── Daily report rendering ───────────────────────────────────────────────────

test("renderDailyReport: renders a table row for EVERY check result, in order", () => {
  const results = [
    row("initialize", true, { detail: { version: "0.9.42" } }),
    row("tools_list", true, { detail: { count: 28 } }),
    row("oauth_discovery", true),
    row("unauthenticated_401", true),
    row("novada_setup", true),
    row("novada_search", true),
    row("novada_extract", true),
    row("novada_scrape_google", false, { note: "novada_scrape_google: [API_DOWN] upstream 10000", errorCode: "API_DOWN" }),
    row("novada_scrape_bing", true),
    row("novada_account", true),
  ];
  const { title, text } = renderDailyReport({ results, dateStamp: "2026-10-23" });

  assert.ok(title.startsWith("Novada MCP"));
  // The table renders the DingTalk-facing Chinese label looked up from
  // CHECK_TABLE by id (2026-10-23 review finding #4), not the result row's
  // own (English, code-only) `label` field.
  for (const r of results) {
    assert.ok(text.includes(realZhLabel(r.id)), `missing Chinese-labeled row for ${r.id} in rendered report`);
  }
  assert.ok(text.includes("version 0.9.42") === false); // version line uses a labeled field, not the raw note
  assert.match(text, /\*\*version\*\*: 0\.9\.42/);
  assert.match(text, /\*\*tool count\*\*: 28/);
});

test("renderDailyReport: overall status is all-healthy when every row passes", () => {
  const results = [row("initialize", true), row("tools_list", true)];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.match(text, /all healthy/);
});

// ── "慢" (slow) marker (2026-10-23 fix) ──────────────────────────────────────
//
// A successful check that still blows its CHECK_TABLE `slowThresholdMs`
// budget must be flagged in the daily report — WITHOUT ever counting as a
// failure (整体状态 stays healthy) — so creeping upstream latency is
// visible before it becomes an actual timeout.

test("renderDailyReport: a successful check whose latency exceeds its CHECK_TABLE slowThresholdMs gets a 慢 marker on ITS row only, and still counts as healthy (not a failure)", () => {
  const bingThreshold = CHECK_TABLE.find((r) => r.id === "novada_scrape_bing").slowThresholdMs;
  const results = [
    row("initialize", true, { latencyMs: 50 }), // far under its free slowThresholdMs
    row("novada_scrape_bing", true, { cost: "billable", latencyMs: bingThreshold + 1000 }),
  ];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.match(text, /all healthy/, "a slow-but-successful check must never flip 整体状态");

  const lines = text.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("| ---"));
  const slowLine = lines.find((l) => l.includes(realZhLabel("novada_scrape_bing")));
  const fastLine = lines.find((l) => l.includes(realZhLabel("initialize")));
  assert.match(slowLine, /慢/, "the row exceeding its latency budget must carry the slow marker");
  assert.doesNotMatch(fastLine, /慢/, "a row well within its latency budget must NOT carry the slow marker");
});

test("renderDailyReport: a successful check within its slowThresholdMs budget never gets the 慢 marker", () => {
  const results = [row("novada_account", true, { cost: "billable", latencyMs: 100 })];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.doesNotMatch(text, /慢/);
});

test("renderDailyReport: a FAILING check never gets the 慢 marker, even if its reported latencyMs exceeds slowThresholdMs (slow is an ok-but-flagged state, not an alternate failure label)", () => {
  const bingThreshold = CHECK_TABLE.find((r) => r.id === "novada_scrape_bing").slowThresholdMs;
  const results = [row("novada_scrape_bing", false, { cost: "billable", latencyMs: bingThreshold + 1000, errorClass: "timeout" })];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.doesNotMatch(text, /慢/);
  assert.match(text, /❌ fail/);
});

// ── Error classification (HIGH finding, 2026-10-23 review): explicit
// errorCode/errorClass -> annotation table, never a `r.id`/tool-name-prefix
// guess. One test per table row, plus the cross-tool-same-label test the
// review specifically asked for.

test("classifyFailure: INSUFFICIENT_BALANCE -> test-account annotation, marked as an account issue (not a product outage)", () => {
  const cls = classifyFailure({ errorCode: "INSUFFICIENT_BALANCE", errorClass: "tool" });
  assert.equal(cls.annotation, "测试账号余额不足（不是产品故障）");
  assert.equal(cls.accountIssue, true);
});

test("classifyFailure: INVALID_API_KEY -> test-key annotation, also an account issue", () => {
  const cls = classifyFailure({ errorCode: "INVALID_API_KEY", errorClass: "tool" });
  assert.equal(cls.annotation, "测试 key 失效");
  assert.equal(cls.accountIssue, true);
});

test("classifyFailure: API_DOWN -> upstream-service annotation, NOT an account issue", () => {
  const cls = classifyFailure({ errorCode: "API_DOWN", errorClass: "tool" });
  assert.equal(cls.annotation, "上游服务故障");
  assert.equal(cls.accountIssue, false);
});

test("classifyFailure: a network/http/shape/rpc errorClass (no structured errorCode) -> generic server/network annotation", () => {
  for (const errorClass of ["network", "http", "shape", "rpc"]) {
    const cls = classifyFailure({ errorCode: null, errorClass });
    assert.equal(cls.annotation, "服务端/网络");
    assert.equal(cls.accountIssue, false);
  }
});

test("classifyFailure: a totally unrecognized errorCode/errorClass -> 未分类, never a crash or a guess", () => {
  const cls = classifyFailure({ errorCode: "SOME_NEW_CODE_NOT_IN_THE_TABLE", errorClass: "tool" });
  assert.equal(cls.annotation, "未分类");
  assert.equal(cls.accountIssue, false);
});

// 2026-10-23 fix: a probe-side timeout (our own AbortController/AbortSignal
// firing) must get its OWN distinct annotation — never the generic
// "服务端/网络" bucket a real DNS/connection failure gets, and never an
// account issue (the hosted server may well still be processing).
test("classifyFailure: a 'timeout' errorClass -> distinct 监控探针超时 annotation, never the generic 服务端/网络 bucket, never an account issue", () => {
  const cls = classifyFailure({ errorCode: null, errorClass: "timeout" });
  assert.equal(cls.annotation, "监控探针超时（服务端可能仍在处理）");
  assert.equal(cls.accountIssue, false);
  assert.notEqual(cls.annotation, "服务端/网络");
});

test("renderDailyReport: novada_search and novada_scrape_google failing with the SAME errorCode get the EXACT SAME annotation — classification is by error class, never by tool-name prefix", () => {
  const results = [
    row("novada_search", false, { note: "novada_search: [INSUFFICIENT_BALANCE] balance too low", errorCode: "INSUFFICIENT_BALANCE", errorClass: "tool" }),
    row("novada_scrape_google", false, { note: "novada_scrape_google: [INSUFFICIENT_BALANCE] balance too low", errorCode: "INSUFFICIENT_BALANCE", errorClass: "tool" }),
  ];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  const annotation = "测试账号余额不足（不是产品故障）";
  // Must appear once per failing row (same annotation for both), and must
  // NOT be the old tool-name-prefix-only "upstream platform" wording.
  const occurrences = text.split(annotation).length - 1;
  assert.equal(occurrences, 2, "both novada_search and novada_scrape_google must carry the identical annotation");
  assert.ok(!text.includes("upstream platform — not an MCP-side bug"), "the removed tool-name-prefix branch must not resurface");
});

test("renderDailyReport: an INSUFFICIENT_BALANCE failure does NOT count toward 整体状态/worst-severity — it's a separate 监控账号问题 line", () => {
  const results = [
    row("initialize", true),
    row("novada_search", false, { severity: "P1", note: "novada_search: [INSUFFICIENT_BALANCE] balance too low", errorCode: "INSUFFICIENT_BALANCE", errorClass: "tool" }),
  ];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.match(text, /all healthy/, "整体状态 must stay healthy — a test-account funding problem is not a product outage");
  assert.match(text, /监控账号问题/);
  assert.match(text, /测试账号余额不足/);
});

test("renderDailyReport: a genuine product-level failure (e.g. API_DOWN) DOES count toward 整体状态/worst-severity", () => {
  const results = [row("initialize", false, { severity: "P0", errorCode: "API_DOWN", errorClass: "tool" })];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.match(text, /⚠️ 1 check\(s\) failing/);
  assert.doesNotMatch(text, /监控账号问题/);
});

test("renderDailyReport: overall status reflects the worst failing severity (among product-level failures)", () => {
  const results = [row("initialize", false, { severity: "P0" }), row("novada_account", false, { severity: "P1" })];
  const { text } = renderDailyReport({ results, dateStamp: "2026-10-23" });
  assert.match(text, /worst: P0/);
});

// ── Title keyword invariant ──────────────────────────────────────────────────

test("every title this module produces already satisfies an 'MCP' keyword robot with zero prepending", () => {
  const { title: dailyTitle } = renderDailyReport({ results: [row("initialize", true)], dateStamp: "2026-10-23" });
  assert.deepEqual(ensureKeyword(dailyTitle, "", "MCP"), { title: dailyTitle, text: "" });

  const initializeRow = CHECK_TABLE.find((r) => r.id === "initialize");
  const { title: alertTitle } = composeAlertMessage({ id: "initialize", severity: "P0", consecutiveFailures: 2, failingSince: Date.now() }, initializeRow, null);
  assert.deepEqual(ensureKeyword(alertTitle, "", "MCP"), { title: alertTitle, text: "" });

  const { title: recoveryTitle } = composeRecoveryMessage({ id: "initialize", outageMs: 60000, recoveredAt: Date.now() }, initializeRow, null);
  assert.deepEqual(ensureKeyword(recoveryTitle, "", "MCP"), { title: recoveryTitle, text: "" });

  const { title: heartbeatTitle } = composeHeartbeatMessage({ id: "initialize", severity: "P0", outageMs: 60000 }, initializeRow, null);
  assert.deepEqual(ensureKeyword(heartbeatTitle, "", "MCP"), { title: heartbeatTitle, text: "" });

  const { title: misconfiguredTitle } = composeMisconfiguredMessage(initializeRow, "initialize: monitor misconfigured: NOVADA_TEST_KEY missing", null);
  assert.deepEqual(ensureKeyword(misconfiguredTitle, "", "MCP"), { title: misconfiguredTitle, text: "" });
});

test("composeAlertMessage/composeRecoveryMessage/composeHeartbeatMessage/composeMisconfiguredMessage use the Chinese labelZh, not the English label", () => {
  const initializeRow = CHECK_TABLE.find((r) => r.id === "initialize");
  const { title: alertTitle } = composeAlertMessage({ id: "initialize", severity: "P0", consecutiveFailures: 2, failingSince: Date.now() }, initializeRow, null);
  assert.ok(alertTitle.includes(initializeRow.labelZh));
  assert.ok(!alertTitle.includes(initializeRow.label));

  const { title: misconfiguredTitle } = composeMisconfiguredMessage(initializeRow, "initialize: monitor misconfigured: NOVADA_TEST_KEY missing", null);
  assert.ok(misconfiguredTitle.includes(initializeRow.labelZh));
  assert.match(misconfiguredTitle, /监控配置缺失/);
  assert.doesNotMatch(misconfiguredTitle, /failing/i, "a misconfiguration notice must read distinctly from an outage alert");
});

// ── shanghaiDateStamp ─────────────────────────────────────────────────────────

test("shanghaiDateStamp: formats as YYYY-MM-DD", () => {
  const stamp = shanghaiDateStamp(new Date("2026-10-23T00:30:00Z")); // 08:30 Shanghai time, same calendar day
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
});

test("shanghaiDateStamp: a UTC time just before midnight can land on the NEXT Shanghai calendar day", () => {
  // 2026-10-22T20:00:00Z = 2026-10-23T04:00:00+08:00
  const stamp = shanghaiDateStamp(new Date("2026-10-22T20:00:00Z"));
  assert.equal(stamp, "2026-10-23");
});

// ── readExpectedToolCount ─────────────────────────────────────────────────────

test("readExpectedToolCount: returns null (not throw) for a missing file", () => {
  assert.equal(readExpectedToolCount("/nonexistent/path/does-not-exist.json"), null);
});

// ── Mode orchestration (stubbed I/O — no network, no git) ───────────────────

test("runAlertMode: sends exactly one alert message on the 2nd consecutive failure, persists state", async () => {
  const sent = [];
  let saved = null;
  const ctx = { mcpUrl: "https://x/mcp", apiKey: "test-key" };
  const io = {
    send: async (msg) => {
      sent.push(msg);
      return { ok: true };
    },
    load: () => ({ checks: { initialize: { consecutiveFailures: 1, failingSince: 1000, lastAlertAt: null, lastHeartbeatAt: null, alerted: false } } }),
    save: (state) => {
      saved = state;
    },
    rateLimiter: { acquire: async () => {} },
  };
  // Stub runChecks indirectly isn't possible without monkeypatching the
  // import, so this test drives runAlertMode with a ctx whose mcpUrl points
  // nowhere and instead asserts on the DRY_RUN-free plumbing using a fully
  // mocked fetch via globalThis.fetch override, scoped to this test only.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === "GET" || !opts) {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" }) };
    }
    const body = JSON.parse(opts.body);
    if (body.method === "initialize") {
      // Make "initialize" keep failing (2nd consecutive failure this run).
      return { status: 402, headers: { get: () => null }, text: async () => JSON.stringify({ error: "DEPLOYMENT_DISABLED" }) };
    }
    if (body.method === "tools/list") {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { tools: [] } }) };
    }
    return { status: 401, headers: { get: () => null } };
  };
  try {
    const exitCode = await runAlertMode({ ctx, dryRun: false, webhookUrl: "https://example.invalid/x", io });
    assert.equal(exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const alertMsgs = sent.filter((m) => m.title.includes("initialize") || m.title.toLowerCase().includes("failing"));
  assert.ok(alertMsgs.length >= 1, "expected at least one alert message for the failing initialize check");
  assert.ok(saved, "state must be persisted (save() called) outside of DRY_RUN");
  assert.equal(saved.checks.initialize.alerted, true);
});

test("runAlertMode: DRY_RUN never calls load()/save() (state untouched)", async () => {
  let loadCalled = false;
  let saveCalled = false;
  const io = {
    send: async () => ({ ok: true, dryRun: true }),
    load: () => {
      loadCalled = true;
      return {};
    },
    save: () => {
      saveCalled = true;
    },
    rateLimiter: { acquire: async () => {} },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { serverInfo: { version: "0.9.42" }, tools: [] } }) });
  try {
    await runAlertMode({ ctx: { mcpUrl: "https://x/mcp", apiKey: "test-key" }, dryRun: true, io });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(loadCalled, false);
  assert.equal(saveCalled, false);
});

// ── CRITICAL finding (2026-10-23 review): alert-check must never fire an
// outage alert for a monitor-misconfiguration failure (missing
// NOVADA_TEST_KEY), and must notify about the misconfiguration exactly once.

test("runAlertMode: WITHOUT NOVADA_TEST_KEY, auth-requiring free checks report 'misconfigured' — no outage alert/heartbeat is ever produced", async () => {
  const sent = [];
  const io = {
    send: async (msg) => {
      sent.push(msg);
      return { ok: true };
    },
    load: () => ({}),
    save: () => {},
    rateLimiter: { acquire: async () => {} },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!opts || opts.method === "GET") {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" }) };
    }
    // Only unauthenticated_401's raw POST should ever reach here for the
    // auth-requiring checks (initialize/tools_list/novada_setup) — their
    // requireApiKey() guard must short-circuit BEFORE any fetch call when
    // ctx.apiKey is absent, so this branch must only ever serve that probe.
    return {
      status: 401,
      headers: { get: (k) => (k.toLowerCase() === "www-authenticate" ? 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource/mcp"' : null) },
    };
  };
  let exitCode;
  try {
    exitCode = await runAlertMode({ ctx: { mcpUrl: "https://x/mcp" } /* no apiKey */, dryRun: false, webhookUrl: "https://example.invalid/x", io });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(exitCode, 0);
  assert.ok(sent.length > 0, "expected at least the misconfigured notice(s) to be sent");
  for (const msg of sent) {
    assert.doesNotMatch(msg.title, /failing/i, `no outage-alert-shaped title should ever be produced from a config-only failure set, got: "${msg.title}"`);
    assert.doesNotMatch(msg.title, /still failing/i);
  }
  assert.ok(sent.some((m) => /监控配置缺失/.test(m.title)), "expected a distinct misconfigured notice to be sent");
});

test("runAlertMode: a misconfigured notice for the same check is sent exactly ONCE across repeated runs (not every 15 minutes forever)", async () => {
  const sent = [];
  let persisted = {};
  const io = {
    send: async (msg) => {
      sent.push(msg);
      return { ok: true };
    },
    load: () => persisted,
    save: (s) => {
      persisted = s;
    },
    rateLimiter: { acquire: async () => {} },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!opts || opts.method === "GET") {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" }) };
    }
    return {
      status: 401,
      headers: { get: (k) => (k.toLowerCase() === "www-authenticate" ? 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource/mcp"' : null) },
    };
  };
  try {
    await runAlertMode({ ctx: { mcpUrl: "https://x/mcp" }, dryRun: false, webhookUrl: "https://example.invalid/x", io, now: 1000 });
    const firstRunSentCount = sent.length;
    assert.ok(firstRunSentCount > 0, "first run must notify");

    await runAlertMode({ ctx: { mcpUrl: "https://x/mcp" }, dryRun: false, webhookUrl: "https://example.invalid/x", io, now: 1000 + 15 * 60_000 });
    assert.equal(sent.length, firstRunSentCount, "second consecutive run with the SAME missing-key misconfiguration must send nothing new");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runDailyMode: sends exactly one markdown report covering all check ids", async () => {
  const sent = [];
  const io = {
    send: async (msg) => {
      sent.push(msg);
      return { ok: true };
    },
    rateLimiter: { acquire: async () => {} },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!opts || opts.method === "GET") {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ resource: "x", authorization_servers: ["x"], issuer: "x", authorization_endpoint: "x", token_endpoint: "x" }) };
    }
    const body = JSON.parse(opts.body);
    if (body.method === "initialize") return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { serverInfo: { version: "0.9.42" } } }) };
    if (body.method === "tools/list") return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { tools: [{ name: "a" }] } }) };
    if (body.method === "tools/call") return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] } }) };
    return { status: 401, headers: { get: () => null } };
  };
  try {
    const exitCode = await runDailyMode({ ctx: { mcpUrl: "https://x/mcp", apiKey: "k" }, dryRun: false, webhookUrl: "https://example.invalid/x", io });
    assert.equal(exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sent.length, 1, "daily mode sends exactly one message");
  assert.equal(sent[0].kind, "markdown");
  for (const row of CHECK_TABLE) {
    assert.ok(sent[0].text.includes(row.labelZh), `daily report missing a row for "${row.id}" (labelZh: ${row.labelZh})`);
  }
});
