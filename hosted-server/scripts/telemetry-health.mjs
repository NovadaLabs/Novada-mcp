#!/usr/bin/env node
/**
 * telemetry-health.mjs — ops health-check for the mcp_events -> HQ outbox
 * (hosted-server/vercel/api/_telemetry.ts + _hq_push.ts + reconcile.ts).
 *
 * Three checks, run in one pass against the SAME dedicated telemetry Supabase
 * project (TELEMETRY_SUPABASE_URL / TELEMETRY_SUPABASE_SERVICE_KEY — the
 * READ-capable service key, same one reconcile.ts uses, NOT the INSERT-only
 * TELEMETRY_SUPABASE_KEY the gateway uses):
 *
 *   1. Backlog age  — how old is the OLDEST still-undelivered (pending/failed)
 *      attributable tool_call row? The reconciler cron is supposed to drain
 *      this to ~0 every ~60s — a growing age means the cron isn't running
 *      (missing CRON_SECRET/TELEMETRY_SUPABASE_SERVICE_KEY -> silent 200-skip,
 *      see reconcile.ts) or HQ is down longer than the retry ladder can absorb.
 *        warn >= 5 min, critical >= 30 min.
 *
 *   2. 24h delivery rate — of every attributable tool_call row in the last
 *      24h, what fraction reached push_status='pushed'? A steady gap below
 *      100% that ISN'T explained by (1)'s in-flight backlog means rows are
 *      quietly dying somewhere in the pipeline.
 *        warn < 98%, critical < 90%.
 *
 *   3. Dead-row count (24h) — push_status='dead' rows are a PERMANENT HQ
 *      rejection (code 10001, "our own payload is malformed" — see
 *      _hq_push.ts's pushToHq). This should be near-ALWAYS ZERO; any nonzero
 *      count is a real bug in buildHqPayload()/the row shape, not noise.
 *        warn > 0.
 *
 * Run: TELEMETRY_SUPABASE_URL=... TELEMETRY_SUPABASE_SERVICE_KEY=... \
 *      node hosted-server/scripts/telemetry-health.mjs
 * Exits 0 (ok/warn) or 1 (critical) — warn is visible but non-blocking,
 * mirroring this repo's existing alert-gating convention (mcp.ts's
 * shouldAlertSentry: not every anomaly should page).
 * Skips cleanly (exit 0, {"skipped": ...}) when the read credentials are
 * absent — this is a diagnostic script, never a hard CI gate on its own.
 *
 * Dependency-free (Node >=20 stdlib only), matching monitoring/smoke/*.mjs.
 *
 * ─── §3 (INDEPENDENT capture-count cross-check) — NOT wired, by design ───────
 * The remaining piece from the telemetry hardening plan — comparing
 * mcp_events' row count against a signal collected OUTSIDE the mcp_events
 * write path (so a bug that stops mcp.ts from ever attempting the INSERT is
 * still caught) — is intentionally left as a documented contract, not a
 * fabricated integration: as of this writing there is no confirmed public
 * Vercel REST endpoint for a project's Function Invocations count (verified
 * 2026-08-26; Vercel's REST API reference lists "Observability"/"Billing"
 * categories but no documented single endpoint for this metric), and adding
 * a NEW independent counter (e.g. a Vercel KV increment on every request,
 * read back via the Upstash REST protocol) needs a new credential path this
 * script has no way to provision or verify without deploy access. See
 * crossCheckCaptureCount()'s doc comment below for the exact contract a real
 * implementation must satisfy, and PICK ONE of the two options documented
 * there. Until then, the honest state is: NOT automated, use the Vercel
 * dashboard's Observability tab as a manual cross-check.
 */

// ─── pure classification (unit-testable, no I/O) ──────────────────────────────

export const BACKLOG_WARN_MS = 5 * 60 * 1000;
export const BACKLOG_CRITICAL_MS = 30 * 60 * 1000;
export const DELIVERY_WARN_RATE = 0.98;
export const DELIVERY_CRITICAL_RATE = 0.90;

/** `ageMs` = now - oldest undelivered row's ts, or null if there is no backlog at all. */
export function classifyBacklogAge(ageMs) {
  if (ageMs === null || ageMs === undefined) return "ok";
  if (ageMs >= BACKLOG_CRITICAL_MS) return "critical";
  if (ageMs >= BACKLOG_WARN_MS) return "warn";
  return "ok";
}

/**
 * `pushed`/`totalAttributable` are counts over the same 24h attributable
 * (hq_identity NOT NULL, event_type=tool_call, rejection_stage<>pre_auth —
 * mirrors reconcile-core.ts's buildUndeliveredQuery scope) window.
 * Zero traffic -> rate 1 ("ok"), never a divide-by-zero NaN.
 */
export function classifyDeliveryRate(pushed, totalAttributable) {
  if (!totalAttributable || totalAttributable <= 0) return { rate: 1, level: "ok" };
  const rate = pushed / totalAttributable;
  let level = "ok";
  if (rate < DELIVERY_CRITICAL_RATE) level = "critical";
  else if (rate < DELIVERY_WARN_RATE) level = "warn";
  return { rate, level };
}

/** Any dead row at all is worth a human look — see this file's header comment. */
export function classifyDeadRows(deadCount) {
  return (deadCount ?? 0) > 0 ? "warn" : "ok";
}

const LEVEL_RANK = { ok: 0, warn: 1, critical: 2 };
export function worstLevel(levels) {
  return levels.reduce((worst, l) => (LEVEL_RANK[l] > LEVEL_RANK[worst] ? l : worst), "ok");
}

// ─── I/O (thin PostgREST calls, injectable fetch for tests) ──────────────────

const REQUEST_TIMEOUT_MS = 8_000;

async function restGet(baseUrl, key, path, fetchImpl) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status} for ${path}`);
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

/** Same "undelivered, attributable" scope as reconcile-core.ts's buildUndeliveredQuery, minus the LOOKBACK/limit — we want the true oldest, unbounded. */
async function fetchOldestBacklogTs(baseUrl, key, fetchImpl) {
  const rows = await restGet(
    baseUrl, key,
    "mcp_events?push_status=in.(pending,failed)&hq_identity=not.is.null&event_type=eq.tool_call&rejection_stage=neq.pre_auth&order=ts.asc&limit=1&select=ts",
    fetchImpl,
  );
  return rows.length > 0 ? rows[0].ts : null;
}

async function fetchCount(baseUrl, key, filterQs, fetchImpl) {
  const rows = await restGet(baseUrl, key, `mcp_events?select=count()&${filterQs}`, fetchImpl);
  return rows[0]?.count ?? 0;
}

/**
 * Run all three checks against one telemetry Supabase project.
 * `fetchImpl` and `now` are injectable purely for tests — production callers
 * omit both and get globalThis.fetch / Date.now().
 */
export async function runHealthCheck({ url, key, fetchImpl = fetch, now = () => Date.now() }) {
  const nowMs = now();
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const attributableBase = "hq_identity=not.is.null&event_type=eq.tool_call&rejection_stage=neq.pre_auth";

  const [oldestTs, pushed24h, total24h, dead24h] = await Promise.all([
    fetchOldestBacklogTs(url, key, fetchImpl),
    fetchCount(url, key, `${attributableBase}&push_status=eq.pushed&ts=gte.${encodeURIComponent(sinceIso)}`, fetchImpl),
    fetchCount(url, key, `${attributableBase}&ts=gte.${encodeURIComponent(sinceIso)}`, fetchImpl),
    fetchCount(url, key, `${attributableBase}&push_status=eq.dead&ts=gte.${encodeURIComponent(sinceIso)}`, fetchImpl),
  ]);

  const ageMs = oldestTs ? nowMs - Date.parse(oldestTs) : null;
  const backlogLevel = classifyBacklogAge(ageMs);
  const delivery = classifyDeliveryRate(pushed24h, total24h);
  const deadLevel = classifyDeadRows(dead24h);

  return {
    backlog: { oldestTs, ageMs, level: backlogLevel },
    delivery: { pushed24h, total24h, rate: delivery.rate, level: delivery.level },
    deadRows: { count24h: dead24h, level: deadLevel },
    overallLevel: worstLevel([backlogLevel, delivery.level, deadLevel]),
  };
}

// ─── §3 contract stub — see this file's header comment ────────────────────────
/**
 * Contract a real implementation MUST satisfy (NOT implemented here):
 * compare mcp_events' row count for a window against a count collected via a
 * mechanism entirely OUTSIDE the mcp_events write path, so a bug that stops
 * mcp.ts from ever reaching captureEvent()/emitEvent() (e.g. a cold-start
 * crash before telemetry code runs) is still caught — comparing mcp_events
 * against itself proves nothing about rows that were never attempted.
 * Two viable options, neither wired:
 *   (a) Vercel's own Function Invocations metric (owner-provisioned
 *       VERCEL_API_TOKEN + VERCEL_PROJECT_ID; exact endpoint unconfirmed as
 *       of 2026-08-26 — verify against current Vercel REST API docs before
 *       wiring this option).
 *   (b) A NEW independent counter written by mcp.ts itself via a datastore
 *       other than the telemetry Supabase (e.g. a Vercel KV INCR on every
 *       request, fire-and-forget waitUntil, BEFORE auth/telemetry run),
 *       read back here via the Upstash REST protocol (see
 *       hosted-server/vercel/test/support/kv-stub.mjs for the wire format).
 *       Requires the SAME KV_REST_API_URL/TOKEN the Vercel deployment
 *       already has, provisioned here as new CI/ops secrets.
 * Throws NOT_IMPLEMENTED — callers must not silently treat this as "ok".
 */
export async function crossCheckCaptureCount() {
  throw new Error("crossCheckCaptureCount: NOT_IMPLEMENTED — see this file's header comment for the two viable options and why neither is wired yet");
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.TELEMETRY_SUPABASE_URL;
  const key = process.env.TELEMETRY_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log(JSON.stringify({ skipped: "telemetry read not configured (TELEMETRY_SUPABASE_URL/TELEMETRY_SUPABASE_SERVICE_KEY absent)" }));
    process.exit(0);
  }
  try {
    const result = await runHealthCheck({ url, key });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.overallLevel === "critical" ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
