/**
 * KV fail-open coverage (claude-directory-exam S1-connector round 2, C1).
 *
 * Independent review of the round-1 golden-baseline regeneration (commit
 * 2ff7ddc) traced a real, reachable defect: decrementQuota/rateLimitExceeded/
 * preAuthRateLimitExceeded called `kv.incr`/`kv.expire` directly with NO
 * try/catch — the one class of KV call in this file inconsistent with its own
 * documented policy ("a KV hiccup here must never block the auth decision
 * already made", already honored by cacheTokenVerify, validateToken's cached-
 * verdict read, refundQuota, maybeGetFirstRunNoticeHosted). When KV throws
 * (confirmed: this is what actually happened capturing the round-1 baseline
 * against a KV-unreachable local harness), the exception propagated all the
 * way out of the CallTool handler, producing a bare, non-compliant
 * `{"code":-32603,"message":"fetch failed"}` transport error for EVERY
 * billable tool call — exactly what Anthropic's "generic errors... with no
 * detail fail review" rule targets.
 *
 * Fix: one shared `kvFailOpen(evt, fallback, op)` wrapper, used by all three
 * call sites. This file extracts and EXECUTES the real kvFailOpen +
 * preAuthRateLimitExceeded + rateLimitExceeded + decrementQuota + monthKey
 * (not reimplementations) against both a THROWING kv mock (proving fail-open:
 * the function returns its documented fallback instead of throwing) and a
 * HEALTHY kv mock (mirror row: proving the fix didn't neuter the real
 * behavior — quota still decrements, rate limits still count, when KV works).
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

function extractMonthKey() {
  const SIG = "function monthKey(): string {";
  const code = sliceUpTo(SIG, "\n}\n", "monthKey").replace(SIG, "function monthKey() {");
  return new Function(`${code}\n}\nreturn monthKey;`)();
}

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

function extractDecrementQuota(kv, kvFailOpen, monthKey) {
  const SIG = 'async function decrementQuota(tokenHash: string, env: Env, plan: "free" | "pro"): Promise<number> {';
  const code = sliceUpTo(SIG, "\n}\n", "decrementQuota")
    .replace(SIG, "return async (tokenHash, env, plan) => {");
  return new Function("kv", "kvFailOpen", "monthKey", `${code}\n};`)(kv, kvFailOpen, monthKey);
}

const kvFailOpen = extractKvFailOpen();
const monthKey = extractMonthKey();

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

// ─── decrementQuota — the C1 root-cause call site ────────────────────────────

test("decrementQuota: KV THROWING on incr -> fails open (returns monthlyQuota, never throws) — this IS the C1 fix", async () => {
  const fn = extractDecrementQuota(makeThrowingKv(), kvFailOpen, monthKey);
  const env = { FREE_PLAN_MONTHLY_QUOTA: "1000" };
  const result = await withSilencedConsoleError(() => fn("deadbeef".repeat(8), env, "free"));
  assert.equal(result, 1000, "a KV outage must allow the call through (never crash it into a bare transport error) — returns monthlyQuota (treated as 0 used this period)");
});

test("decrementQuota: KV THROWING never throws even on the 'pro' plan branch", async () => {
  const fn = extractDecrementQuota(makeThrowingKv(), kvFailOpen, monthKey);
  const env = { FREE_PLAN_MONTHLY_QUOTA: "1000" };
  await assert.doesNotReject(() => withSilencedConsoleError(() => fn("deadbeef".repeat(8), env, "pro")));
});

test("MIRROR: decrementQuota: KV HEALTHY -> still decrements for real and rejects over cap", async () => {
  const kv = makeHealthyKv();
  const fn = extractDecrementQuota(kv, kvFailOpen, monthKey);
  const env = { FREE_PLAN_MONTHLY_QUOTA: "2" };
  const tokenHash = "cafebabe".repeat(8);
  const r1 = await fn(tokenHash, env, "free");
  const r2 = await fn(tokenHash, env, "free");
  const r3 = await fn(tokenHash, env, "free"); // 3rd call crosses the cap of 2
  assert.deepEqual([r1, r2, r3], [1, 0, -1], "fail-open must not weaken real quota enforcement when KV is healthy");
});

// ─── STATIC: every call site actually routes through the shared helper ──────

test("STATIC: preAuthRateLimitExceeded/rateLimitExceeded/decrementQuota each call kvFailOpen(", () => {
  for (const sig of [
    "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    "async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    'async function decrementQuota(tokenHash: string, env: Env, plan: "free" | "pro"): Promise<number> {',
  ]) {
    const body = sliceUpTo(sig, "\n}\n", sig);
    assert.match(body, /kvFailOpen\(/, `${sig} must route its KV call(s) through kvFailOpen(...)`);
  }
});

test("STATIC: no bare (unwrapped) kv.incr call remains in any of the three fixed functions", () => {
  for (const sig of [
    "async function preAuthRateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    "async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {",
    'async function decrementQuota(tokenHash: string, env: Env, plan: "free" | "pro"): Promise<number> {',
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
