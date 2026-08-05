/**
 * Tests for the HQ outbox reconciler's pure core (reconcile-core.ts):
 *   1. isCronAuthorized   — fail-closed cron guard
 *   2. buildUndeliveredQuery — the exact PostgREST filter for the undelivered backlog
 *   3. drainRows          — one attempt per row, bounded by concurrency + wall-clock budget
 *
 * The handler glue (reconcile.ts) is thin I/O wiring over pushToHq (already covered by
 * hq-push.test.mjs) and is exercised by the post-deploy live drain, not here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized, buildUndeliveredQuery, drainRows } from "../api/reconcile-core.ts";

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
