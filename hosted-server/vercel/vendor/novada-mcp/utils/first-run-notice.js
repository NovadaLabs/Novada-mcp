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
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
/**
 * The notice copy — verbatim, owner-approved (TOW2-242). $10 USD, novada.com ONLY
 * (never mcp.novada.com). Shown exactly once. Do not edit without owner approval.
 */
export const FIRST_RUN_NOTICE = "💡 First time using Novada MCP? Get your own API key + $10 free credits at https://novada.com — this notice shows only once.";
/**
 * Env kill switch: when this env var is set (non-empty), the notice is never
 * emitted, regardless of store state. Single-word flag = clean, greppable delete.
 */
const KILL_SWITCH_ENV = "NOVADA_DISABLE_FIRST_RUN_NOTICE";
// ─── Default store (stdio): flag file at ~/.novada-mcp/first-run.json ──────────
const FLAG_DIR = ".novada-mcp";
const FLAG_FILE = "first-run.json";
function flagPath() {
    return path.join(os.homedir(), FLAG_DIR, FLAG_FILE);
}
/**
 * Detect serverless runtime (Vercel). On serverless the filesystem is read-only
 * (EROFS scar) — never touch fs there. isVercel() gates the default store into a
 * permanent no-op that returns hasNoticed=true, so the stdio store is inert on
 * hosted even if it were ever constructed there.
 */
function isVercel() {
    return !!(process.env.VERCEL || process.env.VERCEL_ENV);
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
export class FileNoticeStore {
    async hasNoticed() {
        if (isVercel())
            return true;
        try {
            const raw = await fs.readFile(flagPath(), "utf8");
            // Parse to validate it's our flag; any content that reads back means "shown".
            JSON.parse(raw);
            return true;
        }
        catch (e) {
            // ENOENT → genuinely never shown → false (show it). Everything else → fail
            // quiet as "already noticed" so a broken/unreadable fs never spams.
            if (e?.code === "ENOENT")
                return false;
            return true;
        }
    }
    async markNoticed() {
        if (isVercel())
            return;
        try {
            const dir = path.dirname(flagPath());
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(flagPath(), JSON.stringify({ noticedAt: new Date().toISOString() }), "utf8");
        }
        catch {
            // Best-effort: if we can't persist the flag, we may show once more next
            // run, which is acceptable and far better than crashing a tool call.
        }
    }
}
/** Lazily-constructed default (stdio) store. */
let defaultStore;
function getDefaultStore() {
    if (!defaultStore)
        defaultStore = new FileNoticeStore();
    return defaultStore;
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
export async function maybeGetFirstRunNotice(store) {
    if (process.env[KILL_SWITCH_ENV])
        return null;
    try {
        const s = store ?? getDefaultStore();
        const seen = await s.hasNoticed();
        if (seen)
            return null;
        // Mark BEFORE returning so a downstream crash can't cause a double-show.
        await s.markNoticed();
        return FIRST_RUN_NOTICE;
    }
    catch {
        // Fail quiet: never let the notice path throw into a tool result.
        return null;
    }
}
//# sourceMappingURL=first-run-notice.js.map