// monitoring/dingtalk/send.test.mjs
//
// node:test coverage for send.mjs: signing (against an independently
// computed fixed vector, not just self-consistency), keyword enforcement,
// errcode handling, the 5xx/network retry-once rule, the rate-limiter's
// pure wait-time computation, a real fake-webhook-server round trip, and a
// secrets-never-logged spy.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  signDingTalk,
  buildSignedUrl,
  ensureKeyword,
  buildMarkdownBody,
  buildActionCardBody,
  nextAvailableInMs,
  sendDingTalk,
} from "./send.mjs";

// ── Signing ──────────────────────────────────────────────────────────────────

// Cross-checked against an INDEPENDENT Python implementation of DingTalk's
// documented algorithm (hmac + hashlib.sha256 + base64 + urllib.parse.quote_plus):
//
//   secret = "SECtestsecret1234567890"
//   timestamp = "1700000000000"
//   string_to_sign = f"{timestamp}\n{secret}"
//   sign = quote_plus(base64.b64encode(hmac.new(secret.encode(), string_to_sign.encode(),
//                                                hashlib.sha256).digest()))
//   -> "DIgNmDPSuof38xh133eRNOmAE5BwDTBd6ogR7%2FfeFXM%3D"
//
// This proves send.mjs's JS implementation matches the documented algorithm
// from a second, independent language — not merely that the JS output
// equals itself.
test("signDingTalk matches an independently-computed (Python) fixed vector", () => {
  const { timestamp, sign } = signDingTalk("SECtestsecret1234567890", 1700000000000);
  assert.equal(timestamp, "1700000000000");
  assert.equal(sign, "DIgNmDPSuof38xh133eRNOmAE5BwDTBd6ogR7%2FfeFXM%3D");
});

test("signDingTalk produces a different signature for a different secret or timestamp", () => {
  const base = signDingTalk("SECtestsecret1234567890", 1700000000000);
  const diffSecret = signDingTalk("SECdifferent", 1700000000000);
  const diffTime = signDingTalk("SECtestsecret1234567890", 1700000000001);
  assert.notEqual(diffSecret.sign, base.sign);
  assert.notEqual(diffTime.sign, base.sign);
});

test("buildSignedUrl appends timestamp/sign only when a secret is given", () => {
  const unsigned = buildSignedUrl("https://oapi.dingtalk.com/robot/send?access_token=abc", undefined);
  assert.equal(unsigned, "https://oapi.dingtalk.com/robot/send?access_token=abc");

  const signed = buildSignedUrl("https://oapi.dingtalk.com/robot/send?access_token=abc", "SECxyz", 1700000000000);
  assert.match(signed, /&timestamp=1700000000000&sign=/);
});

// ── Keyword enforcement ──────────────────────────────────────────────────────

test("ensureKeyword is a no-op when keyword already present", () => {
  const r = ensureKeyword("Novada MCP alert", "body text", "MCP");
  assert.deepEqual(r, { title: "Novada MCP alert", text: "body text" });
});

test("ensureKeyword prepends the keyword to the title when missing from both", () => {
  const r = ensureKeyword("Server down", "details here", "MCP");
  assert.equal(r.title, "[MCP] Server down");
  assert.equal(r.text, "details here"); // text untouched
  assert.ok((r.title + "\n" + r.text).includes("MCP"));
});

test("ensureKeyword is a no-op when keyword is falsy (not configured)", () => {
  const r = ensureKeyword("Server down", "details", "");
  assert.deepEqual(r, { title: "Server down", text: "details" });
});

test("ensureKeyword matches when keyword only appears in text, not title", () => {
  const r = ensureKeyword("Server down", "This affects the MCP endpoint", "MCP");
  assert.deepEqual(r, { title: "Server down", text: "This affects the MCP endpoint" });
});

// ── Message bodies ───────────────────────────────────────────────────────────

test("buildMarkdownBody shape", () => {
  assert.deepEqual(buildMarkdownBody("t", "x"), { msgtype: "markdown", markdown: { title: "t", text: "x" } });
});

test("buildActionCardBody includes singleTitle/singleURL only when both given", () => {
  const withLink = buildActionCardBody({ title: "t", text: "x", singleTitle: "View", singleURL: "https://x" });
  assert.equal(withLink.actionCard.singleTitle, "View");
  const withoutLink = buildActionCardBody({ title: "t", text: "x" });
  assert.equal(withoutLink.actionCard.singleTitle, undefined);
});

// ── errcode handling ─────────────────────────────────────────────────────────

test("sendDingTalk: errcode 0 is success", async () => {
  const fetchFn = async () => ({ status: 200, json: async () => ({ errcode: 0, errmsg: "ok" }) });
  const res = await sendDingTalk({ webhookUrl: "https://example.invalid/robot/send?access_token=x", title: "t", text: "x", fetchFn });
  assert.equal(res.ok, true);
});

test("sendDingTalk: non-zero errcode is a failure, never retried", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { status: 200, json: async () => ({ errcode: 310000, errmsg: "keywords not in content" }) };
  };
  const res = await sendDingTalk({ webhookUrl: "https://example.invalid/robot/send?access_token=x", title: "t", text: "x", fetchFn });
  assert.equal(res.ok, false);
  assert.equal(res.errcode, 310000);
  assert.equal(res.errmsg, "keywords not in content");
  assert.equal(calls, 1, "a DingTalk-level errcode must not be retried");
});

// ── retry-once on 5xx/network ────────────────────────────────────────────────

test("sendDingTalk: retries once on HTTP 500, then succeeds", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    if (calls === 1) return { status: 503, json: async () => ({}) };
    return { status: 200, json: async () => ({ errcode: 0, errmsg: "ok" }) };
  };
  const res = await sendDingTalk({ webhookUrl: "https://example.invalid/robot/send?access_token=x", title: "t", text: "x", fetchFn, sleep: async () => {} });
  assert.equal(res.ok, true);
  assert.equal(res.retried, true);
  assert.equal(calls, 2);
});

test("sendDingTalk: retries once on network error, fails after exhausting the retry", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    throw new Error("ECONNRESET");
  };
  const res = await sendDingTalk({ webhookUrl: "https://example.invalid/robot/send?access_token=x", title: "t", text: "x", fetchFn, sleep: async () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.retried, true);
  assert.equal(calls, 2, "exactly one retry, not an unbounded loop");
});

test("sendDingTalk: a 4xx is never retried", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { status: 404, json: async () => ({}) };
  };
  const res = await sendDingTalk({ webhookUrl: "https://example.invalid/robot/send?access_token=x", title: "t", text: "x", fetchFn });
  assert.equal(res.ok, false);
  assert.equal(calls, 1);
});

test("sendDingTalk: DRY_RUN never touches the network and never consults the rate limiter", async () => {
  let fetchCalls = 0;
  let acquireCalls = 0;
  const fetchFn = async () => {
    fetchCalls += 1;
    throw new Error("should never be called in dry run");
  };
  const rateLimiter = { acquire: async () => { acquireCalls += 1; } };
  const res = await sendDingTalk({ webhookUrl: "https://example.invalid/x", title: "t", text: "x", dryRun: true, fetchFn, rateLimiter });
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(fetchCalls, 0);
  assert.equal(acquireCalls, 0);
});

// ── Rate limiter (pure wait-time computation) ───────────────────────────────

test("nextAvailableInMs: under the limit, no wait", () => {
  const history = [0, 1000, 2000];
  assert.equal(nextAvailableInMs(history, 3000, 20, 60000), 0);
});

test("nextAvailableInMs: at the limit, waits until the oldest entry falls out of the window", () => {
  const history = Array.from({ length: 20 }, (_, i) => i * 100); // 0..1900ms, 20 entries
  const now = 2000;
  const waitMs = nextAvailableInMs(history, now, 20, 60000);
  // oldest entry (t=0) falls out of the window at t=60000 -> wait = 60000 - 2000
  assert.equal(waitMs, 58000);
});

test("nextAvailableInMs: entries outside the window don't count against the limit", () => {
  const history = [0]; // far in the past relative to `now`
  const now = 120000; // 2 minutes later, well outside a 60s window
  assert.equal(nextAvailableInMs(history, now, 20, 60000), 0);
});

// ── Fake webhook server: exactly one well-formed request ────────────────────

test("sendDingTalk against a real local fake webhook server: exactly one well-formed request", async () => {
  let requestCount = 0;
  let capturedBody = null;
  let capturedUrl = null;

  const server = http.createServer((req, res) => {
    requestCount += 1;
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      capturedUrl = req.url;
      capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const webhookUrl = `http://127.0.0.1:${port}/robot/send?access_token=fake-token`;

  try {
    const res = await sendDingTalk({
      webhookUrl,
      secret: "SECtestsecret1234567890",
      keyword: "MCP",
      title: "Novada MCP health test",
      text: "fake webhook integration test",
    });
    assert.equal(res.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  assert.equal(requestCount, 1, "exactly one request must reach the fake webhook server");
  assert.match(capturedUrl, /access_token=fake-token/);
  assert.match(capturedUrl, /&timestamp=\d+&sign=/, "signed URL must carry timestamp+sign query params");
  assert.equal(capturedBody.msgtype, "markdown");
  assert.ok(capturedBody.markdown.title.includes("Novada MCP"));
  assert.ok(capturedBody.markdown.title.includes("MCP")); // keyword present
});

// ── Secrets never appear in any log output ──────────────────────────────────

test("a failed send never logs the webhook URL or the signing secret", async () => {
  const SECRET_MARKER = "SECshouldneverbelogged999";
  const TOKEN_MARKER = "access_token=should-never-be-logged-either";
  const webhookUrl = `https://example.invalid/robot/send?${TOKEN_MARKER}`;

  const fetchFn = async () => ({ status: 200, json: async () => ({ errcode: 300001, errmsg: "token or param invalid" }) });

  const originalError = console.error;
  const originalLog = console.log;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  console.log = (...args) => logged.push(args.join(" "));
  try {
    const res = await sendDingTalk({ webhookUrl, secret: SECRET_MARKER, title: "t", text: "x", fetchFn });
    assert.equal(res.ok, false);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  const joined = logged.join("\n");
  assert.ok(!joined.includes(SECRET_MARKER), "secret must never appear in logs");
  assert.ok(!joined.includes(TOKEN_MARKER), "webhook URL / access_token must never appear in logs");
  assert.ok(joined.includes("300001"), "errcode SHOULD be logged (diagnostic, not a secret)");
});
