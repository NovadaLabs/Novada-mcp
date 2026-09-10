#!/usr/bin/env node
// ─── novada-mcp — stdio entry point (npm bin: `novada-mcp`) ──────────────────
// Wires the MCP Server + stdio transport and dispatches every tool call through
// `./core.ts` (the single source of truth for the tool catalog + dispatch logic).
// The hosted HTTP entrance is a SEPARATE artifact — hosted-server/vercel/api/mcp.ts
// — which wraps a vendored copy of this package's build and dispatches through the
// same core.ts. Full cross-artifact map: root ARCHITECTURE.md. Module map for this
// package: npm-package/ARCHITECTURE.md.
// A-11: FIRST import, before the SDK or anything else — fails loud with a
// one-line stderr message + exit(1) on Node <20 instead of continuing into
// whatever confusing runtime error an old Node happens to hit first.
import "./utils/assert-node.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { novadaSetup, validateSetupParams, novadaSessionStats, validateSessionStatsParams, recordToolCall, novadaSearchFeedback, validateSearchFeedbackParams, 
// F2-3: pre-key-gate parameter validation (see PRE_KEY_VALIDATORS below)
// reuses these SAME validator functions dispatch() (core.ts) calls
// internally — one function per tool, imported here, not duplicated.
validateSearchParams, validateExtractParams, validateCrawlParams, validateResearchParams, validateMapParams, validateSiteCopyParams, validateProxyParams, validateScrapeParams, validateVerifyParams, validateBrowserParams, validateAccountParams, validateBrowserFlowParams, validateMonitorParams, validateProxyAccountCreateParams, validateProxyAccountListParams, validateIpWhitelistParams, validateCaptureApikeyParams, validateStaticIpMgmtParams, } from "./tools/index.js";
// Not re-exported through the tools/index.js barrel — imported the same way
// core.ts itself imports it.
import { validateAiMonitorParams } from "./tools/types.js";
import { classifyError, redactSecrets } from "./_core/errors.js";
import { ZodError } from "zod";
import { TOOLS, dispatch, KNOWN_TOOL_NAMES, makeUnknownToolError } from "./core.js";
// F12/F13/E2 (2026-09-10 audit): the key-gate decision layer — tool auth
// classes, the unauthenticated-tier context saveOutput() consults to skip
// ~/Downloads writes, and the tier disclosure block.
import { decideKeyGate, runUnauthenticatedTier, UNAUTH_TIER_DISCLOSURE, } from "./_core/gate.js";
import { PLATFORM_SCRAPER_TOOLS } from "./tools/platform_scrapers.js";
// F-2/F-12/F2-3/P-4: the ONE shared parameter-validation formatter + unknown-key
// warning + missing-required-param mechanisms, reused at every ZodError/success
// site in this file instead of the four independent hand-rolled variants (and
// the auth-check-before-validation ordering) that existed before.
import { formatZodError, computeUnknownKeyWarning, hasUnrecognizedKeysIssue, computeMissingRequiredParams, } from "./utils/validate.js";
// ─── Configuration ───────────────────────────────────────────────────────────
import { VERSION } from "./config.js";
import { listPrompts, getPrompt } from "./prompts/index.js";
import { listResources, readResource } from "./resources/index.js";
import { checkProxyConfiguration } from "./utils/domains.js";
import { autoProvisionProxyCredentialsAtBoot } from "./utils/credentials.js";
import { maybeGetFirstRunNotice } from "./utils/first-run-notice.js";
import { logUsage, summarizeTarget } from "./utils/usage-log.js";
const API_KEY = process.env.NOVADA_API_KEY?.trim();
// ─── Tool & Group Filtering ──────────────────────────────────────────────────
// NOVADA_TOOLS="extract,search,crawl"  → only these tools (comma-separated, short or full names)
// NOVADA_GROUPS="search,proxy"          → category bundles (see CATEGORY_MAP below)
// Both set → union. Neither set → all tools (backward compatible).
/** Category bundles — each group name expands to multiple tools */
// SCRAPE_GROUP used to hand-list only "novada_scrape_amazon" — every platform-scraper
// sibling added since (google/bing/duckduckgo/yandex/youtube/instagram/facebook/tiktok/x/
// walmart/shein/linkedin/github/perplexity) was silently EXCLUDED from
// NOVADA_GROUPS="scrape", contradicting the group's own name. Derived programmatically
// from PLATFORM_SCRAPER_TOOLS (src/tools/platform_scrapers.ts) instead, so every current
// AND future novada_scrape_<platform> tool is included automatically — no per-platform
// edit needed here again. See tests/tools/scrape-group-derivation.test.ts.
const SCRAPE_GROUP = [
    "novada_scrape",
    ...PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition.name),
    "novada_scraper_submit",
    "novada_scraper_status",
    "novada_scraper_result",
];
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
// ─── F2-3: pre-key-gate parameter validation ─────────────────────────────────
// Full Zod validators for the tools where one is separately exported — every
// hand-written visible tool EXCEPT novada_setup/novada_session_stats/
// novada_search_feedback (already pre-gated before the API_KEY check exists
// at all) and novada_discover (exempted from the key gate entirely below,
// since its dispatch case never reads apiKey). Each entry is the SAME
// function core.ts's dispatch() calls internally — reused, not duplicated,
// so a schema change in tools/*.ts is picked up here with zero drift risk.
//
// The 15 novada_scrape_<platform> tools have no separately-exported
// validator (their Zod schema lives inside a private closure in
// tools/platform_scraper.ts's factory, out of this pass's file ownership) —
// computeMissingRequiredParams() covers those instead, with a lighter,
// schema-derived "are the required fields even present" check.
const PRE_KEY_VALIDATORS = {
    novada_search: validateSearchParams,
    novada_extract: validateExtractParams,
    novada_crawl: validateCrawlParams,
    novada_research: validateResearchParams,
    novada_map: validateMapParams,
    novada_site_copy: validateSiteCopyParams,
    novada_proxy: validateProxyParams,
    novada_scrape: validateScrapeParams,
    novada_verify: validateVerifyParams,
    novada_browser: validateBrowserParams,
    novada_account: validateAccountParams,
    novada_browser_flow: validateBrowserFlowParams,
    novada_ai_monitor: validateAiMonitorParams,
    novada_monitor: validateMonitorParams,
    novada_proxy_account_create: validateProxyAccountCreateParams,
    novada_proxy_account_list: validateProxyAccountListParams,
    novada_ip_whitelist: validateIpWhitelistParams,
    novada_capture_apikey: validateCaptureApikeyParams,
    novada_static_ip_mgmt: validateStaticIpMgmtParams,
};
// ─── Error formatting (F-4) ──────────────────────────────────────────────────
// Matches a well-formed agent-facing message that a tool already pre-wrapped
// itself (e.g. tools/setup.ts, tools/session_stats.ts catch their OWN
// ZodError and rethrow a plain Error whose .message already ends in a
// line-anchored `agent_instruction: ...` — the exact convention the rest of
// this codebase parses for). `m` flag matches ECMA-262 line-terminator rules.
const AGENT_INSTRUCTION_LINE_RE = /^\s*agent_instruction\s*:/im;
/**
 * The single "turn a caught error into agent-facing response text" chokepoint
 * for this file's per-tool pre-gate catches (F-4: previously raw `String(e)`
 * at the novada_setup / novada_session_stats / novada_search_feedback catch
 * sites — index.ts:210-212, :223-225, :242-244 before this fix). Three cases:
 *
 *   1. `e` is a ZodError that slipped past a tool's own pre-wrap — format it
 *      with the shared formatZodError() (F-12) instead of a raw String(e).
 *   2. `e` is a plain Error a tool already pre-formatted into agent-facing
 *      text (it already carries its own agent_instruction line) — pass it
 *      through (redacted, defense in depth) rather than re-wrapping it in a
 *      SECOND, more generic classifyError() envelope, which would squash the
 *      original's newlines and bury its specific instruction under a vague
 *      "an unexpected error occurred" one.
 *   3. Anything else (a genuinely unclassified error) — classifyError().toAgentString(),
 *      the same chokepoint the main dispatch catch already uses.
 */
function toAgentErrorText(error, toolName) {
    if (error instanceof ZodError) {
        return formatZodError(toolName, error);
    }
    if (error instanceof Error && AGENT_INSTRUCTION_LINE_RE.test(error.message)) {
        return redactSecrets(error.message);
    }
    return classifyError(error).toAgentString();
}
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
            // Not an MCP tool-call response (protocol-level transport error) — no
            // agent_instruction envelope needed here, but still route through the
            // same redaction chokepoint as every other error surface in this file
            // so a raw upstream string can't leak a credential into stderr.
            const msg = error instanceof Error ? error.message : String(error);
            console.error("[novada]", redactSecrets(msg));
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
            // F13 (2026-09-10 audit): resolve the tool NAME before EVERYTHING else —
            // param validation, the API-key gate, the active-set filter. A name this
            // server has never heard of gets the same unknown-tool error (with a
            // close-name suggestion when one is cheap) in every key state; the old
            // order answered keyless novada_ghost_tool with INVALID_API_KEY.
            // Ordering contract: resolve name → validate params → key check → execute.
            if (!KNOWN_TOOL_NAMES.has(name)) {
                return {
                    content: [{
                            type: "text",
                            text: classifyError(makeUnknownToolError(name)).toAgentString(),
                        }],
                    isError: true,
                };
            }
            // F-2: derive an "unknown parameter(s) ignored" warning from the tool's
            // OWN declared inputSchema (utils/validate.ts — class-driven, no
            // per-tool key list). Computed once per call; success paths below
            // append it as a separate content block, and the ZodError paths append
            // it too UNLESS the schema already hard-REJECTED via .strict() (that
            // case gets its own "Unrecognized key" issue text — appending "ignored,
            // had no effect" alongside a hard rejection would contradict it).
            const unknownKeyWarning = computeUnknownKeyWarning(name, args, TOOLS);
            const withUnknownKeyWarning = (blocks) => {
                if (unknownKeyWarning)
                    blocks.push({ type: "text", text: unknownKeyWarning });
                return blocks;
            };
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
                    return { content: withUnknownKeyWarning([{ type: "text", text: result }]) };
                }
                catch (e) {
                    // F-4: was raw String(e) — toAgentErrorText() passes through
                    // setup.ts's own pre-formatted agent_instruction text unchanged
                    // (it already carries one), or classifies anything else.
                    return { content: [{ type: "text", text: toAgentErrorText(e, name) }], isError: true };
                }
            }
            // NOV-321 / NOV-323: session telemetry + search feedback are in-memory and
            // auth-free — handle them before the API_KEY gate. recordToolCall makes
            // each invocation show up in the telemetry it reports.
            if (name === "novada_session_stats") {
                try {
                    recordToolCall(name);
                    const result = await novadaSessionStats(validateSessionStatsParams(args));
                    return { content: withUnknownKeyWarning([{ type: "text", text: result }]) };
                }
                catch (e) {
                    return { content: [{ type: "text", text: toAgentErrorText(e, name) }], isError: true };
                }
            }
            if (name === "novada_search_feedback") {
                try {
                    recordToolCall(name);
                    const result = await novadaSearchFeedback(validateSearchFeedbackParams(args));
                    return { content: withUnknownKeyWarning([{ type: "text", text: result }]) };
                }
                catch (e) {
                    if (e instanceof ZodError) {
                        // F-4/F-12/P-4: was a bespoke formatter using the off-contract
                        // the off-contract "Next step" token instead of `agent_instruction:` — now the
                        // same shared formatZodError() every other ZodError site uses.
                        const content = [
                            { type: "text", text: formatZodError(name, e) },
                        ];
                        if (unknownKeyWarning && !hasUnrecognizedKeysIssue(e)) {
                            content.push({ type: "text", text: unknownKeyWarning });
                        }
                        return { content, isError: true };
                    }
                    return { content: [{ type: "text", text: toAgentErrorText(e, name) }], isError: true };
                }
            }
            // F2-3: run parameter validation BEFORE the API_KEY check (except
            // novada_discover, exempted from the key gate entirely below — its
            // dispatch case never reads apiKey) so a caller with a bad param AND
            // no key learns about the param, not just "missing key". Validation is
            // local and free — no network call happens for either code path below.
            if (name !== "novada_discover") {
                const argsRecord = args;
                const preValidator = PRE_KEY_VALIDATORS[name];
                if (preValidator) {
                    try {
                        preValidator(argsRecord);
                    }
                    catch (e) {
                        if (e instanceof ZodError) {
                            const content = [
                                { type: "text", text: formatZodError(name, e) },
                            ];
                            if (unknownKeyWarning && !hasUnrecognizedKeysIssue(e)) {
                                content.push({ type: "text", text: unknownKeyWarning });
                            }
                            return { content, isError: true };
                        }
                        // A non-Zod throw from a "validate" function would be
                        // unexpected — don't swallow it here; fall through to the
                        // normal API_KEY/dispatch flow below, which will hit the same
                        // error again through the main catch's classifyError() path.
                    }
                }
                else {
                    // No standalone validator for this tool (the 15 novada_scrape_<platform>
                    // tools) — fall back to a schema-derived "required fields present" check.
                    const missingRequired = computeMissingRequiredParams(name, argsRecord, TOOLS);
                    if (missingRequired && missingRequired.length > 0) {
                        return {
                            content: withUnknownKeyWarning([{
                                    type: "text",
                                    text: [
                                        `Invalid parameters for ${name}:`,
                                        ...missingRequired.map((f) => `  ${f}: Invalid input: expected value, received undefined`),
                                        `agent_instruction: ${missingRequired.map((f) => `Add the required parameter ${f}.`).join(" ")} Do NOT retry with identical params — at least one field must change.`,
                                    ].join("\n"),
                                }]),
                            isError: true,
                        };
                    }
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
            // Enforce tool filter at execution time (not just at list time).
            // F13 ordering: this is part of NAME resolution ("does this connection
            // answer to this name?"), so it runs BEFORE the key gate — a keyless
            // caller of a filtered-out tool learns about the filter, not the key.
            if ((process.env.NOVADA_TOOLS || process.env.NOVADA_GROUPS) && !ACTIVE_TOOLS.find(t => t.name === name)) {
                // F-4 gap #5: this already listed the available tools but carried no
                // agent_instruction/failure_class fields — off-contract shape vs.
                // every other error surface in this file.
                return {
                    content: [{
                            type: "text",
                            text: [
                                `Error [INVALID_PARAMS]: Tool '${name}' is not in the active set.`,
                                `failure_class: permanent`,
                                `retry_recommended: false`,
                                `NOVADA_TOOLS="${process.env.NOVADA_TOOLS ?? ""}" NOVADA_GROUPS="${process.env.NOVADA_GROUPS ?? ""}"`,
                                `agent_instruction: "Call one of the tools already active this session instead: ${ACTIVE_TOOLS.map(t => t.name).join(", ")}. Do not retry '${name}' — it is filtered out by this server's NOVADA_TOOLS/NOVADA_GROUPS config, not by anything in your request."`,
                            ].join("\n"),
                        }],
                    isError: true,
                };
            }
            // F12 (2026-09-10 audit): the key gate is a per-tool-CLASS decision
            // (_core/gate.ts) instead of the old blanket presence check with a
            // novada_discover carve-out:
            //   auth_free          → allow (discover/setup/session_stats/search_feedback)
            //   unauth_basic_tier  → keyless basic extract runs as an EXPLICIT,
            //                        DISCLOSED unauthenticated tier (no disk writes —
            //                        saveOutput consults the gate context; escalation
            //                        params still refuse locally)
            //   key_required       → keyless refusal below, unchanged
            // A present-but-INVALID key is locally indistinguishable from a valid one
            // (presence is the only local signal); billed/escalation paths refuse
            // upstream with the same Error [INVALID_API_KEY] / failure_class: auth
            // contract this local refusal carries.
            const gateDecision = decideKeyGate(name, {
                hasApiKey: !!API_KEY,
                kr6Bypass: isKr6Bypass,
                args: args,
            });
            if (gateDecision.kind === "refuse_missing_key") {
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
            if (gateDecision.kind === "refuse_escalation_requires_key") {
                return {
                    content: [{
                            type: "text",
                            text: [
                                `Error [INVALID_API_KEY]: render escalation requires a valid NOVADA_API_KEY — the keyless unauthenticated tier only covers the basic direct fetch (render="auto"/"static").`,
                                "failure_class: auth",
                                "retry_recommended: false",
                                `agent_instruction: "Either retry without the render parameter for a basic keyless fetch, or call novada_setup to configure a valid NOVADA_API_KEY and unlock render/unblocker/browser escalation."`,
                            ].join("\n"),
                        }],
                    isError: true,
                };
            }
            const unauthenticatedTier = gateDecision.kind === "allow_unauthenticated_tier";
            const t0 = Date.now();
            try {
                // NOV-321: record every dispatched tool call for novada_session_stats telemetry.
                recordToolCall(name);
                // When a tool filter is active, pass the active-tool names so novada_discover's
                // catalog reflects only what's usable this session (not the full registry).
                const visibleTools = (process.env.NOVADA_TOOLS || process.env.NOVADA_GROUPS)
                    ? new Set(ACTIVE_TOOLS.map(t => t.name))
                    : undefined;
                // F12/E2: unauth-tier calls run inside the gate context so saveOutput()
                // skips every ~/Downloads write for them, and their response carries the
                // tier disclosure as a separate content block below.
                const result = unauthenticatedTier
                    ? await runUnauthenticatedTier(() => dispatch(name, args, API_KEY, { onProgress, visibleTools }))
                    : await dispatch(name, args, API_KEY, { onProgress, visibleTools });
                // Local usage log (user-facing audit trail). Fire-and-forget — never blocks or throws.
                void logUsage({ tool: name, status: "success", ms: Date.now() - t0, target: summarizeTarget(args) });
                // TOW2-242: one-time first-run notice. Appended as a SEPARATE content block
                // (never concatenated into `result` — that would corrupt JSON-format outputs)
                // and ONLY on a successful dispatch. All logic + copy lives in the module;
                // this is the ~2-line glue. maybeGetFirstRunNotice() fails quiet → never throws.
                const content = withUnknownKeyWarning([{ type: "text", text: result }]);
                if (unauthenticatedTier)
                    content.push({ type: "text", text: UNAUTH_TIER_DISCLOSURE });
                const notice = await maybeGetFirstRunNotice();
                if (notice)
                    content.push({ type: "text", text: notice });
                return { content };
            }
            catch (error) {
                // Local usage log for the failed call. Fire-and-forget — never throws.
                // Redacted (defense in depth): this is a local audit-trail file, not a
                // tool-call response, but an upstream error can still carry a credential.
                void logUsage({ tool: name, status: "error", ms: Date.now() - t0, target: summarizeTarget(args), error: redactSecrets(String(error)) });
                // Zod validation errors → the shared formatter (F-12/P-4): per-issue-class
                // agent_instruction (missing/wrong-type/bad-enum/too-short/unknown-key/
                // union-mismatch each get an instruction naming the actual fix), reused
                // at every other ZodError site in this file instead of a private copy.
                if (error instanceof ZodError) {
                    const content = [
                        { type: "text", text: formatZodError(name, error) },
                    ];
                    // F-2: fold in the unknown-key warning UNLESS the schema already
                    // hard-rejected via .strict() (that issue is already named above —
                    // don't also say "ignored, had no effect", which would contradict it).
                    if (unknownKeyWarning && !hasUnrecognizedKeysIssue(error)) {
                        content.push({ type: "text", text: unknownKeyWarning });
                    }
                    return { content, isError: true };
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
        // Auto-provision proxy credentials (INC-198): if NOVADA_PROXY_ENDPOINT is
        // set but NOVADA_PROXY_USER/PASS are missing, fetch them from
        // /v1/proxy_account/list using NOVADA_API_KEY as Bearer token and inject
        // into process.env so the synchronous getProxyCredentials() picks them up
        // for all proxy tool calls. The logic lives in credentials.ts next to the
        // provenance marker it must set (MEDIUM-6: boot-injected creds are
        // AUTO-FETCHED — recording who fetched them keeps the F11 fail-closed
        // ledger gate applying instead of reclassifying them as user-supplied
        // "direct"). Non-fatal on failure: proxy tools show a configuration error
        // when invoked.
        const autoCreds = await autoProvisionProxyCredentialsAtBoot();
        if (autoCreds) {
            // G-8: autoCreds.user is a Novada proxy sub-account username (Novada
            // format `*-zone-*`, e.g. "customer-abc-zone-res") — the codebase's
            // own redactSecrets() rule #4 (errors.ts) classifies that shape as a
            // secret. Route it through the same choke-point every other error/log
            // path uses instead of interpolating it raw into stderr.
            console.error(`[novada] Auto-provisioned proxy credentials (account: ${redactSecrets(autoCreds.user)})`);
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
  novada_search              Search the web via Google, DuckDuckGo, Yandex (3 engines)
  novada_extract             Extract content from any URL (smart auto-routing)
  novada_crawl               Crawl a website (BFS/DFS, up to 20 pages)
  novada_research            Multi-source research — returns cited source material to reason over
  novada_map                 Discover URLs on a website (up to 100)
  novada_site_copy           Copy an entire docs site to disk as markdown (one file per page)
  novada_scrape              Structured data from 16 active platforms (~87 operations, e.g. Amazon, TikTok, SHEIN, ChatGPT)
  novada_scrape_<platform>   15 dedicated platform scrapers (amazon, google, bing, duckduckgo, yandex, youtube,
                             instagram, facebook, tiktok, x, walmart, shein, linkedin, github, perplexity) —
                             each a closed, typed operation enum; run --list-tools for the full live set
  novada_ai_monitor          Search AI-company public domains for brand mentions (not live models)
  novada_monitor             Detect page changes between checks (session-scoped baseline)
  novada_proxy               Get proxy credentials (residential/isp/datacenter/mobile/static/dedicated)
  novada_browser             Interactive browser automation (navigate, click, type, screenshot)
  novada_browser_flow        Cloud browser automation via action sequence API
  novada_account             Account & billing dashboard (balance, plans, usage, traffic)
  novada_proxy_account_create  Create a proxy sub-account (WRITE, approval-token gate)
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
    // Not an MCP tool-call response (the server failed to even start — stdio
    // transport connect failure, etc.) — redact for the same defense-in-depth
    // reason as the other stderr sites in this file.
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Fatal error:", redactSecrets(msg));
    process.exit(1);
});
//# sourceMappingURL=index.js.map