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
  { name: "novada_search", schema: SearchParamsSchema, description: "Search the web via 5 engines. Returns titles/URLs/snippets reranked by relevance." },
  { name: "novada_extract", schema: ExtractParamsSchema, description: "Extract clean content from any URL with anti-bot auto-escalation." },
  { name: "novada_crawl", schema: CrawlParamsSchema, description: "BFS/DFS crawl up to 20 pages of a site, extract content from each." },
  { name: "novada_research", schema: ResearchParamsSchema, description: "Multi-source research: fan-out search → dedup → extract → synthesized cited report." },
  { name: "novada_map", schema: MapParamsSchema, description: "Discover URLs on a site via sitemap.xml or BFS crawl. URL list only." },
  { name: "novada_scrape", schema: ScrapeParamsSchema, description: "Structured data from 129 platforms (Amazon, Reddit, TikTok, LinkedIn, etc.)." },
  { name: "novada_verify", schema: VerifyParamsSchema, description: "Fact-check a claim via 3 parallel search angles. Returns verdict + confidence." },
  { name: "novada_unblock", schema: UnblockParamsSchema, description: "Raw rendered HTML of blocked/JS-heavy pages via Web Unblocker or Browser API." },
  { name: "novada_browser", schema: BrowserParamsSchema, description: "Multi-action browser automation via CDP. TODO: cold-start fitness on Edge runtime." },
  { name: "novada_proxy", schema: ProxyParamsSchema, description: "Generic proxy credentials (URL/env/curl format) for your own HTTP clients." },
  { name: "novada_proxy_residential", schema: ProxyResidentialParamsSchema, description: "Residential proxy credentials (100M+ home ISP IPs)." },
  { name: "novada_proxy_isp", schema: ProxyIspParamsSchema, description: "ISP-assigned static proxy credentials — looks like real home users." },
  { name: "novada_proxy_datacenter", schema: ProxyDatacenterParamsSchema, description: "Datacenter proxy credentials — fastest, cheapest." },
  { name: "novada_proxy_mobile", schema: ProxyMobileParamsSchema, description: "4G/5G mobile proxy credentials." },
  { name: "novada_proxy_static", schema: ProxyStaticParamsSchema, description: "Static dedicated ISP IP — never changes for same session_id+country." },
  { name: "novada_proxy_dedicated", schema: ProxyDedicatedParamsSchema, description: "Exclusive datacenter IP, not shared with any other user." },
  { name: "novada_health", schema: HealthParamsSchema, description: "Check which Novada API products are active on your key." },
  { name: "novada_health_all", schema: HealthAllParamsSchema, description: "Extended per-product health check across all Novada endpoints." },
  { name: "novada_discover", schema: DiscoverParamsSchema, description: "List all available Novada tools by category and status." },
  { name: "novada_scraper_submit", schema: ScraperSubmitParamsSchema, description: "Submit async scraping task. Returns task_id." },
  { name: "novada_scraper_status", schema: ScraperStatusParamsSchema, description: "Poll async scraping task status." },
  { name: "novada_scraper_result", schema: ScraperResultParamsSchema, description: "Retrieve completed async scraping task result." },
  { name: "novada_browser_flow", schema: BrowserFlowParamsSchema, description: "Multi-step browser automation on Novada cloud browser. TODO: cold-start fitness on Edge." },
  { name: "novada_ai_monitor", schema: AiMonitorParamsSchema, description: "Monitor how AI models (ChatGPT, Perplexity, Grok, Claude, Gemini) reference a brand." },
  { name: "novada_monitor", schema: MonitorParamsSchema, description: "Detect page changes over time via content hash + field-level diff." },
  { name: "novada_setup", schema: SetupParamsSchema, description: "Diagnose env config and emit setup snippets for all MCP clients. Auth-free." },
  // ── Account / billing tools (KR-6) — operate on the CALLER's own Novada account via pass-through key ──
  { name: "novada_wallet_balance", schema: WalletBalanceParamsSchema, description: "Your master wallet balance (the account the API key belongs to)." },
  { name: "novada_wallet_usage_record", schema: WalletUsageRecordParamsSchema, description: "Paginated wallet transaction / usage history." },
  { name: "novada_plan_balance_all", schema: PlanBalanceAllParamsSchema, description: "Per-product plan balances (residential/isp/datacenter/mobile/static/capture) in parallel." },
  { name: "novada_proxy_account_list", schema: ProxyAccountListParamsSchema, description: "List proxy sub-accounts for a product (paginated)." },
  { name: "novada_proxy_account_create", schema: ProxyAccountCreateParamsSchema, description: "⚠️ WRITE — create a proxy sub-account. Two-step confirm gate (pass confirm:true after human approval).", write: true },
  { name: "novada_traffic_daily", schema: TrafficDailyParamsSchema, description: "Daily traffic consumption across proxy products for a date range." },
  { name: "novada_account_summary", schema: AccountSummaryParamsSchema, description: "One-shot account overview: wallet + plans + recent capture cost." },
  { name: "novada_capture_logs", schema: CaptureLogsParamsSchema, description: "Hourly capture/unlocker/scraper/browser cost breakdown." },
].map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: zodToMcpSchema(t.schema),
  annotations: ("write" in t && t.write)
    ? { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true }
    : { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
}));

// ─── Tool-set filtering (?tools= / ?groups=) ─────────────────────────────────
// Lets a client request a slim toolset, e.g. ?groups=search,scrape or
// ?tools=novada_search,novada_scrape. Matches BrightData's ?groups= pattern.
// Fewer tools = less token overhead in the agent's context window.
const TOOL_GROUPS: Record<string, string[]> = {
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
  if (!toolsParam && !groupsParam) return null;
  const allowed = new Set<string>(["novada_setup"]);
  if (groupsParam) {
    for (const g of groupsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      (TOOL_GROUPS[g] ?? []).forEach((n) => allowed.add(n));
    }
  }
  if (toolsParam) {
    for (const raw of toolsParam.split(",").map((s) => s.trim()).filter(Boolean)) {
      const full = raw.startsWith("novada_") ? raw : `novada_${raw}`;
      if (ALL_TOOL_NAMES.has(full)) allowed.add(full);
    }
  }
  // If params were given but matched nothing real, fall back to no-filter rather than an empty server.
  return allowed.size > 1 ? allowed : null;
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

// ─── MCP server factory ──────────────────────────────────────────────────────
function buildServer(apiKey: string, env: Env, ctx: { token: string; allowedTools?: Set<string> | null }): Server {
  const server = new Server(
    { name: "novada", version: "0.7.13-hosted" },
    { capabilities: { tools: {} } },
  );

  const visibleTools = ctx.allowedTools
    ? TOOLS.filter((t) => ctx.allowedTools!.has(t.name))
    : TOOLS;
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
            "Error [QUOTA_EXCEEDED]: free-plan monthly quota exhausted.",
            "failure_class: quota",
            "retry_recommended: false",
            "agent_instruction: Upgrade at https://dashboard.novada.com or wait until next month for the free tier to reset.",
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
      return {
        content: [{ type: "text" as const, text: result }],
        _meta: { quota_remaining: remaining },
      };
    } catch (error) {
      logUsage(env, ctx.token, name, false, Date.now() - started);
      if (error instanceof ZodError) {
        const issues = error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Validation failed:\n${issues}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
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
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        error: "INTERNAL_ERROR",
        message: (err as Error)?.message ?? String(err),
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
