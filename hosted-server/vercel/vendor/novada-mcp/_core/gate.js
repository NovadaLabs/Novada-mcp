/**
 * gate.ts — the F12/F13 key-gate decision layer for the stdio transport.
 *
 * WHY THIS EXISTS (Path C error matrix, 2026-09-10 audit, findings F12/F13/E2):
 *   - F13: the stdio auth gate used to answer BEFORE tool-name resolution, so a
 *     keyless caller of a NONEXISTENT tool got INVALID_API_KEY instead of an
 *     unknown-tool error. Name resolution now runs first (see index.ts); this
 *     module owns the key decision that runs after it.
 *   - F12: key handling was presence-only and undisclosed — a keyless caller of
 *     novada_extract was refused while an invalid-key caller got a live basic
 *     fetch. The gate now classifies tools by AUTH CLASS and treats extract's
 *     basic direct fetch as an EXPLICIT, DISCLOSED unauthenticated tier.
 *   - E2: unauth-tier calls must not write artifacts under ~/Downloads — the
 *     AsyncLocalStorage context here is read by utils/output.ts's saveOutput()
 *     chokepoint (class-wide: every auto-saving tool goes through it).
 *
 * DESIGN CONSTRAINTS:
 *   - Leaf module: imports NOTHING from core.ts or tools/* (utils/output.ts
 *     imports this file, and core.ts transitively imports utils/output.ts —
 *     any import back toward core.ts here would create a cycle).
 *   - Class-not-instance: tool→class membership is a TABLE. Extending coverage
 *     (e.g. deciding novada_map's sitemap fetch is also keyless-capable) is a
 *     new ROW in UNAUTH_BASIC_TIER_TOOLS, never a new branch.
 *   - The gate can only observe key PRESENCE locally. A present-but-invalid key
 *     is indistinguishable from a valid one without an upstream round-trip;
 *     billed/escalation paths are refused upstream with the same
 *     INVALID_API_KEY contract the local keyless refusal carries.
 *
 * PRODUCT-DIRECTION NOTE: the unauthenticated tier (keyless basic extract) is
 * an assumption implemented per the 2026-09-10 W2 brief — flagged for owner
 * override in reports/w2-auth-gate-2026-09-10.md. Reverting it is one row:
 * empty UNAUTH_BASIC_TIER_TOOLS and every keyless caller is refused as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Tools that never need any key: local/in-memory or pure catalog metadata.
 * (novada_setup/session_stats/search_feedback are also handled by index.ts's
 * pre-gate branches; they are listed here so the CLASS table is the single
 * complete truth, not "the table plus three special cases".)
 */
export const AUTH_FREE_TOOLS = new Set([
    "novada_setup",
    "novada_discover",
    "novada_session_stats",
    "novada_search_feedback",
]);
/**
 * Tools whose BASIC path is a direct fetch that never exercises the API key —
 * the explicit unauthenticated tier (F12). Escalation params on these tools
 * (see ESCALATION_RENDER_MODES) still require a key.
 *
 * Currently only novada_extract, exactly as scoped by the 2026-09-10 brief.
 * Candidate rows pending owner decision (do NOT add silently): novada_map
 * (sitemap fetch), novada_monitor (extract-based diffing).
 */
export const UNAUTH_BASIC_TIER_TOOLS = new Set([
    "novada_extract",
]);
/** Class lookup — everything not in the two tables above requires a key. */
export function toolAuthClass(name) {
    if (AUTH_FREE_TOOLS.has(name))
        return "auth_free";
    if (UNAUTH_BASIC_TIER_TOOLS.has(name))
        return "unauth_basic_tier";
    return "key_required";
}
// ─── Escalation detection ─────────────────────────────────────────────────────
/**
 * `render` values that request billed escalation (Web Unblocker render tier or
 * Browser CDP) on an unauth-tier tool. "js" is the documented alias extract
 * itself normalizes to "render" (extract.ts), so it is a member of the class,
 * not a separate branch.
 */
export const ESCALATION_RENDER_MODES = new Set(["render", "js", "browser"]);
/** True when a call to an unauth-tier tool EXPLICITLY requests key-gated escalation. */
export function isEscalationRequest(name, args) {
    if (toolAuthClass(name) !== "unauth_basic_tier")
        return false;
    const render = args?.["render"];
    return typeof render === "string" && ESCALATION_RENDER_MODES.has(render);
}
/**
 * The single keyless-vs-keyed decision, per tool class. Runs AFTER name
 * resolution and parameter validation (F13 ordering: resolve name → validate
 * params → key check → execute).
 */
export function decideKeyGate(name, opts) {
    if (opts.hasApiKey || opts.kr6Bypass)
        return { kind: "allow" };
    const cls = toolAuthClass(name);
    if (cls === "auth_free")
        return { kind: "allow" };
    if (cls === "unauth_basic_tier") {
        return isEscalationRequest(name, opts.args)
            ? { kind: "refuse_escalation_requires_key" }
            : { kind: "allow_unauthenticated_tier" };
    }
    return { kind: "refuse_missing_key" };
}
const gateContextStorage = new AsyncLocalStorage();
/**
 * True while the current async call tree runs a gate-admitted unauthenticated-
 * tier call. saveOutput() (utils/output.ts) consults this to skip every
 * ~/Downloads write for such calls (E2) — class-wide, no per-tool branches.
 */
export function isUnauthenticatedTierCall() {
    return gateContextStorage.getStore()?.unauthenticatedTier === true;
}
/** Run `fn` with the unauthenticated-tier context set for its whole async tree. */
export async function runUnauthenticatedTier(fn) {
    return gateContextStorage.run({ unauthenticatedTier: true }, fn);
}
// ─── Disclosure ───────────────────────────────────────────────────────────────
/**
 * Appended as a separate content block to every successful unauth-tier
 * response (F12: the tier must be DISCLOSED, never a silent bypass).
 * Pinned by tests/_core/gate.test.ts — keep the four facts: tier name, what
 * still requires a key, the no-save rule, and the fix path.
 */
export const UNAUTH_TIER_DISCLOSURE = "Notice [unauthenticated tier]: this basic direct fetch ran WITHOUT a valid NOVADA_API_KEY. " +
    "Render/unblocker escalation, browser mode, and billed tools require a valid key. " +
    "Output was NOT saved to disk. " +
    "Call novada_setup to configure a key and unlock the full tool set.";
//# sourceMappingURL=gate.js.map