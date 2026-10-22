/**
 * Well-known static-text domain-verification routes (OpenAI Apps submission,
 * https://developers.openai.com/plugins/deploy/submission): "host the exact
 * challenge token as plain text at the URL shown in the portal ... Return
 * only the exact token—not JSON or a list of tokens."
 *
 * api/_wellknown.ts is import-free by design (same convention as _oauth.ts,
 * _plan.ts) — real `import` here, no source-slicing needed for the UNIT
 * layer. The WIRING layer below falls back to the rest of this test dir's
 * "text-parse + extract-and-execute/assert the real mcp.ts source, don't
 * import mcp.ts" convention (module-load side effects: Sentry.init,
 * @vercel/kv client construction, env-var stripping — see oauth.test.mjs's
 * T27-T32 STATIC layer for the precedent this mirrors).
 *
 * Layers:
 *   UNIT   — table lookup, 200/404/405 shapes, HEAD body, trimming,
 *            never-logs, mirror test for an unlisted well-known path.
 *   WIRING — mcp.ts imports and routes handleWellKnownStaticText() BEFORE
 *            the isMcpPath 404 branch, the STUB_AUTH gate, the KV check, and
 *            preAuthRateLimitExceeded(), so OpenAI's verifier can never be
 *            401'd/429'd/503'd.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  WELL_KNOWN_STATIC_TEXT_ROUTES,
  handleWellKnownStaticText,
} from "../api/_wellknown.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");

const ROUTE_PATH = "/.well-known/openai-apps-challenge";
const ENV_VAR = "OPENAI_APPS_CHALLENGE_TOKEN";

// ─── Spy helper: assert no console.* call happened, or (if any did) none of ──
// ─── its string-ified arguments contain a given needle. ─────────────────────

function withConsoleSpy(fn) {
  const calls = [];
  const methods = ["log", "info", "warn", "error", "debug"];
  const originals = {};
  for (const m of methods) {
    originals[m] = console[m];
    console[m] = (...args) => { calls.push({ method: m, args }); };
  }
  try {
    return { result: fn(), calls };
  } finally {
    for (const m of methods) console[m] = originals[m];
  }
}

function assertNeverLogs(calls, needle, label) {
  for (const { method, args } of calls) {
    const joined = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    assert.ok(!joined.includes(needle), `${label}: console.${method} call must never include the token, got: ${joined}`);
  }
}

// ─── UNIT: class table ───────────────────────────────────────────────────────

test("WELL_KNOWN_STATIC_TEXT_ROUTES: first row is the OpenAI Apps challenge path -> env var", () => {
  assert.ok(Array.isArray(WELL_KNOWN_STATIC_TEXT_ROUTES) && WELL_KNOWN_STATIC_TEXT_ROUTES.length >= 1);
  assert.deepEqual(WELL_KNOWN_STATIC_TEXT_ROUTES[0], { path: ROUTE_PATH, envVar: ENV_VAR });
});

// ─── UNIT: env var set -> 200 exact trimmed body, text/plain, no-store ──────

test("GET with env set -> 200, exact trimmed token body, text/plain; charset=utf-8, cache-control: no-store", async () => {
  const RAW = "  abc123-the-real-token  \n"; // deliberately padded to prove trimming
  const { result: res, calls } = withConsoleSpy(() =>
    handleWellKnownStaticText(ROUTE_PATH, "GET", (name) => (name === ENV_VAR ? RAW : undefined)),
  );
  assert.ok(res, "must return a Response, not null, for a matched path");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.text();
  assert.equal(body, "abc123-the-real-token", "body must be the exact token, trimmed, no JSON, no added newline");
  assertNeverLogs(calls, "abc123-the-real-token", "GET 200 path");
});

test("HEAD with env set -> 200 with headers, empty body, never logs", async () => {
  const RAW = "head-token-value";
  const { result: res, calls } = withConsoleSpy(() =>
    handleWellKnownStaticText(ROUTE_PATH, "head", (name) => (name === ENV_VAR ? RAW : undefined)),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.text();
  assert.equal(body, "", "HEAD must not return a body");
  assertNeverLogs(calls, RAW, "HEAD 200 path");
});

// ─── UNIT: env var unset/empty -> 404, same JSON-RPC shape as mcp.ts's ──────
// ─── existing unmatched-path jsonError(404, "NOT_FOUND", ...) ───────────────

const EXPECTED_404_BODY = {
  jsonrpc: "2.0",
  error: {
    code: 404,
    message: "Unknown path. The MCP endpoint is POST/GET /mcp.",
    data: { code: "NOT_FOUND" },
  },
  id: null,
};

for (const [label, rawEnvValue] of [["unset", undefined], ["empty string", ""], ["whitespace only", "   \n"]]) {
  test(`GET with env ${label} -> 404, same shape as mcp.ts's existing unmatched-path 404`, async () => {
    const res = handleWellKnownStaticText(ROUTE_PATH, "GET", () => rawEnvValue);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type"), "application/json");
    const body = await res.json();
    assert.deepEqual(body, EXPECTED_404_BODY);
  });
}

// mcp.ts's own jsonError 404 literal must still match the string embedded above
// (regression fence against the two shapes silently drifting apart).
test("mcp.ts's jsonError 404 call for unmatched paths still uses the exact message this file mirrors", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(
    src,
    /jsonError\(404, "NOT_FOUND", "Unknown path\. The MCP endpoint is POST\/GET \/mcp\."\);/,
    "mcp.ts's unmatched-path 404 message changed — update _wellknown.ts's mirrored literal to match",
  );
});

// ─── UNIT: any other method -> 405 ───────────────────────────────────────────

for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
  test(`${method} on the challenge path -> 405, allow: GET, HEAD`, () => {
    const res = handleWellKnownStaticText(ROUTE_PATH, method, () => "some-token");
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  });
}

// ─── UNIT mirror test: a path NOT in the table is untouched (returns null) ──

test("mirror: a path not in the table returns null (falls through to normal 404, not a special-cased one)", () => {
  const res = handleWellKnownStaticText("/.well-known/not-a-real-challenge", "GET", () => "token-that-must-not-leak-out");
  assert.equal(res, null);
});

test("mirror: a plain unrelated path (e.g. /mcp) returns null", () => {
  const res = handleWellKnownStaticText("/mcp", "GET", () => "token-that-must-not-leak-out");
  assert.equal(res, null);
});

// ─── WIRING: mcp.ts imports + routes handleWellKnownStaticText BEFORE the ───
// ─── auth gate / rate limiter / 404 branch (text-parse convention) ──────────

test("mcp.ts imports ./_wellknown.js and calls handleWellKnownStaticText BEFORE the isMcpPath 404, STUB_AUTH gate, KV check, and pre-auth rate limiter", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /from "\.\/_wellknown\.js"/, "mcp.ts must import from ./_wellknown.js");

  const callIdx = src.indexOf("handleWellKnownStaticText(pathname, request.method,");
  assert.ok(callIdx !== -1, "handleWellKnownStaticText must be called in mcp.ts's routing");

  const notFoundIdx = src.indexOf('return jsonError(404, "NOT_FOUND", "Unknown path. The MCP endpoint is POST/GET /mcp.");');
  const stubAuthIdx = src.indexOf('"STUB_AUTH_UNACKED"');
  const kvCheckIdx = src.indexOf('"KV_NOT_CONFIGURED"');
  const preAuthRlIdx = src.indexOf("await preAuthRateLimitExceeded(ip, env)");

  assert.ok(notFoundIdx !== -1 && callIdx < notFoundIdx, "well-known routing must be wired before the isMcpPath 404 branch");
  assert.ok(stubAuthIdx !== -1 && callIdx < stubAuthIdx, "well-known routing must be wired before the STUB_AUTH gate (so it can't 503 a verifier)");
  assert.ok(kvCheckIdx !== -1 && callIdx < kvCheckIdx, "well-known routing must be wired before the KV_NOT_CONFIGURED check");
  assert.ok(preAuthRlIdx !== -1 && callIdx < preAuthRlIdx, "well-known routing must be wired before preAuthRateLimitExceeded (so it can't 429 a verifier)");
});

test("mcp.ts's well-known routing short-circuits on a non-null response (never falls through for a matched path)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const callIdx = src.indexOf("const wellKnownResponse = handleWellKnownStaticText(");
  assert.ok(callIdx !== -1, "must bind the result to check it");
  const guardSlice = src.slice(callIdx, callIdx + 200);
  assert.match(guardSlice, /if \(wellKnownResponse\) \{\s*return wellKnownResponse;\s*\}/, "must return immediately when a route matched");
});
