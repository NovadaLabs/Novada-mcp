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

// ─── One-shot widened-window drain (built, never auto-invoked) ───────────────
// The routine reconcile cron (~5-15 min via GitHub Actions) always uses reconcile.ts's fixed LOOKBACK_MS/
// BATCH_LIMIT defaults — this pair exists ONLY so an operator can trigger a
// single manual wide-window pass (e.g. `?lookbackHours=720&limit=500`) to
// chase backlog older than the routine 48h window, without touching the
// routine cadence's behavior. Both are clamped so a malformed or malicious
// query param can never turn one cron tick into an unbounded table scan.
export const MAX_LOOKBACK_HOURS = 24 * 30; // 30 days — generous but bounded
export const MAX_BATCH_LIMIT = 500;

/**
 * Parse + clamp an optional `lookbackHours` query param into milliseconds.
 * Invalid (non-numeric, <=0) or absent -> `defaultMs` unchanged. A value
 * above MAX_LOOKBACK_HOURS is clamped down, never rejected outright — an
 * operator asking for "everything" gets the widest safe window, not an error.
 */
export function resolveLookbackMs(param: string | null | undefined, defaultMs: number): number {
  if (!param) return defaultMs;
  const hours = Number(param);
  if (!Number.isFinite(hours) || hours <= 0) return defaultMs;
  const clampedHours = Math.min(hours, MAX_LOOKBACK_HOURS);
  return clampedHours * 60 * 60 * 1000;
}

/**
 * Parse + clamp an optional `limit` query param (rows per run). Invalid/absent
 * -> `defaultLimit`. Clamped to [1, MAX_BATCH_LIMIT] — never 0 (a no-op run
 * that still "succeeds" would mask a real drain failure) and never unbounded
 * (a huge limit could blow the reconciler's own DRAIN_BUDGET_MS wall-clock).
 */
export function resolveBatchLimit(param: string | null | undefined, defaultLimit: number): number {
  if (!param) return defaultLimit;
  const n = Number(param);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(Math.floor(n), MAX_BATCH_LIMIT);
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
 *                                         tick (~5-15 min) even while a large OLD backlog (e.g.
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
 * push_status) — the reconcile cron (~5-15 min) re-selects anything still undelivered, so this loop
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
