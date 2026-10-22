export declare const VERSION: string;
export declare const SCRAPER_API_BASE = "https://scraper.novada.com";
export declare const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";
export declare const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";
/**
 * True on serverless hosts (Vercel / AWS Lambda) that cannot hold a persistent
 * WebSocket. The Browser API is CDP-over-WebSocket, so `render="browser"` can
 * never run there — callers use this to fail fast with a clear error and to keep
 * `render="auto"` from escalating into an impossible tier. (health.ts /
 * health_all.ts carry local copies; dedupe to this in a follow-up.)
 */
export declare function isHostedEnvironment(): boolean;
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
};
export declare const EXCEL_MAX_SHEET_NAME = 31;
//# sourceMappingURL=config.d.ts.map