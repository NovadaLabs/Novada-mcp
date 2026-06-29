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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { kv } from "@vercel/kv";

// ─── Tool implementations & schemas (re-used from local novada-mcp) ──────────
import {
  novadaSearch,
  novadaExtract,
  novadaCrawl,
  novadaResearch,
  novadaMap,
  novadaProxy,
  novadaScrape,
  novadaVerify,
  novadaUnblock,
  novadaBrowser, // TODO: port for Edge runtime — uses playwright-core CDP, native deps
  novadaHealth,
  novadaHealthAll,
  novadaDiscover,
  novadaScraperSubmit,
  novadaScraperStatus,
  novadaScraperResult,
  novadaBrowserFlow, // TODO: port for Edge runtime — depends on cloud browser WS
  novadaAiMonitor,
  novadaMonitor,
  novadaProxyResidential,
  novadaProxyIsp,
  novadaProxyDatacenter,
  novadaProxyMobile,
  novadaProxyStatic,
  novadaProxyDedicated,
  novadaSetup,
  validateMonitorParams,
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateResearchParams,
  validateMapParams,
  validateProxyParams,
  validateScrapeParams,
  validateVerifyParams,
  validateUnblockParams,
  validateBrowserParams,
  validateHealthParams,
  validateHealthAllParams,
  validateDiscoverParams,
  validateScraperSubmitParams,
  validateScraperStatusParams,
  validateScraperResultParams,
  validateBrowserFlowParams,
  validateProxyResidentialParams,
  validateProxyIspParams,
  validateProxyDatacenterParams,
  validateProxyMobileParams,
  validateProxyStaticParams,
  validateProxyDedicatedParams,
  validateSetupParams,
  SetupParamsSchema,
  ProxyResidentialParamsSchema,
  ProxyIspParamsSchema,
  ProxyDatacenterParamsSchema,
  ProxyMobileParamsSchema,
  ProxyStaticParamsSchema,
  ProxyDedicatedParamsSchema,
  HealthAllParamsSchema,
  DiscoverParamsSchema,
  ScraperSubmitParamsSchema,
  ScraperStatusParamsSchema,
  ScraperResultParamsSchema,
  BrowserFlowParamsSchema,
  // ── Account / billing tools (KR-6) — pass-through key only (customer's own account) ──
  novadaWalletBalance,
  novadaWalletUsageRecord,
  novadaPlanBalanceAll,
  novadaProxyAccountList,
  novadaProxyAccountCreate,
  novadaTrafficDaily,
  novadaAccountSummary,
  novadaCaptureLogs,
  validateWalletBalanceParams,
  validateWalletUsageRecordParams,
  validatePlanBalanceAllParams,
  validateProxyAccountListParams,
  validateProxyAccountCreateParams,
  validateTrafficDailyParams,
  validateAccountSummaryParams,
  validateCaptureLogsParams,
  WalletBalanceParamsSchema,
  WalletUsageRecordParamsSchema,
  PlanBalanceAllParamsSchema,
  ProxyAccountListParamsSchema,
  ProxyAccountCreateParamsSchema,
  TrafficDailyParamsSchema,
  AccountSummaryParamsSchema,
  CaptureLogsParamsSchema,
} from "../vendor/novada-mcp/tools/index.js";

import {
  SearchParamsSchema,
  ExtractParamsSchema,
  CrawlParamsSchema,
  ResearchParamsSchema,
  MapParamsSchema,
  ProxyParamsSchema,
  ScrapeParamsSchema,
  VerifyParamsSchema,
  UnblockParamsSchema,
  BrowserParamsSchema,
  HealthParamsSchema,
  AiMonitorParamsSchema,
  validateAiMonitorParams,
} from "../vendor/novada-mcp/tools/types.js";
import { MonitorParamsSchema } from "../vendor/novada-mcp/tools/monitor.js";
import vendorPkg from "../vendor/novada-mcp/package.json" with { type: "json" };
import { NovadaError } from "../vendor/novada-mcp/_core/errors.js";

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
export const config = {
  runtime: "nodejs",
  maxDuration: 60, // novada_research can take 30-45s on deep mode
};

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
  { name: "novada_extract",             title: "Content Extractor",          schema: ExtractParamsSchema,             description: "Read clean content from one or more URLs. Use when you have a specific page URL and need its content. Handles anti-bot protection automatically (if extract still fails, try unblock). For multiple pages on one site, use crawl instead." },
  { name: "novada_crawl",               title: "Site Crawler",               schema: CrawlParamsSchema,               description: "Read content from multiple pages on one site (up to 20). Use when you need an entire section of a website. Optionally run map first to discover target URLs." },
  { name: "novada_research",            title: "Deep Research",              schema: ResearchParamsSchema,            description: "Deep multi-source research: searches multiple angles, reads top sources, returns a synthesized report with citations. Use when you need comprehensive analysis of an open-ended topic (not a yes/no claim — use verify for that). Slower than a single search." },
  { name: "novada_map",                 title: "URL Mapper",                 schema: MapParamsSchema,                 description: "List all URLs on a website via sitemap or crawl. Use when you need to find the right page before crawl/extract. Returns URLs only, no content. Fast site reconnaissance." },
  { name: "novada_scrape",              title: "Platform Scraper",           schema: ScrapeParamsSchema,              description: "Structured data from Amazon, Reddit, TikTok, LinkedIn, GitHub, YouTube, Twitter/X, Walmart, and more platforms. Use when you need e-commerce products, social posts, or job listings — NOT general websites (use extract for those)." },
  { name: "novada_verify",              title: "Claim Verifier",             schema: VerifyParamsSchema,              description: "Fact-check a claim by searching from 3 angles (supporting, skeptical, fact-check). Use when you need to validate a statement before citing it. Returns verdict (supported/unsupported/contested) + confidence 0-100." },
  { name: "novada_unblock",             title: "Anti-Bot Unblocking",        schema: UnblockParamsSchema,             description: "Get raw HTML from bot-protected pages via JS rendering or headless browser. Use only when extract fails on a protected page and you need the raw HTML." },
  { name: "novada_browser",             title: "Browser Automation",         schema: BrowserParamsSchema,             description: "Automate a cloud browser via CDP — click, type, screenshot, navigate. Local MCP only (not available on hosted)." },
  { name: "novada_proxy",               title: "Proxy Credentials",          schema: ProxyParamsSchema,               description: "Generate proxy credentials (URL/env/curl format) for your own HTTP clients. Not needed for extract/crawl — those handle proxies internally." },
  { name: "novada_proxy_residential",   title: "Residential Proxy",          schema: ProxyResidentialParamsSchema,    description: "Residential proxy credentials — real home ISP IPs, best for anti-bot bypass. For web extraction, use extract instead." },
  { name: "novada_proxy_isp",           title: "ISP Proxy",                  schema: ProxyIspParamsSchema,            description: "ISP proxy credentials — looks like home users. For web extraction, use extract instead." },
  { name: "novada_proxy_datacenter",    title: "Datacenter Proxy",           schema: ProxyDatacenterParamsSchema,     description: "Datacenter proxy credentials — fastest, cheapest. For web extraction, use extract instead." },
  { name: "novada_proxy_mobile",        title: "Mobile Proxy",               schema: ProxyMobileParamsSchema,         description: "Mobile 4G/5G proxy credentials. For web extraction, use extract instead." },
  { name: "novada_proxy_static",        title: "Static ISP Proxy",           schema: ProxyStaticParamsSchema,         description: "Static ISP proxy — same IP every request for a session_id+country pair. For web extraction, use extract instead." },
  { name: "novada_proxy_dedicated",     title: "Dedicated Proxy",            schema: ProxyDedicatedParamsSchema,      description: "Exclusive datacenter IP, not shared with other users. For web extraction, use extract instead." },
  { name: "novada_health",              title: "Health Check",               schema: HealthParamsSchema,              description: "Quick health check — which Novada API products are active on your key." },
  { name: "novada_health_all",          title: "Extended Health Check",      schema: HealthAllParamsSchema,           description: "Detailed health check across all 6 Novada product endpoints with latency." },
  { name: "novada_discover",            title: "Tool Discovery",             schema: DiscoverParamsSchema,            description: "List all available Novada tools grouped by category." },
  { name: "novada_scraper_submit",      title: "Async Scraper Submit",       schema: ScraperSubmitParamsSchema,       description: "Start an async scraping task. Returns task_id. Step 1 of 3: submit → status → result." },
  { name: "novada_scraper_status",      title: "Async Scraper Status",       schema: ScraperStatusParamsSchema,       description: "Check async scraping task progress. Step 2 of 3: submit → status → result." },
  { name: "novada_scraper_result",      title: "Async Scraper Result",       schema: ScraperResultParamsSchema,       description: "Get completed async scraping results. Step 3 of 3: submit → status → result." },
  { name: "novada_browser_flow",        title: "Browser Flow Automation",    schema: BrowserFlowParamsSchema,         description: "Multi-step browser automation with persistent sessions. Local MCP only (not available on hosted)." },
  { name: "novada_ai_monitor",          title: "AI Brand Monitor",           schema: AiMonitorParamsSchema,           description: "Check how AI models (ChatGPT, Perplexity, Grok, etc.) reference a brand or product." },
  { name: "novada_monitor",             title: "Page Change Monitor",        schema: MonitorParamsSchema,             description: "Track changes on a web page over time. Compares content hash and field-level diffs." },
  { name: "novada_setup",               title: "Setup & Configuration",      schema: SetupParamsSchema,               description: "Check your API key and environment configuration. Use when you want to verify setup or see which Novada products are active. Auth-free, no quota used." },
  // ── Account / billing tools ──
  { name: "novada_wallet_balance",      title: "Wallet Balance",             schema: WalletBalanceParamsSchema,       description: "Your master wallet balance (the account the API key belongs to)." },
  { name: "novada_wallet_usage_record", title: "Wallet Usage Record",        schema: WalletUsageRecordParamsSchema,   description: "Paginated wallet transaction / usage history." },
  { name: "novada_plan_balance_all",    title: "Plan Balances",              schema: PlanBalanceAllParamsSchema,      description: "Per-product plan balances (residential/isp/datacenter/mobile/static/capture) in parallel." },
  { name: "novada_proxy_account_list",  title: "Proxy Account List",         schema: ProxyAccountListParamsSchema,    description: "List proxy sub-accounts for a product (paginated)." },
  { name: "novada_proxy_account_create",title: "Proxy Account Create",       schema: ProxyAccountCreateParamsSchema,  description: "Create a proxy sub-account. Two-step confirm gate (pass confirm:true after human approval).", write: true },
  { name: "novada_traffic_daily",       title: "Daily Traffic Report",       schema: TrafficDailyParamsSchema,        description: "Daily traffic consumption across proxy products for a date range." },
  { name: "novada_account_summary",     title: "Account Summary",            schema: AccountSummaryParamsSchema,      description: "One-shot account overview: wallet + plans + recent capture cost." },
  { name: "novada_capture_logs",        title: "Capture Logs",               schema: CaptureLogsParamsSchema,         description: "Hourly capture/unlocker/scraper/browser cost breakdown." },
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
const HOSTED_HIDDEN = new Set(["novada_browser", "novada_browser_flow"]);

// ─── Tool-set filtering (?tools= / ?groups=) ─────────────────────────────────
// Lets a client request a slim toolset, e.g. ?groups=search,scrape or
// ?tools=novada_search,novada_scrape. Matches BrightData's ?groups= pattern.
// Fewer tools = less token overhead in the agent's context window.
const TOOL_GROUPS: Record<string, string[]> = {
  core: ["novada_search", "novada_extract", "novada_crawl", "novada_research", "novada_map", "novada_scrape", "novada_verify", "novada_setup"],
  search: ["novada_search"],
  scrape: ["novada_scrape", "novada_extract", "novada_unblock"],
  crawl: ["novada_crawl", "novada_map"],
  research: ["novada_research", "novada_verify", "novada_discover", "novada_ai_monitor", "novada_monitor"],
  scraper: ["novada_scraper_submit", "novada_scraper_status", "novada_scraper_result"],
  proxy: ["novada_proxy", "novada_proxy_residential", "novada_proxy_isp", "novada_proxy_datacenter", "novada_proxy_mobile", "novada_proxy_static", "novada_proxy_dedicated"],
  account: ["novada_wallet_balance", "novada_wallet_usage_record", "novada_plan_balance_all", "novada_proxy_account_list", "novada_proxy_account_create", "novada_traffic_daily", "novada_account_summary", "novada_capture_logs"],
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
    // Default to core tools for first-time users — reduces cognitive overload from 40+ tools
    // Users can pass ?groups=all or ?groups=core,advanced,account to see more
    return new Set([...TOOL_GROUPS["core"], "novada_setup"]);
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
  const raw = await kv.get<string | number>(key);
  const count = raw ? (typeof raw === "number" ? raw : parseInt(String(raw), 10)) : 0;
  if (count >= limit) return true;
  await kv.set(key, String(count + 1), { ex: 120 });
  return false;
}

/** Short stable identifier for a token, safe to log (SHA-256 first 12 hex chars). */
async function tokenFingerprint(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

function monthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Returns the new remaining count, or -1 if the request must be rejected. */
async function decrementQuota(token: string, env: Env, plan: "free" | "pro"): Promise<number> {
  const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "1000", 10);
  const key = `${token}:${monthKey()}`;
  const raw = await kv.get<string | number>(key);
  const used = raw ? (typeof raw === "number" ? raw : parseInt(String(raw), 10)) : 0;
  if (plan === "free" && used >= monthlyQuota) return -1;
  const next = used + 1;
  // 32-day TTL — KV will GC the key after the month rolls over.
  await kv.set(key, String(next), { ex: 60 * 60 * 24 * 32 });
  return Math.max(0, monthlyQuota - next);
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

// ─── MCP server factory ──────────────────────────────────────────────────────
function buildServer(apiKey: string, env: Env, ctx: { token: string; allowedTools?: Set<string> | null }): Server {
  const server = new Server(
    { name: "novada", version: HOSTED_VERSION },
    { capabilities: { tools: {} } },
  );

  const isHosted = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  const visibleTools = (ctx.allowedTools
    ? TOOLS.filter((t) => ctx.allowedTools!.has(t.name))
    : TOOLS
  ).filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: visibleTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const argsObj = (args as Record<string, unknown>) ?? {};
    const started = Date.now();

    // Tool-set filter: reject tools not in the endpoint's ?tools=/?groups= selection.
    if (ctx.allowedTools && !ctx.allowedTools.has(name)) {
      return {
        content: [{
          type: "text" as const,
          text: `Error [TOOL_NOT_ENABLED]: '${name}' is not enabled on this endpoint. It was filtered out by the ?tools=/?groups= URL parameter.\nagent_instruction: Remove the filter from the MCP URL, or add this tool/group to it, to use ${name}.`,
        }],
        isError: true,
      };
    }

    // novada_setup is auth-free and never charged against quota.
    if (name === "novada_setup") {
      try {
        const result = novadaSetup(validateSetupParams(argsObj));
        logUsage(env, ctx.token, name, true, Date.now() - started);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (e) {
        logUsage(env, ctx.token, name, false, Date.now() - started);
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    }

    // Decrement quota BEFORE the call so abusive loops can't burn free credits.
    const remaining = await decrementQuota(ctx.token, env, "free");
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

    try {
      let result: string;
      switch (name) {
        case "novada_search":
          result = await novadaSearch(validateSearchParams(argsObj), apiKey); break;
        case "novada_extract":
          result = await novadaExtract(validateExtractParams(argsObj), apiKey); break;
        case "novada_crawl":
          result = await novadaCrawl(validateCrawlParams(argsObj), apiKey); break;
        case "novada_research":
          result = await novadaResearch(validateResearchParams(argsObj), apiKey); break;
        case "novada_map":
          result = await novadaMap(validateMapParams(argsObj), apiKey); break;
        case "novada_proxy":
          result = await novadaProxy(validateProxyParams(argsObj)); break;
        case "novada_scrape":
          result = await novadaScrape(validateScrapeParams(argsObj), apiKey); break;
        case "novada_verify":
          result = await novadaVerify(validateVerifyParams(argsObj), apiKey); break;
        case "novada_unblock":
          result = await novadaUnblock(validateUnblockParams(argsObj), apiKey); break;
        case "novada_browser":
          // 🔴 NOT AVAILABLE ON HOSTED — Playwright native deps don't run in Edge runtime.
          logUsage(env, ctx.token, name, false, Date.now() - started);
          return {
            content: [{
              type: "text" as const,
              text: "Error [NOT_AVAILABLE_ON_HOSTED]: novada_browser requires native Playwright binaries and cannot run on the hosted MCP server.\nagent_instruction: To use novada_browser, install the local MCP server via `npx novada-mcp` and call it from your client instead. All other Novada tools (search/scrape/extract/map/crawl/verify/research/proxy/*) work on the hosted server.",
            }],
            isError: true,
          };
        case "novada_health":
          validateHealthParams(argsObj);
          result = await novadaHealth(apiKey); break;
        case "novada_health_all":
          validateHealthAllParams(argsObj);
          result = await novadaHealthAll(apiKey); break;
        case "novada_discover":
          result = await novadaDiscover(validateDiscoverParams(argsObj)); break;
        case "novada_scraper_submit":
          result = await novadaScraperSubmit(validateScraperSubmitParams(argsObj), apiKey); break;
        case "novada_scraper_status":
          result = await novadaScraperStatus(validateScraperStatusParams(argsObj), apiKey); break;
        case "novada_scraper_result":
          result = await novadaScraperResult(validateScraperResultParams(argsObj), apiKey); break;
        case "novada_browser_flow":
          // 🔴 NOT AVAILABLE ON HOSTED — cloud browser WS path needs Edge-compatible WebSocket runtime.
          logUsage(env, ctx.token, name, false, Date.now() - started);
          return {
            content: [{
              type: "text" as const,
              text: "Error [NOT_AVAILABLE_ON_HOSTED]: novada_browser_flow requires WebSocket transport not yet ported to Vercel Edge runtime.\nagent_instruction: Use the local MCP server (`npx novada-mcp`) for browser-flow tasks, or use novada_scrape / novada_extract for static-content extraction on the hosted server.",
            }],
            isError: true,
          };
        case "novada_proxy_residential":
          result = await novadaProxyResidential(validateProxyResidentialParams(argsObj)); break;
        case "novada_proxy_isp":
          result = await novadaProxyIsp(validateProxyIspParams(argsObj)); break;
        case "novada_proxy_datacenter":
          result = await novadaProxyDatacenter(validateProxyDatacenterParams(argsObj)); break;
        case "novada_proxy_mobile":
          result = await novadaProxyMobile(validateProxyMobileParams(argsObj)); break;
        case "novada_proxy_static":
          result = await novadaProxyStatic(validateProxyStaticParams(argsObj)); break;
        case "novada_proxy_dedicated":
          result = await novadaProxyDedicated(validateProxyDedicatedParams(argsObj)); break;
        case "novada_ai_monitor":
          result = await novadaAiMonitor(validateAiMonitorParams(argsObj), apiKey); break;
        case "novada_monitor":
          result = await novadaMonitor(validateMonitorParams(argsObj), apiKey); break;
        // ── Account / billing (KR-6) — apiKey is the customer's pass-through key (their own account) ──
        case "novada_wallet_balance":
          result = await novadaWalletBalance(validateWalletBalanceParams(argsObj), apiKey); break;
        case "novada_wallet_usage_record":
          result = await novadaWalletUsageRecord(validateWalletUsageRecordParams(argsObj), apiKey); break;
        case "novada_plan_balance_all":
          result = await novadaPlanBalanceAll(validatePlanBalanceAllParams(argsObj), apiKey); break;
        case "novada_proxy_account_list":
          result = await novadaProxyAccountList(validateProxyAccountListParams(argsObj), apiKey); break;
        case "novada_proxy_account_create":
          result = await novadaProxyAccountCreate(validateProxyAccountCreateParams(argsObj), apiKey); break;
        case "novada_traffic_daily":
          result = await novadaTrafficDaily(validateTrafficDailyParams(argsObj), apiKey); break;
        case "novada_account_summary":
          result = await novadaAccountSummary(validateAccountSummaryParams(argsObj), apiKey); break;
        case "novada_capture_logs":
          result = await novadaCaptureLogs(validateCaptureLogsParams(argsObj), apiKey); break;
        default:
          logUsage(env, ctx.token, name, false, Date.now() - started);
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
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
      logUsage(env, ctx.token, name, false, Date.now() - started);
      if (error instanceof ZodError) {
        const issues = error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Validation failed for ${name}:\n${issues}\n\nagent_instruction: Check the tool's inputSchema for required fields and valid types. Call list_tools to see the schema for ${name}.` }],
          isError: true,
        };
      }
      // NovadaError carries a tailored agent_instruction / failure_class / retry hint —
      // preserve it verbatim (npm-parity). Only fall through to the hosted substring hints
      // below for non-NovadaError errors. (NOV-571: the hosted endpoint was dropping all of
      // this and returning a bare truncated message.)
      if (error instanceof NovadaError) {
        return {
          content: [{ type: "text" as const, text: error.toAgentString() }],
          isError: true,
        };
      }
      // Hosted-aware error wrapping — translate internal errors to actionable guidance
      const rawMsg = error instanceof Error ? error.message : String(error);
      let userMsg = rawMsg;

      // Common hosted failure: NOVADA_WEB_UNBLOCKER_KEY not set → extract/unblock render fails
      if (rawMsg.includes("NOVADA_WEB_UNBLOCKER_KEY") || rawMsg.includes("UNBLOCKER_NOT_CONFIGURED")) {
        userMsg = `Extract/unblock JS rendering is not configured on this hosted endpoint. The tool attempted static extraction only. For JS-heavy pages, use a local MCP server with NOVADA_WEB_UNBLOCKER_KEY configured, or try novada_scrape for platform-specific data.`;
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
      // Cap total length
      if (userMsg.length > 500) {
        userMsg = userMsg.slice(0, 497) + "...";
      }

      return {
        content: [{ type: "text" as const, text: userMsg }],
        isError: true,
      };
    }
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
 * Extract client IP. Vercel Edge sets `x-forwarded-for` and `x-real-ip`.
 * Falls back to "unknown" — rate limit is then skipped.
 */
function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
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

async function readNodeBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method || "GET").toUpperCase();
  if (["GET", "HEAD"].includes(method)) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
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
      // Log full error server-side but don't leak internals to client
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

  // Per-IP rate limit — slow down token brute-force enumeration.
  const ip = getClientIp(request);
  if (await rateLimitExceeded(ip, env)) {
    return jsonError(429, "RATE_LIMITED",
      `Too many requests from your IP. Limit is ${env.RATE_LIMIT_PER_MIN || "60"} requests/minute.`,
      "Retry after 60 seconds. If you need higher limits, contact sales@novada.com.");
  }

  // CORS preflight (some MCP clients probe with OPTIONS)
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

  // Auth
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

  // Build a fresh server + transport per request (stateless mode). Edge
  // functions are per-request isolates with no shared memory — same pattern
  // as the CF Worker port.
  const server = buildServer(apiKey, env, { token, allowedTools });
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
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, "TRANSPORT_ERROR", `MCP transport error: ${message}`);
  } finally {
    try { await server.close(); } catch { /* noop */ }
  }
}
