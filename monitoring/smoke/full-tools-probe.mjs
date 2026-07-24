#!/usr/bin/env node
/**
 * monitoring/smoke/full-tools-probe.mjs
 *
 * Layer D of the synthetic monitor for the live Novada hosted MCP
 * (https://mcp.novada.com) — see monitoring/README.md. Unlike Layer B
 * (all-tools-smoke.mjs, cheap/free calls every 6h), this is the DAILY "test
 * every hosted tool for real" probe: one representative, safe, read-only (or
 * dry-run) call per tool, including every billable per-platform scraper.
 * Dependency-free Node >=20 script; run directly with `node`.
 *
 * A companion OFFLINE self-test lives at
 * monitoring/smoke/full-tools-probe.selftest.mjs — it imports this module's
 * exported pipeline (runAllProbes/classifyFailure/etc.), injects a stub
 * callTool/listTools (no network, no key needed), and asserts every canned
 * scenario classifies correctly. Run it after any change to this file:
 *   node monitoring/smoke/full-tools-probe.selftest.mjs
 *
 * Usage:
 *   NOVADA_TEST_KEY=<key> node monitoring/smoke/full-tools-probe.mjs
 *
 * Env vars:
 *   NOVADA_TEST_KEY  (required) test API key — NEVER hardcode, env only.
 *   MCP_URL          (optional) override the endpoint (see lib/mcp-client.mjs).
 *   SMOKE_SLOW_MS    (optional) threshold in ms above which a passing call is
 *                    classified "SLOW" instead of "PASS". Default 20000.
 *   SMOKE_DELAY_MS   (optional) delay between sequential probe calls, to stay
 *                    friendly to the rate limiter. Default 300.
 *   MONITOR_QUIET    (optional) "1" to suppress the per-tool table AND the
 *                    detailed `SUMMARY: {...}` line from stdout, printing only
 *                    a single non-revealing completion line instead (no tool
 *                    names, domains, backend names, or severity breakdown).
 *                    The full detail is UNAFFECTED in the JSON report file —
 *                    this only changes what a human/CI-log reader sees. This
 *                    repo's GitHub Actions logs are PUBLIC (world-readable),
 *                    so the CI workflow sets this to "1"; local/manual runs
 *                    leave it unset and get the full human-readable output.
 *
 * What it does:
 *   1. `tools/list` (live) -> single source of truth for the tool inventory.
 *      NEVER hardcodes the "does every tool exist" check against a fixed
 *      count — only cross-checks that every name in the embedded PROBES list
 *      below is present. A PROBE tool absent from the live list is a genuine
 *      regression on OUR surface (domain ①), not a backend problem, and is
 *      marked MISSING.
 *   2. STARTUP PREFLIGHT: before any network call, every PROBES entry is run
 *      through the same write-guard (assertExecutable) that will gate it at
 *      call time. A PROBES misconfiguration fails loudly at t=0, never after
 *      N live calls already happened (see preflightAssertAllProbesExecutable
 *      and the CRITICAL fix note on assertExecutable below).
 *   3. Executes ONE representative SAFE call per PROBE tool, sequentially,
 *      with `SMOKE_DELAY_MS` between calls (default 300ms). Any single
 *      network-level failure (httpStatus 0 — timeout OR a DNS/reset blip on
 *      the CI runner) gets ONE retry with a short backoff before being
 *      classified (see callToolWithNetworkRetry) — a transient runner hiccup
 *      must not misclassify as an ours-domain regression.
 *   4. `novada_proxy_account_create` is called WITHOUT `confirm` — this
 *      returns a dry-run confirmation preview (no write, no backend hit) and
 *      counts as a PASS. assertExecutable is ARGS-aware: it blocks this tool
 *      only when `confirm:true` is present, and blocks every other
 *      NEVER_EXECUTE_TOOL_NAMES member unconditionally by name. Every
 *      dispatch is wrapped in a try/catch so a write-guard throw classifies
 *      just THAT probe as an ours-domain error row instead of crashing the
 *      whole run (this exact ordering bug — guard-by-name-only, thrown
 *      outside any try/catch — previously FATAL-exited the run at probe #14
 *      and dropped all 16 scrapers; fixed 2026-07-24).
 *   5. Processing→poll disambiguation: a scraper response whose text shows
 *      `status: processing` and `records: 0` means the platform is just slow,
 *      not broken (see npm-package/src/tools/scrape.ts's `pending` outcome).
 *      This script extracts the `task_id="..."` and polls ONCE via the
 *      generic `novada_scrape({ platform, operation: <catalog id>, task_id })`
 *      with a 90s timeout. `records >= 1` on the poll → SLOW (works, just
 *      needed a poll). Still processing/0 → domain ③ backend (task never
 *      completed server-side) — UNLESS no task_id could be extracted at all,
 *      in which case this is OUR extraction/format assumption breaking, not
 *      a backend problem, so it classifies ①-mcp-code and skips polling
 *      entirely (fixed 2026-07-24 — previously silently misrouted to ③).
 *   6. Classifies every result into a fault DOMAIN (①-mcp-code / ②-gateway /
 *      ③-backend / "-" pass) and a SEVERITY (P0/P1/P2/P3/none) — see the
 *      classifyFailure() doc comment below for the exact rubric, and
 *      monitoring/README.md for the human-readable table. A genuine
 *      INVALID_API_KEY auth error (the test key itself misconfigured/
 *      unprovisioned for scraper products) classifies ②-gateway/config, not
 *      ①-mcp-code — it is not a logic bug in this repo (fixed 2026-07-24).
 *   7. Prints an aligned human table + a SUMMARY line, and writes a dated JSON
 *      report to monitoring/reports/full-<UTC timestamp>.json (gitignored,
 *      artifact-only — see the repo root .gitignore's `reports/` rule). The
 *      summary carries both `maxSeverity` (across all domains) and
 *      `maxOursSeverity` (①/② rows only) so a backend-only event never reads
 *      as "we got paged" — render-report.py's 汇总 sheet headlines the latter.
 *   8. Exit code: non-zero (1) ONLY when the run found an OURS-domain (①/②)
 *      finding at severity P0 or P1, OR a PROBE tool went MISSING from the
 *      live tool list. Backend-only (③) findings — including a full-blown
 *      "≥4 backend platforms down at once" systemic event — always exit 0:
 *      they are reported for visibility, never used to page us, because we
 *      don't own the Novada Scraper API backend.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, listTools, MCP_URL, requireTestKey } from "../lib/mcp-client.mjs";
import { NEVER_EXECUTE_TOOL_NAMES, isBackendKnownFlaky } from "./tool-probes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONITORING_DIR = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(MONITORING_DIR, "reports");

const SLOW_MS = Number(process.env.SMOKE_SLOW_MS) > 0 ? Number(process.env.SMOKE_SLOW_MS) : 20000;
const CALL_DELAY_MS = Number(process.env.SMOKE_DELAY_MS) >= 0 ? Number(process.env.SMOKE_DELAY_MS) : 300;

// See the MONITOR_QUIET doc comment above. Read once at module load — this
// script is always a fresh `node` invocation, never long-running, so a
// module-level constant is equivalent to reading it inside main() but keeps
// every quiet-mode check below terse.
const QUIET = process.env.MONITOR_QUIET === "1";

// Short backoff before the ONE retry on a network-level failure (httpStatus
// === 0). Lives here, not in lib/mcp-client.mjs, so only this daily probe is
// affected — Layer B's all-tools-smoke.mjs is untouched. Overridable via
// runProbe/runAllProbes' deps so the offline self-test can use a tiny value.
const NETWORK_RETRY_BACKOFF_MS = 1000;

// Core tools whose failure alone can legitimately be called "endpoint-wide"
// (P0), per the brief's severity rubric — everything else that fails on our
// surface (①/②) is a single-tool P1 unless the "many tools affected"
// escalation below fires.
const CORE_TOOL_NAMES = new Set([
  "novada_search",
  "novada_extract",
  "novada_scrape",
  "novada_setup",
  "novada_discover",
  "novada_account",
]);

// Any single run where >= this many OURS-domain (①/②) tools fail at once, or
// this many DISTINCT backend platforms fail at once, is treated as a shared
// root cause rather than N independent coincidences — see classifyFailure's
// doc comment and applySeverityEscalations. This threshold is an explicit
// judgment call (not sourced from the brief, which only says "many"/
// "systemic"); documented here so a future reader can tune it deliberately.
const MANY_TOOLS_THRESHOLD = 4;

// ─── PROBES: one representative, safe, read-only (or dry-run) call per tool ─
// `platform`/`operation`/`catalogOpId` are report-only metadata (report
// columns 平台/目标, operation, 后端scraper_id) — "-" where the concept doesn't
// apply (meta/content/browser/proxy tools have no platform or scraper-catalog
// operation). `isScraper` gates the processing→poll disambiguation and the
// "known-flaky backend platform" classification; `resumePlatform` is the
// domain passed to the generic `novada_scrape` dispatcher when polling a
// slow task by task_id (per-platform tools don't take a `platform` arg, so
// polling always goes through the generic dispatcher, never the originating
// per-platform tool — see scrape.ts's resume path, which only cares about
// platform/operation/task_id).
//
// Every semantic operation key → catalog scraper_id pair below was resolved
// by reading the corresponding npm-package/src/tools/scrape_<platform>.ts's
// own `*_OPERATIONS` map (single source of truth) — never guessed:
//   google  : web_search              -> google_search
//   bing    : web_search              -> bing_search
//   duckduckgo: web_search            -> duckduckgo
//   yandex  : web_search              -> yandex
//   amazon  : products_by_keywords    -> amazon_product_keywords
//   walmart : product_by_keyword      -> walmart_product_keywords
//   shein   : product_by_id           -> shein_product_id
//   x       : profile_by_username     -> twitter_profile_username
//   tiktok  : profile_by_url          -> tiktok_profiles_url
//   instagram: profile_by_username    -> ins_profiles_username
//   facebook: profile_by_url          -> facebook_profile_profiles-url
//   youtube : video_by_id             -> youtube_product-videoid
//   linkedin: company_by_url          -> linkedin_company_information_url
//   github  : repository_by_url       -> github_repository_repo-url
//   perplexity: answer_by_search_term -> perplexity_answer_searchterm
const PROBES = Object.freeze([
  // ── meta / content / browser / proxy (free or cheap, read-only / dry-run) ──
  { name: "novada_setup", platform: "-", operation: "-", catalogOpId: "-", args: {}, timeoutMs: 30000, isScraper: false },
  { name: "novada_discover", platform: "-", operation: "-", catalogOpId: "-", args: {}, timeoutMs: 30000, isScraper: false },
  { name: "novada_account", platform: "-", operation: "-", catalogOpId: "-", args: { section: "balance" }, timeoutMs: 30000, isScraper: false },
  { name: "novada_search", platform: "-", operation: "-", catalogOpId: "-", args: { query: "anthropic", num: 1 }, timeoutMs: 45000, isScraper: false },
  { name: "novada_extract", platform: "https://example.com", operation: "-", catalogOpId: "-", args: { url: "https://example.com" }, timeoutMs: 45000, isScraper: false },
  { name: "novada_crawl", platform: "https://example.com", operation: "-", catalogOpId: "-", args: { url: "https://example.com", max_pages: 1 }, timeoutMs: 60000, isScraper: false },
  { name: "novada_map", platform: "https://example.com", operation: "-", catalogOpId: "-", args: { url: "https://example.com", limit: 5 }, timeoutMs: 45000, isScraper: false },
  { name: "novada_monitor", platform: "https://example.com", operation: "-", catalogOpId: "-", args: { url: "https://example.com" }, timeoutMs: 45000, isScraper: false },
  { name: "novada_ai_monitor", platform: "novada", operation: "-", catalogOpId: "-", args: { brand: "novada" }, timeoutMs: 60000, isScraper: false },
  { name: "novada_research", platform: "-", operation: "-", catalogOpId: "-", args: { query: "what is anthropic", depth: "quick" }, timeoutMs: 150000, isScraper: false },
  {
    name: "novada_browser",
    platform: "https://example.com",
    operation: "-",
    catalogOpId: "-",
    args: {
      actions: [
        { action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" },
        { action: "aria_snapshot" },
      ],
    },
    timeoutMs: 90000,
    isScraper: false,
  },
  { name: "novada_proxy", platform: "-", operation: "-", catalogOpId: "-", args: {}, timeoutMs: 30000, isScraper: false },
  { name: "novada_proxy_account_list", platform: "-", operation: "-", catalogOpId: "-", args: { product: "1" }, timeoutMs: 30000, isScraper: false },
  // NO `confirm` — this MUST stay a dry-run preview call. See assertExecutable
  // below: this specific (name, no-confirm) combination is the one carve-out
  // from NEVER_EXECUTE_TOOL_NAMES; `confirm:true` is still hard-blocked no
  // matter what.
  { name: "novada_proxy_account_create", platform: "-", operation: "-", catalogOpId: "-", args: { product: "1", account: "probe_ro", password: "placeholder1234" }, timeoutMs: 30000, isScraper: false },

  // ── generic scrape dispatch (takes the CATALOG scraper id directly) ──────
  {
    name: "novada_scrape",
    platform: "google.com",
    operation: "google_search",
    catalogOpId: "google_search",
    args: { platform: "google.com", operation: "google_search", params: { q: "anthropic", num: 1 }, limit: 1 },
    timeoutMs: 60000,
    isScraper: true,
    resumePlatform: "google.com",
  },

  // ── per-platform scrapers (semantic operation keys, resolved from source) ─
  { name: "novada_scrape_google", platform: "google.com", operation: "web_search", catalogOpId: "google_search", args: { operation: "web_search", params: { q: "anthropic claude", num: 1 }, limit: 1 }, timeoutMs: 60000, isScraper: true, resumePlatform: "google.com" },
  { name: "novada_scrape_bing", platform: "bing.com", operation: "web_search", catalogOpId: "bing_search", args: { operation: "web_search", params: { q: "anthropic claude" }, limit: 1 }, timeoutMs: 60000, isScraper: true, resumePlatform: "bing.com" },
  { name: "novada_scrape_duckduckgo", platform: "duckduckgo.com", operation: "web_search", catalogOpId: "duckduckgo", args: { operation: "web_search", params: { q: "anthropic claude" }, limit: 1 }, timeoutMs: 60000, isScraper: true, resumePlatform: "duckduckgo.com" },
  { name: "novada_scrape_yandex", platform: "yandex.com", operation: "web_search", catalogOpId: "yandex", args: { operation: "web_search", params: { q: "anthropic", yandex_domain: "yandex.com" }, limit: 1 }, timeoutMs: 60000, isScraper: true, resumePlatform: "yandex.com" },
  { name: "novada_scrape_amazon", platform: "amazon.com", operation: "products_by_keywords", catalogOpId: "amazon_product_keywords", args: { operation: "products_by_keywords", params: { keyword: "wireless earbuds" }, limit: 1 }, timeoutMs: 60000, isScraper: true, resumePlatform: "amazon.com" },
  { name: "novada_scrape_walmart", platform: "walmart.com", operation: "product_by_keyword", catalogOpId: "walmart_product_keywords", args: { operation: "product_by_keyword", params: { domain: "https://www.walmart.com/", keyword: "shoes" }, limit: 1 }, timeoutMs: 60000, isScraper: true, resumePlatform: "walmart.com" },
  { name: "novada_scrape_shein", platform: "shein.com", operation: "product_by_id", catalogOpId: "shein_product_id", args: { operation: "product_by_id", params: { ID: "Tween-Girls-Casual-Solid-Color-Criss-Cross-Racerback-Sports-Dress-Kids-p-423721658" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "shein.com" },
  { name: "novada_scrape_x", platform: "x.com", operation: "profile_by_username", catalogOpId: "twitter_profile_username", args: { operation: "profile_by_username", params: { user_name: "BillGates" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "x.com" },
  { name: "novada_scrape_tiktok", platform: "tiktok.com", operation: "profile_by_url", catalogOpId: "tiktok_profiles_url", args: { operation: "profile_by_url", params: { url: "https://www.tiktok.com/@tiktok" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "tiktok.com" },
  { name: "novada_scrape_instagram", platform: "instagram.com", operation: "profile_by_username", catalogOpId: "ins_profiles_username", args: { operation: "profile_by_username", params: { username: "instagram" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "instagram.com" },
  { name: "novada_scrape_facebook", platform: "facebook.com", operation: "profile_by_url", catalogOpId: "facebook_profile_profiles-url", args: { operation: "profile_by_url", params: { url: "https://www.facebook.com/facebook" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "facebook.com" },
  { name: "novada_scrape_youtube", platform: "youtube.com", operation: "video_by_id", catalogOpId: "youtube_product-videoid", args: { operation: "video_by_id", params: { video_id: "LCAY3PGHZyw" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "youtube.com" },
  { name: "novada_scrape_linkedin", platform: "linkedin.com", operation: "company_by_url", catalogOpId: "linkedin_company_information_url", args: { operation: "company_by_url", params: { url: "https://www.linkedin.com/company/microsoft" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "linkedin.com" },
  { name: "novada_scrape_github", platform: "github.com", operation: "repository_by_url", catalogOpId: "github_repository_repo-url", args: { operation: "repository_by_url", params: { url: "https://github.com/gin-gonic/gin" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "github.com" },
  { name: "novada_scrape_perplexity", platform: "perplexity.ai", operation: "answer_by_search_term", catalogOpId: "perplexity_answer_searchterm", args: { operation: "answer_by_search_term", params: { search_terms: "today's weather" } }, timeoutMs: 60000, isScraper: true, resumePlatform: "perplexity.ai" },
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sortable-as-string, filesystem-safe timestamp: 2026-07-24T02-17-00-123Z */
function isoForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Refuse (hard throw) to execute a write-tool — UNLESS it is
 * `novada_proxy_account_create` called WITHOUT `confirm:true`, which is a
 * verified no-op dry-run preview (see
 * npm-package/src/tools/proxy_account_create.ts:99 —
 * `if (params.confirm !== true) { return JSON.stringify({ status:
 * "confirmation_required", ... }) }`, no API call is made in that branch).
 * That tool name is deliberately ALSO listed in NEVER_EXECUTE_TOOL_NAMES
 * (correctly — a REAL confirm:true call must always be blocked); this
 * function is what reconciles "the tool name is on the never-execute list"
 * with "this specific PROBE call is a safe read-only preview", by
 * inspecting ARGS, not just the name.
 *
 * CRITICAL FIX (code review, 2026-07-24): the previous guard threw for ANY
 * novada_proxy_account_create call by name alone, including the safe
 * dry-run PROBE, and it threw OUTSIDE any try/catch at the call site — so
 * the run FATAL-exited at probe #14 with zero results for the remaining 16
 * scrapers. This is now args-aware, AND every call site wraps it in a
 * try/catch (see runProbe / preflightAssertAllProbesExecutable) so a throw
 * here never crashes more than the one probe that triggered it.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} [args]
 */
function assertExecutable(toolName, args = {}) {
  if (toolName === "novada_proxy_account_create") {
    if (args?.confirm === true) {
      throw new Error(`[full-tools-probe] REFUSING to execute "${toolName}" with confirm:true — this is a hard safety invariant.`);
    }
    return; // no confirm:true => verified no-op preview, safe to call
  }
  if (NEVER_EXECUTE_TOOL_NAMES.has(toolName)) {
    throw new Error(
      `[full-tools-probe] REFUSING to execute write-tool "${toolName}" — this is a hard safety invariant, not a bug in the probe list.`
    );
  }
}

/**
 * STARTUP PREFLIGHT (CRITICAL fix, code review 2026-07-24): validate every
 * PROBES entry against assertExecutable ONCE, before any network call. A
 * PROBES misconfiguration (e.g. a future edit adds a real write without
 * noticing the guard) must fail loudly at t=0 — never silently mid-run
 * after N live calls already happened. runProbe's own try/catch around
 * assertExecutable is a SEPARATE defense-in-depth layer for the case where
 * this preflight is somehow bypassed; it should be unreachable if this
 * preflight passes, since both call the same pure function on the same
 * static PROBES data.
 */
function preflightAssertAllProbesExecutable() {
  for (const probe of PROBES) {
    try {
      assertExecutable(probe.name, probe.args);
    } catch (err) {
      throw new Error(
        `[full-tools-probe] PREFLIGHT FAILED: probe "${probe.name}" would be refused by the write-guard at runtime ` +
          `(${err.message}). Fix the PROBES entry before running — this must fail at t=0, not after N live calls.`
      );
    }
  }
}

/** Normalize a callTool()/rpcRequest() error shape (string | {message} | JSON-RPC error) to plain text. */
function errorText(res) {
  const err = res?.error;
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Extract `records: N` from a scrape-family tool's rendered markdown/json header line. */
function extractRecordsCount(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/records:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Extract `task_id="..."` from the "still processing" message (scrape.ts's pending outcome). */
function extractTaskId(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/task_id="([^"]+)"/);
  return m ? m[1] : null;
}

/** True when a scrape-family response is the CLEAN "still processing" outcome
 *  (scrape.ts's `pending` branch: `status: processing` + `records: 0`, ok:true,
 *  never isError). Both markers are required — "records: 0" alone can also be
 *  a graceful empty-serp PASS ("status: ok"), which must NOT trigger a poll. */
function isProcessingText(text) {
  if (typeof text !== "string") return false;
  return /status:\s*processing/i.test(text) && /records:\s*0\b/i.test(text);
}

/**
 * Call a tool, retrying ONCE with a short backoff if the result is a
 * network-level failure (httpStatus === 0 — no HTTP response was ever
 * received). This covers BOTH a genuine client-abort timeout AND a
 * transient DNS/connection-reset blip on the CI runner — either way, one
 * retry before classifying is cheap insurance against a false ours-domain
 * page (MEDIUM fix, code review 2026-07-24). Lives HERE, not in
 * lib/mcp-client.mjs, so only this daily probe is affected — Layer B's
 * all-tools-smoke.mjs is untouched.
 *
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{timeoutMs?: number}} opts
 * @param {typeof callTool} callToolFn
 * @param {number} backoffMs
 */
async function callToolWithNetworkRetry(name, args, opts, callToolFn, backoffMs) {
  const attempt = async () => {
    try {
      return await callToolFn(name, args, opts);
    } catch (err) {
      return { ok: false, httpStatus: 0, timeMs: 0, text: null, error: String(err?.message || err) };
    }
  };

  const first = await attempt();
  if (first.httpStatus !== 0) return first;

  await sleep(backoffMs);
  return attempt();
}

// Real backend auth failure — the caller's NOVADA_TEST_KEY itself is bad or
// unprovisioned for the Scraper API, not a bug in our code. NovadaError's
// toAgentString() (npm-package/src/_core/errors.ts) always renders
// `Error [${code}]: ...` — matching the STABLE enum code name is far more
// robust than matching the human-readable message wording, which can change
// independently of the code. See npm-package/src/tools/scrape.ts:1246-1252's
// `makeNovadaError(NovadaErrorCode.INVALID_API_KEY, ...)` call site.
const INVALID_API_KEY_RE = /invalid_api_key/i;

// Patterns for errors that are OURS to fix (schema/validation/logic bugs in
// this repo's tool wrappers) — checked BEFORE the generic backend-signal
// pattern, since a validation error can otherwise superficially resemble one
// (e.g. mentions "activation" or a platform name).
//
// MEDIUM FIX (code review 2026-07-24): the bare "invalid or missing"
// alternative was removed — it also matched scrape.ts:1246's genuine backend
// 401 ("Invalid or missing NOVADA_API_KEY..."), mislabeling a real auth
// failure as ①-mcp-code. INVALID_API_KEY_RE above now owns that case
// explicitly, checked with higher priority in classifyFailure.
const OURS_VALIDATION_RE =
  /unknown operation|unknown platform|requires (all|one) of|requires .* in (params|addition)|missing required param|invalid_params|preflight:/i;

// Backend/upstream signal patterns — see the brief's ③-backend rubric:
// 维护中/520/API_DOWN/"Scraper API error (HTTP undefined)"/activation, or any
// generic "under maintenance"/"temporarily" retryable-envelope wording emitted
// by npm-package/src/_core/errors.js's makeNovadaError(API_DOWN, ...) call sites.
const BACKEND_SIGNAL_RE =
  /维护中|upstream|\b520\b|api_down|api down|\bactivation\b|scraper api error \(http undefined\)|scraper task failed|under maintenance|temporarily unavailable|task failed on the server side/i;

/**
 * Classify a FAILING probe result into {domain, severity, note}.
 *
 * Priority order (first match wins) — reordered 2026-07-24 per code review:
 *   1. INVALID_API_KEY signal -> ②-gateway/config (P0/P1). Checked FIRST and
 *      unconditionally: a broken test key would surface identically on every
 *      scraper platform regardless of that platform's flakiness, and it is
 *      unambiguously OUR test-infra to fix (rotate/provision the key), never
 *      the platform's fault.
 *   2. Known-flaky backend platform (TOW2-305) -> ③-backend, P3 — ALWAYS,
 *      including when the specific failure mode is a stuck/still-processing
 *      task after one poll (fixed 2026-07-24: previously the
 *      stillProcessingAfterPoll branch was checked first and always
 *      returned P2, even for a documented-chronic-flake platform).
 *   3. Scraper task still stuck after the one poll attempt (non-flaky
 *      platform) -> ③-backend, P2.
 *   4. Our own validation/logic error text (bad op id, missing required
 *      param, etc.) -> ①-mcp-code — this is OUR schema/preflight, not theirs.
 *   5. HTTP 5xx, or ANY network-level failure (httpStatus === 0, whether or
 *      not the message says "timeout" — after callToolWithNetworkRetry's one
 *      retry, a lingering httpStatus 0 means the client never reached the
 *      server) -> ②-gateway.
 *   6. Backend/upstream signal text -> ③-backend.
 *   7. Anything else unclassified -> ①-mcp-code (fail-safe toward "ours until
 *      proven otherwise" — we'd rather over-investigate a real backend blip
 *      once than silently blame the backend for something we broke).
 *
 * Severity for ①/② is P0 when the failing tool is a CORE_TOOL_NAMES member,
 * else P1 (single-tool). The "many tools affected" (-> P0) and "≥4 backend
 * platforms at once" (-> P1 systemic) escalations are applied afterward, over
 * the full result set — see applySeverityEscalations.
 *
 * @param {{name: string, isScraper: boolean}} probe
 * @param {{httpStatus: number, error: unknown}} res
 * @param {{stillProcessingAfterPoll?: boolean}} [opts]
 */
function classifyFailure(probe, res, { stillProcessingAfterPoll = false } = {}) {
  const msg = errorText(res);
  const httpStatus = res.httpStatus;
  const isCore = CORE_TOOL_NAMES.has(probe.name);
  const isFlaky = probe.isScraper && isBackendKnownFlaky(probe.name);

  if (INVALID_API_KEY_RE.test(msg)) {
    return {
      domain: "②-gateway",
      severity: isCore ? "P0" : "P1",
      note: "test key invalid/unprovisioned for scraper products (NovadaError INVALID_API_KEY) — not a code bug",
    };
  }

  if (isFlaky) {
    return {
      domain: "③-backend",
      severity: "P3",
      note: stillProcessingAfterPoll
        ? "scraper task still processing/unresolved after one poll on a known-flaky platform (TOW2-305) — chronic, not a fresh incident"
        : "known-flaky backend platform (TOW2-305)",
    };
  }

  if (stillProcessingAfterPoll) {
    return { domain: "③-backend", severity: "P2", note: "scraper task still processing/unresolved after one poll" };
  }

  if (OURS_VALIDATION_RE.test(msg)) {
    return { domain: "①-mcp-code", severity: isCore ? "P0" : "P1", note: "validation/logic error we own (bad op id / missing param)" };
  }

  if (httpStatus >= 500 || httpStatus === 0) {
    const isTimeout = /timeout/i.test(msg);
    return {
      domain: "②-gateway",
      severity: isCore ? "P0" : "P1",
      note: isTimeout
        ? "client-abort timeout, no backend error surfaced"
        : httpStatus === 0
          ? "client-side network failure (no HTTP response reached after one retry), no backend error surfaced"
          : `gateway/HTTP ${httpStatus}`,
    };
  }

  if (BACKEND_SIGNAL_RE.test(msg)) {
    return { domain: "③-backend", severity: "P2", note: "upstream/backend signal in error text" };
  }

  return { domain: "①-mcp-code", severity: isCore ? "P0" : "P1", note: "unclassified failure — investigate (defaulted to ours, not backend)" };
}

/** Short, human advice for the report's "给后端的建议" column. */
function adviceFor(row) {
  if (row.status === "MISSING") {
    return "Tool vanished from live tools/list — check hosted deploy/registry.ts wiring; this is our regression, not backend.";
  }
  if (row.domain === "-") return "-";
  if (row.domain === "③-backend") {
    if (row.severity === "P3") return "Known-flaky platform (TOW2-305) — no action; trend-watch only.";
    if (typeof row.note === "string" && row.note.includes("still processing")) {
      return "Backend task never completed after one poll — flag to Novada backend (灵匠) as a stuck/slow task, not an MCP bug.";
    }
    return "Backend/upstream signal — Novada Scraper API issue, not ours; expect auto-recovery, re-check next run.";
  }
  if (row.domain === "①-mcp-code") {
    if (typeof row.note === "string" && row.note.includes("task_id extraction failed")) {
      return `Ours — scrape.ts's "processing" wording likely diverged from extractTaskId()'s regex in this script; fix the extraction, not scrape.ts.`;
    }
    return `Ours — inspect npm-package/src/tools/ for "${row.name}" (schema/validation/dispatch bug).`;
  }
  if (row.domain === "②-gateway") {
    if (typeof row.note === "string" && row.note.includes("test key invalid/unprovisioned")) {
      return "Test key misconfigured/unprovisioned for scraper products — verify NOVADA_TEST_KEY, not a code bug.";
    }
    return "Ours — check hosted-server Vercel function health, timeout budget, and streaming behavior.";
  }
  return "-";
}

/**
 * Execute one probe (with the processing→poll disambiguation for scrapers,
 * and the network-retry wrapper for httpStatus-0 results). Never throws —
 * every failure mode (a thrown callTool, a network-level failure, an
 * isError result, a write-guard refusal) classifies into a row instead of
 * propagating.
 *
 * @param {typeof PROBES[number]} probe
 * @param {{callToolFn?: typeof callTool, delayMs?: number, networkRetryBackoffMs?: number}} [deps]
 *   Dependency injection point for the offline self-test
 *   (full-tools-probe.selftest.mjs) — defaults to the real live client.
 */
async function runProbe(
  probe,
  { callToolFn = callTool, delayMs = CALL_DELAY_MS, networkRetryBackoffMs = NETWORK_RETRY_BACKOFF_MS } = {}
) {
  const base = {
    name: probe.name,
    platform: probe.platform,
    operation: probe.operation,
    catalogOpId: probe.catalogOpId,
    input: JSON.stringify(probe.args),
  };

  // CRITICAL FIX (code review 2026-07-24): assertExecutable is now
  // args-aware (see its doc comment) AND wrapped here in a try/catch instead
  // of being left to throw uncaught. main()'s
  // preflightAssertAllProbesExecutable() already validates every PROBES
  // entry once, up front, before any network call — so this branch should
  // be unreachable in normal operation. It exists as defense-in-depth ONLY:
  // if it somehow fires anyway (a future refactor bug reintroduces a bad
  // probe after preflight), classify THIS ONE probe as an ours-domain error
  // and keep going — a single bad probe must never zero out the other 29
  // tools' results.
  try {
    assertExecutable(probe.name, probe.args);
  } catch (err) {
    return {
      ...base,
      status: "FAIL",
      domain: "①-mcp-code",
      severity: CORE_TOOL_NAMES.has(probe.name) ? "P0" : "P1",
      httpStatus: null,
      timeMs: null,
      records: null,
      taskId: null,
      error: String(err?.message || err),
      note: "probe refused by write-guard (should be unreachable — preflight should have caught this)",
    };
  }

  const res = await callToolWithNetworkRetry(probe.name, probe.args, { timeoutMs: probe.timeoutMs }, callToolFn, networkRetryBackoffMs);

  // Processing→poll disambiguation (scrape-family only, and only on the CLEAN
  // "still processing" outcome — never on a genuine isError failure).
  if (probe.isScraper && res.ok && isProcessingText(res.text)) {
    const taskId = extractTaskId(res.text);

    if (!taskId) {
      // HIGH FIX (code review 2026-07-24): the "processing" wording is OUR
      // OWN code's wording (npm-package/src/tools/scrape.ts's pending
      // outcome, scrape.ts:1309). If it matched but we couldn't pull a
      // task_id out of it, that's OUR extraction/format assumption
      // breaking — not a backend problem — so this must NOT silently read
      // as ③-backend. Classify directly as ours and skip polling entirely
      // (there is nothing valid to poll with).
      return {
        ...base,
        status: "FAIL",
        domain: "①-mcp-code",
        severity: CORE_TOOL_NAMES.has(probe.name) ? "P0" : "P1",
        httpStatus: res.httpStatus,
        timeMs: res.timeMs,
        records: 0,
        taskId: null,
        error:
          'response text matched the "processing" pattern (status: processing / records: 0) but no task_id="..." ' +
          "could be extracted — extractTaskId()'s regex or scrape.ts's wording likely diverged",
        note: "processing text matched, task_id extraction failed — ours, not backend",
      };
    }

    const pollArgs = { platform: probe.resumePlatform, operation: probe.catalogOpId, task_id: taskId };
    assertExecutable("novada_scrape", pollArgs);
    const pollRes = await callToolWithNetworkRetry("novada_scrape", pollArgs, { timeoutMs: 90000 }, callToolFn, networkRetryBackoffMs);
    if (delayMs > 0) await sleep(delayMs);

    const pollRecords = pollRes.ok ? extractRecordsCount(pollRes.text) : null;
    if (pollRes.ok && pollRecords !== null && pollRecords >= 1) {
      return {
        ...base,
        status: "SLOW",
        domain: "-",
        severity: null,
        httpStatus: res.httpStatus,
        timeMs: res.timeMs,
        records: pollRecords,
        taskId,
        error: null,
        note: `needed one poll (task_id="${taskId}") to resolve with ${pollRecords} record(s)`,
      };
    }

    const cls = classifyFailure(probe, res, { stillProcessingAfterPoll: true });
    return {
      ...base,
      status: "FAIL",
      domain: cls.domain,
      severity: cls.severity,
      httpStatus: res.httpStatus,
      timeMs: res.timeMs,
      records: 0,
      taskId,
      error: `task_id="${taskId}" still processing/unresolved after one poll (${cls.note}); poll error: ${errorText(pollRes) || "none"}`,
      note: cls.note,
    };
  }

  if (res.ok) {
    return {
      ...base,
      status: res.timeMs > SLOW_MS ? "SLOW" : "PASS",
      domain: "-",
      severity: null,
      httpStatus: res.httpStatus,
      timeMs: res.timeMs,
      records: extractRecordsCount(res.text),
      taskId: null,
      error: null,
      note: null,
    };
  }

  const cls = classifyFailure(probe, res, {});
  return {
    ...base,
    status: "FAIL",
    domain: cls.domain,
    severity: cls.severity,
    httpStatus: res.httpStatus,
    timeMs: res.timeMs,
    records: null,
    taskId: null,
    error: errorText(res) || "(no error message)",
    note: cls.note,
  };
}

/**
 * Run every probe in `probeList` sequentially. No file I/O, no
 * process.exit, no console output — main() owns all of that. Dependency-
 * injected (`callToolFn`/`listToolsFn`) so the offline self-test
 * (full-tools-probe.selftest.mjs) can exercise this exact pipeline against a
 * stub instead of the live network.
 *
 * @param {typeof PROBES} probeList
 * @param {{callToolFn?: typeof callTool, listToolsFn?: typeof listTools, delayMs?: number, networkRetryBackoffMs?: number}} [deps]
 */
async function runAllProbes(
  probeList,
  { callToolFn = callTool, listToolsFn = listTools, delayMs = CALL_DELAY_MS, networkRetryBackoffMs = NETWORK_RETRY_BACKOFF_MS } = {}
) {
  const liveTools = await listToolsFn();
  const liveNames = new Set(liveTools.map((t) => t.name));

  const results = [];
  for (const probe of probeList) {
    if (!liveNames.has(probe.name)) {
      // A PROBE tool missing from the live inventory is a regression on OUR
      // surface (deploy drift, accidental removal) — never a backend problem.
      results.push({
        name: probe.name,
        platform: probe.platform,
        operation: probe.operation,
        catalogOpId: probe.catalogOpId,
        input: JSON.stringify(probe.args),
        status: "MISSING",
        domain: "①-mcp-code",
        severity: CORE_TOOL_NAMES.has(probe.name) ? "P0" : "P1",
        httpStatus: null,
        timeMs: null,
        records: null,
        taskId: null,
        error: "tool present in this script's embedded PROBES list but absent from live tools/list",
        note: "missing-tool regression",
      });
      continue;
    }
    const row = await runProbe(probe, { callToolFn, delayMs, networkRetryBackoffMs });
    results.push(row);
    if (delayMs > 0) await sleep(delayMs);
  }

  return { liveTools, liveNames, results };
}

const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Post-processing escalations, applied over the FULL result set (mutates
 * rows in place, also returns them). Computes `advice` last, so its wording
 * always matches the FINAL (post-escalation) severity.
 */
function applySeverityEscalations(results) {
  const oursFailingRows = results.filter((r) => r.domain === "①-mcp-code" || r.domain === "②-gateway");
  if (oursFailingRows.length >= MANY_TOOLS_THRESHOLD) {
    for (const r of oursFailingRows) {
      r.severity = "P0";
      r.note = `${r.note ? r.note + " " : ""}[escalated: ${oursFailingRows.length} ours-domain (①/②) failures this run — likely shared root cause, affecting many tools]`;
    }
  }

  const backendFailingPlatforms = new Set(
    results.filter((r) => r.domain === "③-backend" && r.platform && r.platform !== "-").map((r) => r.platform)
  );
  if (backendFailingPlatforms.size >= MANY_TOOLS_THRESHOLD) {
    for (const r of results) {
      if (r.domain === "③-backend" && r.platform && r.platform !== "-") {
        r.severity = "P1";
        r.note = `${r.note ? r.note + " " : ""}[escalated: ${backendFailingPlatforms.size} distinct backend platforms failing at once — possible systemic Novada Scraper API outage]`;
      }
    }
  }

  for (const r of results) r.advice = adviceFor(r);
  return results;
}

/**
 * Build the run summary from a (post-escalation) results array.
 *
 * LOW FIX (code review 2026-07-24): `maxSeverity` mixes domains — a P0 among
 * ①/② and a P0 among ③ look identical there. `maxOursSeverity` is scoped to
 * OURS-domain (①/②) rows only, so a fully backend-only event can never
 * misread as "we got paged" — render-report.py's 汇总 sheet headlines this
 * field, not the mixed one.
 */
function buildSummary(results) {
  const missingTools = results.filter((r) => r.status === "MISSING").map((r) => r.name);

  const byStatus = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const bySeverity = results.reduce((acc, r) => {
    if (r.severity) acc[r.severity] = (acc[r.severity] || 0) + 1;
    return acc;
  }, {});
  const maxSeverity =
    Object.keys(bySeverity).length > 0
      ? Object.keys(bySeverity).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0]
      : null;

  const oursSeverities = results
    .filter((r) => (r.domain === "①-mcp-code" || r.domain === "②-gateway") && r.severity)
    .map((r) => r.severity);
  const maxOursSeverity =
    oursSeverities.length > 0 ? [...oursSeverities].sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] : null;

  return {
    maxSeverity,
    maxOursSeverity,
    byStatus,
    bySeverity,
    oursCount: results.filter((r) => r.domain === "①-mcp-code" || r.domain === "②-gateway").length,
    backendCount: results.filter((r) => r.domain === "③-backend").length,
    missingTools,
  };
}

/** Print an aligned, human-readable table: status, severity, domain, ms, tool. */
function printTable(rows) {
  const headers = ["status", "severity", "domain", "ms", "tool"];
  const cells = rows.map((r) => [
    r.status,
    r.severity ?? "-",
    r.domain,
    r.timeMs != null ? String(r.timeMs) : "-",
    r.name,
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)));
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of cells) console.log(fmt(row));
}

async function main() {
  preflightAssertAllProbesExecutable(); // fail loudly at t=0 on a bad PROBES entry
  requireTestKey(); // fail fast, before any network call, with a clear error

  // MCP_URL is gated too — defense-in-depth in case a future URL scheme
  // embeds a key (e.g. a `/:key/mcp` path form); QUIET must never leak
  // anything, even something that looks harmless today.
  if (!QUIET) {
    console.log(`[full-tools-probe] MCP_URL=${MCP_URL}`);
  }
  console.log(`[full-tools-probe] probing ${PROBES.length} tool(s) sequentially (delay ${CALL_DELAY_MS}ms)...\n`);

  const startedAt = new Date();
  const { liveTools, results } = await runAllProbes(PROBES, {
    callToolFn: callTool,
    listToolsFn: listTools,
    delayMs: CALL_DELAY_MS,
    networkRetryBackoffMs: NETWORK_RETRY_BACKOFF_MS,
  });
  console.log(`[full-tools-probe] live tools/list returned ${liveTools.length} tool(s)`);

  applySeverityEscalations(results);

  if (!QUIET) {
    console.log("");
    printTable(results);
  }

  const summary = buildSummary(results);
  const oursP0P1 = results.filter(
    (r) => (r.domain === "①-mcp-code" || r.domain === "②-gateway") && (r.severity === "P0" || r.severity === "P1")
  );

  if (!QUIET) {
    console.log("");
    console.log(`SUMMARY: ${JSON.stringify(summary)}`);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const finishedAt = new Date();
  const exitCode = summary.missingTools.length > 0 || oursP0P1.length > 0 ? 1 : 0;
  const reportPath = path.join(REPORTS_DIR, `full-${isoForFilename(finishedAt)}.json`);
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    mcpUrl: MCP_URL,
    liveToolCount: liveTools.length,
    // tier is always 1 here — unlike Layer B's budget-tiered probes, Layer D
    // runs exactly one representative call per tool every time; the field is
    // kept for report-schema parity with monitoring/smoke's tiered rows.
    results: results.map((r) => ({
      tier: 1,
      name: r.name,
      platform: r.platform,
      operation: r.operation,
      catalogOpId: r.catalogOpId,
      input: r.input,
      status: r.status,
      domain: r.domain,
      severity: r.severity,
      httpStatus: r.httpStatus,
      timeMs: r.timeMs,
      records: r.records,
      taskId: r.taskId,
      error: r.error,
      advice: r.advice,
    })),
    summary,
    exitCode,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[full-tools-probe] report written: ${reportPath}`);

  if (QUIET) {
    // The ONLY status line in quiet mode — deliberately non-revealing: a
    // probed count and an exit code, nothing that names a tool, domain,
    // backend, or severity. See the MONITOR_QUIET doc comment above.
    console.log(`[full-tools-probe] complete: ${results.length} probed, exit ${exitCode}`);
  } else if (exitCode !== 0) {
    console.error(
      `[full-tools-probe] OURS-DOMAIN REGRESSION (exit 1): missing=${JSON.stringify(summary.missingTools)} ` +
        `oursP0P1=${JSON.stringify(oursP0P1.map((r) => `${r.name}:${r.severity}`))}`
    );
  } else {
    console.log(
      `[full-tools-probe] OK (exit 0) — no ours-domain (①/②) P0/P1 finding and no missing tool. ` +
        `Backend-only (③) findings, if any, are reported above but never fail this run.`
    );
  }
  process.exit(exitCode);
}

// Only auto-run main() when this file is executed directly (`node
// full-tools-probe.mjs`), never when imported — the offline self-test
// (full-tools-probe.selftest.mjs) imports this module's exported pipeline
// pieces without triggering a live run (which would otherwise throw on a
// missing NOVADA_TEST_KEY or make real network calls).
const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    // Defensive last resort: this should be unreachable in practice (every
    // per-probe call/poll is already try/caught above), but if `requireTestKey`
    // or `listTools` itself throws (e.g. the endpoint is completely down), still
    // write a minimal report rather than silently vanishing from CI logs.
    //
    // MONITOR_QUIET applies here too (HIGH fix, code review 2026-07-24): an
    // un-try/caught `listTools()` failure (endpoint down) used to bypass
    // quiet mode entirely, printing a raw stack trace / HTTP status /
    // upstream error text straight to this repo's PUBLIC Actions log at
    // exactly the worst moment (an outage). In quiet mode this now prints
    // ONLY the same non-revealing completion line normal quiet-mode
    // completion uses — the full error still lands in the JSON report's
    // `summary.fatalError` field below, never on stdout/stderr.
    if (QUIET) {
      console.error(`[full-tools-probe] complete: 0 probed, exit 1`);
    } else {
      console.error(`[full-tools-probe] FATAL: ${err?.stack || err}`);
    }
    try {
      mkdirSync(REPORTS_DIR, { recursive: true });
      const finishedAt = new Date();
      const report = {
        startedAt: null,
        finishedAt: finishedAt.toISOString(),
        mcpUrl: MCP_URL,
        liveToolCount: 0,
        results: [],
        summary: {
          maxSeverity: "P0",
          maxOursSeverity: "P0",
          byStatus: {},
          bySeverity: { P0: 1 },
          oursCount: 0,
          backendCount: 0,
          missingTools: [],
          fatalError: String(err?.message || err),
        },
        exitCode: 1,
      };
      writeFileSync(path.join(REPORTS_DIR, `full-${isoForFilename(finishedAt)}.json`), JSON.stringify(report, null, 2));
    } catch {
      // best-effort only — never let the report writer mask the original fatal error
    }
    process.exit(1);
  });
}

export {
  PROBES,
  CORE_TOOL_NAMES,
  MANY_TOOLS_THRESHOLD,
  NETWORK_RETRY_BACKOFF_MS,
  SEVERITY_RANK,
  assertExecutable,
  preflightAssertAllProbesExecutable,
  errorText,
  extractRecordsCount,
  extractTaskId,
  isProcessingText,
  classifyFailure,
  adviceFor,
  runProbe,
  runAllProbes,
  applySeverityEscalations,
  buildSummary,
};
