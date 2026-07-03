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

export interface ToolMeta {
  name: string;
  description: string;
  category: ToolCategory;
  status: ToolStatus;
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
    description: "Search the web via Google, Bing, DuckDuckGo, Yahoo, or Yandex with geo-targeting, time_range, domain filters, and optional auto-extract on top results",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_extract",
    description: "Extract main content, title, description, links, and structured fields from one or up to 10 URLs; supports static/render/browser escalation and PDF detection",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_crawl",
    description: "Crawl websites using BFS or DFS traversal with configurable depth, content extraction, include/exclude patterns, and ReDoS-safe path filtering",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_research",
    description: "Multi-step research: 3–10 parallel SERP queries, source deduplication, full content extraction from top URLs, returns cited report with findings summary",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_map",
    description: "Discover all URLs on a website without extracting content; uses sitemap.xml via robots.txt first, falls back to BFS; returns up to 100 filtered URLs",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_site_copy",
    description: "Copy an entire docs site or section to disk as one markdown file per page (llms.txt → sitemap → scoped BFS discovery); returns a compact manifest, not page bodies",
    category: "Content Retrieval",
    status: "active",
  },
  {
    name: "novada_search_feedback",
    description: "Record search-result quality (search_id/query + useful URLs + rating good/ok/bad) to bias future ranking; in-memory feedback store, returns a thank-you/echo with an agent_instruction",
    category: "Content Retrieval",
    status: "active",
  },
  // ─── Scraping & Verification ────────────────────────────────────────────
  {
    name: "novada_scrape",
    description: "Extract structured data from 13 active platforms (~78 operations) (Amazon, TikTok, LinkedIn, YouTube, etc.) in a single synchronous call; supports markdown/json/toon output",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_verify",
    description: "Fact-check a claim by running 3 parallel queries (supporting + skeptical + fact-check); returns verdict (supported/unsupported/contested/insufficient_data) and confidence score 0–100",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_unblock",
    description: "Render blocked or JS-heavy pages via Web Unblocker or Browser CDP; returns raw rendered HTML; supports render/browser methods and wait_for selectors",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_ai_monitor",
    description: "Check how AI models (ChatGPT, Perplexity, Grok, Claude, Gemini) reference a brand or product; returns per-model sentiment, key claims, competitor mentions, and source URLs",
    category: "Scraping & Verification",
    status: "active",
  },
  {
    name: "novada_monitor",
    description: "Session-scoped only / no durable state — baseline lost on server restart; schedule from your own job runner for persistence. Detect changes on a web page over time by comparing content hashes; first call sets a baseline, subsequent calls report changed/unchanged plus optional field-level diffs",
    category: "Scraping & Verification",
    status: "active",
  },
  // ─── Proxy ──────────────────────────────────────────────────────────────
  {
    name: "novada_proxy",
    description: "Get proxy credentials for your own HTTP clients. type=residential|isp|datacenter|mobile|static|dedicated (default residential). Supports country/city/session_id targeting. Returns proxy URL, shell exports (format='env'), or curl flag (format='curl').",
    category: "Proxy",
    status: "active",
  },
  // ─── Browser & Rendering ────────────────────────────────────────────────
  {
    name: "novada_browser",
    description: "Automate browser interactions: navigate, click, type, screenshot, aria_snapshot, evaluate JS, wait, scroll, hover, press_key, select — up to 20 actions per call; maintains session state",
    category: "Browser & Rendering",
    status: "active",
  },
  {
    name: "novada_browser_flow",
    description: "Cloud browser automation via action sequence API (POST browser_flow_use); executes click/scroll/wait/type/screenshot actions in sequence; supports sticky sessions via session_id.",
    category: "Browser & Rendering",
    status: "active",
  },
  // ─── Account & Billing (KR-6 developer-api tools) ───────────────────────
  {
    name: "novada_wallet_balance",
    description: "Read the master Novada wallet balance (currency). Best for confirming credit before launching billable scraper/proxy jobs.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_wallet_usage_record",
    description: "Paginated wallet transaction / usage history. Best for auditing recent spend or exporting billing rows.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_proxy_account_create",
    description: "⚠️ WRITE — create a proxy sub-account against your master plan. Two-step confirm gate: returns a masked preview unless confirm:true is passed after human approval.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_proxy_account_list",
    description: "List proxy sub-accounts for a product (paginated). Best for auditing sub-accounts or finding account names before rotating credentials.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_traffic_daily",
    description: "Aggregate daily traffic consumption across all 5 proxy products in parallel for a date range; returns total MB plus per-product day-by-day breakdown.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_plan_balance_all",
    description: "Per-product plan balance across all 6 flow products (residential/isp/mobile/datacenter/static/capture) in parallel; partial failures isolated per product.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_capture_logs",
    description: "Paginated capture-task logs. Best for auditing what was captured and debugging failed capture jobs.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_account_summary",
    description: "Single-call account dashboard: wallet balance + plan balances + recent capture logs in parallel, returned as a unified headline plus per-section detail.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_ip_whitelist",
    description: "Manage the proxy IP whitelist (add/list/del/remark) for Residential (1), Unlimited (4), and Static ISP (5) products; add/del are writes requiring confirm:true.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_capture_apikey",
    description: "Get or reset the Capture API key for the account; reset is a WRITE action requiring confirm:true after human approval.",
    category: "Account & Billing",
    status: "active",
  },
  {
    name: "novada_static_ip_mgmt",
    description: "Manage static ISP IPs: open (WRITE, confirm gate), renew (WRITE, confirm gate), export, or list; wraps /v1/static_house/* developer-api endpoints.",
    category: "Account & Billing",
    status: "active",
  },
  // ─── Health & Discovery ─────────────────────────────────────────────────
  {
    name: "novada_health",
    description: "Check which Novada API products are active on your key. mode='quick' (default): fast activation check. mode='full': live parallel latency probes across all 6 products (= former novada_health_all).",
    category: "Health & Discovery",
    status: "active",
  },
  {
    name: "novada_discover",
    description: "List all available Novada tools with name, description, category, and status",
    category: "Health & Discovery",
    status: "active",
  },
  {
    name: "novada_setup",
    description: "Check environment configuration and get step-by-step setup instructions for every MCP client; auth-free, works before NOVADA_API_KEY is set",
    category: "Health & Discovery",
    status: "active",
  },
  {
    name: "novada_session_stats",
    description: "Per-process / per-session usage telemetry: tool-call counts, last-N calls, and uptime; in-memory, auth-free, resets on server restart",
    category: "Health & Discovery",
    status: "active",
  },
];

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
