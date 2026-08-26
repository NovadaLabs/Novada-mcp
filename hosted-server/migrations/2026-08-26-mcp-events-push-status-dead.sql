-- ============================================================================
-- mcp_events: add 'dead' as a terminal push_status value — 2026-08-26
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
-- WHY: hosted-server/vercel/api/_hq_push.ts's pushToHq() previously wrote
-- push_status='failed' for BOTH a transient HQ failure (network error, HQ
-- 5xx, code 10000 — worth retrying) AND a PERMANENT failure (HQ code 10001,
-- "our own payload is malformed" — retrying resends the identical bad
-- payload forever). reconcile-core.ts's undelivered-backlog query selects
-- `push_status=in.(pending,failed)` every ~60s, so a single malformed-payload
-- bug would have looped forever, burning the reconciler's batch budget on a
-- row that can never succeed. pushToHq now writes push_status='dead' for the
-- permanent case instead — this migration widens the CHECK constraint added
-- in 2026-07-23-mcp-events-log-schema.sql §3.3 to allow that new value.
--
-- PREREQUISITE (already shipped, not part of this file): the
-- UNIQUE(request_id, event_type) constraint (mcp_events_request_event_uniq)
-- from 2026-07-23-mcp-events-log-schema.sql §3.2. Confirm it exists
-- (`SELECT conname FROM pg_constraint WHERE conname =
-- 'mcp_events_request_event_uniq'`) before relying on the app's
-- `Prefer: resolution=ignore-duplicates` header (added alongside this fix in
-- ./api/_telemetry.ts's emitEvent()) — without the constraint, that header is
-- a silent no-op (PostgREST needs a real unique/exclusion constraint to know
-- what "duplicate" means for ON CONFLICT DO NOTHING).
--
-- LOCK SAFETY: a CHECK constraint cannot be widened in place — it must be
-- dropped and re-added. Mirrors 2026-07-23's NOT VALID + VALIDATE CONSTRAINT
-- pattern so re-adding it does not take a blocking ACCESS EXCLUSIVE lock for
-- the full validation scan on a live, continuously-inserting table. Safe to
-- run as one batch (no CONCURRENTLY statement in this file, unlike 2026-07-23
-- §3 — DROP/ADD CONSTRAINT ... NOT VALID are both metadata-only).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_events_push_status_check'
  ) THEN
    ALTER TABLE mcp_events DROP CONSTRAINT mcp_events_push_status_check;
  END IF;
END $$;

ALTER TABLE mcp_events
  ADD CONSTRAINT mcp_events_push_status_check
  CHECK (push_status IS NULL OR push_status IN ('pending', 'pushed', 'failed', 'dead'))
  NOT VALID;

ALTER TABLE mcp_events VALIDATE CONSTRAINT mcp_events_push_status_check;

COMMENT ON COLUMN mcp_events.push_status IS
  'Enum: pending | pushed | failed | dead. pending/failed are scanned by the reconciler retry queue (reconcile-core.ts buildUndeliveredQuery); dead is a TERMINAL state for a permanent HQ rejection (code 10001 — our own payload bug) and is deliberately excluded from that query so it is never retried.';

-- Refresh PostgREST schema cache (matches 2026-07-23's Section 7).
NOTIFY pgrst, 'reload schema';
