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
/**
 * 90s. The inline push (waitUntil, see _hq_push.ts) usually still delivers a row
 * within a couple seconds — that's the common case this budget is sized for. It is
 * NOT sized to guarantee catching the reconciler's own sweep: since 2026-08-26 the
 * reconciler is triggered by a GitHub Actions scheduled workflow on a ~5-15 min
 * cadence (see reconcile.ts's module doc), not the old every-60s Vercel Cron, so a
 * 90s window can easily end before the reconciler ever ticks. That's why a row still
 * `pending`/`failed` when the budget runs out is treated as "recorded, delivery
 * pending" (non-fatal) below rather than a hard failure — see pollForDelivery's
 * `pending` outcome and main()'s handling of it.
 */
export const POLL_BUDGET_MS = 90_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll mcp_events for a row matching `userAgent`, until it reaches a terminal
 * `push_status` (`pushed` or `dead`) or the budget elapses. Injectable
 * fetchImpl/sleepImpl for tests — production callers omit both.
 *
 * Three distinct outcomes when the row IS found:
 *   - pushed=true              → delivered. Success.
 *   - pushed=false, pending=false → `push_status='dead'` (terminal,
 *     non-retryable). A real bug, not a timing artifact.
 *   - pushed=false, pending=true  → still `pending`/`failed` when the budget
 *     ran out. NOT a failure: since the reconciler now runs on a ~5-15 min
 *     GitHub Actions cadence (see reconcile.ts's module doc) rather than the
 *     old every-60s Vercel Cron, this poll's 90s budget can easily end
 *     before the reconciler's next tick even on a perfectly healthy
 *     pipeline. Capture already succeeded (the row exists) — only delivery
 *     timing is still open.
 * And when the row is never found at all (found=false): capture itself
 * looks broken — still a hard failure regardless of cadence.
 *
 * @returns {Promise<{found: boolean, pushed: boolean, pending: boolean, row: object|null, elapsedMs: number}>}
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
  let lastSeenRow = null;
  while (now() - start < budgetMs) {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}/rest/v1/mcp_events?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0) {
        const row = rows[0];
        lastSeenRow = row;
        if (row.push_status === "pushed") {
          return { found: true, pushed: true, pending: false, row, elapsedMs: now() - start };
        }
        if (row.push_status === "dead") {
          // Terminal, non-retryable — no point polling further.
          return { found: true, pushed: false, pending: false, row, elapsedMs: now() - start };
        }
        // found but still pending/failed — keep polling, the reconciler's
        // next GitHub Actions tick may still pick it up within the budget.
      }
    }
    await sleepImpl(intervalMs);
  }
  // Budget exhausted. A row that was captured but never reached a terminal
  // state is "delivery pending", not a total loss — see the JSDoc above.
  if (lastSeenRow) {
    return { found: true, pushed: false, pending: true, row: lastSeenRow, elapsedMs: now() - start };
  }
  return { found: false, pushed: false, pending: false, row: null, elapsedMs: now() - start };
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
  if (result.found && result.pending) {
    // Non-fatal: capture succeeded (the row exists), delivery just hadn't
    // finished within this poll's 90s budget. Expected occasionally now that
    // the reconciler runs on a ~5-15 min GitHub Actions cadence instead of
    // the old every-60s Vercel Cron (see POLL_BUDGET_MS's doc comment above)
    // — inline push (waitUntil) usually still lands fast, but when it
    // doesn't, the reconciler's next tick (not this canary run) is what
    // finishes the job. Do NOT treat this as a hard failure; a row that
    // never appears at all is handled separately below and still is one.
    console.log(
      "[telemetry-delivery-canary] recorded, delivery pending — row was captured but still pending/failed at the end of the poll window; the GitHub Actions reconciler (~5-15 min cadence) may not have ticked yet. Non-fatal."
    );
    process.exit(0);
  }
  if (result.found && !result.pushed) {
    console.error("[telemetry-delivery-canary] row was captured but reached a terminal non-pushed state (push_status='dead') — this is a buildHqPayload()/HQ payload bug, not a transient blip");
    process.exit(1);
  }
  console.error(`[telemetry-delivery-canary] no mcp_events row for this synthetic call within ${POLL_BUDGET_MS}ms — CAPTURE itself is broken (this is NOT about the reconciler's cadence — an ungrouped row should be captured near-instantly by the inline push; check CRON_SECRET/TELEMETRY_SUPABASE_SERVICE_KEY env vars and .github/workflows/reconcile-cron.yml as a secondary check)`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
