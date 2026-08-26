#!/usr/bin/env node
/**
 * hosted-server/scripts/telemetry-health.selftest.mjs
 *
 * Dependency-free, OFFLINE self-test for telemetry-health.mjs. Makes ZERO
 * network calls (injects a stub `fetchImpl`) and needs NO real
 * TELEMETRY_SUPABASE_URL/SERVICE_KEY.
 *
 * Run this after ANY change to telemetry-health.mjs:
 *   node hosted-server/scripts/telemetry-health.selftest.mjs
 *
 * Assertions:
 *   1. classifyBacklogAge: null -> ok, <5min -> ok, >=5min -> warn, >=30min -> critical
 *   2. classifyDeliveryRate: 0 total -> {rate:1, ok} (never NaN/divide-by-zero),
 *      100% -> ok, 97% -> warn, 80% -> critical
 *   3. classifyDeadRows: 0 -> ok, >0 -> warn
 *   4. worstLevel: picks the worst of a mixed set, "ok" when all ok
 *   5. runHealthCheck: end-to-end against a stub fetchImpl — asserts the
 *      exact PostgREST query shape (undelivered/attributable filters, the
 *      24h window) AND that the three sub-results compose into the correct
 *      overallLevel (critical wins over warn wins over ok)
 *   6. crossCheckCaptureCount: throws NOT_IMPLEMENTED (never silently "ok")
 *
 * Exit code: non-zero on ANY assertion mismatch, or if the module throws
 * uncaught.
 */

import {
  classifyBacklogAge,
  classifyDeliveryRate,
  classifyDeadRows,
  worstLevel,
  runHealthCheck,
  crossCheckCaptureCount,
  BACKLOG_WARN_MS,
  BACKLOG_CRITICAL_MS,
} from "./telemetry-health.mjs";

let failureCount = 0;
function expect(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failureCount += 1;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

/** Stub fetchImpl matching global fetch's (url, opts) -> Promise<Response-like> signature. */
function makeStubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    for (const [needle, respond] of routes) {
      if (String(url).includes(needle)) return respond(String(url));
    }
    throw new Error(`stub fetch: no route matched ${url}`);
  };
  return { fetchImpl, calls };
}

async function main() {
  // ── 1. classifyBacklogAge ──
  console.log("[selftest] (1) classifyBacklogAge thresholds...");
  expect(classifyBacklogAge(null) === "ok", "no backlog (null age) -> ok");
  expect(classifyBacklogAge(0) === "ok", "age 0 -> ok");
  expect(classifyBacklogAge(BACKLOG_WARN_MS - 1) === "ok", "just under 5min -> ok");
  expect(classifyBacklogAge(BACKLOG_WARN_MS) === "warn", "exactly 5min -> warn");
  expect(classifyBacklogAge(BACKLOG_CRITICAL_MS - 1) === "warn", "just under 30min -> warn");
  expect(classifyBacklogAge(BACKLOG_CRITICAL_MS) === "critical", "exactly 30min -> critical");
  expect(classifyBacklogAge(BACKLOG_CRITICAL_MS * 10) === "critical", "way over 30min -> critical");

  // ── 2. classifyDeliveryRate ──
  console.log("[selftest] (2) classifyDeliveryRate...");
  {
    const zero = classifyDeliveryRate(0, 0);
    expect(zero.rate === 1 && zero.level === "ok", `zero traffic -> rate 1, ok (got ${JSON.stringify(zero)}, never NaN)`);
    const full = classifyDeliveryRate(100, 100);
    expect(full.rate === 1 && full.level === "ok", `100% delivered -> ok (got ${JSON.stringify(full)})`);
    const warnCase = classifyDeliveryRate(97, 100);
    expect(warnCase.level === "warn", `97% delivered -> warn (got ${JSON.stringify(warnCase)})`);
    const criticalCase = classifyDeliveryRate(80, 100);
    expect(criticalCase.level === "critical", `80% delivered -> critical (got ${JSON.stringify(criticalCase)})`);
  }

  // ── 3. classifyDeadRows ──
  console.log("[selftest] (3) classifyDeadRows...");
  expect(classifyDeadRows(0) === "ok", "0 dead rows -> ok");
  expect(classifyDeadRows(undefined) === "ok", "undefined dead count -> ok (treated as 0)");
  expect(classifyDeadRows(1) === "warn", "1 dead row -> warn (should be near-always zero)");
  expect(classifyDeadRows(50) === "warn", "many dead rows -> still warn (not critical — a fix-worthy bug, not an outage)");

  // ── 4. worstLevel ──
  console.log("[selftest] (4) worstLevel...");
  expect(worstLevel(["ok", "ok", "ok"]) === "ok", "all ok -> ok");
  expect(worstLevel(["ok", "warn", "ok"]) === "warn", "one warn -> warn");
  expect(worstLevel(["warn", "critical", "ok"]) === "critical", "critical present -> critical wins");
  expect(worstLevel([]) === "ok", "empty list -> ok (vacuous)");

  // ── 5. runHealthCheck — end-to-end against a stub, asserts query shape + composition ──
  console.log("[selftest] (5) runHealthCheck composes the three checks correctly...");
  {
    const now = () => Date.parse("2026-08-26T12:00:00.000Z");
    const oldestTs = "2026-08-26T11:00:00.000Z"; // 1h old -> critical backlog
    const { fetchImpl, calls } = makeStubFetch([
      ["push_status=in.(pending,failed)", () => ({ ok: true, json: async () => [{ ts: oldestTs }] })],
      ["push_status=eq.pushed", () => ({ ok: true, json: async () => [{ count: 95 }] })],
      ["push_status=eq.dead", () => ({ ok: true, json: async () => [{ count: 2 }] })],
      // total count query has neither "eq.pushed" nor "eq.dead" — must be checked LAST
      ["select=count()", () => ({ ok: true, json: async () => [{ count: 100 }] })],
    ]);
    const result = await runHealthCheck({ url: "https://tel.example.test", key: "k", fetchImpl, now });

    expect(result.backlog.ageMs === 60 * 60 * 1000, `backlog age computed from oldest ts (got ${result.backlog.ageMs}ms, want 3600000ms)`);
    expect(result.backlog.level === "critical", `1h-old backlog -> critical (got ${result.backlog.level})`);
    expect(result.delivery.pushed24h === 95 && result.delivery.total24h === 100, `delivery counts wired through (got ${JSON.stringify(result.delivery)})`);
    expect(result.delivery.level === "warn", `95/100 = 95% -> warn (got ${result.delivery.level})`);
    expect(result.deadRows.count24h === 2 && result.deadRows.level === "warn", `2 dead rows -> warn (got ${JSON.stringify(result.deadRows)})`);
    expect(result.overallLevel === "critical", `overall = worst of [critical, warn, warn] = critical (got ${result.overallLevel})`);

    const backlogCall = calls.find((c) => c.url.includes("push_status=in.(pending,failed)"));
    expect(!!backlogCall, "backlog query was made");
    expect(backlogCall.url.includes("hq_identity=not.is.null"), "backlog query scoped to attributable rows (matches reconcile-core.ts's buildUndeliveredQuery scope)");
    expect(backlogCall.url.includes("event_type=eq.tool_call"), "backlog query scoped to tool_call rows");
    expect(backlogCall.url.includes("rejection_stage=neq.pre_auth"), "backlog query excludes pre_auth (never pushed by design)");
    expect(backlogCall.url.includes("order=ts.asc"), "backlog query orders oldest-first (we want the TRUE oldest, not newest)");

    const deliveryTotalCall = calls.find((c) => c.url.includes("select=count()") && !c.url.includes("eq.pushed") && !c.url.includes("eq.dead"));
    expect(!!deliveryTotalCall && deliveryTotalCall.url.includes("ts=gte."), "24h delivery-rate denominator query has a ts window bound");
  }

  // ── 5b. runHealthCheck — all-healthy case composes to ok ──
  console.log("[selftest] (5b) runHealthCheck — no backlog, 100% delivered, 0 dead -> ok...");
  {
    const now = () => Date.parse("2026-08-26T12:00:00.000Z");
    const { fetchImpl } = makeStubFetch([
      ["push_status=in.(pending,failed)", () => ({ ok: true, json: async () => [] })], // no backlog rows at all
      ["push_status=eq.pushed", () => ({ ok: true, json: async () => [{ count: 500 }] })],
      ["push_status=eq.dead", () => ({ ok: true, json: async () => [{ count: 0 }] })],
      ["select=count()", () => ({ ok: true, json: async () => [{ count: 500 }] })],
    ]);
    const result = await runHealthCheck({ url: "https://tel.example.test", key: "k", fetchImpl, now });
    expect(result.backlog.ageMs === null && result.backlog.level === "ok", `empty backlog -> ageMs null, ok (got ${JSON.stringify(result.backlog)})`);
    expect(result.overallLevel === "ok", `fully healthy pipeline -> overallLevel ok (got ${result.overallLevel})`);
  }

  // ── 6. crossCheckCaptureCount — must be an honest NOT_IMPLEMENTED, never a silent "ok" ──
  console.log("[selftest] (6) crossCheckCaptureCount throws NOT_IMPLEMENTED (not faked)...");
  try {
    await crossCheckCaptureCount();
    expect(false, "crossCheckCaptureCount must throw — it must never silently report 'ok' for an unimplemented check");
  } catch (err) {
    expect(String(err.message).includes("NOT_IMPLEMENTED"), `throws with NOT_IMPLEMENTED in the message (got: ${err.message})`);
  }

  console.log("");
  if (failureCount > 0) {
    console.error(`[selftest] FAILED: ${failureCount} assertion(s) did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log("[selftest] OK — all backlog/delivery-rate/dead-row/composition assertions passed, 0 crashes.");
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`[selftest] FATAL: ${err?.stack || err}`);
  process.exitCode = 1;
});
