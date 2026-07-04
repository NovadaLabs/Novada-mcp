#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { novadaSetup, validateSetupParams, novadaSessionStats, validateSessionStatsParams, recordToolCall, novadaSearchFeedback, validateSearchFeedbackParams, } from "./tools/index.js";
import { classifyError } from "./_core/errors.js";
import { ZodError } from "zod";
import { TOOLS, dispatch } from "./core.js";
// ─── Configuration ───────────────────────────────────────────────────────────
import { VERSION } from "./config.js";
import { listPrompts, getPrompt } from "./prompts/index.js";
import { listResources, readResource } from "./resources/index.js";
import { checkProxyConfiguration } from "./utils/domains.js";
import { resolveProxyCredentials } from "./utils/credentials.js";
const API_KEY = process.env.NOVADA_API_KEY?.trim();
// ─── Tool & Group Filtering ──────────────────────────────────────────────────
// NOVADA_TOOLS="extract,search,crawl"  → only these tools (comma-separated, short or full names)
// NOVADA_GROUPS="search,proxy"          → category bundles (see CATEGORY_MAP below)
// Both set → union. Neither set → all tools (backward compatible).
/** Category bundles — each group name expands to multiple tools */
const CATEGORY_MAP = {
    search: ["novada_search", "novada_extract", "novada_crawl", "novada_map", "novada_site_copy", "novada_research", "novada_verify", "novada_ai_monitor", "novada_monitor", "novada_search_feedback"],
    proxy: ["novada_proxy", "novada_proxy_residential", "novada_proxy_isp", "novada_proxy_datacenter", "novada_proxy_mobile", "novada_proxy_static", "novada_proxy_dedicated"],
    browser: ["novada_browser", "novada_browser_flow"],
    scraper: ["novada_scrape", "novada_scraper_submit", "novada_scraper_status", "novada_scraper_result"],
    health: ["novada_discover", "novada_setup", "novada_session_stats"],
    account: ["novada_account", "novada_proxy_account_create", "novada_proxy_account_list", "novada_ip_whitelist", "novada_capture_apikey", "novada_scraper_task_mgmt", "novada_static_ip_mgmt"],
};
/** Normalize short name → full tool name */
function normalizeTool(name) {
    const n = name.trim().toLowerCase();
    return n.startsWith("novada_") ? n : `novada_${n}`;
}
function applyToolFilter(tools) {
    const toolsEnv = process.env.NOVADA_TOOLS;
    const groupsEnv = process.env.NOVADA_GROUPS;
    if (!toolsEnv && !groupsEnv)
        return tools;
    const allowed = new Set();
    // NOVADA_TOOLS: direct tool names
    if (toolsEnv) {
        for (const name of toolsEnv.split(",").filter(Boolean)) {
            allowed.add(normalizeTool(name));
        }
    }
    // NOVADA_GROUPS: category bundles (union with NOVADA_TOOLS if both set)
    if (groupsEnv) {
        for (const group of groupsEnv.split(",").map(g => g.trim().toLowerCase()).filter(Boolean)) {
            const bundle = CATEGORY_MAP[group];
            if (bundle) {
                for (const tool of bundle)
                    allowed.add(tool);
            }
            else {
                // Fallback: treat as individual tool name
                allowed.add(normalizeTool(group));
            }
        }
    }
    // Always include account + setup so agents can diagnose issues regardless of filter.
    // session_stats + search_feedback are auth-free and in-memory — keep them reachable too.
    // novada_account replaces novada_health as the canonical account status tool.
    allowed.add("novada_account");
    allowed.add("novada_setup");
    allowed.add("novada_session_stats");
    allowed.add("novada_search_feedback");
    const filtered = tools.filter(t => allowed.has(t.name));
    if (filtered.length <= 1) {
        const validGroups = Object.keys(CATEGORY_MAP).join(", ");
        const validTools = tools.map(t => t.name.replace("novada_", "")).join(", ");
        console.error(`[novada] Warning: NOVADA_TOOLS="${toolsEnv ?? ""}" NOVADA_GROUPS="${groupsEnv ?? ""}" matched no tools beyond health. Valid groups: ${validGroups}. Valid tools: ${validTools}`);
    }
    return filtered;
}
const ACTIVE_TOOLS = applyToolFilter(TOOLS);
// ─── MCP Server ──────────────────────────────────────────────────────────────
class NovadaMCPServer {
    server;
    constructor() {
        this.server = new Server({
            name: "novada",
            version: VERSION,
            description: "Novada MCP — unified web data API. ONE API KEY (NOVADA_API_KEY) covers all products: search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. Optional: NOVADA_BROWSER_WS for browser automation, NOVADA_PROXY_ENDPOINT for proxy routing. Call novada_health_all() to verify which products are active.",
        }, { capabilities: { tools: {}, prompts: {}, resources: {} } });
        this.setupHandlers();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.onerror = (error) => {
            const msg = error instanceof Error ? error.message : String(error);
            console.error("[novada]", msg);
        };
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: ACTIVE_TOOLS,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.server.setRequestHandler(ListPromptsRequestSchema, async () => listPrompts());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return getPrompt(name, args || {});
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => listResources());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return readResource(request.params.uri);
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            const { name, arguments: args } = request.params;
            // NOV-319: build a per-request progress reporter wired to notifications/progress.
            // Only active when the client supplied a progressToken in _meta; otherwise no-op so
            // long-running tools (novada_crawl per page, novada_research per phase) stay silent.
            const progressToken = extra?._meta?.progressToken;
            const onProgress = progressToken === undefined
                ? undefined
                : async (info) => {
                    await extra.sendNotification({
                        method: "notifications/progress",
                        params: { progressToken, ...info },
                    });
                };
            // novada_setup is auth-free — handle it before the API_KEY gate
            if (name === "novada_setup") {
                try {
                    const result = await novadaSetup(validateSetupParams(args));
                    return { content: [{ type: "text", text: result }] };
                }
                catch (e) {
                    return { content: [{ type: "text", text: String(e) }], isError: true };
                }
            }
            // NOV-321 / NOV-323: session telemetry + search feedback are in-memory and
            // auth-free — handle them before the API_KEY gate. recordToolCall makes
            // each invocation show up in the telemetry it reports.
            if (name === "novada_session_stats") {
                try {
                    recordToolCall(name);
                    const result = await novadaSessionStats(validateSessionStatsParams(args));
                    return { content: [{ type: "text", text: result }] };
                }
                catch (e) {
                    return { content: [{ type: "text", text: String(e) }], isError: true };
                }
            }
            if (name === "novada_search_feedback") {
                try {
                    recordToolCall(name);
                    const result = await novadaSearchFeedback(validateSearchFeedbackParams(args));
                    return { content: [{ type: "text", text: result }] };
                }
                catch (e) {
                    if (e instanceof ZodError) {
                        const issues = e.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
                        return {
                            content: [{
                                    type: "text",
                                    text: `Invalid parameters for ${name}:\n${issues}\nNext step: Check parameter names and values — see tool description for valid options.`,
                                }],
                            isError: true,
                        };
                    }
                    return { content: [{ type: "text", text: String(e) }], isError: true };
                }
            }
            // KR-6 developer-api tools use NOVADA_DEVELOPER_API_KEY with NOVADA_API_KEY fallback.
            // They run their own getDeveloperApiKey() check, so we bypass the strict NOVADA_API_KEY
            // gate when a developer-api key is present.
            const KR6_TOOLS = new Set([
                "novada_account",
                // Aliases — still route to novada_account; must bypass API_KEY gate the same way
                "novada_wallet_balance",
                "novada_wallet_usage_record",
                "novada_traffic_daily",
                "novada_plan_balance_all",
                "novada_capture_logs",
                "novada_account_summary",
                "novada_health",
                "novada_health_all",
                // Non-folded developer-api tools
                "novada_proxy_account_create",
                "novada_proxy_account_list",
                "novada_ip_whitelist",
            ]);
            const hasDeveloperKey = !!process.env.NOVADA_DEVELOPER_API_KEY?.trim();
            const isKr6Bypass = KR6_TOOLS.has(name) && hasDeveloperKey;
            if (!API_KEY && !isKr6Bypass) {
                return {
                    content: [{
                            type: "text",
                            text: [
                                "Error [INVALID_API_KEY]: NOVADA_API_KEY is not set.",
                                "failure_class: auth",
                                "retry_recommended: false",
                                `agent_instruction: "Call novada_setup for step-by-step setup instructions and exact config snippets for your MCP client. Get a key at https://www.novada.com"`,
                            ].join("\n"),
                        }],
                    isError: true,
                };
            }
            // Enforce tool filter at execution time (not just at list time)
            if ((process.env.NOVADA_TOOLS || process.env.NOVADA_GROUPS) && !ACTIVE_TOOLS.find(t => t.name === name)) {
                return {
                    content: [{
                            type: "text",
                            text: `Tool '${name}' is not in the active set. NOVADA_TOOLS="${process.env.NOVADA_TOOLS ?? ""}" NOVADA_GROUPS="${process.env.NOVADA_GROUPS ?? ""}". Available: ${ACTIVE_TOOLS.map(t => t.name).join(", ")}`,
                        }],
                    isError: true,
                };
            }
            try {
                // NOV-321: record every dispatched tool call for novada_session_stats telemetry.
                recordToolCall(name);
                const result = await dispatch(name, args, API_KEY, { onProgress });
                return { content: [{ type: "text", text: result }] };
            }
            catch (error) {
                // Zod validation errors → clear, structured message for the agent including
                // agent_instruction so the caller has a programmatic, parseable recovery signal.
                if (error instanceof ZodError) {
                    const issues = error.issues.map(i => {
                        let msg = `  ${i.path.join(".")}: ${i.message}`;
                        if (i.code === "invalid_value" && "values" in i) {
                            msg += ` (valid values: ${i.values.map(v => `'${v}'`).join(", ")})`;
                        }
                        return msg;
                    }).join("\n");
                    return {
                        content: [{
                                type: "text",
                                text: [
                                    `Invalid parameters for ${name}:`,
                                    issues,
                                    `agent_instruction: Fix the parameter(s) listed above and retry. Check the tool's inputSchema for required fields and valid values. Do NOT retry with identical params — at least one field must change.`,
                                ].join("\n"),
                            }],
                        isError: true,
                    };
                }
                // Classified API/network errors with agent_instruction guidance
                const classified = classifyError(error);
                return {
                    content: [{
                            type: "text",
                            text: classified.toAgentString(),
                        }],
                    isError: true,
                };
            }
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        // Auto-provision proxy credentials: if NOVADA_PROXY_ENDPOINT is set but
        // NOVADA_PROXY_USER/PASS are missing, fetch them from /v1/proxy_account/list
        // using NOVADA_API_KEY as Bearer token, then inject into process.env so the
        // synchronous getProxyCredentials() picks them up for all proxy tool calls.
        if (process.env.NOVADA_PROXY_ENDPOINT &&
            (!process.env.NOVADA_PROXY_USER || !process.env.NOVADA_PROXY_PASS)) {
            try {
                const autoCreds = await resolveProxyCredentials();
                if (autoCreds) {
                    process.env.NOVADA_PROXY_USER = autoCreds.user;
                    process.env.NOVADA_PROXY_PASS = autoCreds.pass;
                    console.error(`[novada] Auto-provisioned proxy credentials (account: ${autoCreds.user})`);
                }
            }
            catch {
                // Non-fatal: proxy tools will show a configuration error when invoked
            }
        }
        checkProxyConfiguration();
        const filterInfo = process.env.NOVADA_TOOLS || process.env.NOVADA_GROUPS
            ? ` (TOOLS=${process.env.NOVADA_TOOLS ?? ""} GROUPS=${process.env.NOVADA_GROUPS ?? ""})`
            : "";
        console.error(`Novada MCP server v${VERSION} running on stdio — ${ACTIVE_TOOLS.length} tools loaded${filterInfo}`);
    }
}
// ─── CLI ─────────────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
if (cliArgs.includes("--list-tools")) {
    for (const tool of ACTIVE_TOOLS) {
        const firstLine = tool.description.trim().split("\n")[0];
        console.log(`  ${tool.name} — ${firstLine}`);
    }
    process.exit(0);
}
if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
    console.log(`novada v${VERSION} — MCP Server for Novada web data API

Usage:
  npx novada              Start the MCP server (stdio transport)
  npx novada --list-tools Show available tools
  npx novada --help       Show this help

Environment (ONE KEY COVERS EVERYTHING):
  NOVADA_API_KEY              Your Novada API key — authenticates ALL products (required)
                              Covers: search, extract, research, crawl, scrape, unblock, proxy auto-provision
  NOVADA_BROWSER_WS           Browser API WebSocket — same account, separate endpoint (optional)
  NOVADA_PROXY_ENDPOINT       Proxy gateway host:port — user/pass auto-fetched from your account (optional)
  NOVADA_WEB_UNBLOCKER_KEY    Override unblocker key (optional — NOVADA_API_KEY is used as fallback)
  NOVADA_PROXY_USER/PASS      Override proxy credentials (optional — auto-provisioned if PROXY_ENDPOINT set)

Connect to Claude Code:
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp

Tools (${TOOLS.length}):
  novada_search              Search the web via Google, Bing, and 3 more engines
  novada_extract             Extract content from any URL (smart auto-routing)
  novada_crawl               Crawl a website (BFS/DFS, up to 20 pages)
  novada_research            Multi-step web research with synthesis
  novada_map                 Discover all URLs on a website (fast)
  novada_scrape              Structured data from 13 active platforms (~78 operations, e.g. Amazon, TikTok)
  novada_proxy               Get residential proxy credentials (legacy)
  novada_verify              Verify a factual claim against web sources
  novada_unblock             Force JS rendering on blocked/SPA pages
  novada_browser             Interactive browser automation (navigate, click, type, screenshot)
  novada_health              Check which Novada products are active on your API key
  novada_health_all          Extended health check with activation links for all products
  novada_discover            List all available Novada tools with categories and status
  novada_proxy_residential   Residential proxy (100M+ IPs, geo-targeting, anti-bot)
  novada_proxy_isp           ISP proxy (rotating ISP-assigned IPs)
  novada_proxy_datacenter    Datacenter proxy (fast, cost-effective rotation)
  novada_proxy_mobile        Mobile carrier proxy (3G/4G/5G IPs)
  novada_proxy_static        Static ISP proxy (dedicated IP, same IP per session_id)
  novada_proxy_dedicated     Dedicated datacenter proxy (exclusive IP, no sharing)
  novada_scraper_submit      Submit async scraping task, returns task_id
  novada_scraper_status      Poll async scraping task status by task_id
  novada_scraper_result      Retrieve completed scraping results by task_id
  novada_browser_flow        Cloud browser automation via action sequence API
  novada_ip_whitelist        Manage IP whitelist for proxy products (add/list/del/remark)
  novada_session_stats       Per-session usage telemetry (tool-call counts, recent calls, uptime)
  novada_search_feedback     Record search-result quality to improve future ranking
`);
    process.exit(0);
}
const server = new NovadaMCPServer();
server.run().catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Fatal error:", msg);
    process.exit(1);
});
//# sourceMappingURL=index.js.map