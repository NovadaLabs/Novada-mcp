export type ToolAuthClass = "auth_free" | "unauth_basic_tier" | "key_required";
/**
 * Tools that never need any key: local/in-memory or pure catalog metadata.
 * (novada_setup/session_stats/search_feedback are also handled by index.ts's
 * pre-gate branches; they are listed here so the CLASS table is the single
 * complete truth, not "the table plus three special cases".)
 */
export declare const AUTH_FREE_TOOLS: ReadonlySet<string>;
/**
 * Tools whose BASIC path is a direct fetch that never exercises the API key —
 * the explicit unauthenticated tier (F12). Escalation params on these tools
 * (see ESCALATION_RENDER_MODES) still require a key.
 *
 * Currently only novada_extract, exactly as scoped by the 2026-09-10 brief.
 * Candidate rows pending owner decision (do NOT add silently): novada_map
 * (sitemap fetch), novada_monitor (extract-based diffing).
 */
export declare const UNAUTH_BASIC_TIER_TOOLS: ReadonlySet<string>;
/** Class lookup — everything not in the two tables above requires a key. */
export declare function toolAuthClass(name: string): ToolAuthClass;
/**
 * `render` values that request billed escalation (Web Unblocker render tier or
 * Browser CDP) on an unauth-tier tool. "js" is the documented alias extract
 * itself normalizes to "render" (extract.ts), so it is a member of the class,
 * not a separate branch.
 */
export declare const ESCALATION_RENDER_MODES: ReadonlySet<string>;
/** True when a call to an unauth-tier tool EXPLICITLY requests key-gated escalation. */
export declare function isEscalationRequest(name: string, args?: Record<string, unknown>): boolean;
export type KeyGateDecision = 
/** Dispatch normally. */
{
    kind: "allow";
}
/** Dispatch inside runUnauthenticatedTier() and append UNAUTH_TIER_DISCLOSURE. */
 | {
    kind: "allow_unauthenticated_tier";
}
/** Refuse: tool requires a key and none is set (Error [INVALID_API_KEY]). */
 | {
    kind: "refuse_missing_key";
}
/** Refuse: keyless caller explicitly requested key-gated escalation. */
 | {
    kind: "refuse_escalation_requires_key";
};
/**
 * The single keyless-vs-keyed decision, per tool class. Runs AFTER name
 * resolution and parameter validation (F13 ordering: resolve name → validate
 * params → key check → execute).
 */
export declare function decideKeyGate(name: string, opts: {
    hasApiKey: boolean;
    kr6Bypass: boolean;
    args?: Record<string, unknown>;
}): KeyGateDecision;
/**
 * True while the current async call tree runs a gate-admitted unauthenticated-
 * tier call. saveOutput() (utils/output.ts) consults this to skip every
 * ~/Downloads write for such calls (E2) — class-wide, no per-tool branches.
 */
export declare function isUnauthenticatedTierCall(): boolean;
/** Run `fn` with the unauthenticated-tier context set for its whole async tree. */
export declare function runUnauthenticatedTier<T>(fn: () => Promise<T>): Promise<T>;
/**
 * Appended as a separate content block to every successful unauth-tier
 * response (F12: the tier must be DISCLOSED, never a silent bypass).
 * Pinned by tests/_core/gate.test.ts — keep the four facts: tier name, what
 * still requires a key, the no-save rule, and the fix path.
 */
export declare const UNAUTH_TIER_DISCLOSURE: string;
//# sourceMappingURL=gate.d.ts.map