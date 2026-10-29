/**
 * KV fail-open coverage (claude-directory-exam S1-connector round 2, C1).
 *
 * Independent review of the round-1 golden-baseline regeneration (commit
 * 2ff7ddc) traced a real, reachable defect: decrementQuota/rateLimitExceeded/
 * preAuthRateLimitExceeded called `kv.incr`/`kv.expire` directly with NO
 * try/catch — the one class of KV call in this file inconsistent with its own
 * documented policy ("a KV hiccup here must never block the auth decision
 * already made", already honored by cacheTokenVerify, validateToken's cached-
 * verdict read, maybeGetFirstRunNoticeHosted). When KV throws (confirmed:
 * this is what actually happened capturing the round-1 baseline against a
 * KV-unreachable local harness), the exception propagated all the way out of
 * the CallTool handler, producing a bare, non-compliant
 * `{"code":-32603,"message":"fetch failed"}` transport error for EVERY
 * billable tool call — exactly what Anthropic's "generic errors... with no
 * detail fail review" rule targets.
 *
 * 2026-10-29 (owner decision): decrementQuota (and the monthly free-call cap
 * it enforced) was removed entirely — see npm-package/CHANGELOG.md. The
 * decrementQuota-specific tests that used to live in this file were deleted
 * (nothing left to extract: the function no longer exists in mcp.ts). The
 * rate-limit coverage below is UNCHANGED and still proves the shared
 * kvFailOpen fix works for the two functions that remain.
 *
 * Fix: one shared `kvFailOpen(evt, fallback, op)` wrapper, used by both
 * remaining call sites. This file extracts and EXECUTES the real kvFailOpen +
 * preAuthRateLimitExceeded + rateLimitExceeded (not reimplementations)
 * against both a THROWING kv mock (proving fail-open: the function returns
 * its documented fallback instead of throwing) and a HEALTHY kv mock (mirror
 * row: proving the fix didn't neuter the real behavior — rate limits still
 * count when KV works).
 *
 * Runs on plain Node (`node --test`) — same "extract-and-execute the real
 * source, don't import mcp.ts" convention as the rest of this test dir
 * (mcp.ts has module-load side effects: Sentry.init, @vercel/kv, env-var
 * stripping).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const mcpSrc = readFileSync(MCP_TS, "utf8");

/** Returns the slice from startAnchor UP TO (not including) endAnchor. */
function sliceUpTo(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end);
}

function extractKvFailOpen() {
  const SIG = "async function kvFailOpen<T>(evt: string, fallback: T, op: () => Promise<T>): Promise<T> {";
  const code = sliceUpTo(SIG, "\n}\n", "kvFailOpen")
    .replace(SIG, "async function kvFailOpen(evt, fallback, op) {");
  return new Function(`${code}\n}\nreturn kvFailOpen;`)();
}

// extractMonthKey was removed 2026-10-29 — monthKey() no longer exists in
// mcp.ts (it was decrementQuota/refundQuota's own KV-key helper, deleted
// along with the monthly free-call cap).

function extractPreAuthRateLimitExceeded(kv, kvFailOpen) {
  const SIG = "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {";
  const code = sliceUpTo(SIG, "\n}\n", "preAuthRateLimitExceeded")
    .replace(SIG, "return async (ip, env) => {");
  return new Function("kv", "kvFailOpen", `${code}\n};`)(kv, kvFailOpen);
}

function extractRateLimitExceeded(kv, kvFailOpen) {
  const SIG = "async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {";
  const code = sliceUpTo(SIG, "\n}\n", "rateLimitExceeded")
    .replace(SIG, "return async (ip, env) => {");
  return new Function("kv", "kvFailOpen", `${code}\n};`)(kv, kvFailOpen);
}

const kvFailOpen = extractKvFailOpen();

/** A kv mock every one of whose methods unconditionally throws. */
function makeThrowingKv() {
  const boom = () => { throw new Error("simulated KV outage: fetch failed"); };
  return { incr: boom, expire: boom, decr: boom, get: boom, set: boom };
}

/** A healthy in-memory kv mock (same shape as g3-g5-n4's mock). */
function makeHealthyKv() {
  const store = new Map();
  return {
    async incr(key) {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async expire() { /* TTL irrelevant within one synchronous test run */ },
    async decr(key) {
      const next = (store.get(key) ?? 0) - 1;
      store.set(key, next);
      return next;
    },
  };
}

// Silence the expected console.error from kvFailOpen's failure-path logging —
// these tests deliberately trigger it; it is not a test failure signal here.
const realConsoleError = console.error;
async function withSilencedConsoleError(fn) {
  console.error = () => {};
  try { return await fn(); } finally { console.error = realConsoleError; }
}

// ─── preAuthRateLimitExceeded ─────────────────────────────────────────────────

test("preAuthRateLimitExceeded: KV THROWING on incr -> fails open (returns false, never throws)", async () => {
  const fn = extractPreAuthRateLimitExceeded(makeThrowingKv(), kvFailOpen);
  const result = await withSilencedConsoleError(() => fn("203.0.113.1", { RATE_LIMIT_PER_MIN: "60" }));
  assert.equal(result, false, "a KV outage must never falsely rate-limit a legitimate caller");
});

test("MIRROR: preAuthRateLimitExceeded: KV HEALTHY -> still counts and gates at the real threshold", async () => {
  const kv = makeHealthyKv();
  const fn = extractPreAuthRateLimitExceeded(kv, kvFailOpen);
  const env = { RATE_LIMIT_PER_MIN: "2" };
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await fn("203.0.113.2", env));
  assert.deepEqual(results, [false, false, true], "fail-open must not weaken real counting when KV is healthy");
});

// ─── rateLimitExceeded ────────────────────────────────────────────────────────

test("rateLimitExceeded: KV THROWING on incr -> fails open (returns false, never throws)", async () => {
  const fn = extractRateLimitExceeded(makeThrowingKv(), kvFailOpen);
  const result = await withSilencedConsoleError(() => fn("203.0.113.3", { RATE_LIMIT_PER_MIN: "60" }));
  assert.equal(result, false, "a KV outage must never falsely rate-limit a legitimate caller");
});

test("MIRROR: rateLimitExceeded: KV HEALTHY -> still counts and gates at the real threshold", async () => {
  const kv = makeHealthyKv();
  const fn = extractRateLimitExceeded(kv, kvFailOpen);
  const env = { RATE_LIMIT_PER_MIN: "2" };
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await fn("203.0.113.4", env));
  assert.deepEqual(results, [false, false, true]);
});

// decrementQuota's C1 fix-verification tests (KV-throwing fail-open + healthy
// mirror) were removed 2026-10-29: decrementQuota itself was deleted along
// with the monthly free-call cap it enforced — there is no longer a function
// here to extract or test. See npm-package/CHANGELOG.md.

// ─── STATIC: every remaining call site actually routes through the shared helper ──

test("STATIC: preAuthRateLimitExceeded/rateLimitExceeded each call kvFailOpen(", () => {
  for (const sig of [
    "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    "async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
  ]) {
    const body = sliceUpTo(sig, "\n}\n", sig);
    assert.match(body, /kvFailOpen\(/, `${sig} must route its KV call(s) through kvFailOpen(...)`);
  }
});

test("STATIC: no bare (unwrapped) kv.incr call remains in either of the two fixed functions", () => {
  for (const sig of [
    "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    "async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
  ]) {
    const body = sliceUpTo(sig, "\n}\n", sig);
    // The real kv.incr call must be INSIDE the kvFailOpen(...) callback, i.e.
    // textually after the kvFailOpen( call opens — a crude but effective proxy:
    // every kv.incr occurrence must appear after the first "kvFailOpen(" in the body.
    const failOpenIdx = body.indexOf("kvFailOpen(");
    const incrIdx = body.indexOf("kv.incr(");
    assert.ok(failOpenIdx !== -1 && incrIdx > failOpenIdx, `${sig}: kv.incr must appear inside the kvFailOpen(...) callback`);
  }
});
