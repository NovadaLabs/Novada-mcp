/**
 * Paid-tier gateway cap exemption (P0) — plan resolution + cap gate.
 * PRD: hosted-server/docs/PRD-paid-tier-gateway-cap-2026-07-13.md (incl.
 * Amendment: lazy trigger at cap-crossing + balance OR-fallback;
 * Amendment 2: uid-keyed plan cache shared across an account's keys).
 *
 * Everything here is dependency-injected (KV + upstream fetch) so the whole
 * module is unit-testable with zero network — see test/paid-tier-cap.test.mjs.
 * mcp.ts wires the real deps (Vercel KV + devApiPost with the CALLER's key).
 *
 * Paid-user definition (canonical — do NOT re-derive elsewhere):
 *   paid := ∃ order where pay_status === 2 AND (pay_money - coupon_money) > 0
 *   (payment is an EVENT, not state — balance alone lies in both directions and
 *    is only ever used as the over-cap OR-fallback, never the primary signal.)
 *
 * Security invariant: NEVER log the API key or the full token hash — only the
 * first 8 hex chars of the tokenHash (see logPrefix below).
 */

import { kv } from "@vercel/kv";
import { devApiPost, withDateRangeCompat } from "../vendor/novada-mcp/_core/developer_api.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Freshness windows (PRD Layer 2). Asymmetry is deliberate:
 *   pro  = 30 days — payment is an event; once paid, always paid in practice.
 *   free = 6 hours — a user who tops up today gets exempted within hours.
 */
export const PLAN_TTL_PRO_S = 30 * 24 * 3600;
export const PLAN_TTL_FREE_S = 6 * 3600;

/**
 * Extra physical KV retention beyond the freshness window. The PRD requires
 * "upstream error + stale cache exists → use the stale value" — a plain
 * TTL-expired key is GONE and can never serve as a stale fallback, so the
 * freshness deadline is embedded in the VALUE ({plan, exp}) and the physical
 * KV TTL is freshness + this grace so the stale copy survives to be used.
 */
export const PLAN_STALE_RETENTION_S = 30 * 24 * 3600;

/**
 * Quota level (used count) past which the plan is pre-warmed asynchronously,
 * so the cap boundary (call #1001) usually hits a KV cache instead of paying
 * an upstream round-trip synchronously. PRD amendment: keys under the cap
 * incur ZERO plan lookups — this threshold is the only early trigger.
 */
export const PREFETCH_THRESHOLD = 900;

/** How long the tokenHash→uid pointer lives (Amendment 2). */
const UID_POINTER_TTL_S = 60 * 24 * 3600;

/** Upstream timeout for the usage-record probe — must not stall the cap boundary. */
const PLAN_RESOLVE_TIMEOUT_MS = 8_000;

// ─── Cap-exempt meta tools (PRD Layer 1) ─────────────────────────────────────
// These are never counted against quota and never blocked by the cap: a
// cap-exhausted key must always be able to discover tools, check its setup,
// and self-diagnose its account/billing state.

/**
 * novada_account + every alias name that routes to novadaAccount() in core.ts's
 * dispatch switch (0.9.9 fold). Single source of truth — mcp.ts imports this.
 */
export const ACCOUNT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "novada_account", "novada_wallet_balance", "novada_wallet_usage_record",
  "novada_traffic_daily", "novada_plan_balance_all", "novada_capture_logs",
  "novada_account_summary", "novada_health", "novada_health_all",
]);

export const CAP_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  "novada_setup",
  "novada_discover",
  ...ACCOUNT_TOOL_NAMES,
]);

// ─── Pure classification (no I/O — fully unit-testable) ─────────────────────

interface UsageRecordEntry {
  pay_status?: unknown;
  pay_money?: unknown;
  coupon_money?: unknown;
  uid?: unknown;
}

/**
 * Classify a plan from the `data` object of a /v1/wallet/usage_record response.
 * "pro" iff ≥1 entry has pay_status===2 AND real money spent (pay_money -
 * coupon_money > 0 — coupon-only orders like pay=14/coupon=14 stay free).
 * Any malformed / empty payload → "free". NEVER throws.
 */
export function classifyPlanFromUsageRecord(data: unknown): "free" | "pro" {
  try {
    if (!data || typeof data !== "object") return "free";
    const list = (data as { list?: unknown }).list;
    if (!Array.isArray(list)) return "free";
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as UsageRecordEntry;
      if (
        e.pay_status === 2 &&
        typeof e.pay_money === "number" &&
        typeof e.coupon_money === "number" &&
        e.pay_money - e.coupon_money > 0
      ) {
        return "pro";
      }
    }
    return "free";
  } catch {
    return "free"; // malformed payload must degrade, never throw
  }
}

/**
 * Extract the account uid from a usage_record payload (Amendment 2): top-level
 * `data.uid` or the first entry carrying one. Normalized to string; null when
 * absent/malformed (graceful degrade → tokenHash-only caching).
 */
export function extractUidFromUsageRecord(data: unknown): string | null {
  try {
    if (!data || typeof data !== "object") return null;
    const normalize = (v: unknown): string | null => {
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      if (typeof v === "string" && v.length > 0) return v;
      return null;
    };
    const top = normalize((data as { uid?: unknown }).uid);
    if (top !== null) return top;
    const list = (data as { list?: unknown }).list;
    if (!Array.isArray(list)) return null;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const uid = normalize((raw as UsageRecordEntry).uid);
      if (uid !== null) return uid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Over-cap allowance (PRD amendment): orders-derived plan is PRIMARY; positive
 * balance is the OR-fallback only (covers order-history lag for brand-new
 * payers; trial-credit overflow is bounded because every allowed call bills
 * that balance).
 */
export function shouldAllowOverCap(plan: "free" | "pro", balance: number | undefined): boolean {
  if (plan === "pro") return true;
  return typeof balance === "number" && balance > 0;
}

// ─── Plan resolution with KV cache ───────────────────────────────────────────

/** Injected dependencies — defaults wire Vercel KV + the developer-api client. */
export interface PlanDeps {
  kvGet: (key: string) => Promise<unknown>;
  kvSet: (key: string, value: unknown, opts: { ex: number }) => Promise<unknown>;
  /** Fetch the usage_record `data` object using the CALLER's key as Bearer. */
  fetchUsageRecord: (apiKey: string) => Promise<unknown>;
  now?: () => number;
}

/**
 * Default upstream probe. Deviation from the PRD's bare `{page:1, limit:50}`:
 * a WIDE explicit date range is sent because the server returns count>0 with
 * an EMPTY list when no date range is provided (INC-193, smoke-verified) and
 * the vendored wallet_usage_record's 30-day default would miss older real-money
 * orders — either failure mode silently misclassifies a paid user as free.
 */
async function defaultFetchUsageRecord(apiKey: string): Promise<unknown> {
  const end = new Date().toISOString().slice(0, 10);
  const body = withDateRangeCompat({ page: 1, limit: 50 }, { start: "2020-01-01", end });
  return devApiPost("/v1/wallet/usage_record", body, { apiKey, timeoutMs: PLAN_RESOLVE_TIMEOUT_MS });
}

const DEFAULT_DEPS: PlanDeps = {
  kvGet: (key) => kv.get(key),
  kvSet: (key, value, opts) => kv.set(key, value, opts),
  fetchUsageRecord: defaultFetchUsageRecord,
};

interface CachedPlan {
  plan: "free" | "pro";
  fresh: boolean;
}

/**
 * Parse a cached plan value — ONLY the canonical {plan, exp} object shape.
 * A bare "free"/"pro" string (e.g. hand-set via KV tooling) is REJECTED as a
 * cache miss: it carries no freshness deadline, so honoring it would make it
 * permanently fresh and permanently skip upstream re-resolution.
 */
function parseCachedPlan(raw: unknown, nowMs: number): CachedPlan | null {
  if (raw && typeof raw === "object") {
    const { plan, exp } = raw as { plan?: unknown; exp?: unknown };
    if ((plan === "free" || plan === "pro") && typeof exp === "number") {
      return { plan, fresh: nowMs < exp };
    }
  }
  return null;
}

/**
 * Resolve the caller's plan ("free" | "pro").
 *
 * Lookup order (all KV, no upstream): fresh `${tokenHash}:plan` → fresh
 * `uid:${uid}:plan` via the `${tokenHash}:uid` pointer (uid is only ever known
 * from a PRIOR resolution — never fetched separately). On miss: ONE upstream
 * usage_record call with the caller's own key, classified by the canonical
 * paid formula, then written under BOTH keys (Amendment 2) with the freshness
 * deadline embedded in the value and a longer physical TTL for stale fallback.
 *
 * Fail-safe contract: upstream error + stale cache → stale value; upstream
 * error + nothing cached → "free" (status quo). NEVER throws.
 */
export async function resolvePlan(
  apiKey: string,
  tokenHash: string,
  deps: PlanDeps = DEFAULT_DEPS,
): Promise<"free" | "pro"> {
  const nowMs = deps.now?.() ?? Date.now();
  const logPrefix = tokenHash.slice(0, 8); // safe to log — 8 hex chars, never the key
  const tokenKey = `${tokenHash}:plan`;
  let stale: "free" | "pro" | null = null;

  // 1. tokenHash-keyed cache
  try {
    const cached = parseCachedPlan(await deps.kvGet(tokenKey), nowMs);
    if (cached?.fresh) return cached.plan;
    if (cached) stale = cached.plan;
  } catch { /* KV read failure — fall through */ }

  // 2. uid-keyed shared cache (Amendment 2) — only when uid is already known
  try {
    const uidRaw = await deps.kvGet(`${tokenHash}:uid`);
    const uid = typeof uidRaw === "string" ? uidRaw : typeof uidRaw === "number" ? String(uidRaw) : null;
    if (uid) {
      const shared = parseCachedPlan(await deps.kvGet(`uid:${uid}:plan`), nowMs);
      if (shared?.fresh) return shared.plan;
      if (shared && stale === null) stale = shared.plan;
    }
  } catch { /* KV read failure — fall through */ }

  // 3. upstream resolution with the CALLER's key
  try {
    const data = await deps.fetchUsageRecord(apiKey);
    const plan = classifyPlanFromUsageRecord(data);
    const uid = extractUidFromUsageRecord(data);
    const freshS = plan === "pro" ? PLAN_TTL_PRO_S : PLAN_TTL_FREE_S;
    const value = { plan, exp: nowMs + freshS * 1000 };
    const ex = freshS + PLAN_STALE_RETENTION_S;
    try {
      await deps.kvSet(tokenKey, value, { ex });
      if (uid !== null) {
        await deps.kvSet(`uid:${uid}:plan`, value, { ex });
        await deps.kvSet(`${tokenHash}:uid`, uid, { ex: UID_POINTER_TTL_S });
      }
    } catch { /* best-effort cache write — never block the caller */ }
    console.log(JSON.stringify({ evt: "plan_resolution", tokenHashPrefix: logPrefix, plan, uidKeyed: uid !== null }));
    return plan;
  } catch (err) {
    console.error(JSON.stringify({
      evt: "plan_resolution_failed",
      tokenHashPrefix: logPrefix,
      stale,
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err),
    }));
    return stale ?? "free"; // degrade gracefully — status quo, never throw
  }
}

// ─── Gateway cap gate (wraps decrementQuota at the single call site) ─────────

export interface CapGateDeps {
  /** mcp.ts's decrementQuota bound to (tokenHash, env) — returns remaining or -1. */
  decrementQuota: (plan: "free" | "pro") => Promise<number>;
  /** resolvePlan bound to (apiKey, tokenHash). */
  resolvePlan: () => Promise<"free" | "pro">;
  /** One live POST /v1/wallet/balance with the caller's key — OR-fallback only. */
  fetchBalance: () => Promise<number>;
}

export interface CapGateResult {
  allowed: boolean;
  /** True iff one quota unit was actually consumed — gates the error-path refund. */
  charged: boolean;
  /** Quota remaining after this call; MAX_SAFE_INTEGER for exempt tools; -1 when rejected. */
  remaining: number;
  /** True when the call passed only via the pro/balance over-cap exemption. */
  overCapAllowed: boolean;
}

/**
 * Enforce the free gateway cap for one tool call (PRD Layers 1+2, amended).
 *
 *   exempt tool          → allow, zero KV/quota/plan activity
 *   under cap            → allow, one atomic incr — ZERO plan lookups
 *   used > 900           → allow + fire resolvePlan async (pre-warm, not awaited;
 *                          on a cache hit it costs one background KV read)
 *   over cap (incr = -1) → await resolvePlan; allow iff plan=="pro" OR balance>0
 *                          (ctx balance reused when present; else one live fetch);
 *                          allowed calls re-increment via the "pro" branch
 *                          (decrementQuota semantics unchanged — the exemption
 *                          wraps the rejection, not the counter)
 *
 * Never throws: every dep failure degrades to the status-quo free path.
 */
export async function enforceGatewayCap(opts: {
  toolName: string;
  monthlyQuota: number;
  ctxBalance?: number;
  deps: CapGateDeps;
}): Promise<CapGateResult> {
  const { toolName, monthlyQuota, ctxBalance, deps } = opts;

  // Layer 1: meta tools never counted, never blocked.
  if (CAP_EXEMPT_TOOLS.has(toolName)) {
    return { allowed: true, charged: false, remaining: Number.MAX_SAFE_INTEGER, overCapAllowed: false };
  }

  const remaining = await deps.decrementQuota("free");

  if (remaining >= 0) {
    const used = monthlyQuota - remaining;
    if (used > PREFETCH_THRESHOLD) {
      // Fire-and-forget pre-warm — resolvePlan is KV-cached, so repeat calls in
      // the 901..cap band cost one unawaited KV read each, zero latency added.
      try { void deps.resolvePlan().then(() => {}, () => {}); } catch { /* never block */ }
    }
    return { allowed: true, charged: true, remaining, overCapAllowed: false };
  }

  // Over cap — Layer 2 decision: orders-derived plan primary, balance OR-fallback.
  let plan: "free" | "pro" = "free";
  try { plan = await deps.resolvePlan(); } catch { plan = "free"; }

  let balance = ctxBalance;
  if (plan !== "pro" && balance === undefined) {
    try { balance = await deps.fetchBalance(); } catch { balance = 0; }
  }

  if (shouldAllowOverCap(plan, balance)) {
    let r = 0;
    // Re-increment on the "pro" branch (no cap check) — the earlier "free" incr
    // was rolled back inside decrementQuota when it crossed the cap.
    try { r = await deps.decrementQuota("pro"); } catch { r = 0; }
    return { allowed: true, charged: true, remaining: r, overCapAllowed: true };
  }

  return { allowed: false, charged: false, remaining: -1, overCapAllowed: false };
}
