export declare const VERSION: string;
export declare const SCRAPER_API_BASE = "https://scraper.novada.com";
export declare const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";
export declare const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";
/**
 * Round 5 (owner direction, 2026-11-18): ONE runtime-capability object,
 * replacing the scattered `isHostedEnvironment()`/`process.env.VERCEL`
 * checks that used to be re-derived independently at ~11 call sites across
 * the codebase (utils/output.ts, utils/first-run-notice.ts, tools/
 * site_copy.ts each had their OWN inline VERCEL check, inconsistently
 * including AWS_LAMBDA_FUNCTION_NAME or not — a silent-drift risk; utils/
 * browser.ts had two MORE copies that diverged the moment
 * DEPLOYMENT_SUPPORTS_WS was introduced, see the A/B verifier finding in
 * utils/runtime.ts's history). Every capability check in this codebase
 * should read a `RUNTIME` field directly instead of re-deriving its own
 * notion of "hosted."
 *
 * `kind` resolution order:
 *  1. `NOVADA_RUNTIME_KIND=hosted|local` — an explicit, HONEST self-
 *     declaration. This is how the EC2 entrypoint (hosted-server/vercel/
 *     server.mts) identifies itself as hosted WITHOUT forging Vercel's own
 *     env vars (the previous design set `VERCEL=1`/`VERCEL_ENV`/
 *     `VERCEL_REGION` before importing any handler — a masquerade, not a
 *     capability declaration).
 *  2. Falls back to real platform auto-detection (`VERCEL` / `VERCEL_ENV` /
 *     `AWS_LAMBDA_FUNCTION_NAME`) when `NOVADA_RUNTIME_KIND` is unset — this
 *     is what makes an ACTUAL Vercel/Lambda deployment "hosted" for free,
 *     with no entrypoint-side forcing needed at all.
 *  3. Otherwise "local" (the npm-package stdio server).
 *
 * `canHoldWebSocket` keeps the existing `DEPLOYMENT_SUPPORTS_WS=true` opt-in
 * override (EC2 is hosted but DOES hold a persistent CDP WebSocket, unlike
 * genuine serverless) as its own independent field — deliberately NOT folded
 * into `kind`, since "is this hosted" and "can this hold a WS" are different
 * questions with different answers on EC2.
 *
 * Fields are plain getters over ONE computation (`computeRuntime()`), not a
 * snapshot frozen at import time: in every real deployment (local stdio,
 * EC2, Vercel/Lambda) these env vars are fixed before the process starts and
 * never change mid-process, so this is observationally "set once at
 * startup" there — but reading live means the test suite can simulate a
 * different runtime by mutating `process.env` directly, without every test
 * needing `vi.resetModules()` + a fresh dynamic import. There is still
 * exactly ONE implementation of the resolution logic — never a second,
 * independently-derived copy.
 */
export type RuntimeKind = "local" | "hosted";
export interface Runtime {
    readonly kind: RuntimeKind;
    /** Can this process write to the local filesystem (~/Downloads, flag files)? False on serverless (read-only FS outside /tmp). */
    readonly canWriteFiles: boolean;
    /** Can this process hold a persistent CDP WebSocket for the Browser API (CDP) tier? */
    readonly canHoldWebSocket: boolean;
}
export declare const RUNTIME: Runtime;
/**
 * scrape-transient-review2-2026-10-21.md MEDIUM #2 (additive budgets): the
 * submit-phase budget (`submitRetryBudget()`, `_core/submit-retry.ts`) and a
 * tool's poll-phase ceiling used to each get their OWN fresh
 * `HOSTED_SAFE_CEILING_MS`-scale allotment, computed independently and
 * unaware of time already spent on the other phase — worst case additive,
 * up to ~`HOSTED_FUNCTION_LIMIT_MS` (the platform kill), i.e. the exact
 * bare-504 failure class the original MEDIUM exists to prevent.
 *
 * Fix: ONE absolute deadline for the WHOLE tool call (submit + retry + poll),
 * established exactly once — at tool entry (`novadaScrape`/`novadaSearch`) —
 * and threaded through both phases: `submitRetryBudget(deadline)` derives its
 * `totalMs` from whatever of this deadline remains when submit starts, and
 * each tool's poll call clamps its OWN ceiling to `min(ownCeiling, remaining)`
 * at the moment polling starts (see `syncPollCeilingMs()`/`pollForResult` in
 * scrape.ts and `pollSearchResult` in search.ts). Because poll always starts
 * AFTER submit returns, `submitElapsed + pollCeiling <= submitElapsed +
 * (deadline - submitEndNow) <= HOSTED_SAFE_CEILING_MS` by construction — the
 * whole call can never exceed the ceiling, regardless of how the time is
 * split between the two phases.
 *
 * On LOCAL (stdio), there is no serverless wall-clock kill, so the deadline
 * is `Infinity` — `Math.min(ownCeiling, Infinity - x) === ownCeiling` always,
 * i.e. every existing local ceiling (`POLL_TIMEOUT_MS`,
 * `TIMEOUTS.SEARCH_TOTAL_CEILING`, `TIMEOUTS.SUBMIT_TIMEOUT_LOCAL`) is
 * reproduced byte-for-byte — local behavior is structurally unaffected by
 * this helper, not just a coincidence of the numbers chosen.
 */
export declare function toolCallDeadline(startMs?: number): number;
export declare const BROWSER_WS_ENDPOINT: string | undefined;
export declare const PROXY_USER: string | undefined;
export declare const PROXY_PASS: string | undefined;
export declare const PROXY_ENDPOINT: string | undefined;
export declare const JS_DETECTION_THRESHOLD = 200;
export declare const HOSTED_FUNCTION_LIMIT_MS = 60000;
export declare const HOSTED_SAFE_CEILING_MS = 50000;
export declare const TIMEOUTS: {
    readonly STATIC_FETCH: 15000;
    readonly PROXY_FETCH: 45000;
    readonly RENDER: 48000;
    readonly BROWSER_CONNECT: 10000;
    readonly BROWSER_PAGE: 30000;
    readonly SITEMAP: 8000;
    readonly CRAWL_STATIC: 15000;
    readonly CRAWL_RENDER: 48000;
    readonly TOTAL_REQUEST_CEILING: 50000;
    readonly SEARCH_SUBMIT_TIMEOUT: 25000;
    readonly SEARCH_POLL_TIMEOUT: 45000;
    readonly SEARCH_TOTAL_CEILING: 50000;
    readonly SUBMIT_TIMEOUT_LOCAL: 60000;
    readonly GOOGLE_REDIRECT_RESOLVE: 2000;
};
export declare const EXCEL_MAX_SHEET_NAME = 31;
//# sourceMappingURL=config.d.ts.map