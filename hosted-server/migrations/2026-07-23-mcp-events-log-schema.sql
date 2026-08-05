-- ============================================================================
-- novada-mcp events log schema — 2026-07-23 (frozen contract)
-- ============================================================================
-- NOT AUTO-APPLIED. This file is NOT run by any script, hook, CI job, or
-- worker in this repo. The OWNER runs it by hand (psql / Supabase SQL editor)
-- against the dedicated telemetry Supabase project:
--
--     project ref:  ypjwcbscjpmecbzllizw   (eu-central-1, "novada-mcp telemetry")
--
-- Do NOT run against the personal memory DB (fjdtuyflvgylrllujpnc) or any
-- other project.
--
-- Source of truth: reports/novada-mcp-log-schema-roundtable-2026-07-23.md
--   §2.2  fixes to existing columns
--   §2.3  new columns (WS-A, hosted-server-owned)
--   §3    idempotency / indexes / billing split
--   §6    outcome -> status_bucket governance mapping
--   §7    TOOL -> PRODUCT mapping
--
-- Baseline this migration assumes: mcp_events as created by
-- reports/novada-mcp-telemetry-schema-2026-07-15.sql (applied 2026-07-15) plus
-- whatever Stage-1 (channel/session_id/operation/account_uid) added on top.
-- Every statement below is IF [NOT] EXISTS / guarded so it is safe to run
-- against that baseline, or against a table that already has some subset of
-- these columns.
--
-- Scope discipline: this migration ONLY covers WS-A (hosted-server-derivable
-- columns). The four WS-B columns (outcome='blocked' real value,
-- target_http_status, retry_count, upstream_request_id) live in npm-package
-- and are NOT part of this file — see §2.4 of the roundtable doc.
--
-- ============================================================================
-- HOW TO RUN THIS FILE (read before running anything) — post-review update
-- ============================================================================
-- SECTIONS 0, 1, 2, 4, 5, 6, 7 are ordinary guarded DDL/DML — safe to run as
-- one batch/transaction (e.g. paste-and-run in the Supabase SQL editor, which
-- wraps the whole paste in one implicit transaction).
--
-- SECTION 3 is DIFFERENT and MUST be run separately, statement-by-statement,
-- with NO wrapping transaction — see the big banner at the top of that
-- section for why (short version: it contains a `CREATE INDEX CONCURRENTLY`,
-- and Postgres hard-errors if that statement is inside a transaction block;
-- the Supabase SQL editor's "Run" button wraps your whole paste in one, so
-- pasting Section 3 there as-is will fail). Use `psql` for Section 3, or the
-- Supabase SQL editor's per-statement execution, one statement at a time.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 0 — pre-flight (informational; no longer a manual step)
-- ────────────────────────────────────────────────────────────────────────────
-- Previously this section held a commented-out SELECT the owner had to
-- uncomment-and-eyeball before running the UNIQUE constraint add below. Per
-- review, that manual step is now an ACTIVE, automatic gate — it lives in
-- SECTION 3, immediately before the UNIQUE index is created, and RAISEs an
-- EXCEPTION (aborting the run) if duplicate (request_id, event_type) rows
-- exist. Nothing to do here; this section is now a pointer only.


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — restore / fix existing columns (§2.2)
-- ────────────────────────────────────────────────────────────────────────────

-- Restore `channel` if a prior deploy dropped it. No-op if already present
-- (it is present in the 2026-07-15 baseline; this guards drift only).
ALTER TABLE mcp_events
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'mcp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_channel_check'
  ) THEN
    ALTER TABLE mcp_events
      ADD CONSTRAINT mcp_events_channel_check
      CHECK (channel IN ('mcp', 'api', 'web'));
  END IF;
END $$;

-- `outcome`: kept as free text (internal raw enum), domain widened to allow
-- 'blocked' as a value. ASSUMPTION (verified against the 2026-07-15 baseline
-- SQL): `outcome` has NO CHECK constraint today — it is plain `text` — so
-- 'blocked' already fits with NO DDL change required. This block is a no-op
-- guard only, in case a CHECK was added out-of-band since 2026-07-15; if one
-- exists and does not already permit 'blocked', it is dropped and recreated
-- with 'blocked' included. Note: the real 'blocked' *value* is only ever
-- written by WS-B (npm-package) once TARGET_BLOCKED exists — this migration
-- only ensures the column/domain can hold it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'mcp_events'::regclass
      AND c.contype = 'c'
      AND a.attname = 'outcome'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%blocked%'
  ) THEN
    RAISE WARNING 'outcome has a CHECK constraint that does not mention ''blocked'' — owner must inspect and extend it manually (not auto-altered by this migration to avoid guessing the existing value list).';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — new WS-A columns (§2.3)
-- ────────────────────────────────────────────────────────────────────────────
-- Column adds only. The CHECK constraints for rejection_stage / auth_method /
-- push_status / operation, and the (request_id, event_type) uniqueness
-- constraint, are handled in SECTION 3 using lock-minimizing patterns
-- (NOT VALID + VALIDATE CONSTRAINT / CREATE INDEX CONCURRENTLY) so they don't
-- belong in this ordinary-transaction section.

ALTER TABLE mcp_events
  ADD COLUMN IF NOT EXISTS product              text,
  ADD COLUMN IF NOT EXISTS status_bucket        text,
  ADD COLUMN IF NOT EXISTS error_code           text,
  ADD COLUMN IF NOT EXISTS failure_class        text,
  ADD COLUMN IF NOT EXISTS retryable            boolean,
  ADD COLUMN IF NOT EXISTS rejection_stage      text,
  ADD COLUMN IF NOT EXISTS is_hosted_limitation boolean,
  ADD COLUMN IF NOT EXISTS operation            text,
  ADD COLUMN IF NOT EXISTS user_agent           text,
  ADD COLUMN IF NOT EXISTS auth_method          text,
  ADD COLUMN IF NOT EXISTS hq_identity          text,
  ADD COLUMN IF NOT EXISTS key_version          text,
  ADD COLUMN IF NOT EXISTS gateway_ceiling_hit  boolean,
  ADD COLUMN IF NOT EXISTS pushed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS push_status          text;

COMMENT ON COLUMN mcp_events.product              IS 'Product the tool belongs to, written at gateway-time from a static TOOL->PRODUCT table (§7) — never derived downstream by regex on tool.';
COMMENT ON COLUMN mcp_events.status_bucket        IS 'Customer-facing status bucket, derived from outcome via the governance mapping in §6 (success / failed / blocked / processing / not_applicable style buckets).';
COMMENT ON COLUMN mcp_events.error_code           IS 'NovadaErrorCode value (closed enum in app code) — never a raw error message.';
COMMENT ON COLUMN mcp_events.failure_class        IS 'FAILURE_CLASS from errors.ts: transient / permanent / auth / quota.';
COMMENT ON COLUMN mcp_events.retryable            IS 'NovadaError.retryable, as computed by the app layer.';
COMMENT ON COLUMN mcp_events.rejection_stage      IS 'Enum: pre_auth | rate_limited | cap_blocked | tool_filtered | dispatched. Written from guard sites so blocked calls that never reach dispatch still produce a row.';
COMMENT ON COLUMN mcp_events.is_hosted_limitation IS 'True when outcome is a hosted-only limitation (e.g. NOT_AVAILABLE_ON_HOSTED), so it is excluded from failure-rate reporting.';
COMMENT ON COLUMN mcp_events.operation            IS 'args.operation / args.platform / render / format — a closed whitelist enum only (never free text like keyword/url). Exception to the "keys only" fence, owner-approved (D2). DB backstop: length(operation) <= 64 (SECTION 3) until the full whitelist CHECK lands per §7.';
COMMENT ON COLUMN mcp_events.user_agent           IS 'HTTP User-Agent, truncated to 200 chars and control-character-stripped at write time. Raw client IP is never stored.';
COMMENT ON COLUMN mcp_events.auth_method          IS 'Enum: path | query | bearer — which extractToken() branch authenticated the request.';
COMMENT ON COLUMN mcp_events.hq_identity          IS 'AES-256-GCM(apikey), stored as base64("nonce:ciphertext:tag"), one unique nonce per row. The encryption key never lives in this table, in logs, or in an env var accessible from here — HQ decrypts to map to a user. Intentionally NOT indexed (high-cardinality ciphertext; meaningless without the HQ key).';
COMMENT ON COLUMN mcp_events.key_version          IS 'Constant tag for the encryption key/version used to produce hq_identity, e.g. aes-gcm-v1 — required so key rotation is auditable per row.';
COMMENT ON COLUMN mcp_events.gateway_ceiling_hit  IS 'True when withWallClock() aborted the call at the gateway''s own wall-clock ceiling (~296s), distinct from the underlying tool/target timing out on its own.';
COMMENT ON COLUMN mcp_events.pushed_at            IS 'When the push worker successfully delivered this row to HQ create-log — distinct from ts (when the event happened). NULL until pushed.';
COMMENT ON COLUMN mcp_events.push_status          IS 'Enum: pending | pushed | failed — scanned by the retry/backfill queue.';


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CONCURRENT / NON-TRANSACTIONAL — RUN STATEMENT-BY-STATEMENT
-- ════════════════════════════════════════════════════════════════════════════
-- >>> DO NOT paste this whole section into the Supabase SQL editor's default
-- >>> "Run" action and DO NOT wrap it in BEGIN/COMMIT. It contains a
-- >>> `CREATE INDEX CONCURRENTLY`, which Postgres REFUSES to run inside a
-- >>> transaction block (hard error: "CREATE INDEX CONCURRENTLY cannot run
-- >>> inside a transaction block"). The Supabase SQL editor implicitly wraps
-- >>> a whole pasted script in one transaction, so pasting this section there
-- >>> as one block will fail outright.
-- >>>
-- >>> Run every statement in this section ONE AT A TIME, either via `psql`
-- >>> (each statement terminated by `;` on its own, with autocommit on — the
-- >>> psql default) or by executing them individually in the Supabase SQL
-- >>> editor (one statement per "Run", not the whole section).
-- >>>
-- >>> Purpose: this section adds the (request_id, event_type) uniqueness
-- >>> guarantee and 4 new CHECK constraints WITHOUT taking a full-table
-- >>> ACCESS EXCLUSIVE lock on the live, continuously-inserting mcp_events
-- >>> table — i.e. gateway writes are not blocked while these run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3.1 — duplicate-row gate (active; formerly the commented Section 0 check) ──
-- Runs automatically, immediately before the UNIQUE index below. Aborts the
-- whole run (RAISE EXCEPTION) if pre-existing duplicate (request_id,
-- event_type) rows would make the UNIQUE add below fail — e.g. from a
-- retry-storm prior to this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM mcp_events
    WHERE request_id IS NOT NULL
    GROUP BY request_id, event_type
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate (request_id,event_type) rows exist — resolve before adding UNIQUE';
  END IF;
END $$;
-- NOTE (re-review must-fix, applied): filters `WHERE request_id IS NOT NULL`.
-- Postgres GROUP BY folds all NULL request_id values into ONE group, but a
-- UNIQUE(request_id, event_type) constraint permits unlimited NULL request_id
-- rows (NULLs are pairwise distinct for uniqueness). request_id is nullable in
-- the 2026-07-15 baseline, so without this filter the gate would very likely
-- false-positive-abort the whole migration on pre-existing NULL-request_id
-- rows that the UNIQUE add would in fact accept. This is a real guard, not
-- hypothetical.

-- ── 3.2 — idempotent UNIQUE via CONCURRENTLY (no ACCESS EXCLUSIVE table lock) ──
-- Step 1: build the unique index CONCURRENTLY (this is the statement that
-- cannot run inside a transaction block — run it standalone).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS mcp_events_request_event_uniq
  ON mcp_events (request_id, event_type);

-- Step 2: attach the already-built index as a constraint. This ALTER TABLE
-- itself takes a brief ACCESS EXCLUSIVE lock, but only for metadata (no table
-- scan, since the index already exists and is valid) — effectively instant.
-- Guarded so it is safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_request_event_uniq'
  ) THEN
    ALTER TABLE mcp_events
      ADD CONSTRAINT mcp_events_request_event_uniq
      UNIQUE USING INDEX mcp_events_request_event_uniq;
  END IF;
END $$;

-- ── 3.3 — 4 new CHECK constraints via NOT VALID + VALIDATE CONSTRAINT ──
-- NOT VALID adds the constraint instantly (metadata-only, no table scan, so
-- new/updated rows are checked immediately but existing rows are not
-- scanned yet). VALIDATE CONSTRAINT then scans existing rows but only takes
-- SHARE UPDATE EXCLUSIVE (concurrent reads AND writes proceed normally),
-- never the full ACCESS EXCLUSIVE that a plain (non-NOT-VALID) ADD
-- CONSTRAINT CHECK would hold for the whole scan. Grouped into this
-- statement-by-statement section for lock-safety consistency with 3.1/3.2
-- above, even though VALIDATE CONSTRAINT itself has no hard transaction-block
-- restriction the way CREATE INDEX CONCURRENTLY does.

-- rejection_stage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_rejection_stage_check'
  ) THEN
    ALTER TABLE mcp_events
      ADD CONSTRAINT mcp_events_rejection_stage_check
      CHECK (rejection_stage IS NULL OR rejection_stage IN
        ('pre_auth', 'rate_limited', 'cap_blocked', 'tool_filtered', 'dispatched'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE mcp_events VALIDATE CONSTRAINT mcp_events_rejection_stage_check;

-- auth_method
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_auth_method_check'
  ) THEN
    ALTER TABLE mcp_events
      ADD CONSTRAINT mcp_events_auth_method_check
      CHECK (auth_method IS NULL OR auth_method IN ('path', 'query', 'bearer'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE mcp_events VALIDATE CONSTRAINT mcp_events_auth_method_check;

-- push_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_push_status_check'
  ) THEN
    ALTER TABLE mcp_events
      ADD CONSTRAINT mcp_events_push_status_check
      CHECK (push_status IS NULL OR push_status IN ('pending', 'pushed', 'failed'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE mcp_events VALIDATE CONSTRAINT mcp_events_push_status_check;

-- operation: DB backstop only (§5 of the fix list / roundtable §7). This is
-- NOT the full closed whitelist yet — just a length ceiling so a future free-
-- text regression can't silently blow up this "keys only" fence's one
-- deliberate raw-value exception. Full whitelist CHECK deferred until the
-- §7 TOOL->PRODUCT / operation registry is final.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_operation_length_check'
  ) THEN
    ALTER TABLE mcp_events
      ADD CONSTRAINT mcp_events_operation_length_check
      CHECK (operation IS NULL OR length(operation) <= 64)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE mcp_events VALIDATE CONSTRAINT mcp_events_operation_length_check;

-- ── 3.4 — NEW indexes, built CONCURRENTLY (no write-blocking lock) ──
-- product / push_status / pushed_at are BRAND-NEW columns (just added in
-- Section 2), so these indexes do not yet exist. On a live, continuously-
-- inserting table a plain CREATE INDEX takes a SHARE lock that blocks gateway
-- writes for the whole build — contradicting this section's lock-safety goal.
-- CONCURRENTLY avoids it (same non-transactional rule as 3.2 — run each
-- statement standalone, never inside a transaction block). Re-review must-fix.
CREATE INDEX CONCURRENTLY IF NOT EXISTS mcp_events_product_idx
  ON mcp_events (product);

-- IS DISTINCT FROM 'pushed' (not <>): push_status is NULL for every pre-push
-- row; a plain <> evaluates to NULL (not TRUE) and would silently EXCLUDE
-- exactly the rows the retry queue must find. IS DISTINCT FROM includes them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS mcp_events_push_status_pending_idx
  ON mcp_events (push_status)
  WHERE push_status IS DISTINCT FROM 'pushed';

CREATE INDEX CONCURRENTLY IF NOT EXISTS mcp_events_pushed_at_null_idx
  ON mcp_events (pushed_at)
  WHERE pushed_at IS NULL;

-- OPERATIONAL CAVEAT (runbook, not a code change): if a `CREATE INDEX
-- CONCURRENTLY` above is interrupted mid-build, Postgres can leave an INVALID
-- index of that name; `IF NOT EXISTS` will then skip rebuilding it and a query
-- relying on it silently won't use it. If that happens:
--   DROP INDEX <name>;  -- then re-run the CREATE INDEX CONCURRENTLY statement.
-- (Same applies to mcp_events_request_event_uniq in 3.2 — there a leftover
-- INVALID index also breaks the subsequent ADD CONSTRAINT ... USING INDEX.)

-- ════════════════════════════════════════════════════════════════════════════
-- END SECTION 3 — resume normal (transactional/batch-safe) execution below
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — indexes (§3.2) — batch-safe remainder only
-- ────────────────────────────────────────────────────────────────────────────
-- The three NEW indexes (product, push_status, pushed_at) moved to §3.4 and are
-- built CONCURRENTLY there — building them here with a plain CREATE INDEX would
-- take a write-blocking SHARE lock on the live table (re-review must-fix). Only
-- the pre-existing BRIN guard remains in this batch-safe section.

-- ts: BRIN, not btree — append-only high-volume time series, BRIN is far
-- cheaper. Already present as mcp_events_ts_brin in the 2026-07-15 baseline, so
-- this is a no-op guard (no lock taken when the index already exists). If a
-- given environment's mcp_events is large AND genuinely lacks this index, run
-- it as CREATE INDEX CONCURRENTLY in the §3 section instead.
CREATE INDEX IF NOT EXISTS mcp_events_ts_brin ON mcp_events USING brin (ts);

-- hq_identity: deliberately NOT indexed — high-cardinality ciphertext, no
-- value without the HQ decryption key. Do not add an index here.


-- ============================================================================
-- SECTION 5 — DROP dead columns (session_id, parent_request_id)
-- ============================================================================
-- OWNER DEFAULT = DROP (per roundtable §2.2 / §9 D6): these columns are dead
-- without WS-C (stateful session mode) which is HARD-deferred (§5 of the
-- roundtable doc). This section is SEPARATE and independently runnable/
-- skippable — if the owner changes their mind on WS-C, do NOT run this
-- section (or restore the columns afresh from Section 2's pattern).
--
-- Any index defined purely on these columns (e.g. mcp_events_session_idx from
-- the 2026-07-15 baseline) is dropped automatically by Postgres along with
-- the column — no separate DROP INDEX needed.
--
-- Uncomment to execute:
--
-- ALTER TABLE mcp_events DROP COLUMN IF EXISTS session_id;
-- ALTER TABLE mcp_events DROP COLUMN IF EXISTS parent_request_id;


-- ============================================================================
-- SECTION 6 — billing / logging split (§3.3)
-- ============================================================================
-- mcp_billing_events: 1:1 with mcp_events by request_id. Call log (mcp_events)
-- = purely "what happened"; billing = purely "what it cost". Only the billing
-- authorization path may read this table — it must never feed the customer-
-- facing call-log view. `charged` / `over_cap_allowed` / `plan` remain on
-- mcp_events (they are call facts — did-it-count / was-cap-bypassed / which
-- plan — not a monetary amount) per the roundtable's explicit call.

CREATE TABLE IF NOT EXISTS mcp_billing_events (
  request_id      text PRIMARY KEY,
  quota_remaining integer,
  -- Forward slot only — not populated by this migration. Reserved for
  -- whatever cost/credit unit is decided later (e.g. credits_charged /
  -- cost_units). Naming is owner's call at that time; left generic here.
  cost_units      numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mcp_billing_events IS
  'Billing-only facts, 1:1 with mcp_events.request_id. Never exposed in the customer-facing call-log view. Read access restricted to the billing authorization path.';
COMMENT ON COLUMN mcp_billing_events.cost_units IS
  'Forward slot for future cost/credit accounting (e.g. credits_charged or cost_units) — not populated as of this migration.';

-- RLS: mirror mcp_events' baseline treatment (2026-07-15 schema, "the lock").
-- Unlike mcp_events (which grants an INSERT-only policy to anon/authenticated
-- for gateway ingest), mcp_billing_events has NO ingest role via PostgREST at
-- all — the gateway writes to it, if ever, via service_role directly, which
-- bypasses RLS entirely. So: RLS ON, zero policies, and an explicit REVOKE as
-- belt-and-suspenders against any default/inherited GRANT ... ALL ON
-- ALL TABLES IN SCHEMA that might otherwise apply. Net effect: anon and
-- authenticated get PGRST301/permission-denied on this table via PostgREST
-- after the schema reload in Section 7; only service_role can read it.
ALTER TABLE mcp_billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mcp_billing_events FROM anon, authenticated;

-- Backfill: copy existing quota_remaining values off mcp_events into the new
-- billing table before anything drops the column off mcp_events. Idempotent
-- via ON CONFLICT DO NOTHING (safe to re-run).
--
-- Restricted to event_type = 'tool_call': request_id is verified 1:1 per
-- request for tool_call rows, so this is a deterministic pick (no risk of
-- picking an arbitrary row among several sharing a request_id from other
-- event_types, e.g. 'initialize'/'resource_read', which do not carry a
-- meaningful quota_remaining anyway).
INSERT INTO mcp_billing_events (request_id, quota_remaining)
SELECT request_id, quota_remaining
FROM mcp_events
WHERE request_id IS NOT NULL
  AND event_type = 'tool_call'
  AND quota_remaining IS NOT NULL
ON CONFLICT (request_id) DO NOTHING;

-- Only after (a) the backfill above has run, and (b) the gateway/app has been
-- switched to write quota_remaining into mcp_billing_events instead of
-- mcp_events, should the old column be dropped. SEPARATE, independently
-- runnable section — do not uncomment until both preconditions are true.
--
-- ALTER TABLE mcp_events DROP COLUMN IF EXISTS quota_remaining;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7 — refresh PostgREST schema cache (matches 2026-07-15 baseline)
-- ────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
