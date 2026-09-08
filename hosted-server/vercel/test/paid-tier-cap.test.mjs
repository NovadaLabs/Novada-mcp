/**
 * Paid-tier gateway cap exemption (P0) — PRD-paid-tier-gateway-cap-2026-07-13.md
 * (incl. Amendment: lazy trigger at cap-crossing + balance OR-fallback).
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
  shouldAllowOverCap,
  CAP_EXEMPT_TOOLS,
  PREFETCH_THRESHOLD,
  PLAN_TTL_PRO_S,
  PLAN_TTL_FREE_S,
  PLAN_STALE_RETENTION_S,
  resolvePlan,
  enforceGatewayCap,
  parseBalanceValue,
  fetchAggregateBalance,
  APPROVAL_GATED_TOOLS,
  isApprovalGatePreviewCall,
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

// ─── Layer 1: UNIT — parseBalanceValue / fetchAggregateBalance ───────────────
// 2026-07-30 incident: Scraping Solutions had wallet=$0 but capture-ledger
// balance ~$99,994.78 and was denied service by the free-gateway cap because
// the OR-fallback only ever probed the wallet. These tests lock in the fix:
// the aggregate resolver queries both ledgers and takes the max.

test("parseBalanceValue: bare number (capture shape) → itself", () => {
  assert.equal(parseBalanceValue(99994.783374), 99994.783374);
  assert.equal(parseBalanceValue(0), 0);
});

test("parseBalanceValue: {balance:number} object (wallet shape) → the balance field", () => {
  assert.equal(parseBalanceValue({ balance: 254.4 }), 254.4);
  assert.equal(parseBalanceValue({ balance: 0 }), 0);
});

test("parseBalanceValue: malformed payloads → 0, never throws", () => {
  const malformed = [null, undefined, "string", NaN, Infinity, -Infinity, [], {}, { balance: "10" }, { balance: null }];
  for (const payload of malformed) {
    assert.equal(parseBalanceValue(payload), 0, `payload ${JSON.stringify(payload)} must parse to 0`);
  }
});

test("aggregate: wallet=0 (object shape), capture>0 (bare-number shape) → max = capture (the incident case)", async () => {
  const balance = await fetchAggregateBalance({
    fetchWalletBalance: async () => ({ balance: 0 }),
    fetchCaptureBalance: async () => 99994.783374,
  });
  assert.equal(balance, 99994.783374);
});

test("aggregate: wallet=0, capture=0 → 0 (still capped)", async () => {
  const balance = await fetchAggregateBalance({
    fetchWalletBalance: async () => ({ balance: 0 }),
    fetchCaptureBalance: async () => 0,
  });
  assert.equal(balance, 0);
});

test("aggregate: wallet probe throws, capture>0 → capture wins (wallet ledger degrades to 0, not a total failure)", async () => {
  const balance = await fetchAggregateBalance({
    fetchWalletBalance: async () => { throw new Error("wallet probe down"); },
    fetchCaptureBalance: async () => 42,
  });
  assert.equal(balance, 42);
});

test("aggregate: capture probe throws, wallet>0 → wallet wins (capture ledger degrades to 0)", async () => {
  const balance = await fetchAggregateBalance({
    fetchWalletBalance: async () => ({ balance: 17 }),
    fetchCaptureBalance: async () => { throw new Error("capture probe down"); },
  });
  assert.equal(balance, 17);
});

test("aggregate: BOTH probes throw → 0, never throws", async () => {
  const balance = await fetchAggregateBalance({
    fetchWalletBalance: async () => { throw new Error("wallet down"); },
    fetchCaptureBalance: async () => { throw new Error("capture down"); },
  });
  assert.equal(balance, 0);
});

test("aggregate: wallet > capture → wallet wins (max, not wallet-preference or capture-preference)", async () => {
  const balance = await fetchAggregateBalance({
    fetchWalletBalance: async () => ({ balance: 500 }),
    fetchCaptureBalance: async () => 10,
  });
  assert.equal(balance, 500);
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

const PAID_PAYLOAD = { list: [{ pay_status: 2, pay_money: 10, coupon_money: 0 }] };
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

test("resolvePlan: uncached + paid payload → pro, tokenHash KV write, pro fresh window = 30d", async () => {
  const kv = makeMockKv();
  const plan = await resolvePlan("key-x", TH, {
    ...kv, fetchUsageRecord: async () => PAID_PAYLOAD, now: () => NOW,
  });
  assert.equal(plan, "pro");
  const tokenSet = kv.sets.find((s) => s.key === `${TH}:plan`);
  assert.ok(tokenSet, "tokenHash-keyed plan must be written");
  assert.equal(tokenSet.value.plan, "pro");
  assert.equal(tokenSet.value.exp, NOW + PLAN_TTL_PRO_S * 1000, "pro freshness window must be 30 days");
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

// 2026-07-30 incident regression: ctxBalance is the CACHED WALLET-ONLY balance
// from token verification (mcp.ts validateToken). A $0 wallet on a
// capture-funded paid account must NOT short-circuit past the live aggregate
// fetch — before this fix, `balance === undefined` was the only trigger, so
// ctxBalance=0 (defined, falsy) skipped deps.fetchBalance() entirely and the
// call was blocked even though the aggregate ledger had real balance.
test("gate: call #1001, ctxBalance=0 (wallet empty) + live aggregate balance>0 → allowed (the incident case)", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1, plan: "free", balance: 99994.78 });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, ctxBalance: 0, deps });
  assert.equal(r.allowed, true, "ctxBalance=0 must not suppress the live aggregate-balance fallback fetch");
  assert.equal(r.overCapAllowed, true);
  assert.equal(calls.fetchBalance, 1, "ctxBalance=0 must trigger the live fetch, not be treated as a trusted positive balance");
});

// Fast-path contrast to the test above: a genuinely POSITIVE ctxBalance still
// must NOT pay a live fetch — only ctxBalance<=0 falls through.
test("gate: call #1001, ctxBalance>0 → fetchBalance is NOT called (fast path preserved)", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1, plan: "free" });
  const r = await enforceGatewayCap({ toolName: "novada_search", monthlyQuota: 1000, ctxBalance: 12, deps });
  assert.equal(r.allowed, true);
  assert.equal(calls.fetchBalance, 0, "a positive ctxBalance must be trusted without a live fetch");
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

// ─── Layer 1: UNIT — isApprovalGatePreviewCall (MEDIUM fix, 2026-09 audit) ───
// ADVERSARIAL-INTEGRATION.md: proxy_account_create's PREVIEW call (no
// approval_token) was charged the same as its EXECUTE call — 2 quota units
// for one logical write, with no refund path for the confirmation_required
// outcome. Class table covers all four evaluateApprovalGate() tools, not
// just proxy_account_create — including the two that are multi-action (only
// SOME `action` values are gated; the rest must still be charged normally).

test("previewCall: single-action gated tool (proxy_account_create), no approval_token → true (preview)", () => {
  assert.equal(
    isApprovalGatePreviewCall("novada_proxy_account_create", { product: "1", account: "a", password: "xxxxxxxx" }),
    true,
  );
});

test("previewCall: single-action gated tool, EMPTY approval_token → true (still a preview — mirrors evaluateApprovalGate's own `.length > 0` check)", () => {
  assert.equal(
    isApprovalGatePreviewCall("novada_proxy_account_create", { product: "1", approval_token: "" }),
    true,
  );
});

test("previewCall: single-action gated tool, deprecated confirm:true with NO token → true (zero upstream work either way — evaluateApprovalGate rejects this shape outright)", () => {
  assert.equal(
    isApprovalGatePreviewCall("novada_proxy_account_create", { product: "1", confirm: true }),
    true,
  );
});

test("previewCall: single-action gated tool, valid-shaped approval_token present → false (execute attempt, must be charged)", () => {
  assert.equal(
    isApprovalGatePreviewCall("novada_proxy_account_create", { product: "1", approval_token: "sig123|9999999999999" }),
    false,
  );
});

test("previewCall: multi-action tool (ip_whitelist), gated action \"add\" with no token → true (preview)", () => {
  assert.equal(isApprovalGatePreviewCall("novada_ip_whitelist", { action: "add", product: "1" }), true);
});

test("previewCall: multi-action tool (ip_whitelist), gated action \"del\" with no token → true (preview)", () => {
  assert.equal(isApprovalGatePreviewCall("novada_ip_whitelist", { action: "del", product: "1" }), true);
});

test("previewCall: multi-action tool (ip_whitelist), UNGATED action \"list\" with no token → false — must be charged normally, not misclassified as a free preview", () => {
  assert.equal(isApprovalGatePreviewCall("novada_ip_whitelist", { action: "list", product: "1" }), false);
});

// 2026-09-07: "remark" was folded into ip_whitelist's approval gate (SEC-consistency
// fix, ledger-closure audit finding #4) — was ungated, now gated same as add/del.
test("previewCall: multi-action tool (ip_whitelist), gated action \"remark\" with no token → true (preview) — remark was folded into the gate alongside add/del", () => {
  assert.equal(isApprovalGatePreviewCall("novada_ip_whitelist", { action: "remark", id: "wl_1" }), true);
});

test("previewCall: multi-action tool (ip_whitelist), \"remark\" WITH a valid-shaped approval_token → false (execute attempt, must be charged)", () => {
  assert.equal(
    isApprovalGatePreviewCall("novada_ip_whitelist", { action: "remark", id: "wl_1", approval_token: "sig123|9999999999999" }),
    false,
  );
});

test("previewCall: multi-action tool (static_ip_mgmt), gated action \"open\" with no token → true (preview)", () => {
  assert.equal(isApprovalGatePreviewCall("novada_static_ip_mgmt", { action: "open" }), true);
});

test("previewCall: multi-action tool (static_ip_mgmt), UNGATED action \"export\" with no token → false", () => {
  assert.equal(isApprovalGatePreviewCall("novada_static_ip_mgmt", { action: "export" }), false);
});

test("previewCall: multi-action tool (capture_apikey), gated action \"reset\" with no token → true (preview)", () => {
  assert.equal(isApprovalGatePreviewCall("novada_capture_apikey", { action: "reset" }), true);
});

test("previewCall: multi-action tool (capture_apikey), UNGATED action \"get\" with no token → false", () => {
  assert.equal(isApprovalGatePreviewCall("novada_capture_apikey", { action: "get" }), false);
});

test("previewCall: a tool NOT in APPROVAL_GATED_TOOLS (e.g. novada_search) → always false, regardless of args", () => {
  assert.equal(isApprovalGatePreviewCall("novada_search", {}), false);
  assert.equal(isApprovalGatePreviewCall("novada_search", { approval_token: "" }), false);
});

test("APPROVAL_GATED_TOOLS: exactly the four evaluateApprovalGate() tools", () => {
  assert.deepEqual(
    [...APPROVAL_GATED_TOOLS.keys()].sort(),
    ["novada_capture_apikey", "novada_ip_whitelist", "novada_proxy_account_create", "novada_static_ip_mgmt"],
  );
});

// ─── Layer 2: RUNTIME — enforceGatewayCap approval-gate preview exemption ────

test("gate: approval-gate PREVIEW call (no approval_token) → allowed, NOT charged, decrementQuota never touched — even cap-exhausted", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1 }); // would reject if charged
  const r = await enforceGatewayCap({
    toolName: "novada_proxy_account_create",
    monthlyQuota: 1000,
    args: { product: "1", account: "sub1", password: "xxxxxxxx" }, // no approval_token
    deps,
  });
  assert.equal(r.allowed, true, "a preview must be allowed even when the free quota is exhausted");
  assert.equal(r.charged, false, "a preview must not be reported as charged");
  assert.equal(calls.decrement.length, 0, "a preview must never call decrementQuota");
  assert.equal(calls.resolvePlan, 0, "a preview must never trigger plan resolution");
});

test("gate: EXECUTE call on a gated tool (valid-shaped approval_token) → charged normally, exactly one decrement", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: 999 });
  const r = await enforceGatewayCap({
    toolName: "novada_proxy_account_create",
    monthlyQuota: 1000,
    args: { product: "1", account: "sub1", password: "xxxxxxxx", approval_token: "sig123|9999999999999" },
    deps,
  });
  assert.equal(r.allowed, true);
  assert.equal(r.charged, true, "the execute call is the real billable event and must be charged");
  assert.deepEqual(calls.decrement, ["free"], "exactly one decrement for the execute call");
});

test("gate: multi-action gated tool, UNGATED action (ip_whitelist \"list\") → charged normally, NOT treated as a free preview", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: 999 });
  const r = await enforceGatewayCap({
    toolName: "novada_ip_whitelist",
    monthlyQuota: 1000,
    args: { action: "list", product: "1" }, // no approval_token — but "list" was never gated
    deps,
  });
  assert.equal(r.charged, true, "an ungated action must still be charged even though the tool has a preview flow for other actions");
  assert.deepEqual(calls.decrement, ["free"]);
});

// 2026-09-07: ip_whitelist "remark" moved from ungated to gated (SEC-consistency
// fix). Runtime-level pair mirroring the pure isApprovalGatePreviewCall unit tests
// above, through the actual enforceGatewayCap call path.
test("gate: ip_whitelist \"remark\" PREVIEW (no approval_token) → allowed, NOT charged — remark now shares the gate with add/del", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: -1 }); // would reject if charged
  const r = await enforceGatewayCap({
    toolName: "novada_ip_whitelist",
    monthlyQuota: 1000,
    args: { action: "remark", id: "wl_1" }, // no approval_token
    deps,
  });
  assert.equal(r.allowed, true, "a remark preview must be allowed even when the free quota is exhausted");
  assert.equal(r.charged, false, "a remark preview must not be charged");
  assert.equal(calls.decrement.length, 0);
});

test("gate: ip_whitelist \"remark\" EXECUTE (valid-shaped approval_token) → charged normally, exactly one decrement", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: 999 });
  const r = await enforceGatewayCap({
    toolName: "novada_ip_whitelist",
    monthlyQuota: 1000,
    args: { action: "remark", id: "wl_1", approval_token: "sig123|9999999999999" },
    deps,
  });
  assert.equal(r.allowed, true);
  assert.equal(r.charged, true, "the remark execute call is the real billable event and must be charged");
  assert.deepEqual(calls.decrement, ["free"]);
});

test("gate: enforceGatewayCap called with no `args` (back-compat) → behaves exactly as before this fix, no crash", async () => {
  const { calls, deps } = makeGateDeps({ remainingFree: 999 });
  const r = await enforceGatewayCap({ toolName: "novada_proxy_account_create", monthlyQuota: 1000, deps });
  assert.equal(r.allowed, true);
  assert.equal(r.charged, true, "with no args to classify, the call must fall through to the normal charged path — never silently exempted");
  assert.deepEqual(calls.decrement, ["free"]);
});

// A stateful decrementQuota mock mirroring the REAL kv.incr/kv.decr atomic
// contract in mcp.ts's decrementQuota (over-cap increment is rolled back,
// success returns `monthlyQuota - used`) — needed for the boundary test
// below, where the SEQUENCE of calls (does decrementQuota fire once or
// twice?) is exactly what the MEDIUM finding was about.
function makeStatefulGateDeps(monthlyQuota) {
  let used = 0;
  const calls = { decrement: [] };
  return {
    calls,
    deps: {
      decrementQuota: async (plan) => {
        calls.decrement.push(plan);
        used += 1;
        if (plan === "free" && used > monthlyQuota) {
          used -= 1; // rollback, mirrors kv.decr in the real decrementQuota
          return -1;
        }
        return Math.max(0, monthlyQuota - used);
      },
      resolvePlan: async () => "free",
      fetchBalance: async () => 0,
    },
  };
}

test("gate: BOUNDARY — caller with exactly 1 unit left: preview (no charge) then execute (charges once) — the approved write completes (MEDIUM fix regression)", async () => {
  const { calls, deps } = makeStatefulGateDeps(1);
  const previewArgs = { product: "1", account: "sub_acct_1", password: "supersecret1" }; // no approval_token
  const executeArgs = { ...previewArgs, approval_token: "sig123|9999999999999" };

  const preview = await enforceGatewayCap({ toolName: "novada_proxy_account_create", monthlyQuota: 1, args: previewArgs, deps });
  assert.equal(preview.allowed, true, "preview must be allowed");
  assert.equal(preview.charged, false, "preview must NOT consume the caller's last unit");
  assert.equal(calls.decrement.length, 0, "preview must not touch the quota counter at all");

  const execute = await enforceGatewayCap({ toolName: "novada_proxy_account_create", monthlyQuota: 1, args: executeArgs, deps });
  assert.equal(
    execute.allowed,
    true,
    "the EXECUTE call must succeed — before this fix the preview already spent the caller's only unit, so this assertion failed with 'Free Gateway Cap Reached' and the approved write could never complete",
  );
  assert.equal(execute.charged, true, "execute is the one real billable event");
  assert.equal(execute.remaining, 0, "one unit charged, one unit was available — 0 remaining, not -1");
  assert.equal(calls.decrement.length, 1, "exactly ONE decrementQuota call total across preview+execute — was 2 before this fix");
});

// ─── Layer 3: STATIC — regression fence on api/mcp.ts ────────────────────────

test("mcp.ts: gateway cap gate wired (enforceGatewayCap imported from ./_plan.js and called)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /from "\.\/_plan\.js"/, "mcp.ts must import from ./_plan.js");
  assert.match(src, /enforceGatewayCap\(/, "mcp.ts must call enforceGatewayCap");
});

test("mcp.ts: enforceGatewayCap call site passes args (MEDIUM fix regression — without this, preview calls can't be detected and are double-charged)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const callStart = src.indexOf("const gate = await enforceGatewayCap({");
  assert.ok(callStart >= 0, "enforceGatewayCap call site must exist");
  const callBody = src.slice(callStart, src.indexOf("});", callStart));
  assert.match(callBody, /args:\s*argsObj/, "enforceGatewayCap must be called with args: argsObj so it can detect approval-gate preview calls");
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
