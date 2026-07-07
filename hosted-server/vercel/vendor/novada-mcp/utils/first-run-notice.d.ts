/**
 * first-run-notice.ts — one-time onboarding notice for first-time Novada MCP users.
 *
 * TOW2-242. Reversibility is a hard requirement: ALL logic + copy lives in this
 * one module. Callers do ~2 lines of glue (call maybeGetFirstRunNotice(), and if
 * it returns a string, push it as a SEPARATE MCP text content block on a
 * SUCCESSFUL tool result). Deleting this file + those glue lines fully removes
 * the feature.
 *
 * Kill switch: set NOVADA_DISABLE_FIRST_RUN_NOTICE (any non-empty value) →
 * maybeGetFirstRunNotice() always returns null.
 *
 * Scope:
 *  - stdio (local npm): shown EXACTLY ONCE per install, tracked by a flag file
 *    at ~/.novada-mcp/first-run.json (default store below).
 *  - hosted (Vercel): tracked per-token in KV — that store is implemented in the
 *    hosted server (mcp.ts), NOT here (this module never touches KV or fs on
 *    serverless). See the VERCEL hard-guard in the default store.
 */
/**
 * The notice copy — verbatim, owner-approved (TOW2-242). $10 USD, novada.com ONLY
 * (never mcp.novada.com). Shown exactly once. Do not edit without owner approval.
 */
export declare const FIRST_RUN_NOTICE = "\uD83D\uDCA1 First time using Novada MCP? Get your own API key + $10 free credits at https://novada.com \u2014 this notice shows only once.";
/**
 * A store that records whether the one-time notice has already been shown.
 * hasNoticed() MUST fail-quiet: on ANY error it reports `true` (already noticed)
 * so a broken store can never cause the notice to spam on every call.
 */
export interface NoticeStore {
    hasNoticed(): Promise<boolean>;
    markNoticed(): Promise<void>;
}
/**
 * Filesystem-backed store for the local stdio server. EVERY fs op is wrapped in
 * try/catch and fails quiet:
 *  - hasNoticed(): flag file exists/parses → true; ENOENT (never shown) → false;
 *    ANY other error (permission, corrupt JSON, etc.) → true (never spam).
 *  - markNoticed(): best-effort mkdir -p + write; swallows all errors.
 *
 * HARD GUARD: on Vercel, both methods short-circuit — hasNoticed()→true (so the
 * notice is suppressed) and markNoticed()→no-op (no fs write). The hosted server
 * has its own KV store; this fs store must never run there.
 */
export declare class FileNoticeStore implements NoticeStore {
    hasNoticed(): Promise<boolean>;
    markNoticed(): Promise<void>;
}
/**
 * Returns the notice string on the FIRST call (per store), else null.
 *
 * Contract:
 *  1. Kill switch env set → always null (no store access at all).
 *  2. Resolve store = param ?? default (stdio file store).
 *  3. If store.hasNoticed() is false → markNoticed() FIRST, THEN return the
 *     notice. Mark-before-return means a crash between mark and use can only
 *     ever LOSE a notice (never double-show it).
 *  4. Any unexpected error → null (fail quiet — marketing must never break a
 *     tool call).
 *
 * @param store  Optional store override (hosted passes a KV-backed store).
 */
export declare function maybeGetFirstRunNotice(store?: NoticeStore): Promise<string | null>;
//# sourceMappingURL=first-run-notice.d.ts.map