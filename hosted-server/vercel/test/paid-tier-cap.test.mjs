/**
 * Paid-tier gateway cap exemption (P0) — PRD-paid-tier-gateway-cap-2026-07-13.md
 * (incl. Amendment: lazy trigger at cap-crossing + balance OR-fallback;
 *  Amendment 2: uid-keyed plan cache shared across an account's keys).
 *
 * Runs on plain Node ≥22.18 (`node --test`) — imports api/_plan.ts directly via
 * Node's built-in type stripping; no test framework, mirroring caller-key.test.mjs.
 *
 * Layers:
 *   1. UNIT     — classifyPlanFromUsageRecord / extractUidFromUsageRecord /
 *                 shouldAllowOverCap / CAP_EXEMPT_TOOLS (pure, no I/O).
 *   2. RUNTIME  — resolvePlan + enforceGatewayCap with injected mock KV /
 *                 mock usage-record fetch / mock quota counter (no network).
 *   3. STATIC   — regression fence on api/mcp.ts source: gate wired before
 *                 dispatch, charge-then-refund dance removed, new cap error
 *                 copy, refund guarded by `charged`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  classifyPlanFromUsageRecord,
  extractUidFromUsageRecord,
  shouldAllowOverCap,
  CAP_EXEMPT_TOOLS,
  PREFETCH_THRESHOLD,
  PLAN_TTL_PRO_S,
  PLAN_TTL_FREE_S,
  PLAN_STALE_RETENTION_S,
  resolvePlan,
  enforceGatewayCap,
} from "../api/_plan.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");

// ─── Layer 1: UNIT — classifyPlanFromUsageRecord ─────────────────────────────

test("classify: empty list → free", () => {
  assert.equal(classifyPlanFromUsageRecord({ list: [] }), "free");
});

test("classify: coupon-only order (pay_money - coupon_money == 0) → free", () => {
  const data = { list: [{ pay_status: 2, pay_money: 14, coupon_money: 14 }] };
  assert.equal(classifyPlanFromUsageRecord(data), "free");
});

test("classify: one real-money order → pro", () => {
  const data = { list: [{ pay_status: 2, pay_money: 10, coupon_money: 0 }] };
  assert.equal(classifyPlanFromUsageRecord(data), "pro");
});

test("classify: pay_status != 2 (unpaid/pending/refund) real-money → free", () => {
  for (const status of [0, 1, 3, -1, undefined]) {
    const data = { list: [{ pay_status: status, pay_money: 10, coupon_money: 0 }] };
    assert.equal(classifyPlanFromUsageRecord(data), "free", `pay_status=${status} must not count as paid`);
  }
});

test("classify: mixed orders (coupon-only + real) → pro", () => {
  const data = {
    list: [
      { pay_status: 2, pay_money: 14, coupon_money: 14 },
      { pay_status: 1, pay_money: 99, coupon_money: 0 },
      { pay_status: 2, pay_money: 5, coupon_money: 1 },
    ],
  };
  assert.equal(classifyPlanFromUsageRecord(data), "pro");
});

test("classify: malformed payloads → free, never throws", () => {
  const malformed = [
    null, undefined, "string", 42, [], {}, { list: "not-an-array" },
    { list: [null, "x", 7] },
    { list: [{ pay_status: 2, pay_money: "10", coupon_money: 0 }] }, // string money
    { list: [{ pay_status: "2", pay_money: 10, coupon_money: 0 }] }, // string status
    { list: [{ pay_status: 2, pay_money: 10 }] },                    // missing coupon_money
  ];
  for (const payload of malformed) {
    assert.equal(classifyPlanFromUsageRecord(payload), "free", `payload ${JSON.stringify(payload)} must classify free`);
  }
});

// ─── Layer 1: UNIT — extractUidFromUsageRecord (Amendment 2) ─────────────────

test("extractUid: uid on an entry → returned as string", () => {
  assert.equal(extractUidFromUsageRecord({ list: [{ uid: 4217 }] }), "4217");
  assert.equal(extractUidFromUsageRecord({ list: [{}, { uid: "abc9" }] }), "abc9");
});

test("extractUid: top-level uid → returned", () => {
  assert.equal(extractUidFromUsageRecord({ uid: 55, list: [] }), "55");
});

test("extractUid: absent/malformed uid → null (graceful degrade)", () => {
  assert.equal(extractUidFromUsageRecord({ list: [{}] }), null);
  assert.equal(extractUidFromUsageRecord(null), null);
  assert.equal(extractUidFromUsageRecord({ list: [{ uid: {} }] }), null);
  assert.equal(extractUidFromUsageRecord({ list: [{ uid: "" }] }), null);
});

// ─── Layer 1: UNIT — shouldAllowOverCap ──────────────────────────────────────

test("overCap allowance: pro always allowed, even with $0 balance", () => {
  assert.equal(shouldAllowOverCap("pro", 0), true);
  assert.equal(shouldAllowOverCap("pro", undefined), true);
});

test("overCap allowance: free + positive balance → allowed (OR-fallback)", () => {
  assert.equal(shouldAllowOverCap("free", 5), true);
  assert.equal(shouldAllowOverCap("free", 0.01), true);
});

test("overCap allowance: free + no/zero/negative balance → blocked", () => {
  assert.equal(shouldAllowOverCap("free", 0), false);
  assert.equal(shouldAllowOverCap("free", -3), false);
  assert.equal(shouldAllowOverCap("free", undefined), false);
});

// ─── Layer 1: UNIT — CAP_EXEMPT_TOOLS ────────────────────────────────────────

test("CAP_EXEMPT_TOOLS: setup + discover + account + every account alias", () => {
  for (const name of [
    "novada_setup", "novada_discover", "novada_account",
    "novada_wallet_balance", "novada_wallet_usage_record", "novada_traffic_daily",
    "novada_plan_balance_all", "novada_capture_logs", "novada_account_summary",
    "novada_health", "novada_health_all",
  ]) {
    assert.ok(CAP_EXEMPT_TOOLS.has(name), `${name} must be cap-exempt`);
  }
});

test("CAP_EXEMPT_TOOLS: content tools are NOT exempt", () => {
  for (const name of ["novada_search", "novada_extract", "novada_scrape", "novada_proxy_account_create"]) {
    assert.ok(!CAP_EXEMPT_TOOLS.has(name), `${name} must NOT be cap-exempt`);
  }
});

// ─── Runtime helpers: mock KV + deps ─────────────────────────────────────────

function makeMockKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const sets = []; // {key, value, opts}
  return {
    store,
    sets,
    kvGet: async (key) => (store.has(key) ? store.get(key) : null),
    kvSet: async (key, value, opts) => {
      store.set(key, value);
      sets.push({ key, value, opts });
      return "OK";
    },
  };
}

const TH = "a".repeat(64); // fake tokenHash
const NOW = 1_760_000_000_000;

const PAID_PAYLOAD = { list: [{ uid: 42, pay_status: 2, pay_money: 10, coupon_money: 0 }] };
const FREE_PAYLOAD = { list: [{ pay_status: 2, pay_money: 14, coupon_money: 14 }] };

// ─── Layer 2: RUNTIME — resolvePlan ──────────────────────────────────────────

test("resolvePlan: fresh tokenHash cache hit → returns cached, no upstream call", async () => {
  const kv = makeMockKv({ [`${TH}:plan`]: { plan: "pro", exp: NOW + 1000 } });
  let upstreamCalls = 0;
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => { upstreamCalls++; return PAID_PAYLOAD; }, now: () => NOW,
  });
  assert.equal(plan, "pro");
  assert.equal(upstreamCalls, 0, "cache hit must not call upstream");
});

test("resolvePlan: bare-string cache value → treated as cache miss (no freshness deadline), upstream re-resolves", async () => {
  // A hand-set bare "pro" (e.g. via KV tooling) carries no exp — honoring it
  // would make it permanently fresh. It must be REJECTED and re-resolved.
  const kv = makeMockKv({ [`${TH}:plan`]: "pro" });
  let upstreamCalls = 0;
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => { upstreamCalls++; return FREE_PAYLOAD; }, now: () => NOW,
  });
  assert.equal(upstreamCalls, 1, "bare-string cache must NOT satisfy the lookup — upstream must run");
  assert.equal(plan, "free", "the fresh upstream classification wins over the bare-string value");
});

test("resolvePlan: uncached + paid payload → pro, dual-key KV write (Amendment 2), pro fresh window = 30d", async () => {
  const kv = makeMockKv();
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => PAID_PAYLOAD, now: () => NOW,
  });
  assert.equal(plan, "pro");
  const tokenSet = kv.sets.find((s) => s.key === `${TH}:plan`);
  const uidSet = kv.sets.find((s) => s.key === "uid:42:plan");
  const uidPtr = kv.sets.find((s) => s.key === `${TH}:uid`);
  assert.ok(tokenSet, "tokenHash-keyed plan must be written");
  assert.ok(uidSet, "uid-keyed plan must be written when uid present in payload");
  assert.ok(uidPtr, "uid pointer must be written so later lookups can find the shared entry");
  assert.equal(tokenSet.value.plan, "pro");
  assert.equal(tokenSet.value.exp, NOW + PLAN_TTL_PRO_S * 1000, "pro freshness window must be 30 days");
  assert.deepEqual(uidSet.value, tokenSet.value, "both keys carry the same resolution");
  // Physical KV retention must outlive the freshness window so a STALE value
  // survives for the upstream-down fallback (PRD: "stale cache exists → use it").
  assert.equal(tokenSet.opts.ex, PLAN_TTL_PRO_S + PLAN_STALE_RETENTION_S);
});

test("resolvePlan: uncached + free/coupon-only payload → free, free fresh window = 6h", async () => {
  const kv = makeMockKv();
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => FREE_PAYLOAD, now: () => NOW,
  });
  assert.equal(plan, "free");
  const tokenSet = kv.sets.find((s) => s.key === `${TH}:plan`);
  assert.ok(tokenSet);
  assert.equal(tokenSet.value.exp, NOW + PLAN_TTL_FREE_S * 1000, "free freshness window must be 6 hours");
  assert.equal(tokenSet.opts.ex, PLAN_TTL_FREE_S + PLAN_STALE_RETENTION_S);
});

test("resolvePlan: payload without uid → tokenHash-only write, no uid keys, no throw (Amendment 2 degrade)", async () => {
  const kv = makeMockKv();
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => FREE_PAYLOAD, now: () => NOW,
  });
  assert.equal(plan, "free");
  assert.ok(kv.sets.some((s) => s.key === `${TH}:plan`));
  assert.ok(!kv.sets.some((s) => s.key.startsWith("uid:")), "no uid-keyed write without uid");
  assert.ok(!kv.sets.some((s) => s.key === `${TH}:uid`), "no uid pointer without uid");
});

test("resolvePlan: tokenHash miss + uid pointer + fresh uid-keyed entry → shared pro, no upstream (Amendment 2)", async () => {
  const kv = makeMockKv({
    [`${TH}:uid`]: "42",
    "uid:42:plan": { plan: "pro", exp: NOW + 1000 },
  });
  let upstreamCalls = 0;
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => { upstreamCalls++; return FREE_PAYLOAD; }, now: () => NOW,
  });
  assert.equal(plan, "pro", "second key of the same account must inherit the shared paid resolution");
  assert.equal(upstreamCalls, 0);
});

test("resolvePlan: upstream error + no cache → free, never throws", async () => {
  const kv = makeMockKv();
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => { throw new Error("api-m down"); }, now: () => NOW,
  });
  assert.equal(plan, "free");
});

test("resolvePlan: upstream error + STALE cache → stale value used", async () => {
  const kv = makeMockKv({ [`${TH}:plan`]: { plan: "pro", exp: NOW - 1 } }); // expired freshness, still retained
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => { throw new Error("api-m down"); }, now: () => NOW,
  });
  assert.equal(plan, "pro", "degrade gracefully to the stale cached value");
});

test("resolvePlan: KV read failure + upstream failure → free, never throws", async () => {
  const plan = await resolvePlan("key-x", TH, {
    kvGet: async () => { throw new Error("kv down"); },
    kvSet: async () => { throw new Error("kv down"); },
    fetchUsageRecord: async () => { throw new Error("api-m down"); },
    now: () => NOW,
  });
  assert.equal(plan, "free");
});

test("resolvePlan: KV write failure after successful upstream → plan still returned", async () => {
  const plan = await resolvePlan("key-x", TH, {
    kvGet: async () => null,
    kvSet: async () => { throw new Error("kv write down"); },
    fetchUsageRecord: async () => PAID_PAYLOAD,
    now: () => NOW,
  });
  assert.equal(plan, "pro");
});

// ─── Layer 2: RUNTIME — enforceGatewayCap ────────────────────────────────────

function makeGateDeps({ remainingFree, remainingPro = 0, plan = "free", balance = 0, planThrows = false, balanceThrows = false } = {}) {
  const calls = { decrement: [], resolvePlan: 0, fetchBalance: 0 };
  return {
    calls,
    deps: {
      decrementQuota: async (p) => { calls.decrement.push(p); return p === "pro" ? remainingPro : remainingFree; },
      resolvePlan: async () => {
        calls.resolvePlan++;
        if (planThrows) throw new Error("resolve failed");
        return plan;
      },
      fetchBalance: async () => {
        calls.fetchBalance++;
        if (balanceThrows) throw new Error("balance failed");
        return balance;
      },
    },
  };
}

test("gate: exempt tool (novada_discover) → allowed, never decrements, never resolves plan — even when cap-exhausted", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1 });
  const r = await enforceGatewayCap({ toolName: "novada_discover", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true);
  assert.equal(r.charged, false);
  assert.equal(calls.decrement.length, 0, "exempt tools must never touch the quota counter");
  assert.equal(calls.resolvePlan, 0);
});

test("gate: exempt account alias (novada_wallet_balance) → allowed, no decrement", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1 });
  const r = await enforceGatewayCap({ toolName: "novada_wallet_balance", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true);
  assert.equal(calls.decrement.length, 0);
});

test("gate: call #500 (under cap) → allowed, ZERO plan lookups, zero balance lookups (lazy trigger)", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: 500 }); // used=500
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true);
  assert.equal(r.charged, true);
  assert.equal(r.remaining, 500);
  await new Promise((res) => setImmediate(res)); // let any stray fire-and-forget settle
  assert.equal(calls.resolvePlan, 0, "under-cap keys must incur ZERO plan lookups");
  assert.equal(calls.fetchBalance, 0);
});

test("gate: call past PREFETCH_THRESHOLD (used=950) → allowed now, plan pre-warm fired async", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: 50 }); // used = 1000-50 = 950 > 900
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true, "pre-warm must not block or reject the call");
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.resolvePlan, 1, "resolvePlan must be pre-warmed once past the threshold");
});

test("gate: call #1001, plan=pro → allowed via pro path, counter re-incremented on the pro branch", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1, plan: "pro" });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true);
  assert.equal(r.overCapAllowed, true);
  assert.equal(r.charged, true);
  assert.deepEqual(calls.decrement, ["free", "pro"], "over-cap allow must re-increment via the pro branch");
  assert.equal(calls.fetchBalance, 0, "pro decision must not need a balance lookup");
});

test("gate: call #1001, plan=free + ctxBalance>0 → allowed via balance OR-fallback, no live balance fetch", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1, plan: "free" });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, ctxBalance: 5, deps });
  assert.equal(r.allowed, true);
  assert.equal(r.overCapAllowed, true);
  assert.equal(calls.fetchBalance, 0, "ctx balance must be reused when available");
});

test("gate: call #1001, plan=free + no ctxBalance + live balance>0 → allowed via fallback fetch", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1, plan: "free", balance: 3 });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true);
  assert.equal(calls.fetchBalance, 1);
});

test("gate: call #1001, no orders + no balance → BLOCKED (trial user stays capped)", async () => {
  const { deps } = makeGateDeps({ remainingFree: -1, plan: "free", balance: 0 });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, ctxBalance: 0, deps });
  assert.equal(r.allowed, false);
  assert.equal(r.charged, false, "a rejected call must not report a charge (decrementQuota already rolled back)");
});

test("gate: call #1001, resolvePlan throws + balance fetch throws → BLOCKED, no exception escapes", async () => {
  const { deps } = makeGateDeps({ remainingFree: -1, planThrows: true, balanceThrows: true });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, false);
});

test("gate: PREFETCH_THRESHOLD is 900 per PRD", () => {
  assert.equal(PREFETCH_THRESHOLD, 900);
});

// ─── Layer 3: STATIC — regression fence on api/mcp.ts ────────────────────────

test("mcp.ts: gateway cap gate wired (enforceGatewayCap imported from ./_plan.js and called)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /from "\.\/_plan\.js"/, "mcp.ts must import from ./_plan.js");
  assert.match(src, /enforceGatewayCap\(/, "mcp.ts must call enforceGatewayCap");
});

test("mcp.ts: old hardcoded free-plan decrement call site is gone", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.doesNotMatch(src, /decrementQuota\(ctx\.tokenHash,\s*env,\s*"free"\)/,
    "the hardcoded plan:'free' decrement at the call site must be replaced by the gate");
});

test("mcp.ts: account charge-then-refund dance removed", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(!src.includes("isAccountDegradedResponse"),
    "account tools are cap-exempt now — the degradation-refund dance must be gone");
  assert.ok(!src.includes("ACCOUNT_DEGRADATION_MARKERS"));
});

test("mcp.ts: cap error copy is truthful (round-2 audit) — blocked means no payment history AND no balance", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The header must state WHY the caller is blocked (the paid exemption did not apply).
  assert.ok(src.includes("has no payment history and no remaining balance, so the paid exemption does not apply"),
    "header must explain that the block implies no payment history and no balance");
  // Top-up guidance must reflect the live balance check on the next call.
  assert.ok(src.includes("a positive balance takes effect on your NEXT call"),
    "option 2 must state that a top-up takes effect on the next call via the live balance check");
  assert.ok(src.includes("purchase-history classification may take up to ~6 hours"),
    "option 2 must state the ~6h purchase-history classification window");
  // Falsehoods from the pre-fix copy must be gone: the cap is NOT independent of
  // balance anymore (balance>0 exempts), and it is NOT separate from billing.
  assert.ok(!src.includes("independent of your Novada balance"),
    "old 'independent of your Novada balance' claim must be gone (balance now exempts)");
  assert.ok(!src.includes("this cap is separate from billing"),
    "old 'separate from billing' note must be gone");
  assert.ok(!src.includes("does not raise the free-gateway cap"),
    "old copy claiming top-up does not lift the cap must be gone");
  // agent_instruction contract: marker kept, retry guidance covers the just-topped-up case.
  assert.match(src, /free_gateway_cap_reached/, "agent_instruction marker must be kept");
  assert.ok(src.includes("unless the user just topped up — then retry immediately"),
    "retry_recommended must cover the just-topped-up retry case");
});

test("mcp.ts: error-path quota refund is guarded by the gate's charged flag", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /gate\.charged/, "refund logic must consult gate.charged");
  assert.doesNotMatch(src, /^\s*await refundQuota\(ctx\.tokenHash, env\);$/m,
    "no unconditional refund lines may remain (exempt tools were never charged)");
});

test("mcp.ts: validateToken captures the wallet balance for the over-cap OR-fallback", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /balance\?\s*:\s*number/, "token info/cache must carry an optional balance");
  assert.match(src, /balance:\s*info\.balance/, "fetchHandler must thread info.balance into ctx");
});

test("mcp.ts: plan resolution is NOT invoked at token validation (lazy trigger only)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const validateTokenBody = src.slice(src.indexOf("async function validateToken"), src.indexOf("async function rateLimitExceeded"));
  assert.ok(!validateTokenBody.includes("resolvePlan"),
    "validateToken must not call resolvePlan — plan resolution is lazy at cap-crossing");
});

test("mcp.ts: _meta.quota_remaining is suppressed for over-cap (paid-exempted) calls", () => {
  // An over-cap pro call re-increments past the cap, so `remaining` computes to 0 —
  // emitting quota_remaining: 0 would tell a PAID (cap-exempt) user they're out of
  // quota. The _meta spread must be double-guarded: charged AND NOT overCapAllowed.
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /gate\.charged && !gate\.overCapAllowed \? \{ _meta: \{ quota_remaining: remaining \} \} : \{\}/,
    "_meta.quota_remaining must be emitted only for real free-plan charges (not exempt, not over-cap-allowed)");
  assert.doesNotMatch(src, /gate\.charged \? \{ _meta/,
    "the single-guarded _meta spread (leaks quota_remaining: 0 to pro users) must be gone");
});
