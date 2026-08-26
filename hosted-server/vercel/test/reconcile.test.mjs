/**
 * Tests for the HQ outbox reconciler's pure core (reconcile-core.ts):
 *   1. isCronAuthorized   — fail-closed cron guard
 *   2. buildUndeliveredQuery — the exact PostgREST filter for the undelivered backlog
 *   3. drainRows          — one attempt per row, bounded by concurrency + wall-clock budget
 *   4. resolveLookbackMs/resolveBatchLimit — the one-shot widened-window drain override
 *      (2026-08-26: built for a manual operator-triggered wide drain of backlog older
 *      than the routine 48h window; NEVER auto-invoked by the per-minute cron itself)
 *
 * The handler glue (reconcile.ts) is thin I/O wiring over pushToHq (already covered by
 * hq-push.test.mjs) and is exercised by the post-deploy live drain, not here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCronAuthorized,
  buildUndeliveredQuery,
  drainRows,
  resolveLookbackMs,
  resolveBatchLimit,
  MAX_LOOKBACK_HOURS,
  MAX_BATCH_LIMIT,
} from "../api/reconcile-core.ts";

// ─── 1. isCronAuthorized ──────────────────────────────────────────────────────
test("isCronAuthorized: missing secret → DENY (fail-closed, never world-open)", () => {
  assert.equal(isCronAuthorized("Bearer anything", undefined), false);
  assert.equal(isCronAuthorized("Bearer anything", ""), false);
});

test("isCronAuthorized: exact 'Bearer <secret>' → allow, everything else → deny", () => {
  assert.equal(isCronAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(isCronAuthorized("Bearer wrong", "s3cret"), false);
  assert.equal(isCronAuthorized("s3cret", "s3cret"), false);          // missing "Bearer "
  assert.equal(isCronAuthorized(undefined, "s3cret"), false);
  assert.equal(isCronAuthorized(null, "s3cret"), false);
});

// ─── 2. buildUndeliveredQuery ─────────────────────────────────────────────────
test("buildUndeliveredQuery: filters to undelivered + attributable + tool_call, oldest first", () => {
  const q = buildUndeliveredQuery("https://x.supabase.co", "2026-08-01T00:00:00.000Z", 100);
  assert.ok(q.startsWith("https://x.supabase.co/rest/v1/mcp_events?"), "hits mcp_events");
  assert.ok(q.includes("push_status=in.(pending,failed)"), "only undelivered");
  assert.ok(q.includes("hq_identity=not.is.null"), "only attributable rows");
  assert.ok(q.includes("event_type=eq.tool_call"), "Phase 1 scope = tool_call");
  assert.ok(q.includes("rejection_stage=neq.pre_auth"), "exclude pre-auth junk (inline never pushes it)");
  assert.ok(q.includes("order=ts.desc"), "newest first — recent real rows never park behind old junk");
  assert.ok(q.includes("limit=100"), "bounded batch");
  assert.ok(q.includes(`ts=gte.${encodeURIComponent("2026-08-01T00:00:00.000Z")}`), "window bound, encoded");
});

test("buildUndeliveredQuery: strips trailing slash on base url (no //rest)", () => {
  const q = buildUndeliveredQuery("https://x.supabase.co/", "2026-08-01T00:00:00.000Z", 10);
  assert.ok(q.includes(".supabase.co/rest/v1/mcp_events"), "single slash");
  assert.ok(!q.includes(".supabase.co//rest"), "no double slash");
});

// ─── 3. drainRows ─────────────────────────────────────────────────────────────
const rowsFixture = (n) =>
  Array.from({ length: n }, (_, i) => ({
    request_id: `r${i}`,
    event_type: "tool_call",
    hq_identity: "n:c:t",
    ts: `2026-08-0${(i % 9) + 1}T00:00:0${i % 10}.000Z`,
  }));

test("drainRows: attempts every row once, passing the row's OWN ts as eventTsMs", async () => {
  const rows = rowsFixture(5);
  const calls = [];
  const res = await drainRows(rows, { push: async (row, ts) => { calls.push([row.request_id, ts]); }, concurrency: 3 });
  assert.equal(res.scanned, 5);
  assert.equal(res.attempted, 5);
  assert.equal(calls.length, 5, "one push per row");
  const seen = new Set(calls.map((c) => c[0]));
  assert.equal(seen.size, 5, "each row attempted exactly once (no dup, no drop)");
  const r2 = calls.find((c) => c[0] === "r2");
  assert.equal(r2[1], Date.parse(rows[2].ts), "eventTsMs = original row ts, not push-time now()");
});

test("drainRows: a row with no ts falls back to a finite now() (never NaN)", async () => {
  const seen = [];
  await drainRows([{ request_id: "x", event_type: "tool_call", hq_identity: "n:c:t", ts: null }], {
    push: async (_row, ts) => { seen.push(ts); },
    now: () => 1_700_000_000_000,
  });
  assert.equal(seen[0], 1_700_000_000_000, "fallback to injected now()");
});

test("drainRows: wall-clock budget stops STARTING new pushes → attempted < scanned", async () => {
  const rows = rowsFixture(20);
  let t = 0;
  const clock = () => (t += 30); // each now() reading advances 30ms
  const calls = [];
  const res = await drainRows(rows, {
    push: async (row) => { calls.push(row.request_id); },
    concurrency: 1,            // serial so the clock advances deterministically per row
    budgetMs: 100,             // ~ first few rows only
    now: clock,
  });
  assert.equal(res.scanned, 20);
  assert.ok(res.attempted < 20, "budget cut the run short");
  assert.ok(res.attempted >= 1, "at least one row attempted");
  assert.equal(calls.length, res.attempted, "attempted count matches pushes made");
});

test("drainRows: push that rejects would surface — our push contract is never-throw", async () => {
  // Guard: drainRows awaits push; if a push impl threw, the run would reject. Assert the
  // happy path resolves cleanly when push honors its fail-silent contract (returns void).
  await assert.doesNotReject(
    drainRows(rowsFixture(3), { push: async () => {}, concurrency: 2 }),
  );
});

// ─── 4. resolveLookbackMs / resolveBatchLimit — one-shot widened-window override ──

test("resolveLookbackMs: absent/null param → default unchanged", () => {
  assert.equal(resolveLookbackMs(null, 12345), 12345);
  assert.equal(resolveLookbackMs(undefined, 12345), 12345);
  assert.equal(resolveLookbackMs("", 12345), 12345);
});

test("resolveLookbackMs: invalid (non-numeric, zero, negative) param → default unchanged", () => {
  assert.equal(resolveLookbackMs("not-a-number", 999), 999);
  assert.equal(resolveLookbackMs("0", 999), 999);
  assert.equal(resolveLookbackMs("-5", 999), 999);
  assert.equal(resolveLookbackMs("NaN", 999), 999);
});

test("resolveLookbackMs: valid hours → converted to ms", () => {
  assert.equal(resolveLookbackMs("1", 0), 60 * 60 * 1000);
  assert.equal(resolveLookbackMs("24", 0), 24 * 60 * 60 * 1000);
  assert.equal(resolveLookbackMs("0.5", 0), 0.5 * 60 * 60 * 1000, "fractional hours accepted");
});

test("resolveLookbackMs: clamped to MAX_LOOKBACK_HOURS — an operator asking for 'everything' gets the widest SAFE window, not an error", () => {
  const got = resolveLookbackMs(String(MAX_LOOKBACK_HOURS * 100), 0);
  assert.equal(got, MAX_LOOKBACK_HOURS * 60 * 60 * 1000, "clamped down to the max, never rejected outright");
});

test("resolveLookbackMs: at exactly MAX_LOOKBACK_HOURS → passes through unclamped", () => {
  assert.equal(resolveLookbackMs(String(MAX_LOOKBACK_HOURS), 0), MAX_LOOKBACK_HOURS * 60 * 60 * 1000);
});

test("resolveBatchLimit: absent/invalid param → default unchanged", () => {
  assert.equal(resolveBatchLimit(null, 100), 100);
  assert.equal(resolveBatchLimit("0", 100), 100);
  assert.equal(resolveBatchLimit("-1", 100), 100);
  assert.equal(resolveBatchLimit("abc", 100), 100);
});

test("resolveBatchLimit: valid value → floored and passed through under the cap", () => {
  assert.equal(resolveBatchLimit("50", 100), 50);
  assert.equal(resolveBatchLimit("50.9", 100), 50, "floored, never rounded up past what was asked");
});

test("resolveBatchLimit: clamped to MAX_BATCH_LIMIT — a huge limit could blow the reconciler's own wall-clock DRAIN_BUDGET_MS", () => {
  assert.equal(resolveBatchLimit(String(MAX_BATCH_LIMIT * 10), 100), MAX_BATCH_LIMIT);
});

test("resolveBatchLimit: routine cron invocation (no query params) is fully unaffected — the override is opt-in only", () => {
  // Mirrors reconcile.ts's actual call site: requestUrl.searchParams.get(...) returns
  // null when the query string is absent, which must resolve to the exact same
  // LOOKBACK_MS/BATCH_LIMIT the routine per-minute cron has always used.
  const ROUTINE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
  const ROUTINE_BATCH_LIMIT = 100;
  assert.equal(resolveLookbackMs(null, ROUTINE_LOOKBACK_MS), ROUTINE_LOOKBACK_MS);
  assert.equal(resolveBatchLimit(null, ROUTINE_BATCH_LIMIT), ROUTINE_BATCH_LIMIT);
});
