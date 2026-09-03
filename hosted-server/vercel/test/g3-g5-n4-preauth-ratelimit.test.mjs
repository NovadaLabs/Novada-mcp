/**
 * G-3 (P3) + G-5/V2-N4 (P3) — hosted rate-limit gateway hardening (audit
 * 2026-09-02, findings/G-security-billing.md + findings/V2-verification-FDEG.md).
 *
 * G-3: the gateway rate-limit rejection returned 429 with retry guidance only
 *   in the JSON message TEXT — no `Retry-After` header, so standard HTTP
 *   clients/SDK backoff logic couldn't act on it. mcp.ts's original
 *   `jsonError(429, "RATE_LIMITED", …)` call took no extraHeaders (contrast
 *   the 401 sites nearby, which do pass extra headers).
 *
 * G-5 / V2-N4: auth ordering was validateToken → rateLimitExceeded. Any
 *   client could send unlimited requests/min, each with a FRESH random
 *   format-valid token (16+ alnum chars) — every one burns a KV cache read, a
 *   live `POST /v1/wallet/balance` probe against api-m.novada.com, a KV cache
 *   write, AND (V2-N4) an emitGuardRejection AES-encrypt + Supabase telemetry
 *   emit — all BEFORE the per-IP rate limiter ever runs, because rejection
 *   (401) happens first and the limiter is never reached. The 90s verdict
 *   cache only absorbs repeats of the SAME key; unique dummy keys are trivial.
 *
 * Fix: a new `preAuthRateLimitExceeded()` gate — same per-minute-bucket KV
 * counter mechanics as the existing post-auth `rateLimitExceeded()`, separate
 * `pra:` key namespace, NO telemetry emit on rejection — checked immediately
 * after `ip` is resolved and BEFORE token extraction / validateToken / any
 * emitGuardRejection call. Both 429 `jsonError` call sites now pass
 * `{ "retry-after": "60" }`.
 *
 * Runs on plain Node (`node --test`) — same "extract-and-execute the REAL
 * source, don't import mcp.ts" constraint as hosted-hidden-fail-closed.test.mjs
 * and tool-catalog-derivation.test.mjs: mcp.ts has module-load side effects
 * (Sentry.init, @vercel/kv client construction, env-var stripping) that make
 * it unsafe to `import` directly in a test.
 *
 * Layers:
 *   1. BEHAVIORAL — extract-and-execute the REAL preAuthRateLimitExceeded()
 *      function body against an in-memory KV mock, wired in front of a
 *      validateToken spy in the exact order fetchHandler wires it, and prove
 *      61 requests from ONE IP call the spy <=60 times (SOP exit condition).
 *   2. STATIC — regression fence on api/mcp.ts source: the pre-auth gate call
 *      site precedes validateToken( and every emitGuardRejection( call inside
 *      fetchHandler's guard chain; `ip` is resolved exactly once and reused;
 *      the gate itself never calls emitGuardRejection; both RATE_LIMITED 429
 *      jsonError sites pass a retry-after header.
 *   3. BEHAVIORAL (G-3) — extract-and-execute the REAL jsonError(...) function
 *      and prove the actual Response object carries `retry-after: 60`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const mcpSrc = readFileSync(MCP_TS, "utf8");

function sliceBetween(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end);
}

// ─── Layer 1: BEHAVIORAL — extract-and-execute the REAL preAuthRateLimitExceeded ──

/** In-memory KV mock honoring the exact subset of the @vercel/kv API the gate uses. */
function makeMockKv() {
  const store = new Map();
  return {
    async incr(key) {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async expire() { /* TTL irrelevant within one synchronous test run */ },
  };
}

/** Extract and EXECUTE mcp.ts's real preAuthRateLimitExceeded body (not a reimplementation). */
function extractPreAuthRateLimitExceeded(kv) {
  const SIG = "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {";
  // sliceBetween returns the slice INCLUDING the start anchor (matching this
  // repo's established convention — see hosted-hidden-fail-closed.test.mjs's
  // sliceBetween). Swap the TS-typed signature for a plain arrow-function
  // opener (same "strip the one TS-only bit, execute the rest verbatim"
  // technique tool-catalog-derivation.test.mjs uses for `: ReadonlySet<string>`).
  const code = sliceBetween(SIG, "\n}\n", "preAuthRateLimitExceeded")
    .replace(SIG, "return async (ip, env) => {");
  const fn = new Function("kv", `${code}\n};`);
  return fn(kv);
}

test("G-5/V2-N4 BEHAVIORAL: preAuthRateLimitExceeded, wired before validateToken exactly as fetchHandler wires it, bounds validateToken to <=60 calls across 61 requests from one IP", async () => {
  const kv = makeMockKv();
  const preAuthRateLimitExceeded = extractPreAuthRateLimitExceeded(kv);
  const env = { RATE_LIMIT_PER_MIN: "60" };
  const ip = "203.0.113.42";

  let validateTokenCalls = 0;
  const validateToken = async (_token, _env) => {
    validateTokenCalls++;
    return { valid: true, plan: "free", quota_remaining: 1000, verified: true };
  };

  // Replays fetchHandler's real order: ip resolved once, gate checked BEFORE
  // any token work, then (only if the gate passes) validateToken runs on a
  // fresh, distinct format-valid dummy key — exactly the attack G-5/V2-N4
  // describe (unique keys defeat the 90s SAME-key verdict cache).
  let preAuthRejections = 0;
  for (let i = 0; i < 61; i++) {
    const dummyKey = `dummy-format-valid-key-${i}-0000000000000000`;
    if (await preAuthRateLimitExceeded(ip, env)) {
      preAuthRejections++;
      continue; // 429 returned immediately — validateToken is never reached
    }
    await validateToken(dummyKey, env);
  }

  assert.ok(validateTokenCalls <= 60, `validateToken must be called <=60 times across 61 requests, got ${validateTokenCalls}`);
  assert.equal(validateTokenCalls, 60, "with limit=60 and 61 requests from one IP, exactly the 61st must be gated pre-auth");
  assert.equal(preAuthRejections, 1, "exactly one request (the 61st) must be pre-auth rejected");
});

test("G-5/V2-N4 BEHAVIORAL: the gate is per-IP, not global — a different IP is unaffected by another IP's counter", async () => {
  const kv = makeMockKv();
  const preAuthRateLimitExceeded = extractPreAuthRateLimitExceeded(kv);
  const env = { RATE_LIMIT_PER_MIN: "60" };

  for (let i = 0; i < 60; i++) await preAuthRateLimitExceeded("203.0.113.42", env);
  const sameIpExceeded = await preAuthRateLimitExceeded("203.0.113.42", env);
  const otherIpExceeded = await preAuthRateLimitExceeded("198.51.100.7", env);

  assert.equal(sameIpExceeded, true, "the 61st request from the SAME IP must be gated");
  assert.equal(otherIpExceeded, false, "a DIFFERENT IP's first request must not be gated by another IP's count");
});

test("G-5/V2-N4 BEHAVIORAL: respects a custom RATE_LIMIT_PER_MIN threshold (not hardcoded to 60)", async () => {
  const kv = makeMockKv();
  const preAuthRateLimitExceeded = extractPreAuthRateLimitExceeded(kv);
  const env = { RATE_LIMIT_PER_MIN: "5" };
  const ip = "203.0.113.99";

  const results = [];
  for (let i = 0; i < 6; i++) results.push(await preAuthRateLimitExceeded(ip, env));

  assert.deepEqual(results, [false, false, false, false, false, true], "requests 1-5 pass, request 6 is gated when RATE_LIMIT_PER_MIN=5");
});

// ─── Layer 2: STATIC — regression fence on api/mcp.ts wiring ────────────────────

test("G-5/V2-N4 STATIC: fetchHandler's pre-auth gate call precedes validateToken( and every emitGuardRejection( call in the guard chain", () => {
  const fnStart = mcpSrc.indexOf("async function fetchHandler(request: Request, nodeCtx?: NodeCtx): Promise<Response> {");
  assert.ok(fnStart !== -1, "fetchHandler must exist at its known signature");
  const guardChainEnd = mcpSrc.indexOf("// Upstream Novada API key", fnStart);
  assert.ok(guardChainEnd !== -1, "guard-chain end anchor ('// Upstream Novada API key') must exist after fetchHandler");
  const guardChain = mcpSrc.slice(fnStart, guardChainEnd);

  const gateCallIdx = guardChain.indexOf("preAuthRateLimitExceeded(ip, env)");
  assert.ok(gateCallIdx !== -1, "preAuthRateLimitExceeded(ip, env) must be called inside fetchHandler's guard chain");

  const validateTokenCallIdx = guardChain.indexOf("await validateToken(token, env)");
  assert.ok(validateTokenCallIdx !== -1, "validateToken(token, env) call must exist in the guard chain");
  assert.ok(gateCallIdx < validateTokenCallIdx,
    `the pre-auth gate (offset ${gateCallIdx}) must run BEFORE validateToken (offset ${validateTokenCallIdx})`);

  const emitGuardRejectionCalls = [...guardChain.matchAll(/await emitGuardRejection\(/g)];
  assert.ok(emitGuardRejectionCalls.length >= 3, `expected >=3 emitGuardRejection sites in the guard chain, found ${emitGuardRejectionCalls.length}`);
  for (const m of emitGuardRejectionCalls) {
    assert.ok(gateCallIdx < m.index,
      `the pre-auth gate (offset ${gateCallIdx}) must run BEFORE every emitGuardRejection call (found one at offset ${m.index})`);
  }
});

test("G-5/V2-N4 STATIC: `ip` is resolved exactly once via getClientIp and reused by both limiters", () => {
  const occurrences = [...mcpSrc.matchAll(/const ip = getClientIp\(request\);/g)];
  assert.equal(occurrences.length, 1,
    "getClientIp(request) must be assigned to `ip` exactly once — the post-auth limiter must reuse it, not re-resolve it");
});

test("G-5/V2-N4 STATIC: the pre-auth gate itself performs no telemetry emit on rejection (stays cheap)", () => {
  const body = sliceBetween(
    "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    "\n}\n",
    "preAuthRateLimitExceeded body (telemetry check)",
  );
  assert.doesNotMatch(body, /emitGuardRejection/,
    "preAuthRateLimitExceeded must not itself call emitGuardRejection — that would just move the amplification target, not close it");
});

test("G-3 STATIC: both RATE_LIMITED 429 jsonError call sites pass a retry-after header", () => {
  const sites = [...mcpSrc.matchAll(/jsonError\(429, "RATE_LIMITED",[\s\S]*?\);/g)];
  assert.ok(sites.length >= 2, `expected >=2 RATE_LIMITED 429 sites (pre-auth + post-auth), found ${sites.length}`);
  for (const m of sites) {
    assert.match(m[0], /"retry-after":\s*"60"/, `429 site must pass a retry-after header, got: ${m[0].slice(0, 160)}`);
  }
});

// ─── Layer 3: BEHAVIORAL (G-3) — extract-and-execute the REAL jsonError(...) ─────

/** Extract and EXECUTE mcp.ts's real jsonError function (not a reimplementation). */
function extractJsonError() {
  const SIG = 'function jsonError(status: number, code: string, message: string, agentInstruction?: string, extraHeaders?: Record<string, string>): Response {';
  const code = sliceBetween(SIG, "\n}\n", "jsonError")
    .replace(SIG, "return function jsonError(status, code, message, agentInstruction, extraHeaders) {");
  return new Function(`${code}\n};`)();
}

test("G-3 BEHAVIORAL: extract-and-execute the REAL jsonError(...) function — a 429 call with retry-after produces a Response carrying that header", () => {
  const jsonError = extractJsonError();

  const res = jsonError(429, "RATE_LIMITED", "Too many requests from your IP. Limit is 60 requests/minute.",
    "Retry after 60 seconds. If you need higher limits, contact sales@novada.com.",
    { "retry-after": "60" });

  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "60", "the real jsonError() must set the retry-after header verbatim from extraHeaders");
  assert.equal(res.headers.get("content-type"), "application/json");
});

test("G-3 BEHAVIORAL: jsonError(...) with no extraHeaders (e.g. the 401 MISSING_TOKEN-less case) never sets a spurious retry-after", () => {
  const jsonError = extractJsonError();

  const res = jsonError(404, "NOT_FOUND", "nope");
  assert.equal(res.headers.get("retry-after"), null, "no extraHeaders passed → no retry-after header must appear");
});
