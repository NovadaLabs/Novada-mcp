import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const _pkg = _require("../package.json");
export const VERSION = _pkg.version;
// Scraper API — platform scraper endpoint (POST /request with Bearer token auth).
// Only /request is live. Returns code 11006 when Scraper product is not activated on account.
export const SCRAPER_API_BASE = "https://scraper.novada.com";
// Scraper task result download — Tier-1 legacy endpoint, uses apikey query param, not Bearer token.
// GET /scraper_download?task_id=...&file_type=json&apikey=...
// Returns {"code":27202} when pending, or JSON array when complete.
//
// Tier-2 probe (2026-07-04): POST https://api-m.novada.com/v1/scraper/task_download
// with Authorization: Bearer returns {"code":401,"msg":"authentication failure:10000"} for
// BOTH multipart/form-data and x-www-form-urlencoded. Tier-2 requires OAuth, not the raw
// API key. Tier-1 (this constant) is the correct endpoint with the pass-through API key.
// Keep Tier-1 until Novada exposes an OAuth flow for the hosted MCP server.
export const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";
// Web Unblocker — JS-rendered pages, POST /request with Bearer token auth.
// Response: { code: 0, data: { code: 200, html: "...", use_balance: N } }
export const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";
/**
 * True on serverless hosts (Vercel / AWS Lambda) that cannot hold a persistent
 * WebSocket. The Browser API is CDP-over-WebSocket, so `render="browser"` can
 * never run there — callers use this to fail fast with a clear error and to keep
 * `render="auto"` from escalating into an impossible tier. (health.ts /
 * health_all.ts carry local copies; dedupe to this in a follow-up.)
 */
export function isHostedEnvironment() {
    return !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
}
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
export function toolCallDeadline(startMs = Date.now()) {
    return isHostedEnvironment() ? startMs + HOSTED_SAFE_CEILING_MS : Infinity;
}
// Optional: Browser API WebSocket endpoint (CDP)
// Format: wss://username:password@upg-scbr2.novada.com
export const BROWSER_WS_ENDPOINT = process.env.NOVADA_BROWSER_WS;
// Optional: Proxy credentials
export const PROXY_USER = process.env.NOVADA_PROXY_USER;
export const PROXY_PASS = process.env.NOVADA_PROXY_PASS;
export const PROXY_ENDPOINT = process.env.NOVADA_PROXY_ENDPOINT;
// JS-heavy detection: content shorter than this triggers render escalation
export const JS_DETECTION_THRESHOLD = 200;
// Hosted Vercel function wall-clock limit (see novada-mcpserver/vercel/api/mcp.ts
// `config.maxDuration`). When a tool's own time budget exceeds this, Vercel kills
// the function mid-flight and returns a BARE HTTP 504 that is NOT valid JSON-RPC,
// which breaks MCP clients (#5). Every long-running tool ceiling below MUST stay
// under this so the tool returns a structured result/error FIRST. The ~10s margin
// covers transport flush + serialization before the hard kill.
export const HOSTED_FUNCTION_LIMIT_MS = 60_000;
export const HOSTED_SAFE_CEILING_MS = 50_000; // tool budgets must stay <= this
// Timeout configuration (milliseconds)
// NOTE: long-running ceilings (RENDER, CRAWL_RENDER, TOTAL_REQUEST_CEILING,
// SEARCH_*) are capped at HOSTED_SAFE_CEILING_MS so the tool emits a structured
// JSON-RPC result before the hosted 504 kill (#5). Do not raise above 50s without
// also raising the Vercel function maxDuration.
export const TIMEOUTS = {
    STATIC_FETCH: 15000, // was 30000; halved to cut worst-case static time (3 retries = 45s max)
    PROXY_FETCH: 45000,
    RENDER: 48_000, // was 60000; under HOSTED_SAFE_CEILING_MS so render returns before the hosted 504
    BROWSER_CONNECT: 10000,
    BROWSER_PAGE: 30000,
    SITEMAP: 8000,
    CRAWL_STATIC: 15000,
    CRAWL_RENDER: 48_000, // was 60000; under HOSTED_SAFE_CEILING_MS (#5)
    TOTAL_REQUEST_CEILING: 50_000, // was 90000; hard per-URL ceiling in extractSingle via Promise.race — capped for hosted (#5)
    // scrape-transient-2026-10-21 (MEDIUM fix, round 1): per-attempt axios timeout for
    // the SHARED submit-retry policy (_core/submit-retry.ts's withSingleTransientRetry),
    // used by BOTH submitScrapeTask (scrape.ts) and submitSearchScrapeTask (search.ts)
    // on hosted. Previously declared but never wired to either submit call (both
    // hardcoded `timeout: 60000` instead) — see scrape-transient-review-2026-10-21.md
    // LOW finding.
    //
    // review2-2026-10-21 MEDIUM #1 follow-up: this is NO LONGER the flat per-attempt
    // cap on hosted — `submitRetryBudget()` now lets attempt 1 use the FULL remaining
    // submit budget (close to HOSTED_SAFE_CEILING_MS), so a slow-but-legitimate submit
    // on one of the ~9 unverified-latency catalog platforms (review2 §[MEDIUM] "class,
    // not instance") is no longer cut off at 25s before any evidence justified that
    // cap. This value is REPURPOSED as `minRetryAttemptMs`: the minimum budget that
    // must remain (after the inter-attempt delay) before a retry is even attempted.
    // Reused rather than inventing a new magic number — it is the SAME value the team
    // already calibrated (review2 §[MEDIUM], "comfortable margin" for every
    // confirmed-fast platform measured: google 1.4–16s, bing ~300ms, amazon/linkedin
    // near-instant) as "enough time for a submit attempt we trust to very likely
    // succeed" — requiring at least that much remaining budget before retrying keeps
    // the same trust bar the team already set, just applied to the RETRY DECISION
    // instead of capping every attempt (including the first, now-unbounded one).
    SEARCH_SUBMIT_TIMEOUT: 25_000, // was 30000; leaves headroom under the 50s total ceiling
    SEARCH_POLL_TIMEOUT: 45_000, // was 60000; under HOSTED_SAFE_CEILING_MS (#5)
    SEARCH_TOTAL_CEILING: 50_000, // was 90000; capped so search returns before the hosted 504 (#5)
    // scrape-transient-2026-10-21: local (stdio) has no serverless wall-clock kill, so
    // the submit-retry budget leaves the per-attempt timeout at the ORIGINAL value both
    // submit call sites hardcoded (`timeout: 60000`) before this fix — centralized here
    // instead of duplicated so local behavior is provably unchanged by the budget logic.
    SUBMIT_TIMEOUT_LOCAL: 60_000,
};
// Excel max sheet name length
export const EXCEL_MAX_SHEET_NAME = 31;
//# sourceMappingURL=config.js.map