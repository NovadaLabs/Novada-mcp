export declare const URL_PROXY_PLANS = "https://dashboard.novada.com/overview/products/";
/** Product keys (novada_proxy `type` values) that have a flow ledger to preflight. */
export declare const FLOW_LEDGER_PRODUCTS: ReadonlySet<string>;
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
 * Read the MATCHING product's ledger row via the SAME per-product lookup
 * novada_account(section="plans") uses (plan_balance_all — single source of
 * truth for expired/unavailable/exhausted derivation). Returns null for
 * products with no flow ledger (static/dedicated — per-IP, user-managed
 * credential lists; there is no plan row to consult). Never throws.
 *
 * @param billingApiKey the key the issued credentials BILL to (HIGH-1) —
 *   threaded into the ledger lookup so the ledger consulted is the billing
 *   account's, never the server env account's. Undefined only on legacy
 *   single-tenant paths where devApi's own env fallback IS the billing key.
 */
export declare function preflightFlowLedger(product: string, billingApiKey?: string): Promise<LedgerPreflight | null>;
/** How the issued credentials were obtained — mirrors resolveProxyCredentials(). */
export interface BillingCredContext {
    source: "direct" | "auto_fetched";
    /** The key auto-fetched creds bill to (absent for "direct"). Never printed. */
    billingApiKey?: string;
}
/**
 * Preflight `product`'s ledger — the BILLING account's ledger (HIGH-1) — and
 * FAIL CLOSED (throw a structured NovadaError carrying the full evidence:
 * which ledger, balance, expiry, top-up path) on a positive
 * expired/exhausted/not-provisioned signal. Returns the preflight (status
 * "active" or "unknown") otherwise, and null for products with no flow ledger
 * — callers use the return value to DISCLOSE ledger state in responses.
 *
 * Callers resolve credentials FIRST and pass the result here, because the
 * gate's very shape depends on how the creds were obtained:
 *   - source "auto_fetched": the ledger is read WITH `billingApiKey` (the key
 *     the creds bill to). Fail-closed applies.
 *   - source "direct" (env/SDK user+pass): the billing account is unknowable —
 *     NO ledger is consulted, status "unknown" is returned and the caller
 *     discloses "ledger unknown for the billing account". Judging a
 *     possibly-unrelated account's ledger caused both wrong-account denial and
 *     wrong-account evidence (review HIGH-1 / MEDIUM-5).
 *
 * @param creds how the credentials about to be issued were obtained.
 * @param toolHint how the refusal names the calling tool in agent_instruction,
 *   e.g. `novada_proxy(type="residential")` or `novada_proxy_residential`.
 */
export declare function assertFlowLedgerActive(product: string, creds: BillingCredContext, toolHint?: string): Promise<LedgerPreflight | null>;
//# sourceMappingURL=proxy_preflight.d.ts.map