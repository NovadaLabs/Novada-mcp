/**
 * reconcile-core.ts — PURE logic for the HQ outbox reconciler (no I/O, no env reads).
 *
 * The hosted gateway pushes each tool_call to HQ inline (fire-and-forget, waitUntil).
 * When that inline push fails transiently (HQ/api-m down, rate-limit), the row is left
 * in the backup telemetry table with push_status='failed' (or never-attempted 'pending')
 * and — before this reconciler existed — was NEVER retried, so it never reached HQ.
 *
 * This module holds the pieces that are worth unit-testing in isolation: the cron auth
 * guard, the "undelivered rows" query builder, and the bounded concurrent drain loop.
 * The I/O glue (SELECT the DB, call pushToHq, respond) lives in ./reconcile.ts so this
 * file value-imports NOTHING from a sibling api/*.ts (only a type) — keeping it loadable
 * under `node --test` type-stripping exactly like _hq_push.ts / _telemetry.ts.
 */
import { timingSafeEqual } from "node:crypto";
import type { McpEventRow } from "./_telemetry.js";

/** A backup row as SELECTed from mcp_events — McpEventRow plus the server-set `ts`
 *  (which McpEventRow omits, since it is a DB default at INSERT time). */
export type OutboxRow = McpEventRow & { ts?: string | null };

/**
 * Constant-shape check of the Vercel Cron auth header. Fail-CLOSED: a missing/empty
 * CRON_SECRET denies every request (never accidentally world-open). Vercel injects
 * `Authorization: Bearer <CRON_SECRET>` on scheduled invocations when the env var is set.
 */
export function isCronAuthorized(authHeader: string | undefined | null, secret: string | undefined | null): boolean {
  if (!secret) return false;                 // fail-closed
  if (typeof authHeader !== "string") return false;
  const got = Buffer.from(authHeader);
  const want = Buffer.from(`Bearer ${secret}`);
  // Length differing is not itself sensitive; timingSafeEqual requires equal lengths.
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);         // constant-time (defense-in-depth vs timing)
}

/**
 * PostgREST URL for the undelivered, ATTRIBUTABLE backlog, oldest first:
 *   - push_status IN (pending, failed)  — not yet delivered to HQ
 *   - hq_identity NOT NULL              — HQ can resolve a user (MISSING_TOKEN rows can't → skip)
 *   - event_type = tool_call            — Phase 1 scope (initialize is Phase 2, pending Leo's event_type)
 *   - rejection_stage <> pre_auth       — the inline path NEVER pushes pre-auth rejections
 *                                         (emitGuardRejection → emitEvent only). An INVALID_TOKEN
 *                                         still carries an encrypted (bad) key, so without this it
 *                                         would resend unattributable junk to HQ AND clog the
 *                                         oldest-first queue behind the canary's bad-key bursts.
 *   - ts >= sinceIso                    — bound the scan window (avoid ancient rows)
 *   - order ts.DESC (newest first)      — a fresh real failure must reach HQ within one
 *                                         tick (~60s) even while a large OLD backlog (e.g.
 *                                         the canary's rate-limit junk) is still draining;
 *                                         oldest-first would park recent rows behind it.
 * Built as a literal query string (not URLSearchParams) so PostgREST operators like
 * `in.(a,b)` and `not.is.null` are not over-encoded.
 */
export function buildUndeliveredQuery(baseUrl: string, sinceIso: string, limit: number): string {
  const qs = [
    "push_status=in.(pending,failed)",
    "hq_identity=not.is.null",
    "event_type=eq.tool_call",
    "rejection_stage=neq.pre_auth",
    `ts=gte.${encodeURIComponent(sinceIso)}`,
    "order=ts.desc",
    `limit=${limit}`,
  ].join("&");
  return `${baseUrl.replace(/\/+$/, "")}/rest/v1/mcp_events?${qs}`;
}

export interface DrainDeps {
  /** Deliver ONE row to HQ (wraps pushToHq with a single attempt + the service-key env).
   *  Must never throw — mirrors pushToHq's fail-silent contract. */
  push: (row: OutboxRow, eventTsMs: number) => Promise<void>;
  /** Parallel workers (default 10). */
  concurrency?: number;
  /** Wall-clock budget; stop STARTING new pushes past this (default 50s < the 60s maxDuration). */
  budgetMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Drain `rows` to HQ with bounded concurrency and a wall-clock budget. Whether each row
 * ends up 'pushed' or stays 'failed' is decided inside `push` (pushToHq updates
 * push_status) — the every-60s cron re-selects anything still undelivered, so this loop
 * makes exactly one delivery attempt per row per run and never blocks on retries.
 * Returns {scanned, attempted}: attempted < scanned iff the budget cut the run short.
 */
export async function drainRows(rows: OutboxRow[], deps: DrainDeps): Promise<{ scanned: number; attempted: number }> {
  const concurrency = Math.max(1, deps.concurrency ?? 10);
  const budgetMs = deps.budgetMs ?? 50_000;
  const now = deps.now ?? (() => Date.now());
  const start = now();

  let next = 0;
  let attempted = 0;

  async function worker(): Promise<void> {
    while (next < rows.length && now() - start < budgetMs) {
      const row = rows[next++];
      attempted++;
      const tsMs = row.ts ? Date.parse(row.ts) : now();
      const eventTsMs = Number.isFinite(tsMs) ? tsMs : now();
      await deps.push(row, eventTsMs);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  return { scanned: rows.length, attempted };
}
