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
import { maybeGetFirstRunNotice } from "./utils/first-run-notice.js";
const API_KEY = process.env.NOVADA_API_KEY?.trim();
// ─── Tool & Group Filtering ──────────────────────────────────────────────────
// NOVADA_TOOLS="extract,search,crawl"  → only these tools (comma-separated, short or full names)
// NOVADA_GROUPS="search,proxy"          → category bundles (see CATEGORY_MAP below)
// Both set → union. Neither set → all tools (backward compatible).
/** Category bundles — each group name expands to multiple tools */
const SCRAPE_GROUP = ["novada_scrape", "novada_scraper_submit", "novada_scraper_status", "novada_scraper_result"];
const CATEGORY_MAP = {
    search: ["novada_search", "novada_extract", "novada_crawl", "novada_map", "novada_site_copy", "novada_research", "novada_verify", "novada_ai_monitor", "novada_monitor", "novada_search_feedback"],
    proxy: ["novada_proxy", "novada_proxy_residential", "novada_proxy_isp", "novada_proxy_datacenter", "novada_proxy_mobile", "novada_proxy_static", "novada_proxy_dedicated"],
    browser: ["novada_browser", "novada_browser_flow"],
    // "scrape" and "scraper" are aliases for the same scrape-tool group — both keys are valid
    // on both surfaces (hosted uses "scrape", local historically used "scraper") so a groups
    // config is portable across surfaces. Do not remove either key.
    scraper: SCRAPE_GROUP,
    scrape: SCRAPE_GROUP,
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
            description: "Novada MCP — unified web data API. ONE API KEY (NOVADA_API_KEY) covers all products: search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. Optional: NOVADA_BROWSER_WS for browser automation, NOVADA_PROXY_ENDPOINT for proxy routing. Call novada_account (section=\"summary\") to check balance, plans, and entitlements.",
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
                                `agent_instruction: "Call novada_setup for step-by-step setup instructions and exact config snippets for your MCP client. Get a key at https://novada.com"`,
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
                // When a tool filter is active, pass the active-tool names so novada_discover's
                // catalog reflects only what's usable this session (not the full registry).
                const visibleTools = (process.env.NOVADA_TOOLS || process.env.NOVADA_GROUPS)
                    ? new Set(ACTIVE_TOOLS.map(t => t.name))
                    : undefined;
                const result = await dispatch(name, args, API_KEY, { onProgress, visibleTools });
                // TOW2-242: one-time first-run notice. Appended as a SEPARATE content block
                // (never concatenated into `result` — that would corrupt JSON-format outputs)
                // and ONLY on a successful dispatch. All logic + copy lives in the module;
                // this is the ~2-line glue. maybeGetFirstRunNotice() fails quiet → never throws.
                const content = [{ type: "text", text: result }];
                const notice = await maybeGetFirstRunNotice();
                if (notice)
                    content.push({ type: "text", text: notice });
                return { content };
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

Tools (${TOOLS.length} registered — run 'npx novada-mcp --list-tools' for the live set):
  novada_search              Search the web via Google, Bing, DuckDuckGo, Yandex (4 engines)
  novada_extract             Extract content from any URL (smart auto-routing)
  novada_crawl               Crawl a website (BFS/DFS, up to 20 pages)
  novada_research            Multi-source research — returns cited source material to reason over
  novada_map                 Discover URLs on a website (up to 100)
  novada_site_copy           Copy an entire docs site to disk as markdown (one file per page)
  novada_scrape              Structured data from 16 active platforms (~88 operations, e.g. Amazon, TikTok, SHEIN, ChatGPT)
  novada_ai_monitor          Search AI-company public domains for brand mentions (not live models)
  novada_monitor             Detect page changes between checks (session-scoped baseline)
  novada_proxy               Get proxy credentials (residential/isp/datacenter/mobile/static/dedicated)
  novada_browser             Interactive browser automation (navigate, click, type, screenshot)
  novada_browser_flow        Cloud browser automation via action sequence API
  novada_account             Account & billing dashboard (balance, plans, usage, traffic)
  novada_proxy_account_create  Create a proxy sub-account (WRITE, confirm gate)
  novada_proxy_account_list  List proxy sub-accounts
  novada_ip_whitelist        Manage IP whitelist for proxy products (add/list/del/remark)
  novada_capture_apikey      Get or reset the Capture API key
  novada_static_ip_mgmt      Manage static ISP IPs (open/renew/export/list)
  novada_discover            List all available Novada tools with categories and status
  novada_setup               Onboarding concierge + API-key validation
  novada_session_stats       Per-session usage telemetry (tool-call counts, recent calls, uptime)
  novada_search_feedback     Record search-result quality to improve future ranking

  (Backward-compat aliases still dispatch but are hidden from tools/list: novada_unblock,
   novada_verify, novada_health, novada_health_all, novada_wallet_balance,
   novada_wallet_usage_record, novada_plan_balance_all, novada_traffic_daily,
   novada_capture_logs, novada_account_summary, novada_proxy_residential/isp/datacenter/
   mobile/static/dedicated, novada_scraper_submit/status/result.)
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