/**
 * Novada MCP — Vercel Edge Function (Streamable HTTP transport)
 *
 * Ported from the Cloudflare Worker at ../worker/src/index.ts.
 * Runs on the Vercel Edge Runtime — same Web APIs as CF Workers
 * (fetch, Request, Response, crypto.subtle). KV is provided by
 * Vercel KV (Upstash Redis under the hood) via @vercel/kv.
 *
 * Auth (Tavily-style, both accepted):
 *   1. ?token=YOUR_NOVADA_API_KEY
 *   2. Authorization: Bearer YOUR_NOVADA_API_KEY
 *
 * Quota: per-token monthly KV counter at <token>:<YYYY-MM>. Decrement
 * before each tool call. 429 when exhausted.
 */

// 🔴 RUNTIME POLYFILLS — must be the VERY FIRST import (side-effect only).
// See ./_polyfills.js for why. ESM hoists imports but resolves them in source
// order; listing this first ensures DOMMatrix/ImageData/Path2D stubs are in
// place before pdfjs-dist (transitively imported via pdf-parse) runs its
// module-init code.
import "./_polyfills.js";

// ─── Error monitoring (Sentry) ────────────────────────────────────────────────
// Captures all unhandled errors + tool-call failures so we can see what's
// breaking for customers and improve. Set SENTRY_DSN in Vercel env vars.
// Free tier: 5,000 errors/month — enough for monitoring hosted MCP usage.
import * as Sentry from "@sentry/node";
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,  // errors only, no performance overhead
    environment: process.env.VERCEL_ENV ?? "development",
    // Serverless: flush events synchronously before Vercel kills the function.
    // Without this, buffered events are dropped when the instance terminates.
    beforeSend: (event) => event,
  });
}

/** Flush Sentry buffer — must be awaited before returning from a serverless handler. */
async function sentryFlush(): Promise<void> {
  if (process.env.SENTRY_DSN) {
    await Sentry.flush(2000).catch(() => { /* best-effort */ });
  }
}

// ─── Sentry alert gating (noise reduction) ────────────────────────────────────
// Every dispatch error is already handled:true (the catch returns a clean isError
// response). Firing captureException for ALL of them pages the owner for upstream
// weather (SERP flaked, scraper parse-fail) and user/input mistakes (bad op id,
// invalid params, bad customer key) — none of which are our bug.
//
// This allowlist holds the transient-upstream + user/input NovadaError codes: for
// those (and any ZodError) we record a forensic breadcrumb instead of an alert.
// Everything else still alerts: non-NovadaError (TypeError etc.) and NovadaError
// with code UNKNOWN — i.e. the buckets that may hide a real bug. Flip this set to
// empty to instantly restore the old alert-on-everything behavior.
const SENTRY_SUPPRESS_CODES: ReadonlySet<string> = new Set<string>([
  // Class A — transient upstream (retry usually works, not our bug)
  NovadaErrorCode.API_DOWN,
  NovadaErrorCode.URL_UNREACHABLE,
  NovadaErrorCode.TASK_PENDING,
  NovadaErrorCode.RATE_LIMITED,
  // Class B — user / input / customer config (agent's or caller's job to fix)
  NovadaErrorCode.INVALID_PARAMS,
  NovadaErrorCode.PRODUCT_UNAVAILABLE,
  NovadaErrorCode.INVALID_API_KEY,
  NovadaErrorCode.PROXY_AUTH_FAILURE,
]);

/**
 * Whether a handled dispatch error warrants a Sentry error-alert (vs a breadcrumb).
 * Returns false for handled transient/user errors (breadcrumb only); true for
 * everything that may be a real bug (non-NovadaError, or NovadaError UNKNOWN).
 */
function shouldAlertSentry(error: unknown): boolean {
  if (error instanceof ZodError) return false;             // user input — never alert
  if (error instanceof NovadaError) return !SENTRY_SUPPRESS_CODES.has(error.code);
  return true;                                             // unclassified → real bug → alert
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { kv } from "@vercel/kv";

// ─── Shared catalog + dispatch from vendored core (single source of truth) ────
// core.ts is side-effect-free: no server construction, no stdio boot, no process.exit.
// It exports HIDDEN_ALIASES (9 npm-alias names) and dispatch() which THROWS on error
// and returns a bare string — all hosted transport wrappers (quota, redaction,
// wall-clock, ALS) stay in this file. The hosted 15-tool TOOLS array (below) is a
// standalone curation, NOT derived from core's 33-tool TOOLS.
import {
  HIDDEN_ALIASES as NPM_HIDDEN_ALIASES,
  dispatch,
} from "../vendor/novada-mcp/core.js";

// ─── Hosted-only: schemas for the visible 15-tool TOOLS array defined below ──
// Only the schemas used by the hosted TOOLS curation — no tool function imports.
import {
  SearchParamsSchema,
  ExtractParamsSchema,
  CrawlParamsSchema,
  ResearchParamsSchema,
  MapParamsSchema,
  ProxyParamsSchema,
  ScrapeParamsSchema,
  BrowserParamsSchema,
  AiMonitorParamsSchema,
} from "../vendor/novada-mcp/tools/types.js";
import { MonitorParamsSchema } from "../vendor/novada-mcp/tools/monitor.js";
import {
  // Schemas for hosted TOOLS curation
  SetupParamsSchema,
  AccountParamsSchema,
  ProxyAccountListParamsSchema,
  ProxyAccountCreateParamsSchema,
  // novada_setup: auth-free pre-quota handler stays in mcp.ts (not routed via dispatch)
  novadaSetup,
  validateSetupParams,
  // novada_discover: hosted-specific override (scopes catalog to visibleToolNames)
  novadaDiscover,
  validateDiscoverParams,
  DiscoverParamsSchema,
} from "../vendor/novada-mcp/tools/index.js";
import vendorPkg from "../vendor/novada-mcp/package.json" with { type: "json" };
import { NovadaError, NovadaErrorCode } from "../vendor/novada-mcp/_core/errors.js";
// Real upstream key verification for validateToken — same wallet-balance probe
// novada_setup already uses to confirm "does this key actually work".
import { devApiPost } from "../vendor/novada-mcp/_core/developer_api.js";
// L3 unified-key: populate the request-scoped credential store with the caller's key so
// store-reading resolvers (getWebUnblockerKey → store.apiKey, resolveProxyCredentials,
// resolveBrowserWs) use the CALLER's key on hosted instead of falling back to server env.
import { withCredentials, resolveBrowserWs } from "../vendor/novada-mcp/utils/credentials.js";
// MCP prompts (tool-selection decision trees) — same module the npm server uses (1:1 parity). Static, safe on serverless.
import { listPrompts, getPrompt } from "../vendor/novada-mcp/prompts/index.js";

// Hosted server version = `<vendored npm version>.<server build tag>-hosted`.
//   • The npm-version part is DERIVED from the vendored package — NEVER hardcoded.
//     (A hardcoded "0.8.2-hosted" once silently drifted two releases behind the
//     vendored 0.8.4; deriving guarantees this part always tracks the shipped tools.)
//   • HOSTED_BUILD tags a server-ONLY deploy that ships no npm change — e.g. this
//     version-derive fix lives only in hosted-server/, so npm stays 0.8.4 while
//     the hosted build is "t1". Bump it per server-only deploy; reset to "t1" (or "")
//     whenever the vendored package version changes.
const HOSTED_BUILD = "";
const HOSTED_VERSION = HOSTED_BUILD
  ? `${vendorPkg.version}.${HOSTED_BUILD}-hosted`
  : `${vendorPkg.version}-hosted`;

// ─── Vercel Function runtime (Node.js serverless) ───────────────────────────
// NOTE: we use Node.js runtime (NOT Edge) because the underlying novada-mcp
// tool implementations depend on Node-only modules: axios, cheerio,
// playwright-core, exceljs, pdf-parse, and the MCP SDK uses EventEmitter.
// Trade-off vs Edge: ~200ms cold start (vs ~50ms) + single-region (vs global edge),
// but in exchange the entire 15-tool surface works without porting.
// TOW2-257 (partial): raised from 60 → 300 on Pro plan (team org).
// Pro Vercel allows up to 800s; 300s is a practical safe ceiling for MCP streaming.
// This gives novada_research (deep mode ~30-45s) and novada_scrape (slow platforms
// that used to exceed the 56s cap) much more headroom without the 45s internal poll
// ceiling ever being the bottleneck.
const FUNCTION_MAX_DURATION_S = 300;
export const config = {
  runtime: "nodejs",
  maxDuration: 300, // MUST be a literal — Vercel statically parses this `config` export and cannot resolve an identifier (keep in sync with FUNCTION_MAX_DURATION_S above)
};

// #5: per-tool wall-clock budget, set a few seconds UNDER maxDuration. If a tool
// somehow runs past this (a primitive that ignored its own ceiling, an upstream
// stall), we throw a structured NovadaError the catch turns into a JSON-RPC error
// envelope — the client NEVER sees the bare HTTP 504 Vercel emits on a hard kill,
// which is not valid JSON-RPC and breaks MCP clients. The tool-level config.ts
// ceilings (≤50s) are the primary guard; this is defense in depth.
const TOOL_WALL_CLOCK_MS = (FUNCTION_MAX_DURATION_S - 4) * 1000; // ~296s after TOW2-257 raise

// Scrape-specific cap: novada_scrape's internal POLL_TIMEOUT_MS (45s) + submit overhead
// normally completes well under the function wall-clock. This guard fires only if the
// upstream stalls past all tool-level ceilings. The message is scrape-aware: it mentions
// task_id resume so the caller does NOT lose the in-flight task and can resume for free.
const SCRAPE_TOOLS = new Set(["novada_scrape", "novada_scraper_submit"]);

/**
 * Race a tool promise against the wall-clock budget. On timeout, reject with a
 * structured NovadaError (TASK_PENDING — transient + retryable) so the call still
 * returns a JSON-RPC error envelope instead of being hard-killed into a bare 504.
 * For scrape tools: include task_id resume hint and no-recharge reminder.
 */
function withWallClock<T>(toolName: string, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const isScrape = SCRAPE_TOOLS.has(toolName);
      const agent_instruction = isScrape
        ? `The scrape task was still running when the hosted endpoint hit its wall-clock budget. ` +
          `If the tool returned a task_id before this error, re-call novada_scrape with that task_id ` +
          `(no new charge — it skips re-submit and goes straight to polling). ` +
          `If no task_id was returned, retry the call. ` +
          `For operations that reliably exceed the hosted cap, use the local MCP server ` +
          `(\`npx novada-mcp\`) which has no per-call wall-clock limit.`
        : `The hosted endpoint wall-clock budget (${TOOL_WALL_CLOCK_MS / 1000}s) was reached. ` +
          `Retry with a narrower request (fewer URLs, render="static", a smaller depth/limit), ` +
          `or run the local MCP server (\`npx novada-mcp\`) which has no per-call wall-clock cap.`;
      reject(new NovadaError({
        code: NovadaErrorCode.TASK_PENDING,
        message: `${toolName} exceeded the hosted ${TOOL_WALL_CLOCK_MS / 1000}s time budget and was stopped before the function timed out.`,
        agent_instruction,
        retryable: true,
      }));
    }, TOOL_WALL_CLOCK_MS);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// ─── Env shape (read from process.env on Vercel) ─────────────────────────────
// Required env vars:
//   KV_REST_API_URL           ← auto-injected when KV store is linked
//   KV_REST_API_TOKEN         ← auto-injected when KV store is linked
//   STUB_AUTH_WARNING_ACCEPTED ← "true" to unlock the worker (stub gate)
//   RATE_LIMIT_PER_MIN        ← per-IP rate limit (default 60)
//   FREE_PLAN_MONTHLY_QUOTA   ← per-token monthly quota (default 1000)
//   LOG_LEVEL                 ← "info" | "silent"
//   NOVADA_API_BASE           ← https://api.novada.com (informational)
interface Env {
  NOVADA_API_BASE: string;
  LOG_LEVEL: string;
  FREE_PLAN_MONTHLY_QUOTA: string;
  STUB_AUTH_WARNING_ACCEPTED?: string;
  RATE_LIMIT_PER_MIN?: string;
}

function readEnv(): Env {
  return {
    NOVADA_API_BASE: process.env.NOVADA_API_BASE || "https://api.novada.com",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    FREE_PLAN_MONTHLY_QUOTA: process.env.FREE_PLAN_MONTHLY_QUOTA || "1000",
    STUB_AUTH_WARNING_ACCEPTED: process.env.STUB_AUTH_WARNING_ACCEPTED,
    RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN,
  };
}

// ─── Server-key neutralization (TOW2-249) ────────────────────────────────────
// OWNER DECISION: on the hosted endpoint the customer pays for their OWN Novada
// consumption from their OWN key (the URL ?token= / Bearer). The server account
// must NEVER fund a caller's upstream calls.
//
// The vendored tool logic resolves upstream credentials through a chain that
// falls back to server env vars when the request-scoped caller key is absent:
//   • _core/developer_api.getDeveloperApiKey()  → NOVADA_DEVELOPER_API_KEY ?? NOVADA_API_KEY
//   • utils/credentials.getWebUnblockerKey()     → … ?? NOVADA_WEB_UNBLOCKER_KEY ?? NOVADA_API_KEY
//   • utils/credentials.resolveProxyCredentials()→ NOVADA_PROXY_* (env creds even take PRIORITY)
//   • utils/credentials.resolveBrowserWs()       → … ?? NOVADA_API_KEY  (does NOT read store.apiKey)
// A hosted dispatch that dropped the caller key (novada_browser / novada_proxy —
// core.dispatch calls them without the apiKey arg) would otherwise silently bill
// the SERVER account through one of these fallbacks.
//
// Rather than fork tool logic (it has one home — npm-package/src), we make the
// server-owned consumption creds physically unreachable IN THIS PROCESS: strip
// them from process.env once at module load so the ONLY key any resolver can find
// is the caller's, carried via the AsyncLocalStorage store (withCredentials) and
// the explicit dispatch arg. Idempotent (same server value every request) and
// serverless-isolate-safe. Ops/transport vars (KV_*, SENTRY_*, RATE_LIMIT_*,
// STUB_AUTH_*, FREE_PLAN_*) are untouched.
//
// NOVADA_BROWSER_WS is captured first so the error-path redactor keeps its
// exact-string scrub (the generic user:pass@host + *.novada.com rules still apply
// regardless). To re-introduce a deliberate server-funded free tier, do it via a
// NEW explicitly-named var — never by restoring these consumption fallbacks.
const SERVER_BROWSER_WS_SNAPSHOT = process.env.NOVADA_BROWSER_WS?.trim() || "";
const SERVER_CONSUMPTION_ENV_VARS = [
  "NOVADA_API_KEY",
  "NOVADA_DEVELOPER_API_KEY",
  "NOVADA_WEB_UNBLOCKER_KEY",
  "NOVADA_BROWSER_WS",
  "NOVADA_PROXY_USER",
  "NOVADA_PROXY_PASS",
  "NOVADA_PROXY_ENDPOINT",
  "NOVADA_RESIDENTIAL_PROXY_USER",
  "NOVADA_RESIDENTIAL_PROXY_PASS",
  "NOVADA_RESIDENTIAL_PROXY_ENDPOINT",
  // proxy_static.js / proxy_dedicated.js read these directly from process.env — each
  // holds IP:PORT:USER:PASS lines. Neither is set on hosted today (no live leak), but
  // an operator setting one later would silently reopen a server-funded + credential-
  // disclosure path, so strip them to honor "server consumption creds unreachable".
  "NOVADA_STATIC_PROXY_LIST",
  "NOVADA_DEDICATED_PROXY_LIST",
  "NOVADA_AUTH_USER",
  "NOVADA_AUTH_PASS",
] as const;

function stripServerConsumptionCreds(): void {
  for (const name of SERVER_CONSUMPTION_ENV_VARS) {
    if (name in process.env) delete process.env[name];
  }
}
// Run once at cold start — before any request resolves a tool credential.
stripServerConsumptionCreds();

// ─── Zod → MCP JSON Schema ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  const { $schema, $defs, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}

// ─── Tool catalog ────────────────────────────────────────────────────────────
const TOOLS = [
  { name: "novada_search",              title: "Web Search",                 schema: SearchParamsSchema,              description: "Search the web via Google, Bing, DuckDuckGo, or Yandex. Use when you need to find relevant pages but don't know the URL. Returns titles, URLs, and snippets. For full page content, follow up with extract." },
  { name: "novada_extract",             title: "Content Extractor",          schema: ExtractParamsSchema,             description: "Read clean content from one or more URLs. Use when you have a specific page URL and need its content. Handles anti-bot protection automatically. For raw HTML, use format='html'. For multiple pages on one site, use crawl instead." },
  { name: "novada_crawl",               title: "Site Crawler",               schema: CrawlParamsSchema,               description: "Read content from multiple pages on one site (up to 20). Use when you need an entire section of a website. Optionally run map first to discover target URLs." },
  { name: "novada_research",            title: "Deep Research",              schema: ResearchParamsSchema,            description: "Deep multi-source research: searches multiple angles, reads top sources, returns a synthesized report with citations. Use when you need comprehensive analysis of an open-ended topic (not a yes/no claim — use verify for that). Slower than a single search." },
  { name: "novada_map",                 title: "URL Mapper",                 schema: MapParamsSchema,                 description: "List all URLs on a website via sitemap or crawl. Use when you need to find the right page before crawl/extract. Returns URLs only, no content. Fast site reconnaissance." },
  { name: "novada_scrape",              title: "Platform Scraper",           schema: ScrapeParamsSchema,              description: "Structured data from Amazon, Reddit, TikTok, LinkedIn, GitHub, YouTube, Twitter/X, Walmart, and more platforms. Use when you need e-commerce products, social posts, or job listings — NOT general websites (use extract for those)." },

  { name: "novada_browser",             title: "Browser Automation",         schema: BrowserParamsSchema,             description: "Automate Novada's cloud browser via CDP — navigate, click, type, screenshot, snapshot. One-shot tasks per call. Credentials auto-provisioned from your API key. NOTE: country is accepted but not yet applied — the browser exit node is not geo-routed by this param today." },
  { name: "novada_proxy",               title: "Proxy Credentials",          schema: ProxyParamsSchema,               description: "Proxy credentials for your own HTTP clients. type=residential|isp|datacenter|mobile|static|dedicated (default residential). Not needed for extract/crawl — those handle proxies internally." },
  { name: "novada_discover",            title: "Tool Discovery",             schema: DiscoverParamsSchema,            description: "List all available Novada tools grouped by category." },
  { name: "novada_ai_monitor",          title: "AI Brand Monitor",           schema: AiMonitorParamsSchema,           description: "Search AI-company domains (chatgpt.com, perplexity.ai, anthropic.com, etc.) and the web for PUBLIC mentions & sentiment of a brand. NOTE: searches indexed public pages — it does NOT query the live models; a brand with few indexed pages shows low/zero mentions (not a measure of how the models actually respond)." },
  { name: "novada_monitor",             title: "Page Change Monitor",        schema: MonitorParamsSchema,             description: "⚠️ Session-scoped only: on the hosted endpoint the baseline is per-invocation (in-memory), so use this for single-call change-diffs, not durable cross-call monitoring. Track changes on a web page over time. Compares content hash and field-level diffs." },
  { name: "novada_setup",               title: "Setup & Configuration",      schema: SetupParamsSchema,               description: "Check your API key and environment configuration. Use when you want to verify setup or see which Novada products are active. Auth-free, no quota used." },
  // ── Account / billing tools ──
  // 0.9.9: wallet_balance / wallet_usage_record / plan_balance_all / traffic_daily /
  // capture_logs / account_summary / health / health_all folded into novada_account.
  // Old names remain functional (alias dispatch below) but are hidden from tools/list.
  { name: "novada_account",             title: "Account & Billing",          schema: AccountParamsSchema,             description: "Single-call account & billing dashboard. section='summary' (default): wallet balance + plan quotas + recent capture logs + health entitlements. section='balance': wallet balance only. section='usage': paginated transaction history. section='plans': per-product plan balances (residential/isp/etc). section='traffic': daily proxy consumption. Pass start_time/end_time (YYYY-MM-DD) and products=[...] for traffic/plans. Aliases: wallet_balance, wallet_usage_record, plan_balance_all, traffic_daily, capture_logs, account_summary, health, health_all." },
  { name: "novada_proxy_account_list",  title: "Proxy Account List",         schema: ProxyAccountListParamsSchema,    description: "List proxy sub-accounts for a product (paginated)." },
  { name: "novada_proxy_account_create",title: "Proxy Account Create",       schema: ProxyAccountCreateParamsSchema,  description: "Create a proxy sub-account. Two-step confirm gate (pass confirm:true after human approval).", write: true },
].map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: zodToMcpSchema(t.schema),
  annotations: ("write" in t && t.write)
    ? { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true }
    : { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
}));

// ─── Hosted-hidden tools ──────────────────────────────────────────────────────
// Tools that are architecturally unavailable on hosted (Vercel) but should still
// be callable (returns NOT_AVAILABLE_ON_HOSTED error) if explicitly requested.
// Separated from TOOLS array because .map() strips non-standard properties.
// novada_browser is ENABLED on hosted (one-shot CDP to Novada's remote cloud browser
// works — verified 2026-07-03). novada_browser_flow stays hidden: it keeps a persistent
// session across MULTIPLE tool calls, which a per-request serverless isolate cannot hold.
const HOSTED_HIDDEN = new Set(["novada_browser_flow"]);

// ─── Hidden-alias allowlist (fail-safe — explicit opt-in) ────────────────────
// Backward-compat ALIASES that must route silently on hosted = fold-targets +
// the proxy/verify/scraper names hosted hides but still serves. NOT every tool
// core can dispatch — never-ported tools (site_copy, ip_whitelist,
// static_ip_mgmt, capture_apikey, scraper_task_mgmt, session_stats,
// search_feedback) stay refused-by-default. A NEW core tool is refused until
// explicitly opted in here (fail-safe direction). Two of the excluded names are
// billable/mutating WRITE actions (static_ip_mgmt spends money, ip_whitelist
// mutates the account) and site_copy writes to the read-only serverless FS —
// auto-exposing them would be a security/billing regression.
const HOSTED_ROUTABLE_ALIASES = new Set<string>([
  ...NPM_HIDDEN_ALIASES,                        // health*, wallet*, plan, traffic, capture_logs, account_summary, unblock
  "novada_proxy_residential", "novada_proxy_isp", "novada_proxy_datacenter",
  "novada_proxy_mobile", "novada_proxy_static", "novada_proxy_dedicated",
  "novada_verify",
  "novada_scraper_submit", "novada_scraper_status", "novada_scraper_result",
]);
const HOSTED_HIDDEN_ALIASES: ReadonlySet<string> = (() => {
  const visible = new Set(TOOLS.map((t) => t.name));
  return new Set([...HOSTED_ROUTABLE_ALIASES].filter((n) => !visible.has(n) && !HOSTED_HIDDEN.has(n)));
})();

// ─── Tool-set filtering (?tools= / ?groups=) ─────────────────────────────────
// Lets a client request a slim toolset, e.g. ?groups=search,scrape or
// ?tools=novada_search,novada_scrape. Matches BrightData's ?groups= pattern.
// Fewer tools = less token overhead in the agent's context window.
const TOOL_GROUPS: Record<string, string[]> = {
  core: ["novada_search", "novada_extract", "novada_crawl", "novada_research", "novada_map", "novada_scrape", "novada_setup", "novada_account", "novada_monitor", "novada_discover"],
  search: ["novada_search"],
  scrape: ["novada_scrape", "novada_extract"],
  scraper: ["novada_scrape", "novada_extract"],   // alias of `scrape` — matches npm group key so NOVADA_GROUPS config is portable across surfaces
  crawl: ["novada_crawl", "novada_map"],
  research: ["novada_research", "novada_discover", "novada_ai_monitor", "novada_monitor"],
  proxy: ["novada_proxy"],
  // 0.9.9: novada_account replaces the 7 folded billing tools in this group
  account: ["novada_account", "novada_proxy_account_list", "novada_proxy_account_create"],
  browser: ["novada_browser", "novada_browser_flow"],
};
const ALL_TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/**
 * Resolve the allowed-tool set from URL params. Returns null = no filter (all tools).
 * `tools` accepts full names (novada_search) or short names (search). `groups`
 * accepts category keys from TOOL_GROUPS. novada_setup is always allowed (auth-free helper).
 */
function resolveAllowedTools(url: URL): Set<string> | null {
  const toolsParam = url.searchParams.get("tools");
  const groupsParam = url.searchParams.get("groups");
  if (!toolsParam && !groupsParam) {
    // Default: expose ALL tools (minus HOSTED_HIDDEN, filtered in buildServer) so a first-time
    // chatbox user can discover + use every product — extract, proxy, scraper, account —
    // without knowing to pass ?groups=. Slim with ?groups=core or ?tools=…
    // when a smaller context window is preferred.
    return null;
  }
  const allowed = new Set<string>(["novada_setup"]);
  if (groupsParam) {
    const groups = groupsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    // "all" = no filter, expose every tool
    if (groups.includes("all")) return null;
    for (const g of groups) {
      (TOOL_GROUPS[g] ?? []).forEach((n) => allowed.add(n));
    }
  }
  if (toolsParam) {
    for (const raw of toolsParam.split(",").map((s) => s.trim()).filter(Boolean)) {
      const full = raw.startsWith("novada_") ? raw : `novada_${raw}`;
      if (ALL_TOOL_NAMES.has(full)) allowed.add(full);
    }
  }
  // If params were given but matched nothing real, fall back to core (not all — a typo shouldn't
  // grant broader access than no params at all).
  if (allowed.size <= 1) {
    return new Set([...TOOL_GROUPS["core"], "novada_setup"]);
  }
  return allowed;
}

// ─── Token auth + quota ──────────────────────────────────────────────────────
interface TokenInfo {
  valid: boolean;
  plan: "free" | "pro";
  quota_remaining: number;
}

// Root-cause incident: a misconfigured connector carried a format-valid token
// belonging to a DIFFERENT Novada account. The old format-only check accepted
// it and silently proxied every call to the wrong account — nobody noticed
// until they inspected their wallet balance. Real verification below closes
// that gap: a real upstream call, cheap/fast, that fails loudly on rejection.
const TOKEN_VERIFY_TIMEOUT_MS = 3_500;

// Hosted runs stateless-per-request (no session reuse across calls — see module
// header), so without a cache EVERY tool call from EVERY customer would pay a live
// upstream round-trip to api-m.novada.com just to re-confirm a key it already
// confirmed moments ago. This short-TTL cache reuses the last EXPLICIT upstream
// verdict (pass or explicit reject) so repeat calls from the same key skip the
// upstream call entirely and pay only a KV read (same infra already used for the
// quota/rate-limit counters below — no second caching technology introduced).
// TTL picked in the middle of the 60-120s range: long enough to absorb a hot
// key's typical per-minute call burst, short enough that a key disabled mid-session
// is re-checked well within the same working session.
const TOKEN_VERIFY_CACHE_TTL_S = 90;

interface CachedTokenVerify {
  valid: boolean;
  verified: boolean;
}

/** Best-effort cache write — a KV hiccup here must never block the auth decision already made. */
async function cacheTokenVerify(cacheKey: string, result: CachedTokenVerify): Promise<void> {
  try {
    await kv.set(cacheKey, result, { ex: TOKEN_VERIFY_CACHE_TTL_S });
  } catch {
    /* best-effort — a caching failure must not surface over the (already-decided) auth result */
  }
}

/**
 * Validate a Novada API key: format check, then a REAL upstream probe against
 * the wallet-balance endpoint (the same cheap "does this key work" call
 * novada_setup already uses — one lightweight read, no side effects), fronted
 * by a short-TTL cache of the last explicit verdict (see TOKEN_VERIFY_CACHE_TTL_S).
 *
 * - Format invalid → reject immediately, no upstream call, no cache read/write.
 * - Cache hit (valid TTL) → reuse the last explicit verdict, no upstream call.
 * - Upstream explicitly rejects the key (INVALID_API_KEY) → reject, cache the rejection.
 * - Upstream accepts the key → cache the pass.
 * - Upstream times out / network error (NOT an explicit rejection) → do NOT
 *   hard-fail the request on a flaky upstream; fall back to the format-only
 *   pass so the endpoint doesn't become less available than before this
 *   change. `verified: false` marks this path distinctly so it can be told
 *   apart from a clean pass in logs. This outcome is NEVER cached — it is a
 *   transient failure, not a real verification result, and caching it would
 *   suppress a real check for the full TTL if the flake clears a moment later.
 * TODO(sub2api): wire to sub2api for per-user plan/quota resolution.
 */
async function validateToken(token: string, env: Env): Promise<TokenInfo & { verified: boolean }> {
  // Accept any non-empty token that looks like a valid API key (alphanumeric, 16+ chars).
  if (!token || token.length < 16 || !/^[a-zA-Z0-9_\-]+$/.test(token)) {
    return { valid: false, plan: "free", quota_remaining: 0, verified: false };
  }
  const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10);

  // tokenKvHash (not the plaintext key) is the cache key — same rule as the quota
  // counters: the plaintext API key must never be a KV key (see tokenKvHash).
  const cacheKey = `tokver:${await tokenKvHash(token)}`;
  try {
    const cached = await kv.get<CachedTokenVerify>(cacheKey);
    if (cached) {
      return {
        valid: cached.valid,
        plan: "free",
        quota_remaining: cached.valid ? monthlyQuota : 0,
        verified: cached.verified,
      };
    }
  } catch {
    // KV read failure — fall through to a live upstream check; never block auth on cache.
  }

  try {
    await devApiPost("/v1/wallet/balance", {}, { apiKey: token, timeoutMs: TOKEN_VERIFY_TIMEOUT_MS });
    await cacheTokenVerify(cacheKey, { valid: true, verified: true });
    return { valid: true, plan: "free", quota_remaining: monthlyQuota, verified: true };
  } catch (e) {
    if (e instanceof NovadaError && e.code === NovadaErrorCode.INVALID_API_KEY) {
      // Explicit auth rejection from Novada — this key does not belong to any
      // account (or was disabled). Fail fast; do NOT fall through to dispatch.
      await cacheTokenVerify(cacheKey, { valid: false, verified: true });
      return { valid: false, plan: "free", quota_remaining: 0, verified: true };
    }
    // Timeout / network / transient upstream failure — NOT a rejection. Falling
    // back to format-only here (rather than failing the request) keeps the
    // hosted endpoint's availability decoupled from developer-api's uptime.
    // `verified: false` lets logs distinguish "we didn't actually check" from
    // a clean pass, without blocking the caller. Deliberately NOT cached (see
    // function doc above).
    console.error(JSON.stringify({
      evt: "token_verify_fallback",
      reason: e instanceof Error ? e.message.slice(0, 200) : String(e),
    }));
    return { valid: true, plan: "free", quota_remaining: monthlyQuota, verified: false };
  }
}

/**
 * Per-IP rate limit using Vercel KV. Returns true if rate exceeded → 429.
 * Keyed by IP + current minute bucket. TTL 2 min for KV GC headroom.
 * Defaults to 60 calls/min/IP (generous — legitimate agents won't hit).
 */
async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {
  if (!ip || ip === "unknown") return false;
  const limit = parseInt(env.RATE_LIMIT_PER_MIN || "60", 10);
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${bucket}`;
  // Atomic increment — read-modify-write would let concurrent requests in the
  // same minute bucket each read a stale count and all slip past the limit.
  const count = await kv.incr(key);
  // Set the bucket TTL once, on the first hit (count === 1 means we just created it).
  if (count === 1) await kv.expire(key, 120);
  return count > limit;
}

/** Short stable identifier for a token, safe to log (SHA-256 first 12 hex chars). */
async function tokenFingerprint(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

/**
 * Full SHA-256 hex of a token, used as the KV key for quota counters. The
 * plaintext API key must NEVER be a KV key — KV keys can surface in logs,
 * dashboards, and key-scan output, leaking the customer's credential. The full
 * 64-char digest (not the 12-char log fingerprint) keeps collisions negligible.
 */
async function tokenKvHash(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returns the new remaining count, or -1 if the request must be rejected.
 * `tokenHash` is the SHA-256 hex of the API key — the plaintext key must never
 * be a KV key (see tokenKvHash). Uses an atomic increment instead of a
 * get-then-set so concurrent calls can't both read the same stale count and
 * over-spend the quota (TOCTOU). If the increment pushes a free-plan account
 * past its cap, the speculative increment is rolled back so an exhausted key's
 * counter can't drift upward unbounded under load.
 */
async function decrementQuota(tokenHash: string, env: Env, plan: "free" | "pro"): Promise<number> {
  const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10);
  const key = `${tokenHash}:${monthKey()}`;
  const used = await kv.incr(key);
  // Set the 32-day TTL once, on the first hit — KV will GC the key after the
  // month rolls over. (count === 1 means we just created it.)
  if (used === 1) await kv.expire(key, 60 * 60 * 24 * 32);
  if (plan === "free" && used > monthlyQuota) {
    // Over cap — undo the speculative increment and reject. Guard the rollback: a failed kv.decr
    // must not throw out of decrementQuota (that would skip the caller's refund path and leave a
    // phantom over-cap charge). Best-effort, mirroring refundQuota. (NOV-573 review)
    try { await kv.decr(key); } catch { /* best-effort rollback */ }
    return -1;
  }
  return Math.max(0, monthlyQuota - used);
}

/**
 * Reverse one decrementQuota when the tool call did NOT do useful work (NOV-578).
 * Quota is decremented BEFORE the tool runs (so an abusive loop can't burn free
 * credits faster than KV updates) — but upstream/transport/validation failures
 * must not charge the customer. Best-effort: floors at 0 and never throws, so a
 * refund hiccup can't mask the original tool error. Mirrors decrementQuota's
 * atomic increment + 32-day TTL. `tokenHash` is the SHA-256 hex of the API key
 * (the plaintext key is never a KV key — see tokenKvHash).
 */
async function refundQuota(tokenHash: string, env: Env): Promise<void> {
  try {
    const key = `${tokenHash}:${monthKey()}`;
    // Atomic decrement, mirroring decrementQuota's incr. Floor at 0: if a
    // concurrent reset/GC already cleared the counter, undo the over-decrement.
    const after = await kv.decr(key);
    if (after < 0) await kv.set(key, "0", { ex: 60 * 60 * 24 * 32 });
  } catch {
    /* best-effort — never let a refund failure surface over the tool error */
  }
}

// ─── First-run notice (TOW2-242) ─────────────────────────────────────────────
// One-time onboarding notice, shown EXACTLY ONCE per token on the hosted endpoint.
// The canonical copy + stdio logic live in the vendored module
// ../vendor/novada-mcp/utils/first-run-notice.ts (FIRST_RUN_NOTICE). We do NOT
// import it here: the vendor dir is regenerated at deploy time and is stale between
// deploys, so importing would break the local tsc gate. Per the TOW2-242 design's
// explicit fallback, we duplicate ONLY the constant inline (KEEP IN SYNC with the
// module) and implement a KV-backed store here (KV is hosted-only). To remove the
// feature on hosted: delete this block + the two call sites below (grep TOW2-242).
const FIRST_RUN_NOTICE =
  "💡 First time using Novada MCP? Get your own API key + $10 free credits at https://novada.com — this notice shows only once.";

// 180-day TTL: a returning token inside the window stays "noticed"; beyond it the KV
// key GCs and the notice may show once more. Acceptable for a soft onboarding nudge.
const FIRST_RUN_TTL_SECONDS = 60 * 60 * 24 * 180;

/**
 * Returns the first-run notice for this token on its FIRST hosted call, else null.
 *
 * Fail-quiet contract (mirrors the vendored module):
 *  - Kill switch env set → null (never emit).
 *  - KV unavailable / any KV error → treat as already-noticed → null (never spam,
 *    never block a tool result).
 *  - Mark-before-return: SET the flag BEFORE returning the notice so a crash can't
 *    double-show it. Key is `noticed:<12-hex token fingerprint>` — never the raw
 *    token (KV keys can surface in logs; see tokenFingerprint / tokenKvHash).
 */
async function maybeGetFirstRunNoticeHosted(token: string): Promise<string | null> {
  if (process.env.NOVADA_DISABLE_FIRST_RUN_NOTICE) return null;
  try {
    const fp = await tokenFingerprint(token);
    const key = `noticed:${fp}`;
    // SET only if absent (NX). `nx:true` returns null when the key already exists →
    // already noticed. A truthy result means we just claimed the first-run slot.
    const claimed = await kv.set(key, Date.now(), { nx: true, ex: FIRST_RUN_TTL_SECONDS });
    if (!claimed) return null;
    return FIRST_RUN_NOTICE;
  } catch {
    // KV missing/errored → fail quiet as "already noticed" so we never block or spam.
    return null;
  }
}

function extractToken(req: Request): string | null {
  // Vercel Node.js Functions: req.url is path-only ("/mcp"). Vercel Edge: it's
  // the absolute URL. Provide a base so URL parsing works in both runtimes.
  const base = `https://${req.headers.get("host") || "localhost"}`;
  const url = new URL(req.url, base);

  // 1. Path-based auth (Firecrawl pattern): /:key/mcp
  //    Vercel rewrite may inject ?pathKey=:key, OR Node runtime may show the original path.
  const pathKey = url.searchParams.get("pathKey");
  if (pathKey && pathKey.trim().length >= 16) return pathKey.trim();
  const pathAuthMatch = url.pathname.match(/^\/([a-zA-Z0-9_\-]{16,})\/mcp$/);
  if (pathAuthMatch) return pathAuthMatch[1];

  // 2. Query param: ?token=YOUR_API_KEY
  const qp = url.searchParams.get("token");
  if (qp) return qp.trim();

  // 3. Bearer header: Authorization: Bearer YOUR_API_KEY
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}

function logUsage(env: Env, token: string, tool: string, ok: boolean, ms: number): void {
  if ((env.LOG_LEVEL ?? "info") !== "silent") {
    tokenFingerprint(token).then((fp) => {
      console.log(JSON.stringify({ evt: "usage", tokenFp: fp, tool, ok, ms }));
    }).catch(() => {});
  }
}

// ─── Output sanitization for hosted ──────────────────────────────────────────
// Strip verbose sections that waste tokens on hosted: Agent Memory (no persistent
// memory), Output Saved (no filesystem), Extraction Diagnostics (debug noise),
// Same-Domain Links (map tool available). Saves ~15-30% tokens per response.
const STRIP_SECTIONS = [
  /\n+## Output Saved\n[\s\S]*?(?=\n## |\n---\n|$)/g,
  /\n+## Agent Memory\n[\s\S]*?(?=\n## |\n---\n|$)/g,
  /\n+## Extraction Diagnostics\n[\s\S]*?(?=\n## |\n---\n|$)/g,
  /\n+## Same-Domain Links[^\n]*\n[\s\S]*?(?=\n## |\n---\n|$)/g,
  /\n+Output saved: [^\n]+/g,
  /\n+\/\/ Output saved: [^\n]+/g,
];

function sanitizeHostedOutput(text: string): string {
  let result = text;
  for (const pattern of STRIP_SECTIONS) {
    result = result.replace(pattern, "");
  }
  // Collapse multiple consecutive blank lines into one
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

// ─── Credential / internal-host redaction for the hosted error path (#2-hosted) ──
// A raw upstream error string (axios message, response body, stack) can carry the
// customer's credential as URL userinfo (`https://user:pass@host`) or an INTERNAL
// Novada host (e.g. the Browser API CDP host `upg-scbr2.novada.com`). BOTH the
// NovadaError branch and the NON-NovadaError fallback below route their message
// through this redactor — the currently vendored errors.js (0.8.2-dev) does NOT
// self-redact in toAgentString(), so the hosted endpoint must defend itself here
// regardless of which package version is vendored. This mirrors the source-of-truth
// redactSecrets() in novada-mcp/_core/errors.ts.
const PUBLIC_NOVADA_HOSTS = new Set([
  "novada.com",
  "www.novada.com",
  "dashboard.novada.com",
  "status.novada.com",
  "mcp.novada.com",
  "docs.novada.com",
]);

function redactHostedSecrets(msg: string): string {
  let out = msg;
  // 1. Exact server NOVADA_BROWSER_WS value (contains user:pass@host) — redact first.
  // The var itself is stripped from process.env at cold start (TOW2-249), so we use
  // the pre-strip snapshot; the generic user:pass@host + *.novada.com rules below
  // still scrub any per-caller browser WS regardless.
  if (SERVER_BROWSER_WS_SNAPSHOT) out = out.split(SERVER_BROWSER_WS_SNAPSHOT).join("[browser-ws-endpoint]");
  // 2. URL userinfo in any scheme (http/https/ws/wss): strip `user:pass@`.
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+(?::[^/@\s]*)?@/gi, "$1");
  // 3. Internal *.novada.com hosts not on the public allowlist → placeholder.
  out = out.replace(/\b(?:[a-z0-9-]+\.)+novada\.com\b/gi, (host) =>
    PUBLIC_NOVADA_HOSTS.has(host.toLowerCase()) ? host : "[novada-internal-host]"
  );
  return out;
}

// ─── MCP server factory ──────────────────────────────────────────────────────
function buildServer(apiKey: string, env: Env, ctx: { token: string; tokenHash: string; allowedTools?: Set<string> | null }): Server {
  const server = new Server(
    { name: "novada", version: HOSTED_VERSION },
    { capabilities: { tools: {}, prompts: {} } },
  );

  const isHosted = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  const visibleTools = (ctx.allowedTools
    ? TOOLS.filter((t) => ctx.allowedTools!.has(t.name))
    : TOOLS
  ).filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name));
  // Names actually exposed on this endpoint — drives both ListTools and the
  // discover catalog so an agent never sees a tool it can't call. A tool can be
  // absent here for three reasons: filtered out by ?tools=/?groups=, hidden by
  // HOSTED_HIDDEN (browser tools on Vercel), or never ported to hosted at all
  // (e.g. novada_site_copy, novada_ip_whitelist — not in the hosted TOOLS array).
  const visibleToolNames: ReadonlySet<string> = new Set(visibleTools.map((t) => t.name));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: visibleTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const argsObj = (args as Record<string, unknown>) ?? {};
    const started = Date.now();

    // Tool-set filter: reject tools not in the endpoint's ?tools=/?groups= selection.
    if (ctx.allowedTools && !ctx.allowedTools.has(name) && !HOSTED_HIDDEN_ALIASES.has(name)) {
      return {
        content: [{
          type: "text" as const,
          text: `Error [TOOL_NOT_ENABLED]: '${name}' is not enabled on this endpoint. It was filtered out by the ?tools=/?groups= URL parameter.\nagent_instruction: Remove the filter from the MCP URL, or add this tool/group to it, to use ${name}.`,
        }],
        isError: true,
      };
    }

    // Hidden / unwired-on-hosted guard: a tool that isn't in the visible set for this
    // endpoint (HOSTED_HIDDEN browser tools, or tools never ported to hosted such as
    // novada_site_copy / novada_ip_whitelist, or an outright unknown name) is rejected
    // BEFORE quota is touched, with an agent_instruction pointing at the npm package
    // where the full tool surface is available.
    if (!visibleToolNames.has(name) && !HOSTED_HIDDEN_ALIASES.has(name)) {
      return {
        content: [{
          type: "text" as const,
          text: `Error [TOOL_NOT_ENABLED]: '${name}' is not available on the hosted Novada MCP endpoint.\nagent_instruction: Install the local MCP server to use ${name} — \`npx novada-mcp\` (npm package "novada-mcp") with your own NOVADA_API_KEY exposes the full tool surface, including browser automation and disk-writing tools. All other Novada tools (search/extract/crawl/map/research/scrape/verify/proxy/account) work on the hosted endpoint.`,
        }],
        isError: true,
      };
    }

    // novada_setup is auth-free and never charged against quota.
    if (name === "novada_setup") {
      try {
        // Pass the caller's token so setup validates the CUSTOMER's key (not the server env fallback).
        const result = await novadaSetup(validateSetupParams(argsObj), ctx.token);
        logUsage(env, ctx.token, name, true, Date.now() - started);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (e) {
        logUsage(env, ctx.token, name, false, Date.now() - started);
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    }

    // Decrement quota BEFORE the call so abusive loops can't burn free credits.
    const remaining = await decrementQuota(ctx.tokenHash, env, "free");
    if (remaining < 0) {
      return {
        content: [{
          type: "text" as const,
          text: [
            "## Free Gateway Cap Reached",
            "",
            `This hosted gateway allows ${parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10)} free calls/month per API key (an anti-abuse cap, independent of your Novada balance). That monthly cap is now used up.`,
            "",
            "Note: this cap is separate from billing. Every successful call already draws per-call usage from your own Novada balance; the cap just limits calls through the free hosted gateway.",
            "",
            "**Options:**",
            "1. The free-gateway cap resets at the start of next month — or run a local MCP server now (no monthly gateway cap): `npx novada-mcp@latest` with the same API key (calls still draw your Novada balance).",
            "2. Top up your Novada balance at https://dashboard.novada.com/ (covers per-call usage; does not raise the free-gateway cap).",
            "3. Need a higher gateway cap? Contact sales@novada.com.",
            "",
            "agent_instruction: free_gateway_cap_reached | retry_recommended: false | resets: start_of_next_month | alternatives: run local MCP via `npx novada-mcp@latest` (same key, no gateway cap) OR wait for monthly reset. This cap is independent of billing — per-call usage draws your Novada balance; top up at https://dashboard.novada.com/ if balance is low.",
          ].join("\n"),
        }],
        isError: true,
      };
    }

    // Browser caller-key billing (TOW2-249 CHALLENGE): core.dispatch calls novadaBrowser
    // WITHOUT the apiKey arg, and resolveBrowserWs reads store.browserWs / NOVADA_BROWSER_WS
    // but NOT store.apiKey — so with the server NOVADA_API_KEY stripped, an unprovisioned
    // browser call would resolve to null ("Not Configured") instead of billing the caller.
    // Pre-resolve the caller's Browser WSS here (auto-fetch via THEIR key, product=10;
    // tenant-safe per-key cache) and seed it into the store so novadaBrowser uses it. If the
    // caller has no Browser entitlement this stays undefined and the tool returns its own
    // "Not Configured" message — no server-account fallback either way.
    let browserWs: string | undefined;
    if (name === "novada_browser") {
      // Bound the auto-provision round-trip: it runs BEFORE the withWallClock guard,
      // so a hung management API could otherwise push total latency toward the 60s
      // Vercel function limit. 4s cap → null → the tool emits its own "Not Configured".
      browserWs = (await Promise.race([
        resolveBrowserWs(apiKey).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ])) ?? undefined;
    }

    // Wrap the whole dispatch so the caller's apiKey populates the AsyncLocalStorage
    // credential store for every store-reading resolver underneath (Web Unblocker / proxy /
    // browser). store.run() transparently propagates the inner return values and rejections.
    return await withCredentials({ apiKey, browserWs }, async () => {
    try {

      // ── Browser-flow explicit refusal (BEFORE dispatch — no quota burned for it) ──
      // novada_browser_flow keeps a persistent WS session across multiple tool calls;
      // Vercel serverless isolates cannot hold that state. Early-exit + refund (NOV-578).
      if (name === "novada_browser_flow") {
        logUsage(env, ctx.token, name, false, Date.now() - started);
        await refundQuota(ctx.tokenHash, env);
        return {
          content: [{
            type: "text" as const,
            text: "Error [NOT_AVAILABLE_ON_HOSTED]: novada_browser_flow requires a persistent WebSocket session that Vercel serverless isolates cannot hold.\nagent_instruction: Use the local MCP server (`npx novada-mcp`) for browser-flow tasks, or use novada_scrape / novada_extract for static-content extraction on the hosted server.",
          }],
          isError: true,
        };
      }

      // ── novada_discover override — scope catalog to this endpoint's visible tools ──
      // core.dispatch calls novadaDiscover(args) without the second arg, which would list
      // core's full 33-tool catalog. On hosted we pass visibleToolNames so the output only
      // advertises the 15 tools the agent can actually call on this endpoint.
      if (name === "novada_discover") {
        const result = await novadaDiscover(validateDiscoverParams(argsObj), visibleToolNames);
        logUsage(env, ctx.token, name, true, Date.now() - started);
        const sanitized = sanitizeHostedOutput(result);
        // TOW2-242: first-run notice on this successful path too (separate block).
        const discoverContent = [{ type: "text" as const, text: sanitized }];
        const discoverNotice = await maybeGetFirstRunNoticeHosted(ctx.token);
        if (discoverNotice) discoverContent.push({ type: "text" as const, text: discoverNotice });
        return { content: discoverContent };
      }

      // ── Single dispatch call (replaces the old hand-maintained switch) ──
      // core.dispatch handles routing for all 33 npm tools + 9 npm hidden aliases.
      // It throws Error("Unknown tool: <name>") for anything not in its switch.
      // withWallClock races the Promise against the 56s wall-clock budget.
      const result = await withWallClock(
        name,
        // TOW2-240: pass visibleToolNames so dispatch can suppress agent_instructions
        // that reference tools absent from this endpoint (e.g. novada_search_feedback).
        dispatch(name, argsObj, apiKey, { onProgress: undefined, visibleTools: visibleToolNames }),
      );

      logUsage(env, ctx.token, name, true, Date.now() - started);
      const sanitized = sanitizeHostedOutput(result);
      // Append quota footer only when quota is running low (< 20% of monthly)
      const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10);
      const quotaFooter = remaining < monthlyQuota * 0.2
        ? `\n\n---\n⚠ Quota: ${remaining}/${monthlyQuota} calls remaining this month.`
        : "";
      // TOW2-242: one-time first-run notice — SEPARATE content block (never
      // concatenated into the result text, which would corrupt JSON outputs),
      // ONLY on this successful path. Fails quiet → never throws.
      const content = [{ type: "text" as const, text: sanitized + quotaFooter }];
      const notice = await maybeGetFirstRunNoticeHosted(ctx.token);
      if (notice) content.push({ type: "text" as const, text: notice });
      return {
        content,
        _meta: { quota_remaining: remaining },
      };
    } catch (error) {
      // Alert-gating (noise reduction): handled transient/user errors record a
      // breadcrumb for forensics; only likely-bug errors fire an actual alert.
      // The customer response, redaction, 500-char cap, logUsage and refundQuota
      // below are UNCHANGED — this gates the Sentry side-effect only.
      if (shouldAlertSentry(error)) {
        Sentry.withScope(scope => {
          scope.setTag("tool", name);
          Sentry.captureException(error);
        });
        await sentryFlush();
      } else {
        const code = error instanceof NovadaError ? error.code : undefined;
        Sentry.addBreadcrumb({
          category: "tool-handled",
          level: "info",
          message: `${name}: ${code ?? (error instanceof Error ? error.name : "error")}`,
          data: {
            tool: name,
            code,
            retryable: error instanceof NovadaError ? error.retryable : undefined,
          },
        });
        // no captureException, no alert — breadcrumb rides along on the next real event
      }
      logUsage(env, ctx.token, name, false, Date.now() - started);
      // The tool failed (validation / upstream / transport) → no useful work done, so
      // refund the quota decremented before the call. Failed calls must not burn customer
      // credits (NOV-578). refundQuota is best-effort and swallows its own errors.
      await refundQuota(ctx.tokenHash, env);
      if (error instanceof ZodError) {
        const issues = error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Validation failed for ${name}:\n${issues}\n\nagent_instruction: Check the tool's inputSchema for required fields and valid types. Call list_tools to see the schema for ${name}.` }],
          isError: true,
        };
      }
      // NovadaError carries a tailored agent_instruction / failure_class / retry hint —
      // preserve it (npm-parity). Only fall through to the hosted substring hints
      // below for non-NovadaError errors. (NOV-571: the hosted endpoint was dropping all of
      // this and returning a bare truncated message.)
      // #2-hosted: the vendored errors.js (0.8.2-dev) does NOT redact inside
      // toAgentString(), so a NovadaError whose .message interpolates upstream text
      // (e.g. classifyError's "Domain unreachable: <raw>" on the render path) can carry
      // `user:pass@host` or an internal *.novada.com host. Route it through the hosted
      // redactor here — toAgentString()'s newline-collapse keeps the credential on one
      // line, so the userinfo/host rules still match.
      if (error instanceof NovadaError) {
        return {
          content: [{ type: "text" as const, text: redactHostedSecrets(error.toAgentString()) }],
          isError: true,
        };
      }
      // Hosted-aware error wrapping — translate internal errors to actionable guidance.
      // #2-hosted: redact credentials / internal hosts from the raw upstream message
      // BEFORE it touches any branch, so neither the substring match nor the sliced
      // fallback can leak `user:pass@host` or an internal *.novada.com host.
      const rawMsg = redactHostedSecrets(error instanceof Error ? error.message : String(error));
      let userMsg = rawMsg;

      // Common hosted failure: NOVADA_WEB_UNBLOCKER_KEY not set → extract render fails
      if (rawMsg.includes("NOVADA_WEB_UNBLOCKER_KEY") || rawMsg.includes("UNBLOCKER_NOT_CONFIGURED")) {
        userMsg = `Extract JS rendering is not configured on this hosted endpoint. The tool attempted static extraction only. For JS-heavy pages, use a local MCP server with NOVADA_WEB_UNBLOCKER_KEY configured, or try novada_scrape for platform-specific data.`;
      }
      // Proxy not configured
      else if (rawMsg.includes("PROXY_AUTH_FAILURE") || rawMsg.includes("proxy credentials not configured")) {
        userMsg = `Proxy credentials are not available on this hosted endpoint. For web extraction, use novada_extract or novada_crawl instead — they handle proxies internally.`;
      }
      // Browser not available
      else if (rawMsg.includes("NOT_AVAILABLE_ON_HOSTED") || rawMsg.includes("Playwright")) {
        userMsg = `This tool requires a local MCP server. Install via: npx novada-mcp`;
      }
      // Fallback: don't leak raw internals (stack traces, file paths, API response bodies)
      else {
        userMsg = `Tool error: ${rawMsg.slice(0, 200)}`;
      }
      // Defense in depth: redact again after assembly (the static templates are clean,
      // but a future edit that interpolates rawMsg shouldn't be able to leak).
      userMsg = redactHostedSecrets(userMsg);
      // Cap total length
      if (userMsg.length > 500) {
        userMsg = userMsg.slice(0, 497) + "...";
      }

      return {
        content: [{ type: "text" as const, text: userMsg }],
        isError: true,
      };
    }
    }); // end withCredentials
  });

  // MCP prompts — list + get, delegated to the vendored prompts module (npm parity).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.setRequestHandler(ListPromptsRequestSchema, async () => listPrompts() as any);
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getPrompt(name, (args as Record<string, string>) || {}) as any;
  });

  return server;
}

// ─── HTTP entrypoint ─────────────────────────────────────────────────────────
function jsonError(status: number, code: string, message: string, agentInstruction?: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: status,
        message,
        data: { code, agent_instruction: agentInstruction },
      },
      id: null,
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

/**
 * Extract the client IP for rate-limit identity. MUST use a Vercel-trusted
 * header — `x-vercel-forwarded-for` (set by Vercel's proxy) or `x-real-ip`.
 * Raw `x-forwarded-for` is client-spoofable (an attacker can forge a fresh IP
 * per request to defeat the per-IP limit), so it is NEVER trusted here.
 * Falls back to "unknown" — rate limit is then skipped.
 */
function getClientIp(request: Request): string {
  const vff = request.headers.get("x-vercel-forwarded-for");
  if (vff) {
    const first = vff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

// ─── Vercel Node runtime adapter ─────────────────────────────────────────────
// Vercel's Node.js Functions runtime invokes handlers with Node's native
// IncomingMessage / ServerResponse — NOT Fetch API Request/Response. But the
// MCP-handler code below was written against Fetch API (request.headers.get(),
// new Response(...)). To keep that body working on Node, the default export is
// a Node-style wrapper that adapts Node req/res ↔ Fetch Request/Response.
//
// If we ever switch to runtime: "edge" (or Fluid Compute's web-style handler),
// drop the adapter and rename `fetchHandler` → default export.

import type { IncomingMessage, ServerResponse } from "node:http";

interface NodeCtx {
  req: IncomingMessage;
  res: ServerResponse;
  parsedBody?: unknown;
}

// NOV-578 #10: hard ceiling on request-body buffering. 4 MB is generous for JSON-RPC /
// tool arguments and aligns with Vercel's own serverless payload limit.
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

async function readNodeBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method || "GET").toUpperCase();
  if (["GET", "HEAD"].includes(method)) return undefined;
  // NOV-578 #10: this runs BEFORE auth — without a ceiling an unauthenticated client could
  // stream an unbounded body and exhaust function memory (pre-auth memory DoS). Reject early
  // on a declared content-length, and enforce a running-total backstop against a lying/absent one.
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    throw Object.assign(new Error("Request body exceeds the 4 MB limit."), { statusCode: 413 });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw Object.assign(new Error("Request body exceeds the 4 MB limit."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function nodeReqToWebReq(req: IncomingMessage, rawBody: Buffer | undefined): Request {
  const host = (req.headers.host as string) || "localhost";
  const url = `https://${host}${req.url || "/"}`;
  const method = (req.method || "GET").toUpperCase();

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach(vv => headers.append(k, vv));
    else if (typeof v === "string") headers.set(k, v);
  }

  // Buffer is a Uint8Array under the hood; cast to satisfy BodyInit typing.
  const body = rawBody ? new Uint8Array(rawBody) : undefined;
  return new Request(url, { method, headers, body });
}

async function sendWebRes(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const text = await webRes.text();
  res.end(text);
}

export default async function nodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Read body once — pass to both the Fetch shim (for pre-transport logic)
    // and the MCP SDK transport (which would otherwise re-read the stream).
    const rawBody = await readNodeBody(req);
    let parsedBody: unknown;
    if (rawBody) {
      const text = rawBody.toString("utf8");
      try { parsedBody = JSON.parse(text); } catch { /* leave undefined */ }
    }

    const webReq = nodeReqToWebReq(req, rawBody);
    const webRes = await fetchHandler(webReq, { req, res, parsedBody });

    // If the MCP transport already wrote to res (Node-style dispatch), skip
    // re-sending. The transport sets res.headersSent after its first write.
    if (!res.headersSent) {
      await sendWebRes(res, webRes);
    }
  } catch (err) {
    if (!res.headersSent) {
      // NOV-578 #10: surface an oversized body as 413 (not a generic 500) so the client
      // gets an actionable signal.
      const statusCode = (err as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 413) {
        res.statusCode = 413;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          error: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds the 4 MB limit. Reduce payload size or split large tool arguments.",
        }));
        return;
      }
      // Log full error server-side but don't leak internals to client
      Sentry.captureException(err);
      await sentryFlush();
      console.error("[nodeHandler] Internal error:", (err as Error)?.message ?? String(err));
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        error: "INTERNAL_ERROR",
        message: "An internal error occurred. Please try again or contact support.",
      }));
    }
  }
}

// ─── Original Fetch-API handler (called by the Node adapter above) ───────────
async function fetchHandler(request: Request, nodeCtx?: NodeCtx): Promise<Response> {
  const env = readEnv();
  // Vercel Node.js Functions: request.url is path-only ("/mcp"). Vercel Edge:
  // absolute URL. Provide a base so URL parsing works in both runtimes.
  const base = `https://${request.headers.get("host") || "localhost"}`;
  const url = new URL(request.url, base);

  // Vercel rewrites /mcp -> /api/mcp, so both pathnames must be accepted here.
  // Path-based auth: /:key/mcp is also valid (Firecrawl pattern for Claude.ai).
  // We also expose a health probe on / and /health for ops.
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/health" || pathname === "/api/health") {
    return new Response(JSON.stringify({ ok: true, service: "novada-mcp-hosted", endpoint: "/mcp" }), {
      headers: { "content-type": "application/json" },
    });
  }

  // Accept /mcp, /api/mcp, or /:key/mcp (path-based auth for Claude.ai).
  // In Vercel Node runtime, req.url may show the original path even after rewrite.
  const pathMatch = pathname.match(/^\/([a-zA-Z0-9_\-]{16,})\/mcp$/);
  const isMcpPath = pathname === "/mcp" || pathname === "/api/mcp" || !!pathMatch;

  if (!isMcpPath) {
    return jsonError(404, "NOT_FOUND", "Unknown path. The MCP endpoint is POST/GET /mcp.");
  }

  // 🔴 STUB AUTH GATE — operator must explicitly accept that the auth layer is a stub
  // until sub2api integration lands. See PRE_LAUNCH_CHECKLIST.md.
  if (env.STUB_AUTH_WARNING_ACCEPTED !== "true") {
    return jsonError(503, "STUB_AUTH_UNACKED",
      "Auth system not yet activated. Contact the operator.",
      "Operator: set env STUB_AUTH_WARNING_ACCEPTED=true via `vercel env add STUB_AUTH_WARNING_ACCEPTED production` and redeploy.");
  }

  // KV connection check — must be explicit. Vercel auto-injects KV_REST_API_URL +
  // KV_REST_API_TOKEN when a KV store is connected to the project. If they're
  // missing, fail loud rather than silently bypassing rate-limit + quota.
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return jsonError(500, "KV_NOT_CONFIGURED",
      "Vercel KV store is not connected to this project. KV_REST_API_URL and KV_REST_API_TOKEN are required.",
      "Operator: create a KV store in the Vercel dashboard (Storage → Create → KV), connect it to this project, then redeploy.");
  }

  // CORS preflight (some MCP clients probe with OPTIONS). Preflight carries no
  // auth header, so it must short-circuit before the token check below.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, mcp-session-id",
        "access-control-max-age": "86400",
      },
    });
  }

  // Auth — validate the token FIRST and reject with 401 BEFORE touching KV.
  // An unauthenticated request must not be able to spend a KV read/incr (the
  // rate-limit counter below), so this runs ahead of rateLimitExceeded.
  const token = extractToken(request);
  if (!token) {
    return jsonError(401, "MISSING_TOKEN",
      "Missing API key. Pass your own Novada API key as ?token=YOUR_KEY or Authorization: Bearer YOUR_KEY — the hosted endpoint bills each call to your own Novada balance.",
      "Get a Novada API key with $10 free credits at https://novada.com — then use it as the token in your MCP URL.");
  }
  const info = await validateToken(token, env);
  if (!info.valid) {
    // `verified` distinguishes a real upstream rejection (key is well-formed but
    // Novada doesn't recognize it — e.g. wrong account, disabled key) from a
    // bare format failure (too short / bad charset), so the agent gets an
    // accurate diagnosis instead of always being told "check the format".
    const message = info.verified
      ? "Your API key is not a valid or active Novada API key. It was rejected by the Novada account API — verify you copied the correct key from your OWN Novada account."
      : "Invalid API key format. Use your own Novada API key (16+ chars, from your Novada account) as the token.";
    return jsonError(401, "INVALID_TOKEN", message,
      "Check your key at https://dashboard.novada.com/api-key/ — make sure it belongs to YOUR account, not a different one. Get a Novada API key with $10 free credits at https://novada.com if you don't have one.");
  }

  // Per-IP rate limit — slow down abusive loops from an authenticated key.
  // Identity comes from a Vercel-trusted IP header (never spoofable raw XFF).
  const ip = getClientIp(request);
  if (await rateLimitExceeded(ip, env)) {
    return jsonError(429, "RATE_LIMITED",
      `Too many requests from your IP. Limit is ${env.RATE_LIMIT_PER_MIN || "60"} requests/minute.`,
      "Retry after 60 seconds. If you need higher limits, contact sales@novada.com.");
  }

  // Upstream Novada API key — the customer's own key, and ONLY their own key
  // (TOW2-249 pass-through model). The caller's token IS their Novada API key and
  // every upstream call is billed to THEIR balance. There is deliberately NO
  // server-env fallback: funding a caller's consumption from the server account is
  // the exact bug this fixes, and the server consumption creds are stripped from
  // process.env at cold start anyway (see stripServerConsumptionCreds). `token` is
  // already validated non-empty above (401 otherwise); the guard is defensive.
  const apiKey = token?.trim();
  if (!apiKey) {
    return jsonError(401, "MISSING_TOKEN",
      "No Novada API key provided. Pass your own key as ?token=YOUR_KEY (or Authorization: Bearer YOUR_KEY) — the hosted endpoint bills each call to your own Novada balance and never to a shared account.",
      "Get a Novada API key with $10 free credits at https://novada.com — then use it as the token in your MCP URL.");
  }

  // Optional tool-set filter from ?tools= / ?groups= (BrightData-style slim endpoint).
  const allowedTools = resolveAllowedTools(url);

  // SHA-256 of the API key — used as the KV quota key so the plaintext key is
  // never written to KV (see tokenKvHash). Computed once per request.
  const tokenHash = await tokenKvHash(token);

  // Build a fresh server + transport per request (stateless mode). Edge
  // functions are per-request isolates with no shared memory — same pattern
  // as the CF Worker port.
  const server = buildServer(apiKey, env, { token, tokenHash, allowedTools });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);

    if (nodeCtx) {
      // Node runtime: MCP SDK's StreamableHTTPServerTransport.handleRequest
      // expects Node's (req, res, parsedBody?) and writes the response stream
      // directly to res. We supply the pre-parsed body because nodeHandler
      // already consumed req's stream to build the Fetch Request above.
      // CORS must be set on res BEFORE the SDK writes headers.
      nodeCtx.res.setHeader("access-control-allow-origin", "*");
      nodeCtx.res.setHeader("access-control-expose-headers", "mcp-session-id");
      // SDK types are Node-first; pass through with a cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (transport as any).handleRequest(nodeCtx.req, nodeCtx.res, nodeCtx.parsedBody);
      // Sentinel — nodeHandler checks res.headersSent and skips sendWebRes.
      return new Response(null, { status: 200, headers: { "x-handled-by": "mcp-transport" } });
    }

    // Theoretical Fetch-API path (Edge runtime). Unused while we're on Node.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: Response = await (transport as any).handleRequest(request);
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-expose-headers", "mcp-session-id");
    return new Response(response.body, { status: response.status, headers });
  } catch (err) {
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "TRANSPORT_ERROR", `MCP transport error: ${message}`);
  } finally {
    try { await server.close(); } catch { /* noop */ }
  }
}
