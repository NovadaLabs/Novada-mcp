/**
 * Canonical tool registry — the SINGLE SOURCE OF TRUTH for Novada MCP tools.
 *
 * Every tool exposed by the server (the `TOOLS` array in src/index.ts) MUST have
 * exactly one entry here, keyed by `name`. `src/tools/discover.ts` DERIVES its
 * catalog from this list — it does NOT maintain its own copy — so the discover
 * output can never drift from the tools that are actually wired.
 *
 * Drift guards (see tests/tools/discover.test.ts):
 *   1. TOOL_REGISTRY names === TOOLS names in src/index.ts (exact set match).
 *   2. The discover catalog ⊆ TOOL_REGISTRY (no ghost tools).
 *
 * This module is intentionally side-effect-free (no server construction, no
 * top-level execution) so it can be imported by index.ts, discover.ts, the
 * hosted endpoint, and tests without booting the MCP server.
 */
import { PLATFORM_SCRAPER_REGISTRY_ENTRIES } from "./platform_scrapers.js";
/** Category buckets, in the order they should render in `novada_discover`. */
export const TOOL_CATEGORIES = [
    "Content Retrieval",
    "Scraping & Verification",
    "Proxy",
    "Browser & Rendering",
    "Account & Billing",
    "Health & Discovery",
    "Auth",
];
/**
 * Opt-in filtering groups (F-1/F-7 audit, W-B1) — a COARSE 4-way partition of the
 * full registry, distinct from (and orthogonal to) TOOL_CATEGORIES above:
 *   - "core"     — general-purpose content/browser/proxy tools
 *   - "scrapers" — novada_scrape + all 15 novada_scrape_<platform> siblings
 *   - "account"  — KR-6 developer-api account/billing/write tools
 *   - "meta"     — discovery/setup/telemetry helper tools
 * Every TOOL_REGISTRY entry belongs to EXACTLY ONE group (enforced by ToolMeta
 * being a required field below — TypeScript fails the build if a row omits it).
 * Consumed by src/tools/discover.ts (renders the group reference) and by
 * hosted-server/vercel/api/mcp.ts's `?groups=` filter (local NOVADA_GROUPS keeps
 * its own pre-existing, richer taxonomy — see src/index.ts — which is NOT wired to
 * this table; see W-B1's report for why).
 */
export const TOOL_GROUPS = ["core", "scrapers", "account", "meta"];
/**
 * Which billing LEDGER a tool call draws on (C-7/G-10/G-12 audit, W-B4). Verified
 * per-tool against the tool's OWN source (network target + auth key), not guessed
 * from the tool's name — see the per-row comments below for the code evidence.
 *   - "capture"  — hits scraper.novada.com / webunlocker.novada.com only — i.e.
 *     the Capture/scraper balance (novada_account section="plans", product="capture").
 *   - "wallet"   — draws the master wallet-funded proxy-flow bandwidth (novada_proxy
 *     once the returned credentials are USED) or spends wallet currency directly
 *     (novada_static_ip_mgmt open/renew purchase/renew per-IP static allocations).
 *   - "mixed"    — the tool's OWN logic can debit EITHER ledger depending on the
 *     path taken for that specific call: its default fetch is wallet-funded proxy
 *     bandwidth (utils/http.ts's fetchViaProxy); it can escalate to a Capture-billed
 *     Web-Unblocker JS-render fetch, OR to a Browser/CDP fetch (which is ALSO
 *     Wallet-billed — same product family as novada_proxy, not Capture). Not a
 *     guess-once label — genuinely conditional per call.
 *   - "none"     — no consumption ledger is debited (free / read-only / in-memory
 *     / administrative account-management action).
 * See LEDGER_EXPLAINER below for the human-readable "which ledger funds what" copy
 * novada_discover renders from this same table (single source of truth).
 */
export const TOOL_LEDGERS = ["wallet", "capture", "mixed", "none"];
/**
 * Human-readable "which ledger funds what" explainer, one line per ToolLedger
 * value. novada_discover renders this verbatim so an agent choosing between
 * tools has a cost-basis, not just a name (C-7/G-10 fix). Source of truth for
 * this copy lives here, not duplicated in discover.ts.
 */
export const LEDGER_EXPLAINER = Object.freeze({
    capture: "Capture — the scraper/search balance (novada_account section=\"plans\", product=\"capture\"). " +
        "Funds novada_search, novada_scrape (+ every platform-scraper tool), novada_verify, " +
        "novada_ai_monitor, and the Web-Unblocker JS-render escalation inside " +
        "novada_extract/crawl/research/site_copy/monitor.",
    wallet: "Wallet — the master currency balance (novada_account section=\"balance\"). Funds proxy " +
        "bandwidth once novada_proxy's returned credentials are actually used, novada_static_ip_mgmt's " +
        "open/renew per-IP purchases, and the Browser product (novada_browser / novada_browser_flow — " +
        "billed via api-m.novada.com's developer-api / proxy_account family, product=10, the same " +
        "mechanism and zone-suffix convention as the proxy family's product=1). The Browser product's " +
        "balance is NOT separately surfaced in novada_account's ledger sections (not in " +
        "plan_balance_all's product list) — check dashboard.novada.com directly for it.",
    mixed: "Mixed — this tool's default fetch draws Wallet-funded proxy bandwidth; a single call can " +
        "escalate to a Capture-billed Web-Unblocker JS-render fetch, OR to a Browser (CDP) fetch — " +
        "which is ALSO Wallet-billed (same product family as novada_proxy, not Capture) — depending on " +
        "what the target page needs. Which ledger moves depends on the path taken for THAT call, not " +
        "the tool as a whole.",
    none: "None — no consumption ledger is debited by this tool call (free, read-only, in-memory, or " +
        "an account-management action).",
});
/**
 * One entry per registered tool. Descriptions here are the SHORT,
 * catalog-facing one-liners (the full multi-paragraph descriptions live on the
 * `TOOLS` array in src/index.ts, which the MCP client sees in inputSchema).
 * Order mirrors the `TOOLS` array for easy side-by-side review.
 */
export const TOOL_REGISTRY = [
    // ─── Content Retrieval ──────────────────────────────────────────────────
    {
        name: "novada_search",
        description: "Search the web via Google, DuckDuckGo, or Yandex with geo-targeting, time_range, domain filters, and optional auto-extract on top results",
        category: "Content Retrieval",
        status: "active",
        title: "Web Search",
        group: "core",
        // Code: search.ts:142,244 POST `${SCRAPER_API_BASE}/request` — Capture only.
        // Live-verified (C-reliability-live.md spend ledger): Wallet unmoved, Capture
        // debited across every search call in the audit.
        ledger: "capture",
    },
    {
        name: "novada_extract",
        description: "Extract main content, title, description, links, and structured fields from one or up to 10 URLs; supports static/render/browser escalation and PDF detection",
        category: "Content Retrieval",
        status: "active",
        title: "Content Extractor",
        group: "core",
        // Code: extract.ts imports fetchViaProxy (wallet-funded proxy bandwidth, the
        // default fetch), fetchWithRender (Capture-billed Web-Unblocker escalation),
        // AND fetchViaBrowser (Browser/CDP escalation — coordinator correction,
        // 2026-09-03: this is ALSO wallet-billed, product=10 via the SAME api-m.novada.com
        // developer-api/proxy_account family as novada_proxy's product=1, NOT Capture —
        // see the "wallet" bullet in LEDGER_EXPLAINER). Genuinely conditional per call.
        ledger: "mixed",
    },
    {
        name: "novada_crawl",
        description: "Crawl websites using BFS or DFS traversal with configurable depth, content extraction, include/exclude patterns, and ReDoS-safe path filtering",
        category: "Content Retrieval",
        status: "active",
        title: "Site Crawler",
        group: "core",
        // Code: crawl.ts:1,42 imports fetchViaProxy (wallet, default) AND fetchWithRender
        // (Capture-billed Web Unblocker escalation) — same conditional-per-call shape as extract.
        ledger: "mixed",
    },
    {
        name: "novada_research",
        description: "Multi-step research: 3–10 parallel SERP queries, source deduplication, full content extraction from top URLs; returns CITED SOURCE MATERIAL (numbered source passages) for you to compose the answer from — extractive, not a synthesized report",
        category: "Content Retrieval",
        status: "active",
        title: "Deep Research",
        group: "core",
        // Code: research.ts:4-5 composes novadaExtract (mixed: wallet + capture-on-
        // escalation) AND submitSearchScrapeTask/resolveSearchResults from search.ts
        // (capture-only) — a single research call draws BOTH ledgers by construction.
        ledger: "mixed",
    },
    {
        name: "novada_map",
        description: "Discover all URLs on a website without extracting content; uses sitemap.xml via robots.txt first, falls back to BFS; returns up to 100 filtered URLs",
        category: "Content Retrieval",
        status: "active",
        title: "URL Mapper",
        group: "core",
        // Code: map.ts imports ONLY fetchViaProxy (no fetchWithRender/fetchViaBrowser
        // import at all) — wallet-funded proxy bandwidth is the sole fetch path.
        ledger: "wallet",
    },
    {
        name: "novada_site_copy",
        description: "Copy an entire docs site or section to disk as one markdown file per page (llms.txt → sitemap → scoped BFS discovery); returns a compact manifest, not page bodies",
        category: "Content Retrieval",
        status: "active",
        title: "Site Copy",
        group: "core",
        // Code: site_copy.ts:3-4 imports fetchViaProxy AND fetchWithRender — same
        // conditional-per-call shape as extract/crawl.
        ledger: "mixed",
    },
    {
        name: "novada_search_feedback",
        description: "Record search-result quality (search_id/query + useful URLs + rating good/ok/bad) to bias future ranking; in-memory feedback store, returns a thank-you/echo with an agent_instruction",
        category: "Content Retrieval",
        status: "active",
        title: "Search Feedback",
        group: "meta",
        // Finding: G-security-billing.md write-gate table — "in-memory only, per-process,
        // nothing persisted, nothing leaves the process" / "No external effect at all".
        ledger: "none",
    },
    // ─── Scraping & Verification ────────────────────────────────────────────
    {
        name: "novada_scrape",
        description: "Extract structured data from 16 active platforms (~87 operations) (Amazon, TikTok, LinkedIn, YouTube, SHEIN, ChatGPT, Perplexity, etc.) in a single synchronous call; supports markdown/json/toon/csv/excel/html output",
        category: "Scraping & Verification",
        status: "active",
        title: "Platform Scraper",
        group: "scrapers",
        // Code: scrape.ts:2,12 — SCRAPE_ENDPOINT = `${SCRAPER_API_BASE}/request`. Live-
        // verified (C-reliability-live.md: github submit −0.18 Capture, Wallet unmoved).
        ledger: "capture",
    },
    // novada_scrape_amazon (and, as they're added, its 15 per-platform siblings) is
    // GENERATED by the platform-scraper factory (src/tools/platform_scraper.ts) from a
    // declarative config (src/tools/scrape_amazon.ts) — spread here rather than
    // hand-written so the registry entry can never drift from the generated tool.
    // Each generated entry carries its own title (derivePlatformTitle) and
    // group:"scrapers" — see createPlatformScraperTool in platform_scraper.ts.
    // ledger:"capture" is injected here (not in platform_scraper.ts, which this
    // audit does not own/edit) because EVERY platform scraper's handler delegates
    // to novadaScrape (scrape.ts) — the same SCRAPER_API_BASE fact as novada_scrape
    // above, stamped once for the whole class instead of per-platform.
    ...PLATFORM_SCRAPER_REGISTRY_ENTRIES.map((entry) => ({ ...entry, ledger: "capture" })),
    {
        name: "novada_ai_monitor",
        description: "Search indexed public pages on AI-company domains (chatgpt.com/openai.com, perplexity.ai, anthropic.com, ...) for brand mentions and sentiment. Does NOT query the live AI models — reflects indexed-page coverage only. Returns per-domain sentiment signals, key claims, competitor mentions, and source URLs.",
        category: "Scraping & Verification",
        status: "active",
        title: "AI Brand Monitor",
        group: "core",
        // Code: ai_monitor.ts:1 imports submitSearchScrapeTask/resolveSearchResults
        // from search.ts — same SCRAPER_API_BASE path as novada_search.
        ledger: "capture",
    },
    {
        name: "novada_monitor",
        description: "Session-scoped only / no durable state — baseline lost on server restart; schedule from your own job runner for persistence. Detect changes on a web page over time by comparing content hashes; first call sets a baseline, subsequent calls report changed/unchanged plus optional field-level diffs",
        category: "Scraping & Verification",
        status: "active",
        title: "Page Change Monitor",
        group: "core",
        // Code: monitor.ts:3,400-419 — content fetch is entirely via novadaExtract, so
        // this tool inherits extract's mixed wallet/capture shape (no direct fetch of its own).
        ledger: "mixed",
    },
    {
        name: "novada_verify",
        description: "Check a factual claim against 3 parallel web searches (supporting, skeptical, fact-check angles); returns verdict: supported / unsupported / contested / insufficient_data with confidence 0–100. Signal-based, not definitive.",
        category: "Scraping & Verification",
        status: "active",
        title: "Fact Verification",
        group: "core",
        // Code: verify.ts:2 imports submitSearchScrapeTask/resolveSearchResults from
        // search.ts — same SCRAPER_API_BASE path as novada_search.
        ledger: "capture",
    },
    // ─── Proxy ──────────────────────────────────────────────────────────────
    {
        name: "novada_proxy",
        description: "Get proxy credentials for your own HTTP clients. type=residential|isp|datacenter|mobile|static|dedicated (default residential). Supports country/city/session_id targeting. Returns proxy URL, shell exports (format='env'), or curl flag (format='curl').",
        category: "Proxy",
        status: "active",
        title: "Proxy Credentials",
        group: "core",
        // The tool call itself makes no billable request — it formats credentials.
        // Ledger reflects what actually pays once those credentials are USED: Wallet-
        // funded proxy-flow bandwidth (this is also the ledger the new C-11
        // expired-plan entitlement check in proxy.ts verifies before handing out creds).
        ledger: "wallet",
    },
    // ─── Browser & Rendering ────────────────────────────────────────────────
    {
        name: "novada_browser",
        description: "Automate browser interactions: navigate, click, type, screenshot, aria_snapshot, evaluate JS, wait, scroll, hover, press_key, select — up to 20 actions per call; maintains session state",
        category: "Browser & Rendering",
        status: "active",
        title: "Browser Automation",
        group: "core",
        // RELABELED 2026-09-03 (coordinator correction — historical-P0-class
        // wrong-ledger-assumption catch): the ORIGINAL "capture" stamp here reasoned
        // from "same NOVADA_API_KEY" — which proves nothing, since every tool shares
        // that key. The actual evidence points to Wallet: utils/credentials.ts's
        // resolveBrowserWs()/auto-provision path fetches WSS creds via
        // /v1/proxy_account/list product=10 on api-m.novada.com (developer-api) — the
        // IDENTICAL mechanism + zone-suffix convention as novada_proxy's own
        // product=1 lookup (also wallet). Never hits scraper.novada.com/
        // webunlocker.novada.com (the actual Capture hosts). Product=10 is NOT one of
        // plan_balance_all's ALL_PRODUCT_KEYS, so novada_account shows no balance for
        // it under any ledger — flagged honestly in LEDGER_EXPLAINER's "wallet" entry
        // rather than asserting an unverified Capture fact.
        ledger: "wallet",
    },
    {
        name: "novada_browser_flow",
        description: "Cloud browser automation via action sequence API (POST browser_flow_use); executes click/scroll/wait/type/screenshot actions in sequence; supports sticky sessions via session_id.",
        category: "Browser & Rendering",
        status: "active",
        title: "Browser Flow Automation",
        group: "core",
        // RELABELED 2026-09-03 (coordinator correction — same historical-P0-class
        // wrong-ledger-assumption catch as novada_browser above): the ORIGINAL
        // "capture" stamp reasoned from "same NOVADA_API_KEY", which proves nothing
        // (every tool shares that key). The billable POST is
        // https://api-m.novada.com/v1/browser_flow/browser_flow_use — i.e.
        // DEVELOPER_API_BASE (browser_flow.ts:78), NOT SCRAPER_API_BASE
        // (scraper.novada.com, the actual Capture host). Same api-m.novada.com /
        // developer-api family as the proxy-account mechanism → wallet, matching
        // novada_browser. Not one of plan_balance_all's ALL_PRODUCT_KEYS, so no
        // balance for it surfaces under any ledger in novada_account.
        ledger: "wallet",
    },
    // ─── Account & Billing (KR-6 developer-api tools) ───────────────────────
    {
        name: "novada_account",
        description: "Unified account & billing dashboard. section='summary' (default): wallet balance + plan quotas + recent capture logs + health entitlements. section='balance': wallet balance. section='usage': paginated transaction history. section='plans': per-product plan balances. section='traffic': daily proxy consumption. Aliases: wallet_balance, wallet_usage_record, plan_balance_all, traffic_daily, capture_logs, account_summary, health, health_all.",
        category: "Account & Billing",
        status: "active",
        title: "Account & Billing",
        group: "account",
        // Reads (wallet_balance/plan_balance_all/capture_logs/health) — balance/plan
        // lookups, not consumption charges. Code: account_summary.ts composes these
        // three read-only sub-tools; account.ts's other sections are equally read-only.
        ledger: "none",
    },
    {
        name: "novada_proxy_account_create",
        description: "⚠️ WRITE — create a proxy sub-account against your master plan. Two-step approval-token gate: call once without approval_token to get a masked preview + a token, then re-call with that exact token and unchanged parameters after human approval.",
        category: "Account & Billing",
        status: "active",
        title: "Proxy Account Create",
        group: "account",
        // Admin write against api-m.novada.com (NOVADA_DEVELOPER_API_KEY) — creates a
        // sub-account record; no per-call consumption ledger is debited by the call itself.
        ledger: "none",
    },
    {
        name: "novada_proxy_account_list",
        description: "List proxy sub-accounts for a product (paginated). Best for auditing sub-accounts or finding account names before rotating credentials.",
        category: "Account & Billing",
        status: "active",
        title: "Proxy Account List",
        group: "account",
        ledger: "none",
    },
    {
        name: "novada_ip_whitelist",
        description: "Manage the proxy IP whitelist (add/list/del/remark) for Residential (1), Unlimited (4), and Static ISP (5) products; add/del/remark are writes gated by a two-step approval_token (preview first, then re-call with the token).",
        category: "Account & Billing",
        status: "active",
        title: "IP Whitelist Manager",
        group: "account",
        // Account configuration (add/list/del/remark against /v1/white_list/*) — no
        // consumption ledger.
        ledger: "none",
    },
    {
        name: "novada_capture_apikey",
        description: "Get or reset the Capture API key for the account; reset is a WRITE action gated by a two-step approval_token — preview first, then re-call with the token after human approval.",
        category: "Account & Billing",
        status: "active",
        title: "Capture API Key",
        group: "account",
        // Manages the KEY that authenticates Capture-ledger calls — it does not itself
        // spend the Capture balance (get/reset are administrative, not consumption).
        ledger: "none",
    },
    {
        name: "novada_static_ip_mgmt",
        description: "Manage static ISP IPs: open (WRITE, approval-token gate), renew (WRITE, approval-token gate), export, or list; wraps /v1/static_house/* developer-api endpoints.",
        category: "Account & Billing",
        status: "active",
        title: "Static IP Manager",
        group: "account",
        // open/renew SPEND MONEY to purchase/renew per-IP static allocations (finding:
        // G-security-billing.md's own write-gate table row calls this out explicitly:
        // "open/renew — SPENDS MONEY"). Static ISP is a proxy product, purchased with
        // wallet currency like every other flow plan (plan_balance_all.ts header
        // comment: "Wallet ... Funds proxy-product plan purchases only"). export/list
        // are free reads — the field is per-TOOL, not per-action, so the write actions'
        // ledger is the honest label for the row as a whole.
        ledger: "wallet",
    },
    // ─── Health & Discovery ─────────────────────────────────────────────────
    {
        name: "novada_discover",
        description: "List all available Novada tools with name, description, category, and status",
        category: "Health & Discovery",
        status: "active",
        title: "Tool Discovery",
        group: "meta",
        ledger: "none",
    },
    {
        name: "novada_setup",
        description: "Onboarding concierge + first-run front door: validates your API key against the account API, tells you exactly how to register / get a key (free credits) if you have none, and orients you on the core tools. Auth-free — never errors on a missing key.",
        category: "Health & Discovery",
        status: "active",
        title: "Setup & Configuration",
        group: "meta",
        ledger: "none",
    },
    {
        name: "novada_session_stats",
        description: "Per-process / per-session usage telemetry: tool-call counts, last-N calls, and uptime; in-memory, auth-free, resets on server restart",
        category: "Health & Discovery",
        status: "active",
        title: "Session Stats",
        group: "meta",
        ledger: "none",
    },
];
/**
 * Every registered tool name -> group, derived from TOOL_REGISTRY (single source
 * of truth). Consumed by discover.ts's Tool Groups section and available for any
 * other transport (hosted mcp.ts) that wants to mirror the same partition.
 */
export const GROUP_TOOL_NAMES = Object.freeze(Object.fromEntries(TOOL_GROUPS.map((g) => [g, TOOL_REGISTRY.filter((t) => t.group === g).map((t) => t.name)])));
/**
 * Every registered tool name -> ledger, derived from TOOL_REGISTRY (single source
 * of truth). A row with no `ledger` set (should never happen for a real entry —
 * see tests/consistency/registry-ledger-taxonomy.test.ts) simply does not appear
 * under any key here; it is NOT silently coerced into "none", so an unassigned
 * row is visible as a gap in the union rather than masquerading as a real value.
 * Consumed by discover.ts's Billing section.
 */
export const LEDGER_TOOL_NAMES = Object.freeze(Object.fromEntries(TOOL_LEDGERS.map((l) => [l, TOOL_REGISTRY.filter((t) => t.ledger === l).map((t) => t.name)])));
/** Tool names in the canonical registry, as a Set for fast membership checks. */
export const REGISTERED_TOOL_NAMES = new Set(TOOL_REGISTRY.map((t) => t.name));
/**
 * The subset of TOOL_CATEGORIES that have at least one entry in TOOL_REGISTRY.
 * Categories with zero entries (e.g. "Auth") are intentionally excluded so they
 * never appear in the Zod enum, the inputSchema description, or Zod validation
 * error hints shown to callers.
 *
 * Guaranteed non-empty at runtime because the registry always has tools.
 * Type is `[ToolCategory, ...ToolCategory[]]` to satisfy z.enum() which requires
 * a non-empty tuple.
 */
const _populatedCategories = TOOL_CATEGORIES.filter((c) => TOOL_REGISTRY.some((t) => t.category === c));
// z.enum() requires a non-empty tuple — assert at module load time so a
// misconfigured empty registry surfaces as a startup error, not a type error.
if (_populatedCategories.length === 0) {
    throw new Error("TOOL_REGISTRY is empty — cannot derive populated categories for Zod enum");
}
export const POPULATED_TOOL_CATEGORIES = _populatedCategories;
//# sourceMappingURL=registry.js.map