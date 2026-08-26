#!/usr/bin/env node
/**
 * hosted-server/scripts/telemetry-delivery-canary.selftest.mjs
 *
 * Dependency-free, OFFLINE self-test for telemetry-delivery-canary.mjs's
 * pollForDelivery(). Makes ZERO real network calls (injects a stub
 * fetchImpl + a no-op sleepImpl + a manual clock) and needs NO real
 * TELEMETRY_SUPABASE_URL/KEY or NOVADA_TEST_KEY.
 *
 * Run: node hosted-server/scripts/telemetry-delivery-canary.selftest.mjs
 *
 * Assertions:
 *   1. row reaches push_status='pushed' on the FIRST poll -> found+pushed immediately
 *   2. row starts 'pending', becomes 'pushed' on a LATER poll -> polls multiple times, then succeeds
 *   3. row reaches push_status='dead' -> found=true, pushed=false (stops polling immediately, does not exhaust the budget)
 *   4. no row ever appears -> found=false, pushed=false, exhausts the full budget
 *   5. the PostgREST query targets user_agent + event_type=tool_call + ordered newest-first
 *   6. row exists but stays 'pending' for the whole budget -> found=true, pushed=false,
 *      pending=true (the 2026-08-26 GitHub-Actions-cadence tolerance: distinct from both
 *      "dead" (3) and "never appeared" (4) — see pollForDelivery's JSDoc)
 */
import { pollForDelivery } from "./telemetry-delivery-canary.mjs";

let failureCount = 0;
function expect(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failureCount += 1;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

/** Manual clock + no-op sleep so polling loops resolve instantly in tests. */
function makeClock(stepMs) {
  let t = 0;
  return {
    now: () => t,
    sleepImpl: async () => { t += stepMs; },
  };
}

async function main() {
  // ── 1. pushed on the first poll ──
  console.log("[selftest] (1) row already 'pushed' on first poll...");
  {
    const { now, sleepImpl } = makeClock(1000);
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => [{ push_status: "pushed", request_id: "r1" }] };
    };
    const result = await pollForDelivery({ url: "https://tel.example.test", key: "k", userAgent: "ua-1", fetchImpl, sleepImpl, now, budgetMs: 30_000, intervalMs: 1000 });
    expect(result.found === true && result.pushed === true, `found+pushed on first poll (got ${JSON.stringify(result)})`);
    expect(fetchCalls === 1, `exactly one fetch call — no unnecessary polling once pushed (got ${fetchCalls})`);
  }

  // ── 2. pending -> pending -> pushed ──
  console.log("[selftest] (2) row transitions pending -> pending -> pushed across polls...");
  {
    const { now, sleepImpl } = makeClock(1000);
    let call = 0;
    const statuses = ["pending", "pending", "pushed"];
    const fetchImpl = async () => {
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      return { ok: true, json: async () => [{ push_status: status, request_id: "r2" }] };
    };
    const result = await pollForDelivery({ url: "https://tel.example.test", key: "k", userAgent: "ua-2", fetchImpl, sleepImpl, now, budgetMs: 30_000, intervalMs: 1000 });
    expect(result.found === true && result.pushed === true, `eventually found+pushed (got ${JSON.stringify(result)})`);
    expect(call === 3, `polled exactly 3 times to see the transition (got ${call})`);
  }

  // ── 3. dead -> stop immediately, do not exhaust budget ──
  console.log("[selftest] (3) row reaches push_status='dead' -> stops polling immediately...");
  {
    const { now, sleepImpl } = makeClock(1000);
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return { ok: true, json: async () => [{ push_status: "dead", request_id: "r3" }] };
    };
    const result = await pollForDelivery({ url: "https://tel.example.test", key: "k", userAgent: "ua-3", fetchImpl, sleepImpl, now, budgetMs: 30_000, intervalMs: 1000 });
    expect(result.found === true && result.pushed === false, `found but NOT pushed for a dead row (got ${JSON.stringify(result)})`);
    expect(call === 1, `stops polling on the FIRST dead observation — a terminal state, no point waiting out the budget (got ${call} calls)`);
  }

  // ── 4. no row ever appears -> exhausts the budget ──
  console.log("[selftest] (4) no matching row ever appears -> exhausts the full budget, found=false...");
  {
    const { now, sleepImpl } = makeClock(5000);
    const fetchImpl = async () => ({ ok: true, json: async () => [] });
    const result = await pollForDelivery({ url: "https://tel.example.test", key: "k", userAgent: "ua-4", fetchImpl, sleepImpl, now, budgetMs: 20_000, intervalMs: 5000 });
    expect(result.found === false && result.pushed === false, `found=false, pushed=false when nothing ever shows up (got ${JSON.stringify(result)})`);
    expect(result.elapsedMs >= 20_000, `polling ran for the full budget (got ${result.elapsedMs}ms, want >=20000ms)`);
  }

  // ── 5. query shape ──
  console.log("[selftest] (5) PostgREST query targets user_agent + tool_call, newest-first...");
  {
    const { now, sleepImpl } = makeClock(1000);
    let capturedUrl = null;
    const fetchImpl = async (u) => {
      capturedUrl = String(u);
      return { ok: true, json: async () => [{ push_status: "pushed" }] };
    };
    await pollForDelivery({ url: "https://tel.example.test", key: "k", userAgent: "novada-telemetry-canary/abc123", fetchImpl, sleepImpl, now, budgetMs: 30_000, intervalMs: 1000 });
    expect(capturedUrl.includes("user_agent=eq.novada-telemetry-canary%2Fabc123"), `query filters on the exact (URL-encoded) user_agent (got ${capturedUrl})`);
    expect(capturedUrl.includes("event_type=eq.tool_call"), "query scoped to tool_call rows");
    expect(capturedUrl.includes("order=ts.desc"), "query orders newest-first (the canary's own call is always the most recent for this unique UA)");
    expect(capturedUrl.includes("limit=1"), "query bounded to 1 row");
  }

  // ── 6. stuck 'pending' for the whole budget -> non-fatal "delivery pending" ──
  console.log("[selftest] (6) row exists but stays 'pending' for the entire budget -> pending=true, not a hard failure...");
  {
    const { now, sleepImpl } = makeClock(5000);
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return { ok: true, json: async () => [{ push_status: "pending", request_id: "r6" }] };
    };
    const result = await pollForDelivery({ url: "https://tel.example.test", key: "k", userAgent: "ua-6", fetchImpl, sleepImpl, now, budgetMs: 20_000, intervalMs: 5000 });
    expect(result.found === true && result.pushed === false && result.pending === true, `found+not-pushed+pending at timeout, distinct from 'dead' and 'never found' (got ${JSON.stringify(result)})`);
    expect(result.row?.request_id === "r6", `last-seen row is surfaced, not discarded (got ${JSON.stringify(result.row)})`);
    expect(result.elapsedMs >= 20_000, `polling ran for the full budget before giving up on reaching a terminal state (got ${result.elapsedMs}ms, want >=20000ms)`);
  }

  console.log("");
  if (failureCount > 0) {
    console.error(`[selftest] FAILED: ${failureCount} assertion(s) did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log("[selftest] OK — all pollForDelivery state-transition assertions passed, 0 crashes.");
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`[selftest] FATAL: ${err?.stack || err}`);
  process.exitCode = 1;
});
