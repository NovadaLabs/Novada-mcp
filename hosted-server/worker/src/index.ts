/**
 * Novada MCP — Cloudflare Worker (Streamable HTTP transport)
 *
 * Hosts the existing local novada-mcp tool implementations as a remote MCP
 * endpoint at POST/GET /mcp. Any MCP client (Claude Desktop, Cursor, Cline,
 * Windsurf, VS Code) can connect via URL.
 *
 * Auth (Tavily-style, both accepted):
 *   1. ?token=sk-eu-novada-XXX
 *   2. Authorization: Bearer sk-eu-novada-XXX
 *
 * Quota: per-token monthly KV counter at <token>:<YYYY-MM>. Decrement before
 * each tool call. 429 when exhausted.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";

// ─── Tool implementations & schemas (re-used from local novada-mcp) ──────────
//
// All tools imported from the parent package. Tools that touch fs / native
// Node modules (playwright-core, pdf-parse, exceljs) may fail at runtime on
// Workers; nodejs_compat covers most cases, but the ones marked TODO below
// should be exercised on staging before production traffic.
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
  novadaBrowser, // TODO: port for Workers runtime — uses playwright-core CDP, native deps
  novadaHealth,
  novadaHealthAll,
  novadaDiscover,
  novadaScraperSubmit,
  novadaScraperStatus,
  novadaScraperResult,
  novadaBrowserFlow, // TODO: port for Workers runtime — depends on cloud browser WS
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
} from "novada-mcp/build/tools/index.js";

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
} from "novada-mcp/build/tools/types.js";
import { MonitorParamsSchema } from "novada-mcp/build/tools/monitor.js";

// ─── Env binding shape (matches wrangler.toml) ───────────────────────────────
export interface Env {
  NOVADA_MCP_QUOTA: KVNamespace;
  NOVADA_API_BASE: string;
  LOG_LEVEL: string;
  FREE_PLAN_MONTHLY_QUOTA: string;
  // Set as a Worker secret with: wrangler secret put NOVADA_API_KEY
  // This is the upstream Novada API key the worker uses to call the Novada
  // backend on behalf of the authenticated MCP user.
  NOVADA_API_KEY?: string;
  // 🔴 STUB AUTH GATE — until sub2api integration lands (TODO(sub2api)),
  // validateToken accepts ANY sk-eu-novada-* token = the free tier is NOT gated.
  // Operator MUST acknowledge by setting this env var to "true" or the worker
  // refuses every request with 503 STUB_AUTH_UNACKED. See PRE_LAUNCH_CHECKLIST.md.
  STUB_AUTH_WARNING_ACCEPTED?: string;
  // Per-IP rate limit (per minute) to slow down token brute-force enumeration.
  // Default 60 = generous for legitimate agents, kills naive scrapers.
  RATE_LIMIT_PER_MIN?: string;
  // NOVADA_MCP_USAGE?: AnalyticsEngineDataset;
}

// ─── Zod → MCP JSON Schema ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  const { $schema, $defs, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}

// ─── Tool catalog ────────────────────────────────────────────────────────────
// Descriptions trimmed for transport size — full descriptions live in the
// upstream package and can be re-imported if needed.
const TOOLS = [
  { name: "novada_search",           title: "Web Search",                schema: SearchParamsSchema,         description: "Search the web via 5 engines. Returns titles/URLs/snippets reranked by relevance." },
  { name: "novada_extract",          title: "Content Extractor",          schema: ExtractParamsSchema,        description: "Extract clean content from any URL with anti-bot auto-escalation." },
  { name: "novada_crawl",            title: "Site Crawler",               schema: CrawlParamsSchema,          description: "BFS/DFS crawl up to 20 pages of a site, extract content from each." },
  { name: "novada_research",         title: "Deep Research",              schema: ResearchParamsSchema,       description: "Multi-source research: fan-out search → dedup → extract → synthesized cited report." },
  { name: "novada_map",              title: "URL Mapper",                 schema: MapParamsSchema,            description: "Discover URLs on a site via sitemap.xml or BFS crawl. URL list only." },
  { name: "novada_scrape",           title: "Platform Scraper",           schema: ScrapeParamsSchema,         description: "Structured data from 129 platforms (Amazon, Reddit, TikTok, LinkedIn, etc.)." },
  { name: "novada_verify",           title: "Claim Verifier",             schema: VerifyParamsSchema,         description: "Fact-check a claim via 3 parallel search angles. Returns verdict + confidence." },
  { name: "novada_unblock",          title: "Anti-Bot Unblocking",        schema: UnblockParamsSchema,        description: "Raw rendered HTML of blocked/JS-heavy pages via Web Unblocker or Browser API." },
  { name: "novada_browser",          title: "Browser Automation",         schema: BrowserParamsSchema,        description: "Multi-action browser automation via CDP on Novada cloud browser." },
  { name: "novada_proxy",            title: "Proxy Credentials",          schema: ProxyParamsSchema,          description: "Generic proxy credentials (URL/env/curl format) for your own HTTP clients." },
  { name: "novada_proxy_residential",title: "Residential Proxy",          schema: ProxyResidentialParamsSchema,description: "Residential proxy credentials (100M+ home ISP IPs)." },
  { name: "novada_proxy_isp",        title: "ISP Proxy",                  schema: ProxyIspParamsSchema,       description: "ISP-assigned static proxy credentials — looks like real home users." },
  { name: "novada_proxy_datacenter", title: "Datacenter Proxy",           schema: ProxyDatacenterParamsSchema,description: "Datacenter proxy credentials — fastest, cheapest." },
  { name: "novada_proxy_mobile",     title: "Mobile Proxy",               schema: ProxyMobileParamsSchema,    description: "4G/5G mobile proxy credentials." },
  { name: "novada_proxy_static",     title: "Static ISP Proxy",           schema: ProxyStaticParamsSchema,    description: "Static dedicated ISP IP — never changes for same session_id+country." },
  { name: "novada_proxy_dedicated",  title: "Dedicated Proxy",            schema: ProxyDedicatedParamsSchema, description: "Exclusive datacenter IP, not shared with any other user." },
  { name: "novada_health",           title: "Health Check",               schema: HealthParamsSchema,         description: "Check which Novada API products are active on your key." },
  { name: "novada_health_all",       title: "Extended Health Check",      schema: HealthAllParamsSchema,      description: "Extended per-product health check across all Novada endpoints." },
  { name: "novada_discover",         title: "Tool Discovery",             schema: DiscoverParamsSchema,       description: "List all available Novada tools by category and status." },
  { name: "novada_scraper_submit",   title: "Async Scraper Submit",       schema: ScraperSubmitParamsSchema,  description: "Submit async scraping task. Returns task_id." },
  { name: "novada_scraper_status",   title: "Async Scraper Status",       schema: ScraperStatusParamsSchema,  description: "Poll async scraping task status." },
  { name: "novada_scraper_result",   title: "Async Scraper Result",       schema: ScraperResultParamsSchema,  description: "Retrieve completed async scraping task result." },
  { name: "novada_browser_flow",     title: "Browser Flow Automation",    schema: BrowserFlowParamsSchema,    description: "Multi-step browser automation on Novada cloud browser." },
  { name: "novada_ai_monitor",       title: "AI Brand Monitor",           schema: AiMonitorParamsSchema,      description: "Monitor how AI models (ChatGPT, Perplexity, Grok, Claude, Gemini) reference a brand." },
  { name: "novada_monitor",          title: "Page Change Monitor",        schema: MonitorParamsSchema,        description: "Detect page changes over time via content hash + field-level diff." },
  { name: "novada_setup",            title: "Setup & Configuration",      schema: SetupParamsSchema,          description: "Diagnose env config and emit setup snippets for all MCP clients. Auth-free." },
].map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: zodToMcpSchema(t.schema),
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
}));

// ─── Token auth + quota ──────────────────────────────────────────────────────
interface TokenInfo {
  valid: boolean;
  plan: "free" | "pro";
  quota_remaining: number;
}

/**
 * 🔴 TODO(sub2api): replace this stub with a sub2api lookup that resolves the
 * presented MCP token to a Novada user + plan + remaining quota. RIGHT NOW we
 * accept any token shaped like `sk-eu-novada-*` — meaning the free tier IS NOT
 * GATED. Operator must explicitly set env STUB_AUTH_WARNING_ACCEPTED=true to
 * deploy this worker. See PRE_LAUNCH_CHECKLIST.md.
 */
async function validateToken(token: string, env: Env): Promise<TokenInfo> {
  if (!token || !token.startsWith("sk-eu-novada-")) {
    return { valid: false, plan: "free", quota_remaining: 0 };
  }
  // Loud per-request warning so this never silently ships to production.
  if ((env.LOG_LEVEL ?? "info") !== "silent") {
    console.warn("[novada-mcp-hosted] STUB AUTH ACTIVE — any sk-eu-novada-* prefix accepted. Wire sub2api before production launch.");
  }
  const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "5000", 10);
  return { valid: true, plan: "free", quota_remaining: monthlyQuota };
}

/**
 * Per-IP rate limit using KV. Returns true if rate exceeded → 429.
 * Keyed by IP + current minute bucket. TTL 2 min for KV GC headroom.
 * Defaults to 60 calls/min/IP (generous — legitimate agents won't hit).
 */
async function rateLimitExceeded(ip: string, env: Env): Promise<boolean> {
  if (!ip || ip === "unknown") return false; // can't rate-limit unknown
  const limit = parseInt(env.RATE_LIMIT_PER_MIN || "60", 10);
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${bucket}`;
  const raw = await env.NOVADA_MCP_QUOTA.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return true;
  await env.NOVADA_MCP_QUOTA.put(key, String(count + 1), { expirationTtl: 120 });
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
  const monthlyQuota = parseInt(env.FREE_PLAN_MONTHLY_QUOTA || "5000", 10);
  const key = `${token}:${monthKey()}`;
  const raw = await env.NOVADA_MCP_QUOTA.get(key);
  const used = raw ? parseInt(raw, 10) : 0;
  if (plan === "free" && used >= monthlyQuota) return -1;
  const next = used + 1;
  // 32-day TTL — KV will GC the key after the month rolls over.
  await env.NOVADA_MCP_QUOTA.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 32 });
  return Math.max(0, monthlyQuota - next);
}

function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  const qp = url.searchParams.get("token");
  if (qp) return qp.trim();
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return null;
}

function logUsage(env: Env, token: string, tool: string, ok: boolean, ms: number): void {
  // TODO: write to Analytics Engine when binding is configured.
  // env.NOVADA_MCP_USAGE?.writeDataPoint({ blobs: [tokenFingerprint(token), tool, ok ? "ok" : "err"], doubles: [ms] });
  if ((env.LOG_LEVEL ?? "info") !== "silent") {
    // Fire-and-forget — don't block tool execution on hashing.
    tokenFingerprint(token).then((fp) => {
      console.log(JSON.stringify({ evt: "usage", tokenFp: fp, tool, ok, ms }));
    }).catch(() => {});
  }
}

// ─── MCP server factory ──────────────────────────────────────────────────────
function buildServer(apiKey: string, env: Env, ctx: { token: string }): Server {
  const server = new Server(
    // DORMANT — this Cloudflare Worker is NOT deployed: its mcp.novada.com route is
    // commented out in wrangler.toml. The live server is vercel/api/mcp.ts, which
    // derives its version from the vendored package. Hardcoded (not derived) here only
    // because the derive isn't wired for the Worker bundle; keep in sync if revived.
    { name: "novada", version: "0.8.4-hosted" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const argsObj = (args as Record<string, unknown>) ?? {};
    const started = Date.now();

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
            "agent_instruction: Upgrade at https://www.novada.com/pricing or wait until next month for the free tier to reset.",
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
          // 🔴 NOT AVAILABLE ON HOSTED — Playwright native deps don't run in CF Workers.
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
          // 🔴 NOT AVAILABLE ON HOSTED — cloud browser WS path needs Worker-compatible WebSocket runtime.
          logUsage(env, ctx.token, name, false, Date.now() - started);
          return {
            content: [{
              type: "text" as const,
              text: "Error [NOT_AVAILABLE_ON_HOSTED]: novada_browser_flow requires WebSocket transport not yet ported to CF Workers.\nagent_instruction: Use the local MCP server (`npx novada-mcp`) for browser-flow tasks, or use novada_scrape / novada_extract for static-content extraction on the hosted server.",
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "novada-mcp-hosted", endpoint: "/mcp" }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname !== "/mcp") {
      return jsonError(404, "NOT_FOUND", "Unknown path. The MCP endpoint is POST/GET /mcp.");
    }

    // 🔴 STUB AUTH GATE — operator must explicitly accept that the auth layer is a stub
    // until sub2api integration lands. See PRE_LAUNCH_CHECKLIST.md.
    if (env.STUB_AUTH_WARNING_ACCEPTED !== "true") {
      return jsonError(503, "STUB_AUTH_UNACKED",
        "This worker has stub token validation (any sk-eu-novada-* prefix is accepted). Refusing to serve until operator acknowledges.",
        "Operator: set env STUB_AUTH_WARNING_ACCEPTED=true in wrangler.toml [vars] (NOT secrets) and redeploy. Then wire sub2api before public launch.");
    }

    // Per-IP rate limit — slow down token brute-force enumeration.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
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
        "Missing token. Pass ?token=sk-eu-novada-XXX or Authorization: Bearer sk-eu-novada-XXX.",
        "Get a token at https://www.novada.com");
    }
    const info = await validateToken(token, env);
    if (!info.valid) {
      return jsonError(401, "INVALID_TOKEN",
        "Invalid token format. Expected sk-eu-novada-*.",
        "Get a valid token at https://www.novada.com");
    }

    // Upstream Novada API key — set via `wrangler secret put NOVADA_API_KEY`.
    // TODO(sub2api): swap to a per-user resolved key once sub2api is wired up.
    const apiKey = env.NOVADA_API_KEY?.trim();
    if (!apiKey) {
      return jsonError(500, "WORKER_MISCONFIGURED",
        "Upstream NOVADA_API_KEY secret is not set on this Worker.",
        "Operator: run `wrangler secret put NOVADA_API_KEY`.");
    }

    // Build a fresh server + transport per request (stateless mode). This
    // matches the Streamable HTTP transport's recommended pattern when running
    // on per-request isolates with no shared memory.
    const server = buildServer(apiKey, env, { token });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      // The SDK transport speaks Node http req/res. On Workers we adapt by
      // letting the transport materialize a Response via its built-in helpers.
      // @ts-expect-error — transport.handleRequest accepts Fetch Request/Response when running in Workers/edge runtimes via the SDK's edge shim.
      const response: Response = await transport.handleRequest(request);
      // Tack on CORS headers for browser-based MCP clients.
      const headers = new Headers(response.headers);
      headers.set("access-control-allow-origin", "*");
      headers.set("access-control-expose-headers", "mcp-session-id");
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonError(500, "TRANSPORT_ERROR", `MCP transport error: ${message}`);
    } finally {
      // Stateless: tear down so we don't leak isolate memory.
      try { await server.close(); } catch { /* noop */ }
    }
  },
};
