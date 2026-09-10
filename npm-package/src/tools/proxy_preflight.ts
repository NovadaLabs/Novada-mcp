// ─── F11: flow-ledger preflight before issuing proxy credentials ──────────────
//
// CONFIRMED 2026-09-10 (F11): an owner key whose residential_flow ledger showed
// balance 0 (plan expired 2026-07-08) received clean-looking credentials from
// novada_proxy; the gateway then accepted the auth handshake but refused to
// route (HTTP 402) — visible to the user only as `curl` exit code 56 with zero
// explanation. The fix: BEFORE issuing credentials, preflight the MATCHING
// product's flow-plan ledger row (balance + expire_time) and refuse — with the
// full evidence — when the ledger positively says the plan cannot route.
//
// CLASS-shaped by construction: the set of gated products, their labels and
// their ledger endpoints all come from FLOW_BALANCE_ENDPOINTS (the ONE
// product → endpoint table, in plan_balance_all.ts). A new proxy product is a
// new ROW there — this module never grows a new branch for it.
//
// Failure semantics (deliberate, pinned by tests):
//   fail-CLOSED on a POSITIVE bad signal — expired / exhausted (balance 0) /
//     not provisioned ⇒ throw a structured NovadaError naming the ledger, the
//     balance, the expiry and the top-up path. Issuing credentials for such a
//     ledger is worse than refusing: they authenticate, then die at CONNECT
//     time with no clue.
//   fail-OPEN on an INDETERMINATE preflight — no dev-api key configured (e.g.
//     credentials supplied via env vars only), network error, timeout,
//     malformed response ⇒ status "unknown", credentials are still issued and
//     the caller (proxy.ts) DISCLOSES the unverified ledger in the response.
//     A diagnostics outage must never break a working credential formatter
//     (same G-11 precedent the original C-11 gate followed).

import { novadaPlanBalanceAll, FLOW_BALANCE_ENDPOINTS, deriveBalanceEvidence } from "./plan_balance_all.js";
import { NovadaError, NovadaErrorCode } from "../_core/errors.js";

export const URL_PROXY_PLANS = "https://dashboard.novada.com/overview/products/";

/** Rows of the shared table that gate credential issuing (proxy products only). */
const FLOW_LEDGER_ROWS = FLOW_BALANCE_ENDPOINTS.filter((r) => r.proxy);

/** Product keys (novada_proxy `type` values) that have a flow ledger to preflight. */
export const FLOW_LEDGER_PRODUCTS: ReadonlySet<string> = new Set(FLOW_LEDGER_ROWS.map((r) => r.key));

export type LedgerStatus = "active" | "exhausted" | "expired" | "unavailable" | "unknown";

export interface LedgerPreflight {
  /** Product key == novada_proxy `type` value (table `key`). */
  product: string;
  /** Human plan name for evidence text (table `label`). */
  label: string;
  /** WHICH ledger was consulted — the developer-api endpoint path (table `path`). */
  ledger: string;
  status: LedgerStatus;
  /** Remaining balance, human units ("3.5 GB", "12/100 req"). */
  balance_human?: string;
  /** Plan expiry (ISO YYYY-MM-DD), derived from the ledger's expire_time. */
  expires_at?: string;
  /** Why the status is what it is (raw error text for unavailable/unknown). */
  detail?: string;
}

/**
 * Cap how long the preflight may hold up an otherwise-instant credential call.
 * plan_balance_all's underlying devApiPost defaults to a 30s timeout — too slow
 * to gate on. A timeout degrades to "unknown" (fail-open), never fail-closed on
 * a slow network.
 */
const PREFLIGHT_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`ledger preflight timed out after ${ms}ms`)), ms);
      // Never keep the process alive just for this timer.
      (t as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
}

interface LedgerEntry {
  status?: string;
  error?: string;
  unavailable?: boolean;
  expired?: boolean;
  expires_at_human?: string;
  exhausted?: boolean;
  balance_human?: string;
  balance?: unknown;
}

/**
 * Read the MATCHING product's ledger row via the SAME per-product lookup
 * novada_account(section="plans") uses (plan_balance_all — single source of
 * truth for expired/unavailable/exhausted derivation). Returns null for
 * products with no flow ledger (static/dedicated — per-IP, user-managed
 * credential lists; there is no plan row to consult). Never throws.
 */
export async function preflightFlowLedger(product: string): Promise<LedgerPreflight | null> {
  const row = FLOW_LEDGER_ROWS.find((r) => r.key === product);
  if (!row) return null;
  const base = { product: row.key, label: row.label, ledger: row.path };
  try {
    const raw = await withTimeout(
      novadaPlanBalanceAll({ products: [row.key] } as never),
      PREFLIGHT_TIMEOUT_MS,
    );
    const parsed = JSON.parse(raw) as { per_product?: Record<string, LedgerEntry> };
    const entry = parsed?.per_product?.[row.key];
    if (!entry) return { ...base, status: "unknown", detail: "ledger response carried no entry for this product" };
    if (entry.status === "error") {
      if (entry.unavailable === true) return { ...base, status: "unavailable", detail: entry.error };
      // Transient/unclassified error — indeterminate, not a positive signal.
      return { ...base, status: "unknown", detail: entry.error ?? "ledger lookup error" };
    }
    // ok row — prefer the enriched fields; fall back to deriving from the raw
    // balance so older payload shapes still classify.
    const derived = deriveBalanceEvidence(entry.balance);
    const evidence = {
      ...base,
      balance_human: entry.balance_human ?? derived.balance_human,
      expires_at: entry.expires_at_human,
    };
    if (entry.expired === true) return { ...evidence, status: "expired" };
    if ((entry.exhausted ?? derived.exhausted) === true) return { ...evidence, status: "exhausted" };
    return { ...evidence, status: "active" };
  } catch (err) {
    return { ...base, status: "unknown", detail: err instanceof Error ? err.message : String(err) };
  }
}

const REFUSAL_REASON: Record<Exclude<LedgerStatus, "active" | "unknown">, string> = {
  expired: "EXPIRED",
  exhausted: "EXHAUSTED (balance 0)",
  unavailable: "not provisioned on this account",
};

/**
 * Preflight `product`'s ledger and FAIL CLOSED (throw a structured NovadaError
 * carrying the full evidence: which ledger, balance, expiry, top-up path) on a
 * positive expired/exhausted/not-provisioned signal. Returns the preflight
 * (status "active" or "unknown") otherwise, and null for products with no flow
 * ledger — callers use the return value to DISCLOSE ledger state in responses.
 *
 * @param toolHint how the refusal names the calling tool in agent_instruction,
 *   e.g. `novada_proxy(type="residential")` or `novada_proxy_residential`.
 */
export async function assertFlowLedgerActive(
  product: string,
  toolHint: string = `novada_proxy(type="${product}")`,
): Promise<LedgerPreflight | null> {
  const pf = await preflightFlowLedger(product);
  if (!pf) return null;
  if (pf.status === "expired" || pf.status === "exhausted" || pf.status === "unavailable") {
    const reason = REFUSAL_REASON[pf.status];
    const balance = pf.balance_human ?? "unknown";
    const expiry = pf.expires_at ?? "unknown";
    throw new NovadaError({
      code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
      message:
        `Your ${pf.label} proxy plan is ${reason} — Novada will not route traffic for it. ` +
        `Ledger evidence: balance ${balance}, expiry ${expiry}. Returning credentials would look valid ` +
        `but silently fail at connect time (the gateway accepts auth, then refuses with HTTP 402 — curl exit 56).`,
      agent_instruction:
        `Do NOT use ${toolHint} right now — the ${pf.label} flow ledger (${pf.ledger}) shows ` +
        `${reason.toLowerCase()}: balance ${balance}, expiry ${expiry}. Any credentials returned would ` +
        `authenticate and then fail at connect time with no further clue. Tell the user to renew/top up ` +
        `the ${pf.label} plan at ${URL_PROXY_PLANS}, then retry. To confirm plan status across ALL ` +
        `ledgers (Wallet + every product), call novada_account(section="plans").`,
      retryable: false,
      detail: `plan=${pf.label} product=${pf.product} ledger=${pf.ledger} status=${pf.status} balance=${balance} expiry=${expiry}`,
    });
  }
  return pf;
}
