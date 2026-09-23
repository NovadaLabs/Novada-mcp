// Aggregates per-product balances across all Novada flow products (4 flow-metered
// proxy products + capture) in parallel, plus a per-IP lifecycle summary for static ISP.
//
// static ISP is NOT a flow-metered product — it's billed per-IP
// (static_house/{open,list,export,renew} track which IPs you own + expiry), unlike
// the other 4 proxy products which are billed by traffic volume via *_flow/balance.
// Calling /v1/static_flow/balance 404s even for accounts with active static_house
// orders (confirmed via raw devApiPost smoke test), so it's handled separately below
// via static_house/list instead of the generic flow-balance fan-out.

import { z } from "zod";
import { devApiParallel, devApiPost } from "../_core/developer_api.js";
import { NovadaError } from "../_core/errors.js";
import { novadaCaptureLogs } from "./capture_logs.js";

// ─── Endpoint table ──────────────────────────────────────────────────────────
//
// THE product → flow-ledger table — the single source of truth for every
// callsite that needs "which ledger backs this product" (this file's balance
// fan-out AND the F11 credential preflight in tools/proxy_preflight.ts).
// CLASS-shaped on purpose: adding a new flow-metered product is a new ROW here
// (key + path + label + proxy flag) — never a new branch anywhere else.
//   label — human name used in refusal evidence ("Your Residential proxy plan…").
//   proxy — true when novada_proxy(type=key) issues credentials billed against
//           this ledger (capture is flow-metered but not a proxy product).
export const FLOW_BALANCE_ENDPOINTS = [
  { key: "residential", path: "/v1/residential_flow/balance",        label: "Residential", proxy: true },
  { key: "isp",         path: "/v1/isp_flow/balance",                label: "ISP",         proxy: true },
  { key: "mobile",      path: "/v1/mobile_flow/mobile_flow_balance", label: "Mobile",      proxy: true },
  { key: "datacenter",  path: "/v1/dc_flow/balance",                 label: "Datacenter",  proxy: true },
  { key: "capture",     path: "/v1/capture/get_balance",             label: "Capture",     proxy: false },
] as const;

const ALL_PRODUCT_KEYS = ["residential", "isp", "mobile", "datacenter", "static", "capture"] as const;

type ProductKey = typeof ALL_PRODUCT_KEYS[number];

// ─── Schema & Types ──────────────────────────────────────────────────────────

export const PlanBalanceAllParamsSchema = z
  .object({
    products: z
      .array(z.enum(ALL_PRODUCT_KEYS))
      .optional()
      .describe("Subset of products to query. Omit to query ALL 6 in parallel."),
  })
  .strict();

export type PlanBalanceAllParams = z.infer<typeof PlanBalanceAllParamsSchema>;

export function validatePlanBalanceAllParams(
  args: Record<string, unknown> | undefined,
): PlanBalanceAllParams {
  return PlanBalanceAllParamsSchema.parse(args ?? {});
}

// ─── Tool Implementation ─────────────────────────────────────────────────────

interface PerProductOk {
  status: "ok";
  balance: unknown;
  /** True when the product's expire_time is in the past (computed by us, not by server). */
  expired?: boolean;
  /** Human-readable expiry date (ISO YYYY-MM-DD) — derived from numeric expire_time. */
  expires_at_human?: string;
  /** True when the plan has zero remaining balance (shape-aware — see deriveBalanceEvidence). */
  exhausted?: boolean;
  /** Human-readable remaining balance ("3.5 GB", "12/100 req", "132.91 credits"). */
  balance_human?: string;
  /**
   * True when the capture ledger read 0 but a re-read stayed 0 AND recent
   * capture activity contradicts it — the 0 is a SUSPECT read (known
   * intermittent /v1/capture/get_balance glitch, live-verified 2026-09-22),
   * NOT verified exhaustion. Mutually exclusive with `exhausted` — the guard
   * (verifyCaptureZero) sets exactly one of the two. Consumers must never
   * render an unverified entry as exhausted/dead or push a top-up.
   */
  balance_unverified?: boolean;
}
interface PerProductError {
  status: "error";
  error: string;
  /** Set when this product is not provisioned for the account (HTTP 404). Lets the agent skip it instead of surfacing as a transient bug. */
  unavailable?: boolean;
}
type PerProductResult = PerProductOk | PerProductError;

/**
 * Server returns `expire_time` as a unix timestamp (seconds). Compute the
 * derived `expired` flag and a human-readable date so agents don't have to.
 */
function enrichBalance(raw: unknown): { expired?: boolean; expires_at_human?: string } {
  if (raw === null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const exp = obj.expire_time;
  if (typeof exp !== "number" || exp <= 0) return {};
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = exp < nowSec;
  const expires_at_human = new Date(exp * 1000).toISOString().slice(0, 10);
  return { expired, expires_at_human };
}

/**
 * Shape-aware "how much is left" derivation — the F11 evidence source. The
 * developer API returns three balance shapes (see account.ts's renderer for
 * the live-confirmed catalog):
 *   1. bare number                     — capture credits
 *   2. { total, used, ... }            — mobile request-count plans
 *   3. { balance: <bytes>, ... }       — residential/isp/datacenter bytes plans
 * `exhausted` means "zero remaining" — the ledger state that makes the gateway
 * accept auth and then refuse to route (HTTP 402, curl exit 56) while the
 * credentials themselves still look perfectly valid.
 */
export function deriveBalanceEvidence(raw: unknown): { exhausted?: boolean; balance_human?: string } {
  if (typeof raw === "number") {
    return { exhausted: raw <= 0, balance_human: `${raw.toFixed(2)} credits` };
  }
  if (raw === null || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  if (typeof b.total === "number" && typeof b.used === "number") {
    // total=0 means unprovisioned/fresh — not exhausted; only flag when total>0 && used>=total
    return { exhausted: b.total > 0 && b.used >= b.total, balance_human: `${b.used}/${b.total} req` };
  }
  if (typeof b.balance === "number") {
    const mb = b.balance / (1024 * 1024);
    const balance_human = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
    return { exhausted: b.balance <= 0, balance_human };
  }
  return {};
}

// ─── Capture zero-balance guard (2026-09-22) ─────────────────────────────────
//
// /v1/capture/get_balance INTERMITTENTLY returns a bare `data: 0` for a FUNDED
// account (live-verified: real balance ~68.76 credits while get_balance read 0
// in the same session in which a live scrape succeeded and billed correctly).
// Untreated, that 0 flows through deriveBalanceEvidence → {exhausted:true,
// "0.00 credits"} and every consumer of this chokepoint (novada_account
// plans/summary, novada_setup readiness + capture line) confidently tells a
// paying customer "Capture exhausted / top up". Root cause is the backend
// endpoint (out of scope here); this guard makes sure a suspect 0 never
// produces a confident "exhausted":
//   1. re-read get_balance ONCE after a short delay — a >0 re-read resolves a
//      transient 0 and is used directly.
//   2. still 0 → cross-signal: recent capture activity via novadaCaptureLogs
//      (the SAME endpoint/window account_summary's capture_recent_count uses).
//      Activity present contradicts the 0 → `balance_unverified:true`, never
//      `exhausted:true`.
//   3. reverse-safety: still 0 AND no recent activity → genuinely exhausted,
//      byte-identical to pre-guard behavior. Never tell a truly-empty account
//      it has money.
// The guard runs ONLY when the capture read is bare-number 0 (the live-
// verified glitch shape) — the normal >0 path makes zero extra calls.

/** Delay before the single get_balance re-read (transient-glitch settle time). */
const CAPTURE_ZERO_REREAD_DELAY_MS = 400;

/**
 * Lookback window for the "recent successful capture" cross-signal. Kept as a
 * local const (mirrors account_summary.ts's CAPTURE_LOOKBACK_DAYS) rather than a
 * shared export: several existing test files fully module-mock this module and
 * capture_logs.js WITHOUT importOriginal, so a shared exported const would read
 * as `undefined` under those mocks → NaN dates. Keep the two values in sync.
 */
const CAPTURE_ACTIVITY_LOOKBACK_DAYS = 7;

/** YYYY-MM-DD for `daysAgo` days before now (UTC) — same shape account_summary uses. */
function isoDateDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The live-verified glitch shape: capture credits arrive as a bare number, and the glitch reads exactly 0. */
function isSuspectCaptureZero(raw: unknown): boolean {
  return typeof raw === "number" && raw === 0;
}

type CaptureZeroVerdict =
  | { kind: "recovered"; balance: number } // re-read returned a positive balance — transient 0 resolved
  | { kind: "contradicted" }               // still 0, but recent activity contradicts it — UNVERIFIED
  | { kind: "confirmed" };                 // still 0 and nothing contradicts it — genuinely exhausted

/**
 * Verify a suspect capture 0 (see the block comment above). Never throws:
 * every failure of the extra calls degrades toward "confirmed" (today's
 * behavior) — the guard can only SOFTEN a 0 when positive contrary evidence
 * exists, never invent funds.
 */
async function verifyCaptureZero(apiKey?: string): Promise<CaptureZeroVerdict> {
  const capturePath = FLOW_BALANCE_ENDPOINTS.find((e) => e.key === "capture")!.path;

  // 1. Single re-read after a short delay — resolves the purely transient case.
  try {
    await sleep(CAPTURE_ZERO_REREAD_DELAY_MS);
    const reread = await devApiPost<unknown>(capturePath, {}, { apiKey });
    if (typeof reread === "number" && reread > 0) {
      return { kind: "recovered", balance: reread };
    }
  } catch {
    // Re-read failed — it cannot exonerate the 0; fall through to the cross-signal.
  }

  // 2. Cross-signal: recent SUCCESSFUL capture activity (status:"success" only).
  // A *billed* capture proves funds existed; a failed/refused attempt proves
  // nothing, so it must NOT count as contrary evidence (else a genuinely drained
  // account that recently *tried* to scrape would read as "unverified" and its
  // top-up nudge would be wrongly suppressed). A funded account that
  // successfully scraped in the last 7 days directly contradicts a 0-credits read.
  try {
    const raw = await novadaCaptureLogs(
      {
        page: 1,
        page_size: 5,
        status: "success",
        start_time: isoDateDaysAgo(CAPTURE_ACTIVITY_LOOKBACK_DAYS),
        end_time: isoDateDaysAgo(0), // today
      },
      apiKey,
    );
    const parsed = JSON.parse(raw) as { data?: { list?: unknown[] | null } };
    const recentCount = Array.isArray(parsed?.data?.list) ? parsed.data.list.length : 0;
    if (recentCount > 0) return { kind: "contradicted" };
  } catch {
    // Activity check failed — nothing contradicts the 0; fall through to confirmed.
  }

  return { kind: "confirmed" };
}

/** Softened human line for an unverified capture 0 — explicitly NOT "exhausted". */
const CAPTURE_UNVERIFIED_HUMAN =
  "0.00 credits — UNVERIFIED (recent capture activity detected; likely a transient balance-read glitch — verify at dashboard.novada.com)";

/**
 * THE CLASS ("not provisioned") — SINGLE SOURCE OF TRUTH for every callsite
 * that needs to tell "this product isn't on the account" apart from a
 * genuine/transient error: HTTP 404 (message literal, existing) OR business
 * code 11009 (structural — live-captured 2026-08, confirmed for
 * residential/isp/datacenter: a flow-balance endpoint for a plan the account
 * lacks returns HTTP 200 with envelope `{code:11009, msg:"Failed to obtain
 * user information"}`). Used by BOTH the flow-loop classifier below AND
 * fetchStaticIpSummary's catch — one helper, so the two callsites can never
 * drift apart. Do NOT broaden beyond these two class members.
 */
function isNotProvisioned(code: number | undefined, msg: string): boolean {
  return code === 11009 || msg.includes("Product not provisioned") || msg.includes("HTTP 404");
}

/**
 * static ISP is billed per-IP (not by traffic volume) — summarize ownership
 * via static_house/list instead of a flow-balance call. Region breakdown is
 * best-effort: the list-item shape isn't documented beyond page/limit/total,
 * so we only aggregate a `region` field if the server actually includes one.
 */
async function fetchStaticIpSummary(apiKey?: string): Promise<PerProductResult> {
  try {
    const data = await devApiPost<{ list?: unknown[] | null; total?: number }>(
      "/v1/static_house/list",
      { page: 1, limit: 200 },
      { apiKey },
    );
    const list = Array.isArray(data.list) ? data.list : [];
    const region_breakdown: Record<string, number> = {};
    for (const item of list) {
      if (item !== null && typeof item === "object") {
        const region = (item as Record<string, unknown>).region;
        if (typeof region === "string" && region) {
          region_breakdown[region] = (region_breakdown[region] ?? 0) + 1;
        }
      }
    }
    const active_ip_count = typeof data.total === "number" ? data.total : list.length;
    return {
      status: "ok",
      balance: {
        billing_model: "per_ip_lifecycle",
        active_ip_count,
        region_breakdown,
        raw: data,
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const businessCode = err instanceof NovadaError ? err.businessCode : undefined;
    if (isNotProvisioned(businessCode, errMsg)) {
      return {
        status: "error",
        error: `No static ISP IPs provisioned (billed per-IP, not by traffic — see novada_static_ip_mgmt to open one). Underlying error: ${errMsg}`,
        unavailable: true,
      };
    }
    // NOT the not-provisioned class (e.g. transient 5xx, auth failure, network
    // error) — surface as a genuine error. Do NOT mislabel it "not
    // provisioned": that would hide a real outage/misconfiguration behind a
    // reassuring "known account state" signal.
    return {
      status: "error",
      error: errMsg,
    };
  }
}

/**
 * Query balance endpoints across all (or a chosen subset of) Novada flow
 * products in parallel, plus a per-IP lifecycle summary for static ISP. Never
 * hard-fails — partial errors are surfaced in `errors[]` while successful
 * per-product balances are returned alongside.
 */
export async function novadaPlanBalanceAll(
  params: PlanBalanceAllParams,
  apiKey?: string,
): Promise<string> {
  const wantStatic = !params.products?.length || params.products.includes("static");
  const requested = params.products?.length
    ? FLOW_BALANCE_ENDPOINTS.filter(e => params.products!.includes(e.key as ProductKey))
    : FLOW_BALANCE_ENDPOINTS;

  const selected = requested.map(e => ({ key: e.key, path: e.path, body: {} }));

  const [flowResults, staticResult] = await Promise.all([
    devApiParallel<unknown>(selected, { apiKey }),
    wantStatic ? fetchStaticIpSummary(apiKey) : null,
  ]);

  // ── Capture zero-balance guard (see verifyCaptureZero's block comment) ────
  // Gated to the bare-number-0 case only — a >0 read (or any non-capture
  // product) takes this branch never and makes zero extra calls.
  const captureRead = flowResults.find((r) => r.key === "capture");
  let captureBalanceUnverified = false;
  if (captureRead?.ok && isSuspectCaptureZero(captureRead.data)) {
    const verdict = await verifyCaptureZero(apiKey);
    if (verdict.kind === "recovered") {
      // Transient 0 resolved — use the good re-read exactly as if it had been
      // the first read; the loop below derives evidence from it normally.
      captureRead.data = verdict.balance;
    } else if (verdict.kind === "contradicted") {
      captureBalanceUnverified = true;
    }
    // "confirmed": leave the 0 as-is → deriveBalanceEvidence reports
    // exhausted:true, byte-identical to pre-guard behavior (reverse-safety).
    console.error(JSON.stringify({ evt: "capture_zero_guard", verdict: verdict.kind }));
  }

  const summary: Record<string, PerProductResult> = {};
  const errors: Array<{ product: string; error: string }> = [];
  const expired_products: string[] = [];
  const unavailable_products: string[] = [];
  const active_products: string[] = [];

  for (const r of flowResults) {
    if (r.ok) {
      const enriched = enrichBalance(r.data);
      if (r.key === "capture" && captureBalanceUnverified) {
        // Suspect 0 contradicted by recent activity: report the raw 0 honestly,
        // but with `balance_unverified` instead of `exhausted` and a softened
        // human line — a consumer must never render this as "exhausted/top up".
        summary[r.key] = {
          status: "ok",
          balance: r.data,
          ...enriched,
          balance_unverified: true,
          balance_human: CAPTURE_UNVERIFIED_HUMAN,
        };
      } else {
        summary[r.key] = { status: "ok", balance: r.data, ...enriched, ...deriveBalanceEvidence(r.data) };
      }
      if (enriched.expired) expired_products.push(r.key);
      else active_products.push(r.key);
    } else {
      const errMsg = r.error ?? "unknown error";
      const isUnavailable = isNotProvisioned(r.code, errMsg);
      summary[r.key] = { status: "error", error: errMsg, ...(isUnavailable ? { unavailable: true } : {}) };
      if (isUnavailable) {
        // Not-provisioned is known account state, not a transient failure —
        // it's already surfaced via `unavailable_products`/`per_product[key]
        // .unavailable`. Do NOT also push it into `errors[]`: a downstream
        // consumer (account.ts) would otherwise render BOTH "⛔ not
        // provisioned" (table, keyed off the structured flag) AND a generic
        // "service error" line (errors list) for the same product — two
        // contradictory signals for one piece of account state.
        unavailable_products.push(r.key);
      } else {
        errors.push({ product: r.key, error: errMsg });
      }
    }
  }

  if (staticResult) {
    summary.static = staticResult;
    if (staticResult.status === "ok") {
      active_products.push("static");
    } else if (staticResult.unavailable) {
      // Mirror the flow-loop: not-provisioned is known account state, already
      // signaled via `unavailable_products`/`per_product.static.unavailable` —
      // do NOT also push it into `errors[]` (see the flow-loop comment above
      // for why a double signal is contradictory downstream).
      unavailable_products.push("static");
    } else {
      errors.push({ product: "static", error: staticResult.error });
    }
  }

  const totalSelected = selected.length + (wantStatic ? 1 : 0);

  // Treat unavailable-products as not a "real" error for status-summarising
  // purposes — they're known account state, not transient failures. NOTE:
  // this filter is currently a no-op by construction — both loops above
  // deliberately never push an unavailable product into `errors[]` (see
  // their own comments) — but it's kept (rather than replaced with `errors`
  // directly) as a defensive invariant guard for `overall` below: if a
  // future edit ever did push an unavailable product into `errors[]`, this
  // line is what would keep it from corrupting the "all_failed"/"partial"
  // classification.
  const realErrors = errors.filter(e => !unavailable_products.includes(e.product));
  const overall =
    realErrors.length === 0
      ? "ok"
      : realErrors.length === totalSelected - unavailable_products.length
        ? "all_failed"
        : "partial";

  return JSON.stringify(
    {
      status: overall,
      summary: {
        active_products,
        expired_products,
        unavailable_products,
        all_plans_expired: active_products.length === 0 && expired_products.length > 0,
      },
      per_product: summary,
      errors: errors.length ? errors : undefined,
      agent_instruction:
        (expired_products.length > 0
          ? `Products ${expired_products.join(", ")} have EXPIRED plans (balance=0, expired=true). Master wallet currency still available — call novada_account(section="balance"). To restock, the user needs to purchase a new plan at https://dashboard.novada.com.`
          : "Per-product balances. Each balance includes derived expired/expires_at_human fields. For master wallet (currency) use novada_account(section=\"balance\").") +
        (captureBalanceUnverified
          ? " NOTE: the Capture balance endpoint read 0 twice, but recent capture activity contradicts it (known intermittent backend glitch) — do NOT report Capture as exhausted or push a top-up; tell the user to verify the real balance at https://dashboard.novada.com."
          : ""),
    },
    null,
    2,
  );
}
