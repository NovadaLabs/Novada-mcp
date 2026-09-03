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

export type ToolStatus = "active" | "todo";

/** Category buckets, in the order they should render in `novada_discover`. */
export const TOOL_CATEGORIES = [
  "Content Retrieval",
  "Scraping & Verification",
  "Proxy",
  "Browser & Rendering",
  "Account & Billing",
  "Health & Discovery",
  "Auth",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

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
export const TOOL_GROUPS = ["core", "scrapers", "account", "meta"] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface ToolMeta {
  name: string;
  description: string;
  category: ToolCategory;
  status: ToolStatus;
  /** Short MCP `title` (UI display hint) — every tool must have one (F-7). */
  title: string;
  /** Opt-in filtering group — see TOOL_GROUPS above. */
  group: ToolGroup;
}

/**
 * One entry per registered tool. Descriptions here are the SHORT,
 * catalog-facing one-liners (the full multi-paragraph descriptions live on the
 * `TOOLS` array in src/index.ts, which the MCP client sees in inputSchema).
 * Order mirrors the `TOOLS` array for easy side-by-side review.
 */
export const TOOL_REGISTRY: readonly ToolMeta[] = [
  // ─── Content Retrieval ──────────────────────────────────────────────────
  {
    name: "novada_search",
    description: "Search the web via Google, DuckDuckGo, or Yandex with geo-targeting, time_range, domain filters, and optional auto-extract on top results",
    category: "Content Retrieval",
    status: "active",
    title: "Web Search",
    group: "core",
  },
  {
    name: "novada_extract",
    description: "Extract main content, title, description, links, and structured fields from one or up to 10 URLs; supports static/render/browser escalation and PDF detection",
    category: "Content Retrieval",
    status: "active",
    title: "Content Extractor",
    group: "core",
  },
  {
    name: "novada_crawl",
    description: "Crawl websites using BFS or DFS traversal with configurable depth, content extraction, include/exclude patterns, and ReDoS-safe path filtering",
    category: "Content Retrieval",
    status: "active",
    title: "Site Crawler",
    group: "core",
  },
  {
    name: "novada_research",
    description: "Multi-step research: 3–10 parallel SERP queries, source deduplication, full content extraction from top URLs; returns CITED SOURCE MATERIAL (numbered source passages) for you to compose the answer from — extractive, not a synthesized report",
    category: "Content Retrieval",
    status: "active",
    title: "Deep Research",
    group: "core",
  },
  {
    name: "novada_map",
    description: "Discover all URLs on a website without extracting content; uses sitemap.xml via robots.txt first, falls back to BFS; returns up to 100 filtered URLs",
    category: "Content Retrieval",
    status: "active",
    title: "URL Mapper",
    group: "core",
  },
  {
    name: "novada_site_copy",
    description: "Copy an entire docs site or section to disk as one markdown file per page (llms.txt → sitemap → scoped BFS discovery); returns a compact manifest, not page bodies",
    category: "Content Retrieval",
    status: "active",
    title: "Site Copy",
    group: "core",
  },
  {
    name: "novada_search_feedback",
    description: "Record search-result quality (search_id/query + useful URLs + rating good/ok/bad) to bias future ranking; in-memory feedback store, returns a thank-you/echo with an agent_instruction",
    category: "Content Retrieval",
    status: "active",
    title: "Search Feedback",
    group: "meta",
  },
  // ─── Scraping & Verification ────────────────────────────────────────────
  {
    name: "novada_scrape",
    description: "Extract structured data from 16 active platforms (~87 operations) (Amazon, TikTok, LinkedIn, YouTube, SHEIN, ChatGPT, Perplexity, etc.) in a single synchronous call; supports markdown/json/toon/csv/excel/html output",
    category: "Scraping & Verification",
    status: "active",
    title: "Platform Scraper",
    group: "scrapers",
  },
  // novada_scrape_amazon (and, as they're added, its 15 per-platform siblings) is
  // GENERATED by the platform-scraper factory (src/tools/platform_scraper.ts) from a
  // declarative config (src/tools/scrape_amazon.ts) — spread here rather than
  // hand-written so the registry entry can never drift from the generated tool.
  // Each generated entry carries its own title (derivePlatformTitle) and
  // group:"scrapers" — see createPlatformScraperTool in platform_scraper.ts.
  ...PLATFORM_SCRAPER_REGISTRY_ENTRIES,
  {
    name: "novada_ai_monitor",
    description: "Search indexed public pages on AI-company domains (chatgpt.com/openai.com, perplexity.ai, anthropic.com, ...) for brand mentions and sentiment. Does NOT query the live AI models — reflects indexed-page coverage only. Returns per-domain sentiment signals, key claims, competitor mentions, and source URLs.",
    category: "Scraping & Verification",
    status: "active",
    title: "AI Brand Monitor",
    group: "core",
  },
  {
    name: "novada_monitor",
    description: "Session-scoped only / no durable state — baseline lost on server restart; schedule from your own job runner for persistence. Detect changes on a web page over time by comparing content hashes; first call sets a baseline, subsequent calls report changed/unchanged plus optional field-level diffs",
    category: "Scraping & Verification",
    status: "active",
    title: "Page Change Monitor",
    group: "core",
  },
  {
    name: "novada_verify",
    description: "Check a factual claim against 3 parallel web searches (supporting, skeptical, fact-check angles); returns verdict: supported / unsupported / contested / insufficient_data with confidence 0–100. Signal-based, not definitive.",
    category: "Scraping & Verification",
    status: "active",
    title: "Fact Verification",
    group: "core",
  },
  // ─── Proxy ──────────────────────────────────────────────────────────────
  {
    name: "novada_proxy",
    description: "Get proxy credentials for your own HTTP clients. type=residential|isp|datacenter|mobile|static|dedicated (default residential). Supports country/city/session_id targeting. Returns proxy URL, shell exports (format='env'), or curl flag (format='curl').",
    category: "Proxy",
    status: "active",
    title: "Proxy Credentials",
    group: "core",
  },
  // ─── Browser & Rendering ────────────────────────────────────────────────
  {
    name: "novada_browser",
    description: "Automate browser interactions: navigate, click, type, screenshot, aria_snapshot, evaluate JS, wait, scroll, hover, press_key, select — up to 20 actions per call; maintains session state",
    category: "Browser & Rendering",
    status: "active",
    title: "Browser Automation",
    group: "core",
  },
  {
    name: "novada_browser_flow",
    description: "Cloud browser automation via action sequence API (POST browser_flow_use); executes click/scroll/wait/type/screenshot actions in sequence; supports sticky sessions via session_id.",
    category: "Browser & Rendering",
    status: "active",
    title: "Browser Flow Automation",
    group: "core",
  },
  // ─── Account & Billing (KR-6 developer-api tools) ───────────────────────
  {
    name: "novada_account",
    description: "Unified account & billing dashboard. section='summary' (default): wallet balance + plan quotas + recent capture logs + health entitlements. section='balance': wallet balance. section='usage': paginated transaction history. section='plans': per-product plan balances. section='traffic': daily proxy consumption. Aliases: wallet_balance, wallet_usage_record, plan_balance_all, traffic_daily, capture_logs, account_summary, health, health_all.",
    category: "Account & Billing",
    status: "active",
    title: "Account & Billing",
    group: "account",
  },
  {
    name: "novada_proxy_account_create",
    description: "⚠️ WRITE — create a proxy sub-account against your master plan. Two-step confirm gate: returns a masked preview unless confirm:true is passed after human approval.",
    category: "Account & Billing",
    status: "active",
    title: "Proxy Account Create",
    group: "account",
  },
  {
    name: "novada_proxy_account_list",
    description: "List proxy sub-accounts for a product (paginated). Best for auditing sub-accounts or finding account names before rotating credentials.",
    category: "Account & Billing",
    status: "active",
    title: "Proxy Account List",
    group: "account",
  },
  {
    name: "novada_ip_whitelist",
    description: "Manage the proxy IP whitelist (add/list/del/remark) for Residential (1), Unlimited (4), and Static ISP (5) products; add/del are writes requiring confirm:true.",
    category: "Account & Billing",
    status: "active",
    title: "IP Whitelist Manager",
    group: "account",
  },
  {
    name: "novada_capture_apikey",
    description: "Get or reset the Capture API key for the account; reset is a WRITE action requiring confirm:true after human approval.",
    category: "Account & Billing",
    status: "active",
    title: "Capture API Key",
    group: "account",
  },
  {
    name: "novada_static_ip_mgmt",
    description: "Manage static ISP IPs: open (WRITE, confirm gate), renew (WRITE, confirm gate), export, or list; wraps /v1/static_house/* developer-api endpoints.",
    category: "Account & Billing",
    status: "active",
    title: "Static IP Manager",
    group: "account",
  },
  // ─── Health & Discovery ─────────────────────────────────────────────────
  {
    name: "novada_discover",
    description: "List all available Novada tools with name, description, category, and status",
    category: "Health & Discovery",
    status: "active",
    title: "Tool Discovery",
    group: "meta",
  },
  {
    name: "novada_setup",
    description: "Onboarding concierge + first-run front door: validates your API key against the account API, tells you exactly how to register / get a key (free credits) if you have none, and orients you on the core tools. Auth-free — never errors on a missing key.",
    category: "Health & Discovery",
    status: "active",
    title: "Setup & Configuration",
    group: "meta",
  },
  {
    name: "novada_session_stats",
    description: "Per-process / per-session usage telemetry: tool-call counts, last-N calls, and uptime; in-memory, auth-free, resets on server restart",
    category: "Health & Discovery",
    status: "active",
    title: "Session Stats",
    group: "meta",
  },
];

/**
 * Every registered tool name -> group, derived from TOOL_REGISTRY (single source
 * of truth). Consumed by discover.ts's Tool Groups section and available for any
 * other transport (hosted mcp.ts) that wants to mirror the same partition.
 */
export const GROUP_TOOL_NAMES: Readonly<Record<ToolGroup, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    TOOL_GROUPS.map((g) => [g, TOOL_REGISTRY.filter((t) => t.group === g).map((t) => t.name)])
  ) as unknown as Record<ToolGroup, readonly string[]>
);

/** Tool names in the canonical registry, as a Set for fast membership checks. */
export const REGISTERED_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_REGISTRY.map((t) => t.name)
);

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
const _populatedCategories = TOOL_CATEGORIES.filter(
  (c) => TOOL_REGISTRY.some((t) => t.category === c)
);

// z.enum() requires a non-empty tuple — assert at module load time so a
// misconfigured empty registry surfaces as a startup error, not a type error.
if (_populatedCategories.length === 0) {
  throw new Error("TOOL_REGISTRY is empty — cannot derive populated categories for Zod enum");
}

export const POPULATED_TOOL_CATEGORIES: [ToolCategory, ...ToolCategory[]] =
  _populatedCategories as [ToolCategory, ...ToolCategory[]];
