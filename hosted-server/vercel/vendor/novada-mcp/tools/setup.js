import { z, ZodError } from "zod";
import { novadaWalletBalance } from "./wallet_balance.js";
import { NovadaError, NovadaErrorCode } from "../_core/errors.js";
import { VERSION } from "../config.js";
export const SetupParamsSchema = z.object({}).strict();
export function validateSetupParams(raw) {
    try {
        return SetupParamsSchema.parse(raw);
    }
    catch (e) {
        if (e instanceof ZodError) {
            const issues = e.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
            throw new Error(`Invalid parameters for novada_setup:\n${issues}\nagent_instruction: Fix the parameter(s) listed above and retry. Check the tool's inputSchema for required fields and valid values.`);
        }
        throw e;
    }
}
// ─── Canonical URLs (reused from the codebase — do NOT invent new paths) ──────
//   REGISTER / $10 free credits : https://novada.com  (public signup front door — TOW2-242)
//   TOP UP / dashboard home      : https://dashboard.novada.com  (billing / overview)
//   GET AN API KEY          : https://dashboard.novada.com/api-key/  (errors.ts INVALID_API_KEY template)
//   BROWSER API WS          : https://dashboard.novada.com/overview/browser/  (health.ts)
//   PROXY                   : https://dashboard.novada.com/overview/proxy/    (health.ts)
const URL_DASHBOARD = "https://dashboard.novada.com";
// TOW2-242: signup/registration front door is novada.com (NOT dashboard.*, NOT
// mcp.novada.com). New testers get an API key + $10 free credits here. This is a
// deliberate always-on onboarding lookup — no once-logic (that's the first-run
// notice module's job).
const URL_SIGNUP = "https://novada.com";
const URL_API_KEY = "https://dashboard.novada.com/api-key/";
const URL_BROWSER = "https://dashboard.novada.com/overview/browser/";
const URL_PROXY = "https://dashboard.novada.com/overview/proxy/";
/**
 * TOW2-252: account-identity suffix for the wallet balance line — key tail +
 * as-of. uid is not available from the wallet envelope and we do NOT add an API
 * call just to fetch it, so it is omitted here. Key tail is never more than 4 chars.
 */
function identitySuffix(effectiveKey) {
    const tail = effectiveKey && effectiveKey.length >= 4 ? effectiveKey.slice(-4) : (effectiveKey ?? "");
    const asOf = new Date().toISOString();
    return tail
        ? ` · account: key …${tail} · as of ${asOf}`
        : ` · account: as of ${asOf}`;
}
/**
 * Cheap, authoritative key check: read the master wallet balance — the same
 * billing endpoint novada_account already uses. This is a
 * real "does the key work" probe (NOT a synthetic per-product probe), and it
 * doubles as a "you have credit" signal for a brand-new tester.
 *
 * Never throws — classifies the outcome into one of the three key-states.
 */
async function validateKey(effectiveKey) {
    if (!effectiveKey)
        return { state: "not_set" };
    try {
        const raw = await novadaWalletBalance({}, effectiveKey);
        const parsed = JSON.parse(raw);
        const balance = parsed?.data?.balance;
        // The wallet API does NOT return a currency field. Never invent one (€/$):
        // print the bare number and note the dashboard shows the real currency.
        const currency = typeof parsed?.data?.currency === "string" ? parsed.data.currency : "";
        if (typeof balance === "number") {
            const balanceLine = balance > 0
                ? `Wallet balance: ${currency}${balance.toFixed(2)} (currency as shown in your dashboard) — enough to start testing.${identitySuffix(effectiveKey)}`
                : `Wallet balance: ${currency}0.00 (currency as shown in your dashboard) — top up at ${URL_DASHBOARD} to run pay-per-use tools.${identitySuffix(effectiveKey)}`;
            return { state: "ready", balanceLine };
        }
        // Key was accepted (no auth error) but balance shape was unexpected — still
        // "ready" (the credential works); just can't show a number.
        return { state: "ready", balanceLine: "Key accepted. (Wallet balance unavailable right now.)" };
    }
    catch (e) {
        // Auth failures → the key is present but not valid. Everything else
        // (network, rate-limit, transient 5xx) is NOT the key's fault → treat the
        // key as present-and-probably-fine so we never scare a first-run user with
        // a transient blip.
        const isAuth = e instanceof NovadaError && e.code === NovadaErrorCode.INVALID_API_KEY;
        const msg = e instanceof Error ? e.message : String(e);
        if (isAuth) {
            return { state: "present_but_invalid", detail: msg.split("\n")[0]?.slice(0, 160) };
        }
        return {
            state: "ready",
            balanceLine: `Key present — couldn't confirm balance (temporary API issue: ${msg.split("\n")[0]?.slice(0, 100)}). This is usually transient.`,
        };
    }
}
// ─── "What you can do" orientation (plain-language, human + agent friendly) ───
const CORE_TOOLS = [
    { tool: "novada_search", line: "Search the web (Google/Bing/etc.) — find pages, news, facts." },
    { tool: "novada_extract", line: "Read any page — clean text, title, links, or specific fields from a URL." },
    { tool: "novada_scrape", line: "Structured data from platforms — Amazon products, LinkedIn, TikTok, YouTube, and more." },
    { tool: "novada_browser", line: "Operate a page — click, type, scroll, screenshot; drive JS-heavy sites and logins." },
    { tool: "novada_account", line: "Your account at a glance — balance, plan quotas, and recent usage." },
];
// H4: novada_site_copy is NOT ported to the hosted surface (writes to a
// read-only serverless FS), so advertising it here dead-ends a hosted agent
// with TOOL_NOT_ENABLED. novada_crawl covers whole-site content on both
// surfaces, so we point at it instead.
const ADDON_TOOLS = "Also available: novada_research (multi-source cited report), novada_crawl (multi-page content from a site), " +
    "novada_monitor (watch a page for changes), and novada_proxy (residential/ISP/mobile/datacenter IPs for your own HTTP clients — set type=).";
/**
 * Onboarding concierge — the first-run front door of the Novada MCP.
 *
 * AUTH-FREE by design: this is the tool that helps you GET a key, so a missing
 * key is the normal first-run state, never an error. It (1) reports whether your
 * key is present+valid / present-but-invalid / not set, (2) tells you the exact
 * next action, and (3) orients you on what you can do.
 */
export async function novadaSetup(_params, callerApiKey) {
    const apiKey = process.env.NOVADA_API_KEY?.trim();
    const devApiKey = process.env.NOVADA_DEVELOPER_API_KEY?.trim();
    const browserWs = process.env.NOVADA_BROWSER_WS?.trim();
    const proxyUser = process.env.NOVADA_PROXY_USER?.trim();
    const proxyPass = process.env.NOVADA_PROXY_PASS?.trim();
    const proxyEndpoint = process.env.NOVADA_PROXY_ENDPOINT?.trim();
    // On the hosted server the customer's key arrives per-request (callerApiKey) — validate
    // THAT, not the server's env fallback. Locally, fall back to env. This makes setup a
    // truthful front door: it checks the key the customer actually connected with.
    const effectiveKey = callerApiKey?.trim() || devApiKey || apiKey;
    const proxyConfigured = !!(proxyUser && proxyPass && proxyEndpoint);
    const validation = await validateKey(effectiveKey);
    const { state } = validation;
    const L = ["# Welcome to Novada", ""];
    // ─── (a) Status line ────────────────────────────────────────────────────
    const statusLabel = state === "ready" ? "✅ You're ready — your API key works."
        : state === "present_but_invalid" ? "⚠️ Your API key is set but was rejected."
            : "👋 No API key yet — let's get you started (free credits available).";
    L.push(`**Status:** ${statusLabel}`);
    if (state === "ready" && validation.balanceLine)
        L.push(`> ${validation.balanceLine}`);
    L.push("");
    // ─── (b) Next action for this state ───────────────────────────────────────
    if (state === "not_set") {
        L.push("## Get started in 3 steps");
        L.push("");
        L.push(`1. **Register** at ${URL_SIGNUP} — get your own API key + $10 free credits so you can test right away.`);
        L.push(`2. **Copy your API key** from ${URL_API_KEY}`);
        L.push("3. **Add it to your MCP client**, then restart it:");
        L.push("");
        L.push("   **Claude Code** (one command):");
        L.push("   ```");
        L.push("   claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp");
        L.push("   ```");
        L.push("");
        L.push("   **Claude Desktop / Cursor / VS Code / Windsurf** (mcp config `env` block):");
        L.push("   ```json");
        L.push('   { "mcpServers": { "novada": {');
        L.push('     "command": "npx", "args": ["-y", "novada-mcp"],');
        L.push('     "env": { "NOVADA_API_KEY": "your_key" }');
        L.push("   } } }");
        L.push("   ```");
        L.push("");
        L.push("Then call **novada_setup** again — it will confirm your key works and show your balance.");
        L.push("");
    }
    else if (state === "present_but_invalid") {
        L.push("## Fix your key");
        L.push("");
        L.push(`Your key was rejected by the account API. Get a valid key at ${URL_API_KEY} and update the`);
        L.push("`NOVADA_API_KEY` env var in your MCP client config, then restart the client.");
        if (validation.detail)
            L.push(`> Detail: ${validation.detail}`);
        L.push("");
        L.push(`If you don't have an account yet, register at ${URL_SIGNUP} — API key + $10 free credits included.`);
        L.push("");
    }
    else {
        // ready
        L.push("You're all set. Here's what you can do:");
        L.push("");
    }
    // ─── (c) "What you can do" orientation (always shown) ─────────────────────
    L.push("## What you can do");
    L.push("");
    for (const { tool, line } of CORE_TOOLS) {
        L.push(`- **${tool}** — ${line}`);
    }
    L.push("");
    L.push(ADDON_TOOLS);
    L.push("");
    // Optional capabilities (only nudge when ready — don't clutter the first run).
    if (state === "ready") {
        const optional = [];
        if (!browserWs)
            optional.push(`For faster **novada_browser** sessions you can set NOVADA_BROWSER_WS (optional — auto-provisioned from your key otherwise). Enable at ${URL_BROWSER}`);
        if (!proxyConfigured)
            optional.push(`For **novada_proxy** (set type=residential|isp|mobile|datacenter|static|dedicated) in your own HTTP clients, set NOVADA_PROXY_ENDPOINT (user/pass auto-fetched from your key). Details at ${URL_PROXY}`);
        if (optional.length) {
            L.push("### Optional add-ons");
            for (const o of optional)
                L.push(`- ${o}`);
            L.push("");
        }
        L.push("Next: call **novada_account** for balance + quotas, or **novada_discover** to list every tool.");
        L.push("");
    }
    // ─── Privacy disclosure (one line, always shown) ──────────────────────────
    // Hosted gateway telemetry is metadata-only; the full field list and the
    // never-collected list live in the novada://privacy resource.
    L.push("Usage metadata is logged (never your queries, URL paths, or content) — read novada://privacy.");
    L.push("");
    // ─── Agent-facing machine block ───────────────────────────────────────────
    const agentInstruction = state === "ready"
        ? "Key is valid. You may call any tool. Suggest the user try novada_search or novada_extract; call novada_account for balance/quotas."
        : state === "present_but_invalid"
            ? `Do NOT retry other tools yet — the key is invalid. Tell the user to get a valid key at ${URL_API_KEY} and update NOVADA_API_KEY in their MCP client config, then restart. This is a setup step, not a tool failure.`
            : `No key yet. Tell the user to register at ${URL_SIGNUP} (API key + $10 free credits included), copy their API key from ${URL_API_KEY}, add it as NOVADA_API_KEY in their MCP client config, and restart. Do not treat this as an error — it is the normal first-run state.`;
    L.push("## Agent");
    L.push(`key_state: ${state}`);
    // NOVADA_SERVER_VERSION is set at module init by the hosted wrapper (mcp.ts) to its
    // computed HOSTED_VERSION string (e.g. "0.9.26-hosted"), which is the same string
    // serverInfo.version carries in the MCP initialize response. Falling back to VERSION
    // (from package.json) keeps stdio mode correct without any extra env configuration.
    // INVARIANT: this line == serverInfo.version in both hosted and stdio modes.
    L.push(`server_version: ${process.env.NOVADA_SERVER_VERSION ?? VERSION}`);
    L.push(`register_url: ${URL_SIGNUP}`);
    L.push(`api_key_url: ${URL_API_KEY}`);
    L.push(`core_tools: ${CORE_TOOLS.map(t => t.tool).join(", ")}`);
    L.push(`agent_instruction: ${agentInstruction}`);
    return L.join("\n");
}
//# sourceMappingURL=setup.js.map