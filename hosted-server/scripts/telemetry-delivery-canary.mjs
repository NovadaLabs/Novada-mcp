#!/usr/bin/env node
/**
 * telemetry-delivery-canary.mjs — end-to-end proof that a REAL tool call
 * against the live https://mcp.novada.com actually produces a `pushed`
 * mcp_events row within a bounded window. This is the ONE check nothing else
 * in this hardening pass exercises: telemetry-health.mjs proves the PIPELINE
 * is healthy in aggregate, but not that a specific real call's row actually
 * made it through capture -> reconcile -> HQ.
 *
 * Correlation strategy: a distinctive `User-Agent` header
 * (`novada-telemetry-canary/<runId>`) is set on the synthetic call and
 * matched against mcp_events.user_agent (a column already captured on every
 * row, see hosted-server/vercel/api/_telemetry.ts's sanitizeUserAgent).
 * Deliberately does NOT touch the tool-response contract (no new `_meta`
 * field, no change to billing-critical response shape) — this canary only
 * ever READS mcp_events via the read-only TELEMETRY_SUPABASE_SERVICE_KEY.
 *
 * Call made: `novada_setup` — free, cap-exempt, auth-free-ish (still needs a
 * valid key), zero side effects. Never a billable call.
 *
 * Requires:
 *   NOVADA_TEST_KEY                    — same funded test key the rest of the
 *                                         canary/synthetic-monitor suite uses
 *   TELEMETRY_SUPABASE_URL             — telemetry Supabase REST endpoint
 *   TELEMETRY_SUPABASE_SERVICE_KEY     — READ-capable key (reconcile.ts's key,
 *                                         NOT the gateway's INSERT-only key)
 *
 * Skips cleanly (exit 0, {"skipped": ...}) when the Supabase read
 * credentials are absent — these are NOT yet provisioned as CI secrets as of
 * this writing (see this repo's CLAUDE.md: DB/telemetry credentials are
 * owner-provisioned, never invented here). NOVADA_TEST_KEY is always
 * required — same fail-loud contract as monitoring/lib/mcp-client.mjs.
 *
 * Run: NOVADA_TEST_KEY=... TELEMETRY_SUPABASE_URL=... \
 *      TELEMETRY_SUPABASE_SERVICE_KEY=... \
 *      node hosted-server/scripts/telemetry-delivery-canary.mjs
 */
import { callTool } from "../../monitoring/lib/mcp-client.mjs";

export const POLL_INTERVAL_MS = 5_000;
/** 90s — a little over the reconciler's 60s cron period, so a healthy
 *  pipeline has time for at least one full drain tick even if the inline
 *  push happened to fail and fell through to the reconciler. */
export const POLL_BUDGET_MS = 90_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll mcp_events for a row matching `userAgent`, until it reaches
 * push_status='pushed' or the budget elapses. Injectable fetchImpl/sleepImpl
 * for tests — production callers omit both.
 *
 * @returns {Promise<{found: boolean, pushed: boolean, row: object|null, elapsedMs: number}>}
 */
export async function pollForDelivery({
  url,
  key,
  userAgent,
  budgetMs = POLL_BUDGET_MS,
  intervalMs = POLL_INTERVAL_MS,
  fetchImpl = fetch,
  sleepImpl = sleep,
  now = () => Date.now(),
}) {
  const start = now();
  const qs = `user_agent=eq.${encodeURIComponent(userAgent)}&event_type=eq.tool_call&order=ts.desc&limit=1`;
  while (now() - start < budgetMs) {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}/rest/v1/mcp_events?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0) {
        const row = rows[0];
        if (row.push_status === "pushed") {
          return { found: true, pushed: true, row, elapsedMs: now() - start };
        }
        if (row.push_status === "dead") {
          // Terminal, non-retryable — no point polling further.
          return { found: true, pushed: false, row, elapsedMs: now() - start };
        }
        // found but still pending/failed — keep polling, the reconciler
        // cron may still pick it up within the budget.
      }
    }
    await sleepImpl(intervalMs);
  }
  return { found: false, pushed: false, row: null, elapsedMs: now() - start };
}

async function main() {
  const url = process.env.TELEMETRY_SUPABASE_URL;
  const key = process.env.TELEMETRY_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log(JSON.stringify({ skipped: "telemetry read not configured (TELEMETRY_SUPABASE_URL/TELEMETRY_SUPABASE_SERVICE_KEY absent)" }));
    process.exit(0);
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const userAgent = `novada-telemetry-canary/${runId}`;

  const call = await callTool("novada_setup", {}, { headers: { "user-agent": userAgent } });
  if (!call.ok) {
    console.log(JSON.stringify({ error: "synthetic novada_setup call itself failed", detail: call.error }));
    process.exit(1);
  }

  const result = await pollForDelivery({ url, key, userAgent });
  console.log(JSON.stringify({ userAgent, ...result }, null, 2));

  if (result.pushed) process.exit(0);
  if (result.found && !result.pushed) {
    console.error("[telemetry-delivery-canary] row was captured but reached a terminal non-pushed state (push_status='dead') — this is a buildHqPayload()/HQ payload bug, not a transient blip");
    process.exit(1);
  }
  console.error(`[telemetry-delivery-canary] no mcp_events row for this synthetic call within ${POLL_BUDGET_MS}ms — CAPTURE or DELIVERY is broken (or the reconciler cron isn't running — check vercel.json's crons + CRON_SECRET/TELEMETRY_SUPABASE_SERVICE_KEY env vars)`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
