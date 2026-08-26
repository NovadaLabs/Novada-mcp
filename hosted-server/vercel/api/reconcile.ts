/**
 * reconcile.ts — HQ outbox drain, triggered by Vercel Cron every minute.
 *
 * WHY: HQ (api-m.novada.com) is the system of record for customer-facing MCP usage
 * logs; our telemetry Supabase is only a backup. The inline push (see _hq_push.ts,
 * scheduled in mcp.ts's waitUntil) drops a row after 3 immediate retries if HQ is
 * transiently unavailable — with no replay, those rows never reached HQ. This route is
 * that replay: every minute it re-sends the undelivered, attributable backlog, so every
 * recorded tool_call lands in HQ within ~60s even across an api-m outage. Idempotent by
 * contract (HQ dedups on request_id+event_type), so re-sending an already-stored row is
 * a no-op on their side.
 *
 * SECURITY: refuses anything without `Authorization: Bearer $CRON_SECRET` (Vercel Cron
 * sends this automatically when CRON_SECRET is set) → no public trigger.
 *
 * READ KEY: SELECTing the backlog needs a read-capable key. The gateway's normal
 * TELEMETRY_SUPABASE_KEY is INSERT-only under RLS, so this route uses a separate
 * TELEMETRY_SUPABASE_SERVICE_KEY, and passes it as TELEMETRY_SUPABASE_KEY into pushToHq
 * so its own push_status PATCH authenticates too.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { pushToHq } from "./_hq_push.js";
import {
  buildUndeliveredQuery,
  drainRows,
  isCronAuthorized,
  resolveLookbackMs,
  resolveBatchLimit,
  type OutboxRow,
} from "./reconcile-core.js";

// Vercel Node.js Function. maxDuration 60 == the cron period, so a run can never
// overlap the next tick; the drain's own 50s budget (below) keeps it safely under this.
export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

const LOOKBACK_MS = 48 * 60 * 60 * 1000; // only chase the last 48h of backlog
const BATCH_LIMIT = 100; // per run; single-attempt pushes → comfortably < 60s
const DRAIN_BUDGET_MS = 50_000;
const SELECT_TIMEOUT_MS = 8_000; // bound the backlog SELECT (mirrors _hq_push's timeouts) — a hung PostgREST must not eat the whole cron tick and get force-killed

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const authHeader = req.headers["authorization"];
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!isCronAuthorized(auth, process.env.CRON_SECRET)) {
    return send(res, 401, { error: "unauthorized" });
  }

  const url = process.env.TELEMETRY_SUPABASE_URL;
  const serviceKey = process.env.TELEMETRY_SUPABASE_SERVICE_KEY;
  // Fail-safe: without a read key, this route is a clean no-op (never 500s the cron).
  if (!url || !serviceKey) {
    return send(res, 200, { skipped: "telemetry read not configured" });
  }

  // One-shot widened-window override (built for, and ONLY for, a manual
  // operator-triggered drain of backlog older than the routine 48h window —
  // e.g. `/api/reconcile?lookbackHours=720&limit=500`, still gated by the
  // SAME CRON_SECRET bearer check above). The routine per-minute cron
  // invocation carries NO query string, so it always falls through to the
  // fixed LOOKBACK_MS/BATCH_LIMIT defaults below — this override changes
  // nothing about the routine cadence unless a caller explicitly asks for it.
  // Both params are parsed+clamped by reconcile-core.ts (MAX_LOOKBACK_HOURS /
  // MAX_BATCH_LIMIT) so a wide request still can't turn one 60s cron tick
  // into an unbounded scan.
  const requestUrl = new URL(req.url ?? "/api/reconcile", "http://internal");
  const lookbackMs = resolveLookbackMs(requestUrl.searchParams.get("lookbackHours"), LOOKBACK_MS);
  const batchLimit = resolveBatchLimit(requestUrl.searchParams.get("limit"), BATCH_LIMIT);

  const sinceIso = new Date(Date.now() - lookbackMs).toISOString();
  const query = buildUndeliveredQuery(url, sinceIso, batchLimit);

  let rows: OutboxRow[] = [];
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), SELECT_TIMEOUT_MS);
  try {
    const r = await fetch(query, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: controller.signal,
    });
    if (!r.ok) {
      return send(res, 200, { error: "select_failed", status: r.status });
    }
    rows = (await r.json()) as OutboxRow[];
  } catch (err) {
    return send(res, 200, { error: "select_threw", detail: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
  } finally {
    clearTimeout(tid);
  }

  if (rows.length === 0) {
    return send(res, 200, { scanned: 0, attempted: 0 });
  }

  // pushToHq reads TELEMETRY_SUPABASE_URL/KEY for its push_status PATCH — feed it the
  // service key so the write-back authenticates. maxAttempts=1: the cron is the retry loop.
  const pushEnv = { ...process.env, TELEMETRY_SUPABASE_KEY: serviceKey };
  // Defensive: drainRows only awaits pushToHq (itself never-throw), but keep the
  // "never 500 the cron" contract absolute even if a future dep changes that.
  try {
    const result = await drainRows(rows, {
      push: (row, eventTsMs) => pushToHq(row, pushEnv, eventTsMs, 1),
      concurrency: 20, // higher parallelism so a batch of slow (timeout-bound) junk pushes still clears within the 50s budget
      budgetMs: DRAIN_BUDGET_MS,
    });
    return send(res, 200, { scanned: result.scanned, attempted: result.attempted });
  } catch {
    return send(res, 200, { scanned: rows.length, attempted: 0, error: "drain_threw" });
  }
}
