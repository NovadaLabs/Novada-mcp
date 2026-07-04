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
// It exports TOOLS (33 npm-visible tools), HIDDEN_ALIASES (9 npm-alias names), and
// dispatch() which THROWS on error and returns a bare string — all hosted transport
// wrappers (quota, redaction, wall-clock, ALS) stay in this file.
import {
  TOOLS as CORE_TOOLS,
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
// L3 unified-key: populate the request-scoped credential store with the caller's key so
// store-reading resolvers (getWebUnblockerKey → store.apiKey, resolveProxyCredentials,
// resolveBrowserWs) use the CALLER's key on hosted instead of falling back to server env.
import { withCredentials } from "../vendor/novada-mcp/utils/credentials.js";
// MCP prompts (tool-selection decision trees) — same module the npm server uses (1:1 parity). Static, safe on serverless.
import { listPrompts, getPrompt } from "../vendor/novada-mcp/prompts/index.js";

// Hosted server version = `<vendored npm version>.<server build tag>-hosted`.
//   • The npm-version part is DERIVED from the vendored package — NEVER hardcoded.
//     (A hardcoded "0.8.2-hosted" once silently drifted two releases behind the
//     vendored 0.8.4; deriving guarantees this part always tracks the shipped tools.)
//   • HOSTED_BUILD tags a server-ONLY deploy that ships no npm change — e.g. this
//     version-derive fix lives only in novada-mcpserver, so npm stays 0.8.4 while
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
// but in exchange the entire 25-tool surface works without porting.
const FUNCTION_MAX_DURATION_S = 60; // novada_research can take 30-45s on deep mode
export const config = {
  runtime: "nodejs",
  maxDuration: 60, // MUST be a literal — Vercel statically parses this `config` export and cannot resolve an identifier (keep in sync with FUNCTION_MAX_DURATION_S above)
};

// #5: per-tool wall-clock budget, set a few seconds UNDER maxDuration. If a tool
// somehow runs past this (a primitive that ignored its own ceiling, an upstream
// stall), we throw a structured NovadaError the catch turns into a JSON-RPC error
// envelope — the client NEVER sees the bare HTTP 504 Vercel emits on a hard kill,
// which is not valid JSON-RPC and breaks MCP clients. The tool-level config.ts
// ceilings (≤50s) are the primary guard; this is defense in depth.
const TOOL_WALL_CLOCK_MS = (FUNCTION_MAX_DURATION_S - 4) * 1000; // ~56s

/**
 * Race a tool promise against the wall-clock budget. On timeout, reject with a
 * structured NovadaError (TASK_PENDING — transient + retryable) so the call still
 * returns a JSON-RPC error envelope instead of being hard-killed into a bare 504.
 */
function withWallClock<T>(toolName: string, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new NovadaError({
        code: NovadaErrorCode.TASK_PENDING,
        message: `${toolName} exceeded the hosted ${TOOL_WALL_CLOCK_MS / 1000}s time budget and was stopped before the function timed out.`,
        agent_instruction:
          `The hosted endpoint caps each call below the serverless function limit. ` +
          `Retry with a narrower request (fewer URLs, render="static", a smaller depth/limit), ` +
          `or run the local MCP server (\`npx novada-mcp\`) which has no per-call wall-clock cap.`,
        retryable: true,
      }));
    }, TOOL_WALL_CLOCK_MS);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// ─── Env shape (read from process.env on Vercel) ─────────────────────────────
// Required env vars:
//   NOVADA_API_KEY            ← upstream Novada API key (vercel env add ...)
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
  NOVADA_API_KEY?: string;
  STUB_AUTH_WARNING_ACCEPTED?: string;
  RATE_LIMIT_PER_MIN?: string;
}

function readEnv(): Env {
  return {
    NOVADA_API_BASE: process.env.NOVADA_API_BASE || "https://api.novada.com",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    FREE_PLAN_MONTHLY_QUOTA: process.env.FREE_PLAN_MONTHLY_QUOTA || "1000",
    NOVADA_API_KEY: process.env.NOVADA_API_KEY,
    STUB_AUTH_WARNING_ACCEPTED: process.env.STUB_AUTH_WARNING_ACCEPTED,
    RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN,
  };
}

// ─── Zod → MCP JSON Schema ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  const { $schema, $defs, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}

// ─── Tool catalog ────────────────────────────────────────────────────────────
const TOOLS = [
  { name: "novada_search",              title: "Web Search",                 schema: SearchParamsSchema,              description: "Search the web via Google, Bing, DuckDuckGo, Yahoo, or Yandex. Use when you need to find relevant pages but don't know the URL. Returns titles, URLs, and snippets. For full page content, follow up with extract." },
  { name: "novada_extract",             title: "Content Extractor",          schema: ExtractParamsSchema,             description: "Read clean content from one or more URLs. Use when you have a specific page URL and need its content. Handles anti-bot protection automatically. For raw HTML, use format='html'. For multiple pages on one site, use crawl instead." },
  { name: "novada_crawl",               title: "Site Crawler",               schema: CrawlParamsSchema,               description: "Read content from multiple pages on one site (up to 20). Use when you need an entire section of a website. Optionally run map first to discover target URLs." },
  { name: "novada_research",            title: "Deep Research",              schema: ResearchParamsSchema,            description: "Deep multi-source research: searches multiple angles, reads top sources, returns a synthesized report with citations. Use when you need comprehensive analysis of an open-ended topic (not a yes/no claim — use verify for that). Slower than a single search." },
  { name: "novada_map",                 title: "URL Mapper",                 schema: MapParamsSchema,                 description: "List all URLs on a website via sitemap or crawl. Use when you need to find the right page before crawl/extract. Returns URLs only, no content. Fast site reconnaissance." },
  { name: "novada_scrape",              title: "Platform Scraper",           schema: ScrapeParamsSchema,              description: "Structured data from Amazon, Reddit, TikTok, LinkedIn, GitHub, YouTube, Twitter/X, Walmart, and more platforms. Use when you need e-commerce products, social posts, or job listings — NOT general websites (use extract for those)." },

  { name: "novada_browser",             title: "Browser Automation",         schema: BrowserParamsSchema,             description: "Automate Novada's cloud browser via CDP — navigate, click, type, screenshot, snapshot. One-shot tasks per call. Credentials auto-provisioned from your API key." },
  { name: "novada_proxy",               title: "Proxy Credentials",          schema: ProxyParamsSchema,               description: "Proxy credentials for your own HTTP clients. type=residential|isp|datacenter|mobile|static|dedicated (default residential). Not needed for extract/crawl — those handle proxies internally." },
  { name: "novada_discover",            title: "Tool Discovery",             schema: DiscoverParamsSchema,            description: "List all available Novada tools grouped by category." },
  { name: "novada_ai_monitor",          title: "AI Brand Monitor",           schema: AiMonitorParamsSchema,           description: "Check how AI models (ChatGPT, Perplexity, Grok, etc.) reference a brand or product." },
  { name: "novada_monitor",             title: "Page Change Monitor",        schema: MonitorParamsSchema,             description: "Track changes on a web page over time. Compares content hash and field-level diffs." },
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

// ─── Derived hidden-alias allowlist (structural fix for bug#2) ───────────────
// Instead of a hand-maintained list that drifts whenever core adds/removes an alias,
// derive it: anything core.dispatch can handle that isn't in the hosted visible set
// and isn't HOSTED_HIDDEN (browser_flow refusal) is allowed past the visibility guards.
// This means any alias added to core.ts is automatically routable here too.
//
//   VISIBLE        = the 15-tool hosted visible set (defined in TOOLS above)
//   ALL_ROUTABLE   = every name core.dispatch handles (33 CORE_TOOLS + 9 NPM_HIDDEN_ALIASES)
//   HOSTED_HIDDEN  = names that must REFUSE on hosted (browser_flow — persistent WS)
//   HOSTED_HIDDEN_ALIASES = ALL_ROUTABLE minus (VISIBLE ∪ HOSTED_HIDDEN)
const HOSTED_HIDDEN_ALIASES: ReadonlySet<string> = (() => {
  const visible = new Set(TOOLS.map((t) => t.name));
  const allRoutable = new Set([
    ...CORE_TOOLS.map((t: { name: string }) => t.name),
    ...NPM_HIDDEN_ALIASES,
  ]);
  return new Set([...allRoutable].filter((n) => !visible.has(n) && !HOSTED_HIDDEN.has(n)));
})();

// ─── Tool-set filtering (?tools= / ?groups=) ─────────────────────────────────
// Lets a client request a slim toolset, e.g. ?groups=search,scrape or
// ?tools=novada_search,novada_scrape. Matches BrightData's ?groups= pattern.
// Fewer tools = less token overhead in the agent's context window.
const TOOL_GROUPS: Record<string, string[]> = {
  core: ["novada_search", "novada_extract", "novada_crawl", "novada_research", "novada_map", "novada_scrape", "novada_setup", "novada_account", "novada_monitor", "novada_discover"],
  search: ["novada_search"],
  scrape: ["novada_scrape", "novada_extract"],
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

/**
 * Validate a Novada API key. Accepts any non-empty hex-like string (the standard
 * Novada API key format, e.g. "1f35b477c9e1802778ec64aee2a6adfa").
 * TODO(sub2api): wire to sub2api for per-user plan/quota resolution.
 */
async function validateToken(token: string, env: Env): Promise<TokenInfo> {
  // Accept any non-empty token that looks like a valid API key (alphanumeric, 16+ chars).
  if (!token || token.length < 16 || !/^[a-zA-Z0-9_\-]+$/.test(token)) {
    return { valid: false, plan: "free", quota_remaining: 0 };
  }
  const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10);
  return { valid: true, plan: "free", quota_remaining: monthlyQuota };
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
  // 1. Exact NOVADA_BROWSER_WS value (contains user:pass@host) — redact first.
  const browserWs = process.env.NOVADA_BROWSER_WS?.trim();
  if (browserWs) out = out.split(browserWs).join("[browser-ws-endpoint]");
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
            "## Quota Exhausted",
            "",
            `Your free-plan monthly quota (${parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10)} calls/month) has been used up.`,
            "",
            "**Options:**",
            "1. Wait until next month for the free tier to reset",
            "2. Use a local MCP server (unlimited): `npx novada-mcp` with your own API key",
            "3. Contact sales@novada.com for higher limits",
            "",
            "agent_instruction: quota_exhausted | retry_recommended: false | alternative: install local MCP server via npx novada-mcp for unlimited usage with your own API key",
          ].join("\n"),
        }],
        isError: true,
      };
    }

    // Wrap the whole dispatch so the caller's apiKey populates the AsyncLocalStorage
    // credential store for every store-reading resolver underneath (Web Unblocker / proxy /
    // browser). store.run() transparently propagates the inner return values and rejections.
    return await withCredentials({ apiKey }, async () => {
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
      // all 33 CORE_TOOLS. On hosted we pass visibleToolNames so the output only advertises
      // the 15 tools the agent can actually call on this endpoint.
      if (name === "novada_discover") {
        const result = await novadaDiscover(validateDiscoverParams(argsObj), visibleToolNames);
        logUsage(env, ctx.token, name, true, Date.now() - started);
        const sanitized = sanitizeHostedOutput(result);
        return { content: [{ type: "text" as const, text: sanitized }] };
      }

      // ── Single dispatch call (replaces the old hand-maintained switch) ──
      // core.dispatch handles routing for all 33 npm tools + 9 npm hidden aliases.
      // It throws Error("Unknown tool: <name>") for anything not in its switch.
      // withWallClock races the Promise against the 56s wall-clock budget.
      const result = await withWallClock(
        name,
        dispatch(name, argsObj, apiKey, { onProgress: undefined }),
      );

      logUsage(env, ctx.token, name, true, Date.now() - started);
      const sanitized = sanitizeHostedOutput(result);
      // Append quota footer only when quota is running low (< 20% of monthly)
      const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10);
      const quotaFooter = remaining < monthlyQuota * 0.2
        ? `\n\n---\n⚠ Quota: ${remaining}/${monthlyQuota} calls remaining this month.`
        : "";
      return {
        content: [{ type: "text" as const, text: sanitized + quotaFooter }],
        _meta: { quota_remaining: remaining },
      };
    } catch (error) {
      Sentry.withScope(scope => {
        scope.setTag("tool", name);
        Sentry.captureException(error);
      });
      await sentryFlush();
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
      "Missing token. Pass ?token=YOUR_API_KEY or Authorization: Bearer YOUR_API_KEY.",
      "Get your API key at https://dashboard.novada.com/overview/scraper/api-playground/");
  }
  const info = await validateToken(token, env);
  if (!info.valid) {
    return jsonError(401, "INVALID_TOKEN",
      "Invalid API key. Use your Novada API key (32-char hex string from the dashboard).",
      "Get your API key at https://dashboard.novada.com/overview/scraper/api-playground/");
  }

  // Per-IP rate limit — slow down abusive loops from an authenticated key.
  // Identity comes from a Vercel-trusted IP header (never spoofable raw XFF).
  const ip = getClientIp(request);
  if (await rateLimitExceeded(ip, env)) {
    return jsonError(429, "RATE_LIMITED",
      `Too many requests from your IP. Limit is ${env.RATE_LIMIT_PER_MIN || "60"} requests/minute.`,
      "Retry after 60 seconds. If you need higher limits, contact sales@novada.com.");
  }

  // Upstream Novada API key — use the customer's own key (pass-through model).
  // The customer's token IS their Novada API key. Their own account balance is used.
  // Fallback to env var NOVADA_API_KEY only for backward compat / operator testing.
  const apiKey = token || env.NOVADA_API_KEY?.trim();
  if (!apiKey) {
    return jsonError(500, "FUNCTION_MISCONFIGURED",
      "No API key available. Provide your Novada API key via the URL.",
      "Get your API key at https://dashboard.novada.com/overview/scraper/api-playground/");
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
