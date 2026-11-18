import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const _pkg = _require("../package.json") as { version: string };
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
 * Round 5 (owner direction, 2026-11-18), refined Round 8 (A/B verifier,
 * 2026-11-18): ONE runtime-capability object, replacing the scattered
 * `isHostedEnvironment()`/`process.env.VERCEL` checks that used to be
 * re-derived independently at ~11 call sites across the codebase (utils/
 * output.ts, utils/first-run-notice.ts, tools/site_copy.ts each had their
 * OWN inline VERCEL check, inconsistently including AWS_LAMBDA_FUNCTION_NAME
 * or not — a silent-drift risk; utils/browser.ts had two MORE copies that
 * diverged once a round-5 opt-in flag (`DEPLOYMENT_SUPPORTS_WS`, since
 * removed) was introduced). Every capability check in this codebase should
 * read a `RUNTIME` field directly instead of re-deriving its own notion of
 * "hosted."
 *
 * Round 8: the round-5 design folded TWO different real deployments (EC2's
 * long-lived Node server and genuine Vercel/Lambda serverless) into one
 * "hosted" kind, then needed a SEPARATE opt-in env var
 * (`DEPLOYMENT_SUPPORTS_WS=true`) to tell them apart for the one capability
 * (persistent WebSocket) that actually differs between them — an extra flag,
 * plus a systemd-unit edit and a manual EC2 daemon-reload to set it. Fixed
 * by letting `kind` itself carry three distinct values, so the capability is
 * a property of WHICH kind this is, never a bolt-on flag:
 *  - "local"      — npm-package stdio server (user's own machine). Can hold
 *                    a WS, can write files.
 *  - "hosted"      — a long-lived Node process behind a reverse proxy (EC2's
 *                    server.mts). CAN hold a persistent CDP WebSocket (it is
 *                    not a fresh isolate per request); cannot write files
 *                    (shared multi-tenant disk).
 *  - "serverless"  — genuine per-request isolates (Vercel functions, AWS
 *                    Lambda), auto-detected. Cannot hold a WS; cannot write
 *                    files.
 *
 * `kind` resolution order:
 *  1. `NOVADA_RUNTIME_KIND=hosted|local|serverless` — an explicit, HONEST
 *     self-declaration. This is how the EC2 entrypoint (hosted-server/
 *     vercel/server.mts) identifies itself as "hosted" WITHOUT forging
 *     Vercel's own env vars (the pre-round-5 design set `VERCEL=1`/
 *     `VERCEL_ENV`/`VERCEL_REGION` before importing any handler — a
 *     masquerade, not a capability declaration) and WITHOUT a second opt-in
 *     flag for the one capability that differs from genuine serverless.
 *  2. Falls back to real platform auto-detection (`VERCEL` / `VERCEL_ENV` /
 *     `AWS_LAMBDA_FUNCTION_NAME`) → "serverless", when `NOVADA_RUNTIME_KIND`
 *     is unset — this is what makes an ACTUAL Vercel/Lambda deployment
 *     correctly report `canHoldWebSocket: false` for free, no declaration
 *     needed there either.
 *  3. Otherwise "local" (the npm-package stdio server).
 *
 * Fields are plain getters over ONE computation (`computeRuntimeKind()`),
 * not a snapshot frozen at import time: in every real deployment (local
 * stdio, EC2, Vercel/Lambda) these env vars are fixed before the process
 * starts and never change mid-process, so this is observationally "set once
 * at startup" there — but reading live means the test suite can simulate a
 * different runtime by mutating `process.env` directly, without every test
 * needing `vi.resetModules()` + a fresh dynamic import. There is still
 * exactly ONE implementation of the resolution logic — never a second,
 * independently-derived copy.
 */
export type RuntimeKind = "local" | "hosted" | "serverless";

export interface Runtime {
  readonly kind: RuntimeKind;
  /** Can this process write to the local filesystem (~/Downloads, flag files)? False on hosted/serverless (shared or read-only FS). */
  readonly canWriteFiles: boolean;
  /** Can this process hold a persistent CDP WebSocket for the Browser API (CDP) tier? False only on genuine serverless (per-request isolates). */
  readonly canHoldWebSocket: boolean;
}

function computeRuntimeKind(): RuntimeKind {
  const forced = process.env.NOVADA_RUNTIME_KIND;
  if (forced === "hosted" || forced === "local" || forced === "serverless") return forced;
  return process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? "serverless"
    : "local";
}

export const RUNTIME: Runtime = {
  get kind(): RuntimeKind {
    return computeRuntimeKind();
  },
  get canWriteFiles(): boolean {
    return computeRuntimeKind() === "local";
  },
  get canHoldWebSocket(): boolean {
    return computeRuntimeKind() !== "serverless";
  },
};

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
export function toolCallDeadline(startMs: number = Date.now()): number {
  // Round 8: both "hosted" (EC2) and "serverless" (Vercel/Lambda) get this
  // ceiling — it bounds per-request latency on the shared multi-tenant
  // endpoint by design, not merely as a serverless-specific defense (EC2 has
  // no platform-imposed wall-clock kill of its own, but the SLA-style bound
  // is intentional there too). Only "local" (the user's own stdio process)
  // is exempt.
  return RUNTIME.kind !== "local" ? startMs + HOSTED_SAFE_CEILING_MS : Infinity;
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
  STATIC_FETCH: 15000,       // was 30000; halved to cut worst-case static time (3 retries = 45s max)
  PROXY_FETCH: 45000,
  RENDER: 48_000,            // was 60000; under HOSTED_SAFE_CEILING_MS so render returns before the hosted 504
  BROWSER_CONNECT: 10000,
  BROWSER_PAGE: 30000,
  SITEMAP: 8000,
  CRAWL_STATIC: 15000,
  CRAWL_RENDER: 48_000,      // was 60000; under HOSTED_SAFE_CEILING_MS (#5)
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
  SEARCH_POLL_TIMEOUT: 45_000,   // was 60000; under HOSTED_SAFE_CEILING_MS (#5)
  SEARCH_TOTAL_CEILING: 50_000,  // was 90000; capped so search returns before the hosted 504 (#5)
  // scrape-transient-2026-10-21: local (stdio) has no serverless wall-clock kill, so
  // the submit-retry budget leaves the per-attempt timeout at the ORIGINAL value both
  // submit call sites hardcoded (`timeout: 60000`) before this fix — centralized here
  // instead of duplicated so local behavior is provably unchanged by the budget logic.
  SUBMIT_TIMEOUT_LOCAL: 60_000,
  // search-goto-links-2026-11-04: per-request timeout for resolving ONE Google
  // click-tracking redirect token (GET https://www.google.com/goto?url=...,
  // reading the 302 Location — see utils/google_redirect.ts). Live-verified
  // response time is 50-200ms; 2s leaves comfortable headroom for a slow hop
  // without letting one stuck request eat a meaningful slice of the tool's
  // overall deadline (resolution runs with bounded concurrency, see
  // MAX_ITEMS_TO_RESOLVE in that module).
  GOOGLE_REDIRECT_RESOLVE: 2_000,
} as const;

// Excel max sheet name length
export const EXCEL_MAX_SHEET_NAME = 31;
