/**
 * HQ log push — forwards a `tool_call` telemetry row to Leo's HQ log-ingest API.
 *
 * CONTRACT (LAW): /Users/tongwu/mcp_log_create_接口文档.md
 *   POST {NOVADA_HQ_LOG_URL}/mcp/log/create, Content-Type: application/json.
 *   Response envelope: { code, data, msg, timestamp } (HTTP 200 for both 0 and 10001).
 *     code 0     → success (incl. idempotent request_id+event_type hit, or an
 *                  hq_identity that decrypts to an unknown apikey — both silent-ignore).
 *     code 10001 → OUR payload is malformed (missing required field). Our own bug —
 *                  retrying would just resend the same bad payload. NEVER retry.
 *     code 10000 (HTTP 400) → hq_identity decrypt failure or a DB write failure on
 *                  Leo's side. Transient from our POV — retry with backoff.
 *
 * Principles (mirrors ./_telemetry.ts, and non-negotiable per the same owner rules):
 *   1. FAIL SAFE — NOVADA_HQ_LOG_URL absent/empty → return immediately, zero network
 *      activity (dark-deploy safe: this file can ship with the env var unset).
 *   2. FAIL SILENT — pushToHq() NEVER throws. It runs fire-and-forget inside
 *      waitUntil(), strictly AFTER the customer's response has already been sent;
 *      nothing it does may affect the request path.
 *   3. STATUS-BUCKET FOLD HAPPENS ONLY HERE — our own mcp_events row keeps its
 *      fine-grained internal status_bucket (success | blocked | failed | pending |
 *      not_applicable, see ./_telemetry.ts statusBucket()). hqStatusBucket() below
 *      folds that down to Leo's 3-bucket customer vocabulary (success | client_error |
 *      server_error) ONLY for the outbound HQ payload — the internal row is untouched.
 *
 * NODE --test IMPORT CONSTRAINT (see ./_telemetry.ts's file-structure note): this
 * module IS directly imported by test/hq-push.test.mjs via Node's built-in TS type
 * stripping, so — exactly like _telemetry.ts — it may import VALUES only from
 * already-compiled vendor `.js` files (never a sibling `api/*.ts` source via a
 * `.js` specifier, since no such compiled sibling exists outside the Vercel/esbuild
 * build step). `McpEventRow` is pulled in as a `import type` instead — type-only
 * imports are erased entirely by Node's type stripping, so no runtime resolution of
 * "./_telemetry.js" is ever attempted.
 */

import { NovadaErrorCode } from "../vendor/novada-mcp/_core/errors.js";
import type { McpEventRow } from "./_telemetry.js";

// ─── Leo's payload shape — EXACTLY his field list, no extras, no key_version ──
export interface HqLogPayload {
  ts: number;
  tool: string;
  operation: string;
  product: string;
  target_domain: string;
  status_bucket: "success" | "client_error" | "server_error";
  user_agent: string;
  request_id: string;
  event_type: "POST /request";
  auth_method: string;
  error_code: string;
  failure_class: string;
  retryable: 0 | 1;
  latency_ms: number;
  charged: 0 | 1;
  plan: string;
  hq_identity: string;
}

// ─── §6 (roundtable doc) fold: internal row fields -> Leo's 3-bucket vocabulary ──
//
// The row does NOT retain the raw internal `outcome` string that produced it (see
// ./_telemetry.ts's McpEventRow doc comment: buildToolCallEvent derives
// status_bucket/error_code/rejection_stage/is_hosted_limitation/gateway_ceiling_hit
// from `outcome` at WRITE time and discards the original string) — so this function
// classifies using only what the row actually carries. Order matters: first match
// wins. Anything that reaches the bottom without matching falls to server_error,
// NEVER success — the explicit, deliberate fail-safe default for any outcome not
// enumerated in the governed mapping below.
type HqStatusBucketRow = Pick<
  McpEventRow,
  "status_bucket" | "error_code" | "rejection_stage" | "gateway_ceiling_hit"
>;

export function hqStatusBucket(row: HqStatusBucketRow): "success" | "client_error" | "server_error" {
  // success ← outcome "ok" (the only source of internal status_bucket "success").
  if (row.status_bucket === "success") return "success";

  // ── client_error ──────────────────────────────────────────────────────────
  // Auth failures: the guard-site outcomes "MISSING_TOKEN" and "INVALID_TOKEN"
  // (bad/missing key to OUR gateway) never construct a NovadaError, so error_code
  // is null for both — rejection_stage="pre_auth" is the ONLY field that survives
  // to distinguish them from other failures, and the two are indistinguishable
  // from each other at the row level. Both are "auth failures" per the contract,
  // so both fold to client_error via this one check.
  if (row.rejection_stage === "pre_auth") return "client_error";
  // INVALID_API_KEY: an actual thrown NovadaError further down the dispatch chain
  // (e.g. an upstream 401), distinct from the pre_auth gateway-key guard above.
  if (row.error_code === NovadaErrorCode.INVALID_API_KEY) return "client_error";
  if (row.error_code === NovadaErrorCode.INVALID_PARAMS) return "client_error";
  // cap_blocked: the free-gateway-cap guard rejection.
  if (row.rejection_stage === "cap_blocked") return "client_error";
  if (row.error_code === NovadaErrorCode.WRONG_TARGET) return "client_error";
  if (row.error_code === NovadaErrorCode.PRODUCT_UNAVAILABLE) return "client_error";
  // SPA_NO_URLS_FOUND: novada_map hit a JS-rendered SPA and the static crawl found
  // no URLs — a TARGET-shape condition the caller can act on (render mode / a
  // different tool), same "permanent" failure_class as WRONG_TARGET/PRODUCT_UNAVAILABLE
  // above. Folds to client_error, NOT the server_error default — otherwise an ordinary
  // SPA target misreports as a Novada outage on HQ's customer dashboard. [audit 2026-07-31 P3]
  if (row.error_code === NovadaErrorCode.SPA_NO_URLS_FOUND) return "client_error";
  // TARGET_BLOCKED (WS-B, npm-package — not yet emitted by any code path today) is
  // the ONLY outcome that produces internal status_bucket "blocked" (see
  // ./_telemetry.ts statusBucket()) — so this needs zero further edits once
  // npm-package starts throwing it.
  if (row.status_bucket === "blocked") return "client_error";
  if (row.error_code === NovadaErrorCode.URL_UNREACHABLE) return "client_error";
  // target 429 (the upstream site rate-limiting US).
  if (row.error_code === NovadaErrorCode.RATE_LIMITED) return "client_error";
  // Our OWN gateway throttling the caller (per-IP 429, rejection_stage
  // "rate_limited"). Orchestrator decision 2026-07-24: this is HTTP-semantics
  // 4xx — the CALLER is sending too fast — so it belongs in client_error;
  // mapping it to server_error would misattribute the throttle to a Novada
  // outage in Leo's UI.
  if (row.rejection_stage === "rate_limited") return "client_error";
  if (row.error_code === NovadaErrorCode.TASK_NOT_FOUND) return "client_error";
  // NOT_AVAILABLE_ON_HOSTED (architectural) and TOOL_NOT_ENABLED (caller's own
  // ?tools=/?groups= filter) both produce internal status_bucket "not_applicable".
  if (row.status_bucket === "not_applicable") return "client_error";

  // ── server_error ──────────────────────────────────────────────────────────
  if (row.error_code === NovadaErrorCode.API_DOWN) return "server_error";
  if (row.error_code === NovadaErrorCode.PROXY_AUTH_FAILURE) return "server_error";
  // Gateway timeout: withWallClock's OWN 56s ceiling firing on a thrown
  // NovadaError. The in-band "TIMEOUT" outcome (extractSingle's own ceiling,
  // returned as a string rather than thrown) leaves error_code null and
  // gateway_ceiling_hit false — it is indistinguishable at the row level from any
  // other unmapped failure, so it correctly falls through to the default below.
  if (row.gateway_ceiling_hit === true) return "server_error";
  if (row.error_code === NovadaErrorCode.SESSION_EXPIRED) return "server_error";

  // Unmapped — fail toward server_error, NEVER success. Covers: NovadaErrorCode.
  // UNKNOWN, the generic "error" outcome (novada_setup's catch-all), non-ceiling
  // TASK_PENDING (a poll-in-progress state Leo's 3-bucket vocabulary has no slot
  // for), in-band "TIMEOUT" (see above), and any future/unlisted outcome.
  return "server_error";
}

/**
 * Pure builder — no I/O. Returns null (skip push) unless the row is a `tool_call`
 * event with a non-null `hq_identity` (nothing to push for `initialize` rows, and
 * nothing HQ can attribute to a customer without hq_identity — e.g. the AES key
 * env var was absent when the row was built).
 *
 * All optional Leo fields fall back to "" (never null) — Go's non-pointer struct
 * fields are the safer target for an empty value than a JSON `null`, and this
 * matches Leo's own documented convention for error_code/failure_class ("成功时传
 * 空字符串" — send empty string on success, not null).
 *
 * `eventTsMs` is Leo's `ts` field verbatim (contract: mcp_log_create_接口文档.md —
 * "ts = 事件发生时间", the moment the tool call STARTED, in Unix ms) — it MUST be
 * the caller's own event-start timestamp (mcp.ts's `started = Date.now()`, taken
 * before the tool runs), never derived here. Calling this function is itself a
 * later point in time (after the customer response, inside waitUntil()), so a
 * local `Date.now()` here would systematically report the event as having
 * happened later than it actually did — up to the ~56s gateway ceiling for slow
 * tools. Defaults to `Date.now()` only so pre-existing call sites in this test
 * file that don't care about the exact `ts` value keep compiling unchanged; the
 * real mcp.ts call site always passes its own `started` explicitly.
 */
export function buildHqPayload(row: McpEventRow, eventTsMs: number = Date.now()): HqLogPayload | null {
  if (row.event_type !== "tool_call") return null;
  if (!row.hq_identity) return null;
  return {
    ts: eventTsMs,
    tool: row.tool ?? "",
    operation: row.operation ?? "",
    product: row.product ?? "",
    target_domain: row.target_domain ?? "",
    status_bucket: hqStatusBucket(row),
    user_agent: row.user_agent ?? "",
    request_id: row.request_id,
    event_type: "POST /request",
    auth_method: row.auth_method ?? "",
    error_code: row.error_code ?? "",
    failure_class: row.failure_class ?? "",
    retryable: row.retryable ? 1 : 0,
    latency_ms: row.latency_ms ?? 0,
    charged: row.charged ? 1 : 0,
    plan: row.plan ?? "",
    hq_identity: row.hq_identity,
  };
}

// ─── pushToHq I/O ──────────────────────────────────────────────────────────────

const HQ_PUSH_TIMEOUT_MS = 5_000;
/** Delay BEFORE attempt 2 and attempt 3 respectively — 3 attempts total. */
const HQ_RETRY_DELAYS_MS = [500, 2_000] as const;
const HQ_PATCH_TIMEOUT_MS = 3_000;

interface HqLogCreateResponse {
  code: number;
  data: unknown;
  msg: string;
  timestamp: number;
}

type PostOutcome = { ok: true } | { ok: false; permanent: boolean };

/** One POST attempt. Never throws — every failure mode resolves to `{ ok: false, ... }`. */
async function postOnce(url: string, payload: HqLogPayload): Promise<PostOutcome> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), HQ_PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/mcp/log/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body: HqLogCreateResponse | null = null;
    try {
      body = (await res.json()) as HqLogCreateResponse;
    } catch {
      body = null; // unparsable body — treat as a retryable failure below
    }
    if (res.status === 200 && body?.code === 0) return { ok: true };
    // 10001 = invalid params — OUR payload bug. Retrying resends the same bad
    // payload, so this is a PERMANENT failure: stop immediately.
    if (body?.code === 10001) return { ok: false, permanent: true };
    // 10000 (HTTP 400, decrypt/DB failure) / non-200 / unparsable body — retryable.
    return { ok: false, permanent: false };
  } catch {
    // Network error / abort (timeout) — retryable.
    return { ok: false, permanent: false };
  } finally {
    clearTimeout(tid);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort push_status update on OUR OWN mcp_events row, via the same Supabase
 * REST mechanism ./_telemetry.ts's emitEvent() uses for the original INSERT — a
 * PATCH filtered by request_id + event_type=tool_call (the same idempotency key
 * Leo's own dedup uses). Silently skipped when telemetry env vars are absent
 * (never derives its own copy of TELEMETRY_SUPABASE_URL/KEY gating logic —
 * reads directly off the passed `env`, defaulting to process.env).
 */
async function updatePushStatus(
  row: McpEventRow,
  env: NodeJS.ProcessEnv,
  status: "pushed" | "failed" | "dead",
): Promise<void> {
  const url = env.TELEMETRY_SUPABASE_URL;
  const key = env.TELEMETRY_SUPABASE_KEY;
  if (!url || !key) return; // telemetry disabled — nothing to update, skip silently
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), HQ_PATCH_TIMEOUT_MS);
  try {
    const qs = `request_id=eq.${encodeURIComponent(row.request_id)}&event_type=eq.tool_call`;
    const body: Record<string, unknown> = { push_status: status };
    if (status === "pushed") body.pushed_at = new Date().toISOString();
    const res = await fetch(`${url}/rest/v1/mcp_events?${qs}`, {
      method: "PATCH",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) console.warn("hq_push: push_status update failed", res.status);
  } catch (err) {
    console.warn("[hq_push] push_status update failed:", err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120));
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Push one tool_call row to HQ's `/mcp/log/create`, then record the outcome on our
 * own mcp_events row's push_status column. NEVER throws — this is scheduled via
 * waitUntil() strictly after the customer response has already been sent, so any
 * failure here (network, HQ 5xx, malformed payload) must be fully self-contained.
 *
 * `env` defaults to `process.env`; a caller (or a test) may pass a plain object
 * instead — this is a real function parameter (not a hidden process.env read)
 * specifically so tests never have to mutate global process.env to exercise the
 * env-gated branches.
 */
export async function pushToHq(row: McpEventRow, env: NodeJS.ProcessEnv = process.env, eventTsMs: number = Date.now(), maxAttempts: number = 1 + HQ_RETRY_DELAYS_MS.length): Promise<void> {
  try {
    const url = env.NOVADA_HQ_LOG_URL?.trim();
    if (!url) return; // absent/empty → no push, no error (dark-deploy safe)

    const payload = buildHqPayload(row, eventTsMs);
    if (!payload) return; // not a tool_call row, or no hq_identity — nothing to push

    let outcome: PostOutcome = { ok: false, permanent: false };
    // Inline caller uses the full retry ladder (default). The reconciler passes
    // maxAttempts=1 — a single POST per run — because the every-60s cron IS its retry
    // loop, so a persistent failure must not burn ~23s of the serverless budget here.
    const totalAttempts = Math.max(1, Math.min(maxAttempts, 1 + HQ_RETRY_DELAYS_MS.length));
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      if (attempt > 0) await sleep(HQ_RETRY_DELAYS_MS[attempt - 1]);
      outcome = await postOnce(url, payload);
      if (outcome.ok || outcome.permanent) break;
    }

    // Terminal `dead` state (distinct from transient `failed`): a permanent
    // outcome (HQ code 10001 — OUR payload is malformed) will NEVER succeed on
    // retry, so it must NOT re-enter the reconciler's undelivered-backlog query
    // (push_status=in.(pending,failed) — see reconcile-core.ts). Writing it as
    // an ordinary `failed` row instead would make the every-60s cron retry the
    // same bad payload forever, burning its batch budget on rows that can never
    // deliver. `dead` is a signal to fix buildHqPayload()/the row shape, so its
    // first occurrence is logged loudly (not the fail-silent `console.warn`
    // used elsewhere in this file) — this is OUR bug, worth a human looking at.
    const status: "pushed" | "failed" | "dead" = outcome.ok ? "pushed" : (outcome.permanent ? "dead" : "failed");
    if (status === "dead") {
      console.error(JSON.stringify({
        evt: "hq_push_dead",
        request_id: row.request_id,
        tool: row.tool,
        msg: "HQ rejected this payload permanently (code 10001) — buildHqPayload()/row shape needs a fix; this row will never be retried.",
      }));
    }
    await updatePushStatus(row, env, status);
  } catch {
    // Absolute catch-all — pushToHq must never throw into its caller.
  }
}
