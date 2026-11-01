/**
 * Cap-exempt tool classification.
 *
 * HISTORY: this module used to implement the "paid-tier gateway cap exemption"
 * (PRD: hosted-server/docs/PRD-paid-tier-gateway-cap-2026-07-13.md) — a
 * per-token monthly free-call quota with a paid-account exemption. OWNER
 * DECISION (2026-10-29): the monthly free-call cap is REMOVED ENTIRELY. There
 * is no per-token quota, no plan resolution, no over-cap exemption, and no
 * balance lookup anymore — every call is billed to the caller's own Novada
 * account. See npm-package/CHANGELOG.md under [Unreleased].
 *
 * What survives: CAP_EXEMPT_TOOLS / ACCOUNT_TOOL_NAMES are still the single
 * source of truth for which tools are genuinely free (never cost the caller
 * anything upstream) — mcp.ts uses this set to pick the gateway status
 * footer's "no charge" variant vs its "billed" variant (see buildStatusFooter
 * in mcp.ts). Everything else that used to live here (enforceGatewayCap,
 * resolvePlan, shouldAllowOverCap, classifyPlanFromUsageRecord,
 * fetchAggregateBalance/parseBalanceValue, the approval-gate preview-charge
 * exemption, and the PLAN_TTL_PRO_S / PLAN_TTL_FREE_S / PLAN_STALE_RETENTION_S
 * / PREFETCH_THRESHOLD constants) existed only to decide whether to charge or
 * exempt a now-deleted quota counter — deleted with it. Deletion verified:
 * grepped every one of those symbols across the repo (excluding
 * vendor/node_modules) before removal — no other caller.
 */

// ─── Cap-exempt meta tools ────────────────────────────────────────────────────
// These never cost the caller anything upstream: a caller must always be able
// to discover tools, check its own setup, and self-diagnose its account state
// without being billed for it.

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
