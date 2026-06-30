#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  novadaSearch,
  novadaExtract,
  novadaCrawl,
  novadaResearch,
  novadaMap,
  novadaSiteCopy,
  novadaProxy,
  novadaScrape,
  novadaVerify,
  novadaUnblock,
  novadaBrowser,
  novadaHealth,
  novadaHealthAll,
  novadaDiscover,
  novadaScraperSubmit,
  novadaScraperStatus,
  novadaScraperResult,
  novadaBrowserFlow,
  novadaAiMonitor,
  novadaMonitor,
  validateMonitorParams,
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateResearchParams,
  validateMapParams,
  validateSiteCopyParams,
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
} from "./tools/index.js";
import { classifyError, NovadaErrorCode } from "./_core/errors.js";
import { ZodError } from "zod";
import {
  SearchParamsSchema,
  ExtractParamsSchema,
  CrawlParamsSchema,
  ResearchParamsSchema,
  MapParamsSchema,
  SiteCopyParamsSchema,
  SITE_COPY_HARD_MAX,
  ProxyParamsSchema,
  ScrapeParamsSchema,
  VerifyParamsSchema,
  UnblockParamsSchema,
  BrowserParamsSchema,
  HealthParamsSchema,
  AiMonitorParamsSchema,
  validateAiMonitorParams,
} from "./tools/types.js";
import { HealthAllParamsSchema } from "./tools/health_all.js";
import { DiscoverParamsSchema } from "./tools/discover.js";
import { ScraperSubmitParamsSchema } from "./tools/scraper_submit.js";
import { ScraperStatusParamsSchema } from "./tools/scraper_status.js";
import { ScraperResultParamsSchema } from "./tools/scraper_result.js";
import { BrowserFlowParamsSchema } from "./tools/browser_flow.js";
import { MonitorParamsSchema } from "./tools/monitor.js";
import {
  novadaProxyResidential,
  validateProxyResidentialParams,
  ProxyResidentialParamsSchema,
  novadaProxyIsp,
  validateProxyIspParams,
  ProxyIspParamsSchema,
  novadaProxyDatacenter,
  validateProxyDatacenterParams,
  ProxyDatacenterParamsSchema,
  novadaProxyMobile,
  validateProxyMobileParams,
  ProxyMobileParamsSchema,
  novadaProxyStatic,
  validateProxyStaticParams,
  ProxyStaticParamsSchema,
  novadaProxyDedicated,
  validateProxyDedicatedParams,
  ProxyDedicatedParamsSchema,
  novadaSetup,
  validateSetupParams,
  SetupParamsSchema,
  // KR-6: developer-api account-management tools
  novadaWalletBalance,
  validateWalletBalanceParams,
  WalletBalanceParamsSchema,
  novadaWalletUsageRecord,
  validateWalletUsageRecordParams,
  WalletUsageRecordParamsSchema,
  novadaProxyAccountCreate,
  validateProxyAccountCreateParams,
  ProxyAccountCreateParamsSchema,
  novadaProxyAccountList,
  validateProxyAccountListParams,
  ProxyAccountListParamsSchema,
  novadaTrafficDaily,
  validateTrafficDailyParams,
  TrafficDailyParamsSchema,
  novadaPlanBalanceAll,
  validatePlanBalanceAllParams,
  PlanBalanceAllParamsSchema,
  novadaCaptureLogs,
  validateCaptureLogsParams,
  CaptureLogsParamsSchema,
  novadaAccountSummary,
  validateAccountSummaryParams,
  AccountSummaryParamsSchema,
  novadaIpWhitelist,
  validateIpWhitelistParams,
  IpWhitelistParamsSchema,
} from "./tools/index.js";

// ─── Configuration ───────────────────────────────────────────────────────────

import { VERSION } from "./config.js";
import { listPrompts, getPrompt } from "./prompts/index.js";
import { listResources, readResource } from "./resources/index.js";
import { checkProxyConfiguration } from "./utils/domains.js";
import { resolveProxyCredentials } from "./utils/credentials.js";

const API_KEY = process.env.NOVADA_API_KEY?.trim();

/** Convert a Zod v4 schema to MCP-compatible JSON Schema.
 * Uses Zod's native .toJSONSchema() — zod-to-json-schema v3 does not support Zod v4.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  // Strip meta-schema declarations that MCP clients don't need
  const { $schema, $defs, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "novada_search",
    description: `Search the web via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex). Returns titles, URLs, snippets — reranked by relevance. For complex questions needing multiple sources, use novada_research instead (it's faster and more thorough).

**Use for:** Current events, finding URLs, fact lookup, competitive research. Set enrich_top=true to auto-extract the #1 result.
**Not for:** Reading a known URL (novada_extract), multi-source report (novada_research).
**Tip:** engine='google' (default) is the fastest and most reliable. duckduckgo/yahoo/yandex are fallbacks and can be markedly slower; 'bing' is currently degraded — avoid it.
**Project grouping:** Pass \`project="my-project"\` to group all outputs in a subfolder (e.g. ~/Downloads/novada-mcp/2026-06-26/my-project/). Useful for multi-step research tasks.`,
    inputSchema: zodToMcpSchema(SearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_extract",
    description: `Extract content from any URL. Handles Cloudflare, DataDome, Kasada automatically via auto-escalation (static → JS render → Browser CDP). Batch mode: pass url as array for up to 10 pages in parallel.

**CRITICAL — Format Selection:**
- \`format="markdown"\` (default): full-page content for reading/analysis. Best for articles, docs.
- \`format="json"\`: structured object. Key fields: url, title, content, quality, links, structured_data, fields, hints, mode, fetched_at. Use \`fields=["price","title"]\` to populate the \`fields\` key — this is the primary reason to choose format="json".
- \`format="html"\`: raw HTML source (truncated at 10K chars — use novada_unblock for full HTML). Best for debugging or custom parsing.
- \`clean=true\`: strip nav/sidebar, return main content only (~15K chars vs ~100K full page).

Common mistake: using markdown when you need specific data — use \`format="json"\` + \`fields=["price","title"]\` instead.

**Use for:** Reading pages, batch-extracting search results, pulling structured fields (price, author, date). Works on anti-bot pages automatically.
**Not for:** URL discovery (novada_map), multi-page crawl (novada_crawl), platform data like Amazon/LinkedIn (novada_scrape is richer).
**Key rule:** Leave render="auto" (default). Only set render="render" for known JS-heavy SPAs. Auto mode is 15-100x faster on static sites.
By default returns full page content for maximum information. Add clean=true to extract only the main article body (strips nav/footer/ads).

**Results auto-saved:** Every extraction saves to \`~/Downloads/novada-mcp/YYYY-MM-DD/\` automatically. File path shown at the top of each response.
**Project grouping:** Pass \`project="my-project"\` to group all outputs in a subfolder (e.g. ~/Downloads/novada-mcp/2026-06-26/my-project/). Useful for multi-step research tasks.`,
    inputSchema: zodToMcpSchema(ExtractParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_crawl",
    description: `Use when you need content from multiple pages of a site and don't have the URLs yet. Crawls BFS or DFS up to 20 pages, extracts content from each. Use select_paths globs to target specific sections (e.g. "/docs/api/**").

**Best for:** Doc site ingestion, competitive content analysis, building knowledge bases from a domain.
**Not for:** A single page (use novada_extract), URL discovery without content extraction (use novada_map — much faster).

Common mistakes:
- Do NOT set max_pages > 10 for large sites — crawl time scales linearly (~1.4s/page). At max_pages=20, expect 28s minimum.
- Do NOT use novada_crawl to fetch one page — use novada_extract which is faster and simpler.
- Use select_paths to restrict to relevant URL patterns before setting max_pages high.

When to use:
- You need content from multiple pages on one domain (e.g., all /docs/* pages).
- You need BFS discovery of related content under a path prefix.

Not for:
- Single-URL extraction — use novada_extract.
- Finding all URLs on a site without downloading content — use novada_map.`,
    inputSchema: zodToMcpSchema(CrawlParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_research",
    description: `The most powerful research tool in any MCP server. One call → 3-10 parallel searches across Google/Bing/DuckDuckGo → dedup → extract full content from top 5 sources → synthesized cited report. No other MCP server can do this.

**Use for:** Any complex question needing multiple sources. Comparative analysis, market research, technical deep dives, competitive intelligence. Replaces 5-10 manual search+extract calls.
**Not for:** Single fact lookup (novada_search) or reading one URL (novada_extract).
**Depth:** "quick" (3 queries), "deep" (5-6), "comprehensive" (8-10), "auto" (default).
**Key advantage:** Agents call this ONCE instead of orchestrating search→extract→synthesize manually. Saves tokens, time, and complexity.
**Project grouping:** Pass \`project="my-project"\` to group all outputs in a subfolder (e.g. ~/Downloads/novada-mcp/2026-06-26/my-project/). Useful for multi-step research tasks.`,
    inputSchema: zodToMcpSchema(ResearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_map",
    description: `Use when you need to know what URLs exist on a site before deciding what to read. Tries sitemap.xml first (fast), falls back to BFS crawl. Returns URL list only — no content.

**Best for:** Site structure discovery, finding the correct subpage URL when you extracted the wrong page.
**Not for:** Reading page content (follow with novada_extract or novada_crawl).
**Note:** Limited results on JavaScript SPAs — will flag this in output.`,
    inputSchema: zodToMcpSchema(MapParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_site_copy",
    description: `Copy an entire docs site or site section to disk as clean markdown — one .md file per page — and return a COMPACT manifest, not the page bodies. Use when you need a whole knowledge base on disk (offline docs ingest, RAG corpus, full-site mirror).

**Discovery (in order):** (1) llms.txt / llms-full.txt if present (canonical, flat page list), (2) sitemap.xml, (3) scoped same-host BFS drained to completion. Path filters (select_paths/exclude_paths) and same-host are always enforced.
**Best for:** "Copy all of docs.x.com", building a local docs corpus, ingesting an llms.txt index.
**Not for:** A single page (use novada_extract), a handful of pages inline (use novada_crawl — it returns bodies), URL discovery only (use novada_map).
**Output:** Each page is written to ~/Downloads/novada-mcp/<date>/<project|domain>/site-copy/<slug>.md as it completes. A manifest.json records {url,file,title,word_count,depth,bytes,status} per page plus run meta. The tool RETURNS a compact summary + the manifest path — Read the .md files or manifest.json, do not expect inline content.
**Scale:** max_pages default 200, hard max ${SITE_COPY_HARD_MAX}. Drains the in-scope queue until empty or the ceiling is hit.
**Key rule:** Files are streamed to disk; the response is intentionally small. After it completes, Read manifest.json then open the specific .md files you need.`,
    inputSchema: zodToMcpSchema(SiteCopyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_scrape",
    description: `Use when you need structured data from a specific platform — not raw HTML, but clean tabular records. Supports 13 platforms (~78 operations): Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb, and more.

**Best for:** E-commerce product data, social posts/comments, job listings, reviews, real estate, market data.
**Not for:** General web pages (use novada_extract), unknown domains not in the platform list (use novada_crawl).
**Output formats:** "markdown" (default, agent-optimized table), "json" (structured, for programmatic use).
**Example:** platform="amazon.com", operation="amazon_product_keywords", params={keyword:"iphone 16", num:5}
**Discover platforms:** Read the \`novada://scraper-platforms\` MCP resource for the complete platform list with operation IDs and required params.
**Project grouping:** Pass \`project="my-project"\` to group all outputs in a subfolder (e.g. ~/Downloads/novada-mcp/2026-06-26/my-project/). Useful for multi-step research tasks.`,
    inputSchema: zodToMcpSchema(ScrapeParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_proxy",
    description: `Use when you need to route your own HTTP requests through residential or mobile IPs — for geo-targeting, IP rotation, or bypassing IP-based rate limits. Returns proxy URL, shell export commands, or curl --proxy flag.

**Best for:** When you need a specific country/city IP, sticky sessions for multi-step workflows, or testing geo-restricted content.
**Not for:** Web page extraction (use novada_extract — proxy is automatic), web search (use novada_search).
**Formats:** "url" for Node.js/Python, "env" for shell variables, "curl" for CLI requests.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
**Specialized tools:** For specific proxy types, use novada_proxy_residential, novada_proxy_isp, novada_proxy_datacenter, novada_proxy_mobile, novada_proxy_static, or novada_proxy_dedicated.`,
    inputSchema: zodToMcpSchema(ProxyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_residential",
    description: `Route requests through residential IPs — real home ISP addresses from a 100M+ IP pool. Best anti-bot bypass for geo-restricted or protected pages.

**Best for:** Anti-bot protected pages, geo-restricted content, platforms that block datacenter IPs.
**Not for:** novada_extract or novada_crawl — they handle proxy routing internally. These credentials are for your own HTTP clients (curl, requests, axios).
**Params:** url (optional), country (ISO 2-letter), city (optional, requires country), session_id (optional for sticky IP).
**Formats:** "url", "env", "curl".
**agent_instruction:** Best for geo-restricted content. Use country param for targeting. Strongest anti-bot bypass — escalate here from isp/datacenter when blocked.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.`,
    inputSchema: zodToMcpSchema(ProxyResidentialParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_isp",
    description: `Route requests through ISP-assigned IPs that look like real home users — ideal for social media and ecommerce platforms.

**Best for:** Social media scraping, ecommerce platforms, any site distinguishing home users from datacenter IPs.
**Not for:** novada_extract or novada_crawl — they handle proxy routing internally. These credentials are for your own HTTP clients (curl, requests, axios).
**Params:** url (optional), country (ISO 2-letter, optional), session_id (optional for sticky IP).
**Formats:** "url", "env", "curl".
**agent_instruction:** ISP proxies look like real home users. Best for social/ecommerce. Escalate to novada_proxy_residential for stronger anti-bot.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.`,
    inputSchema: zodToMcpSchema(ProxyIspParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_datacenter",
    description: `Route requests through datacenter IPs — fastest and most cost-effective option for high-volume scraping of targets without aggressive anti-bot.

**Best for:** APIs, public data feeds, high-volume scraping of non-protected targets.
**Not for:** novada_extract or novada_crawl — they handle proxy routing internally. These credentials are for your own HTTP clients (curl, requests, axios).
**Params:** url (optional), country (ISO 2-letter, optional), session_id (optional for sticky IP).
**Formats:** "url", "env", "curl".
**agent_instruction:** Fastest proxies. Best for high-volume, non-anti-bot targets. Escalate to isp → residential if blocked.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.`,
    inputSchema: zodToMcpSchema(ProxyDatacenterParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_mobile",
    description: `Route requests through 4G/5G mobile IPs — real mobile device IPs ideal for mobile-targeted content and apps.

**Best for:** Mobile-targeted content, app APIs, platforms serving different content to mobile vs desktop.
**Not for:** novada_extract or novada_crawl — they handle proxy routing internally. These credentials are for your own HTTP clients (curl, requests, axios).
**Params:** url (optional), country (ISO 2-letter, optional), carrier (optional, e.g. 'verizon'), session_id (optional for sticky IP).
**Formats:** "url", "env", "curl".
**agent_instruction:** Mobile IPs. Best for mobile-targeted content and apps. Pair with mobile User-Agent for full simulation.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.`,
    inputSchema: zodToMcpSchema(ProxyMobileParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_static",
    description: `Route requests through a dedicated static ISP IP that never changes — same IP every request for a given session_id + country.

**Best for:** Account management, login-dependent workflows, platforms that flag IP changes as suspicious.
**Not for:** novada_extract or novada_crawl — they handle proxy routing internally. These credentials are for your own HTTP clients (curl, requests, axios).
**Params:** url (optional), country (ISO 2-letter, REQUIRED), session_id (REQUIRED — determines your dedicated IP).
**Formats:** "url", "env", "curl".
**agent_instruction:** Same IP every request. Best for accounts requiring consistent identity. Keep the same session_id for the entire account lifecycle.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.`,
    inputSchema: zodToMcpSchema(ProxyStaticParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_dedicated",
    description: `Route requests through an exclusive datacenter IP not shared with any other user — clean reputation, zero contamination risk.

**Best for:** High-trust platforms, workflows needing a pristine IP with no negative history.
**Not for:** novada_extract or novada_crawl — they handle proxy routing internally. These credentials are for your own HTTP clients (curl, requests, axios).
**Params:** url (optional), session_id (REQUIRED — maps to your exclusive dedicated IP).
**Formats:** "url", "env", "curl".
**agent_instruction:** Exclusive datacenter IP. Best for high-trust platforms. No other user shares this IP. For human-like IP appearance, use novada_proxy_residential instead.
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.`,
    inputSchema: zodToMcpSchema(ProxyDedicatedParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_verify",
    description: `Use when you have a factual claim and need to check if it's supported by web sources. Runs 3 parallel searches (supporting, skeptical, fact-check angles) and returns a verdict: supported / unsupported / contested / insufficient_data.

**Best for:** Checking claims before citing them, cross-validating research findings, detecting misinformation.
**Not for:** Open-ended questions (use novada_research), reading a specific URL (use novada_extract).
**Note:** Verdict is signal-based (search balance), not a definitive ruling. Confidence 0–100 indicates certainty.`,
    inputSchema: zodToMcpSchema(VerifyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_unblock",
    description: `Use when you need the raw rendered HTML of a blocked or JS-heavy page. Forces JS rendering via Web Unblocker or Browser API. Returns raw HTML, not cleaned text.

**Best for:** When you need raw HTML (not cleaned text) for custom DOM parsing. When novada_extract with render="render" still fails. Returns the full JS-rendered HTML source.
**Tip:** For most anti-bot pages, try novada_extract with render="render" first — it returns clean text. Use novada_unblock when you specifically need the raw HTML source.
**Not for:** Reading cleaned text (use novada_extract with render="render"), structured platform data (use novada_scrape).
**Methods:** "render" (Web Unblocker, faster/cheaper), "browser" (full Chromium CDP, handles complex SPAs).
**Wait hint:** Use wait_for to specify a CSS selector to wait for before capturing HTML.

Common mistakes:
- This tool returns RAW HTML, not parsed/cleaned text. Passing the output directly to an LLM expecting markdown will produce garbled, token-heavy responses.
- For extracted content from bot-protected pages, use novada_extract (it calls the unblocker internally with render='render').
- Do not use novada_unblock for simple static pages — it adds 9-16 seconds of latency vs 112ms for novada_extract.

When to use:
- You need the original DOM structure for CSS selector parsing in a processing pipeline.
- You are feeding the HTML into a downstream parser, not directly to an LLM.
- You need raw access to a page's complete HTML before novada_extract's content selection.

Not for:
- Getting readable content from protected pages — use novada_extract with render='render'.
**Auth:** Uses NOVADA_API_KEY (the single key for all Novada products) — no separate key needed. NOVADA_WEB_UNBLOCKER_KEY is an optional override; NOVADA_API_KEY is used as fallback if it is not set.`,
    inputSchema: zodToMcpSchema(UnblockParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_browser",
    description: `Use when you need to interact with a web page — click buttons, fill forms, scroll, take screenshots, or execute JavaScript. Chain multiple actions in one call for efficiency.

**Best for:** Login flows, paginated content, interactive SPAs, form submission, visual verification, scraping behind user interactions.
**Not for:** Simple page reading (use novada_extract), structured data (use novada_scrape), raw HTML (use novada_unblock).
**Actions:** navigate, click, type, screenshot, aria_snapshot, evaluate, wait, scroll, hover, press_key, select — up to 20 per call.
**Sessions:** Pass session_id to maintain state (cookies, login) across multiple calls. Sessions expire after 10 min of inactivity. Use close_session to release early.
**Auth:** NOVADA_API_KEY (auto-provisions Browser API credentials). NOVADA_BROWSER_WS is optional — set it to override auto-provision.
**Platform note:** TikTok is geo-restricted in some regions — pass country="us" in actions that support it. Use wait with domcontentloaded (never networkidle) for SPAs.
**Constraint:** close_session and list_sessions must be the only action in the call — they cannot be combined with other actions.`,
    inputSchema: zodToMcpSchema(BrowserParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_health",
    description: `Check which Novada API products are active on your API key.

**Best for:** First-time setup, diagnosing why a tool is failing, confirming your account has the right products activated.
**Returns:** Status table for Search, Extract, Scraper API, Proxy, and Browser API — with activation links for anything not yet enabled.`,
    inputSchema: zodToMcpSchema(HealthParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_health_all",
    description: `Extended health check that tests ALL Novada product endpoints in parallel and returns detailed per-product status.

**agent_instruction:** Call this when novada_health shows an issue and you need per-product details, or when setting up Novada for the first time and want to confirm every product is reachable.
**Returns:** Per-product table — product | status | latency | notes — covering Search, Extract, Scraper, Proxy, Browser, and Unblock APIs.
**Degraded mode:** If one product probe fails, all others still return — never hard-fails.
**Activation links:** Any PRODUCT_UNAVAILABLE result includes a direct link to activate that product on your dashboard.
**Difference from novada_health:** This tool tests 6 products (vs 5), includes the Unblock API probe, and provides richer notes per product.
**Auth:** NOVADA_API_KEY (the single key for all Novada products). NOVADA_WEB_UNBLOCKER_KEY is OPTIONAL — NOVADA_API_KEY is used as fallback if it is not set.`,
    inputSchema: zodToMcpSchema(HealthAllParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_discover",
    description: `List all available Novada tools with name, description, category, and status (active/todo).

**agent_instruction:** Call this first to see all available Novada tools and capabilities — especially useful when starting a new task and you need to find the right tool.
**Returns:** Markdown table grouped by category — Content Retrieval, Scraping & Verification, Proxy, Browser & Rendering, Health & Discovery, Auth.
**Filter:** Pass category to narrow to a specific group (e.g. category="Proxy" to see all proxy tools).
**Status legend:** active = available now; todo = planned but not yet implemented.

**KEY FACT: ONE API KEY COVERS ALL PRODUCTS.** NOVADA_API_KEY authenticates search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. No separate keys needed for any product. NOVADA_BROWSER_WS and NOVADA_PROXY_ENDPOINT unlock additional capabilities but require no extra API key. If a tool fails, call novada_health_all() to diagnose.`,
    inputSchema: zodToMcpSchema(DiscoverParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_scraper_submit",
    description: `Submit an async scraping task for any URL. Returns a task_id — use novada_scraper_status to poll progress, then novada_scraper_result to retrieve data.

**Best for:** Scraping URLs that require async processing (JS-heavy pages, rate-limited targets, long-running extractions).
**Workflow:** submit → poll status → retrieve result. Three separate calls.
**Required:** url (the page to scrape). Optional: scraper_type (default 'universal'), country (2-letter ISO code).
**Next step:** After calling this tool, use novada_scraper_status with the returned task_id to check progress.
**Note:** If the endpoint returns a placeholder task_id, contact Novada support at support@novada.com to confirm scraper_type availability.
**Alternative:** For 13 active platforms (Amazon, Reddit, TikTok), use novada_scrape instead — it's synchronous and returns results directly.`,
    inputSchema: zodToMcpSchema(ScraperSubmitParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_scraper_status",
    description: `Check the status of an async scraping task by task_id. Returns: pending, running, complete, or failed.

**Required:** task_id (from novada_scraper_submit).
**Pending/running:** Retry in 5–10 seconds. Use exponential backoff (5s → 10s → 20s → 40s).
**Complete:** Call novada_scraper_result with the same task_id to retrieve formatted data.
**Failed:** Re-submit with novada_scraper_submit, or use novada_extract / novada_unblock as alternatives.
**agent_instruction:** Each response includes the next action to take — always follow it.`,
    inputSchema: zodToMcpSchema(ScraperStatusParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_scraper_result",
    description: `Retrieve the completed result of an async scraping task by task_id.

**Required:** task_id (from novada_scraper_submit). Confirm status='complete' with novada_scraper_status first.
**Formats:** 'markdown' (default — human-readable table), 'json' (structured array for programmatic use), 'raw' (unprocessed API response).
**agent_instruction:** Call novada_scraper_status first to confirm task is complete before calling this tool. Calling this on a pending task returns a not_ready response.
**Note:** If result is unavailable, check novada_scraper_status and contact Novada support at support@novada.com with the task_id if the endpoint is returning errors.`,
    inputSchema: zodToMcpSchema(ScraperResultParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_browser_flow",
    description: `Execute multi-step browser automation with Novada's cloud browser. Use for JS-heavy sites, login flows, or multi-page sequences.

**Best for:** Automating sequences of clicks, form fills, scrolls, and screenshots on a single page or across a multi-step flow. Maintains session state across calls when session_id is provided.
**Actions:** click, scroll, wait, type, screenshot — up to 20 per call.
**Sessions:** Pass session_id to reuse the same browser instance across calls (preserves cookies, login state). Sessions expire after 10 minutes of inactivity.
**Fallback:** If this tool fails, use novada_browser — it uses CDP directly and supports more action types (navigate, aria_snapshot, evaluate, hover, press_key, select).
**Not for:** Single URL reading without interaction (use novada_extract or novada_unblock), structured platform data (use novada_scrape).`,
    inputSchema: zodToMcpSchema(BrowserFlowParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_ai_monitor",
    description: `Use when you need to check how AI models (ChatGPT, Perplexity, Grok, Claude, Gemini) reference a brand or product. Searches each AI platform's indexed content for brand mentions, analyzes sentiment, extracts claims, and identifies competitor mentions.

**Best for:** Brand monitoring across AI search engines, competitive positioning analysis, detecting how AI recommends or compares your product.
**Not for:** General web search (use novada_search), real-time social monitoring (use novada_scrape with twitter/reddit).
**Output:** Per-model sentiment (positive/neutral/negative), key claims, competitor mentions, source URLs.
**Models supported:** chatgpt, perplexity, grok, claude, gemini. Default checks: chatgpt, perplexity, grok.`,
    inputSchema: zodToMcpSchema(AiMonitorParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_monitor",
    description: `Detect changes on a web page over time. Extracts content, computes a hash, compares with previous check. Returns changed/unchanged + field-level diffs.

**Use for:** E-commerce price monitoring, stock availability tracking, content change detection, competitive pricing alerts.
**How:** First call = baseline. Subsequent calls compare against baseline and report changes. Pass fields=["price","availability"] for field-level diffs with % change.
**Session-scoped:** State lives in memory for the MCP session duration. Not persisted across restarts.
**Not for:** One-time extraction (novada_extract), full crawl (novada_crawl).`,
    inputSchema: zodToMcpSchema(MonitorParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_setup",
    description: `Check environment configuration and get step-by-step setup instructions. Safe to call before NOVADA_API_KEY is configured.

**Use for:** First-time setup, diagnosing missing credentials, getting exact config snippets for Claude Code / Claude Desktop / Cursor / VS Code / Windsurf.
**Output:** Status of all env vars (NOVADA_API_KEY, NOVADA_BROWSER_WS, NOVADA_PROXY_*), setup commands for all MCP clients, and which tools are currently active.
**No auth required:** This tool works even when NOVADA_API_KEY is not set.

**UNIFIED KEY:** NOVADA_API_KEY is the only required key. It covers: Search, Extract, Web Unblocker, Scraper API, Research, Crawl, Map, Browser API HTTP management, Proxy management and auto-provisioning. NOVADA_BROWSER_WS (Browser WebSocket) and NOVADA_PROXY_ENDPOINT unlock additional capabilities but require no separate API key — NOVADA_API_KEY authenticates them all. Also shows output pipeline status (where extracted files are saved).
Output pipeline supports optional project folders for grouping related queries.`,
    inputSchema: zodToMcpSchema(SetupParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  // ─── KR-6: developer-api account-management tools ─────────────────────────
  {
    name: "novada_wallet_balance",
    description: `Read the master Novada wallet balance (currency). Wraps developer-api POST /v1/wallet/balance.

**Best for:** Confirming credit available before launching billable scraper/proxy jobs.
**Not for:** Per-product MB/quota — use novada_plan_balance_all for residential/isp/mobile/datacenter/static/capture sub-balances.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(WalletBalanceParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_wallet_usage_record",
    description: `Paginated wallet transaction / usage history. Wraps developer-api POST /v1/wallet/usage_record.

**Best for:** Auditing recent spend, exporting billing rows.
**Not for:** Aggregate by-product spend (use novada_traffic_daily) or current balances (use novada_plan_balance_all).
**Params:** start_time/end_time (YYYY-MM-DD, optional — server default ~30d), page, page_size (max 200). Tool emits both \`start_time\` AND server's typo'd \`strat_time\` for forward-compat.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(WalletUsageRecordParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_account_create",
    description: `⚠️ WRITE — Create a proxy sub-account. Two-step confirm gate.

**Behavior:** Without \`confirm: true\` the tool returns a \`confirmation_required\` JSON preview (password masked) and DOES NOT hit the API. Show preview to the human user; only re-call with \`confirm: true\` after explicit human approval.

**Best for:** Provisioning a team-member or per-project sub-account against your master plan.
**Params:** product ("1"=Residential, "2"=Rotating ISP, "3"=Rotating Datacenter, "4"=Unlimited, "7"=Unblocker, "9"=Mobile), account (3-64, [a-zA-Z0-9_-]), password (8-64), status ("1" active default | "-3" disabled), remark?, limit_flow? (GB cap as string), confirm.
**Wire format:** multipart/form-data (per developer-api spec).
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(ProxyAccountCreateParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_account_list",
    description: `List proxy sub-accounts. Wraps developer-api POST /v1/proxy_account/list.

**Best for:** Auditing sub-accounts, finding account names before rotating credentials.
**Params:** product (REQUIRED — same codes as create), page, limit (max 200), status? ("1"|"-3"), account? (exact-match filter).
**Wire format:** multipart/form-data.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(ProxyAccountListParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_traffic_daily",
    description: `Aggregate daily traffic consumption across all 5 Novada proxy products in PARALLEL. Fans out to residential/isp/mobile/datacenter/static \`*_flow/consume_log\` endpoints.

**Best for:** "How much have we spent on proxies in the last N days?" / dashboarding spend per product.
**Returns:** total_mb_across_products + per_product[<key>].raw (server's day-by-day breakdown) + per-product error flags. Partial failures (e.g. a product not provisioned) do NOT block successful ones.
**Params:** start_time/end_time (YYYY-MM-DD, optional — emits both start_time AND typo'd strat_time), products (optional subset).
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(TrafficDailyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_plan_balance_all",
    description: `Per-product balance across all 6 Novada flow products in PARALLEL (residential/isp/mobile/datacenter/static/capture).

**Best for:** "Do we have quota left on product X?" / pre-flight check before launching a scrape job.
**Not for:** Master wallet currency balance — use novada_wallet_balance.
**Returns:** per_product[<key>].balance (raw server response — typical fields: balance_mb, remaining_mb, plan_mb). Partial failures isolated per product.
**Params:** products (optional subset).
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(PlanBalanceAllParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_capture_logs",
    description: `Paginated capture-task logs. Wraps developer-api POST /v1/capture/logs.

**Best for:** Auditing what was captured, debugging failed capture jobs.
**Params:** start_time/end_time (YYYY-MM-DD, optional — emits both start_time AND strat_time), page, page_size (max 200), status filter.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(CaptureLogsParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_account_summary",
    description: `Single-call account dashboard. Calls wallet_balance + plan_balance_all + capture_logs (last 5 rows) in PARALLEL and returns a unified headline + per-section detail.

**Best for:** "What's my Novada account status?" / "How much do I have left?" / one-shot health snapshot.
**Returns:** \`headline\` (one-line human summary), \`sections.{wallet,plans,capture_recent}\` (raw per-tool output), \`agent_instruction\` (next-step hint — e.g. "all plans expired, buy at dashboard").
**Why not 3 calls:** Halves round-trip cost for the most common account-status query. Plans section already includes derived \`expired\`/\`expires_at_human\` and \`unavailable_products\` so agents don't compute timestamps.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(AccountSummaryParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_ip_whitelist",
    description: `Manage IP whitelist for proxy products. Supports add/list/delete/remark for Residential (1), Unlimited (4), and Static ISP (5) products.

**Actions:** "add" (WRITE — requires confirm), "list" (read-only), "del" (WRITE — requires confirm), "remark" (update note on entry).
**Required:** action, product (1=Residential, 4=Unlimited, 5=Static ISP).
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(IpWhitelistParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
];

// ─── Tool & Group Filtering ──────────────────────────────────────────────────
// NOVADA_TOOLS="extract,search,crawl"  → only these tools (comma-separated, short or full names)
// NOVADA_GROUPS="search,proxy"          → category bundles (see CATEGORY_MAP below)
// Both set → union. Neither set → all tools (backward compatible).

/** Category bundles — each group name expands to multiple tools */
const CATEGORY_MAP: Record<string, string[]> = {
  search:  ["novada_search", "novada_extract", "novada_crawl", "novada_map", "novada_site_copy", "novada_research", "novada_verify", "novada_ai_monitor", "novada_monitor"],
  proxy:   ["novada_proxy", "novada_proxy_residential", "novada_proxy_isp", "novada_proxy_datacenter", "novada_proxy_mobile", "novada_proxy_static", "novada_proxy_dedicated"],
  browser: ["novada_browser", "novada_browser_flow"],
  scraper: ["novada_scrape", "novada_scraper_submit", "novada_scraper_status", "novada_scraper_result"],
  health:  ["novada_health", "novada_health_all", "novada_discover", "novada_setup"],
  account: ["novada_wallet_balance", "novada_wallet_usage_record", "novada_proxy_account_create", "novada_proxy_account_list", "novada_traffic_daily", "novada_plan_balance_all", "novada_capture_logs", "novada_account_summary", "novada_ip_whitelist"],
};

/** Normalize short name → full tool name */
function normalizeTool(name: string): string {
  const n = name.trim().toLowerCase();
  return n.startsWith("novada_") ? n : `novada_${n}`;
}

function applyToolFilter(tools: typeof TOOLS): typeof TOOLS {
  const toolsEnv = process.env.NOVADA_TOOLS;
  const groupsEnv = process.env.NOVADA_GROUPS;

  if (!toolsEnv && !groupsEnv) return tools;

  const allowed = new Set<string>();

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
        for (const tool of bundle) allowed.add(tool);
      } else {
        // Fallback: treat as individual tool name
        allowed.add(normalizeTool(group));
      }
    }
  }

  // Always include health + setup so agents can diagnose issues regardless of filter
  allowed.add("novada_health");
  allowed.add("novada_setup");

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
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "novada",
        version: VERSION,
        description: "Novada MCP — unified web data API. ONE API KEY (NOVADA_API_KEY) covers all products: search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. Optional: NOVADA_BROWSER_WS for browser automation, NOVADA_PROXY_ENDPOINT for proxy routing. Call novada_health_all() to verify which products are active.",
      },
      { capabilities: { tools: {}, prompts: {}, resources: {} } }
    );
    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[novada]", msg);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ACTIVE_TOOLS,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => listPrompts() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return getPrompt(name, (args as Record<string, string>) || {}) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => listResources() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return readResource(request.params.uri) as any;
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // novada_setup is auth-free — handle it before the API_KEY gate
      if (name === "novada_setup") {
        try {
          const result = novadaSetup(validateSetupParams(args as Record<string, unknown>));
          return { content: [{ type: "text" as const, text: result }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: String(e) }], isError: true };
        }
      }

      // KR-6 developer-api tools use NOVADA_DEVELOPER_API_KEY with NOVADA_API_KEY fallback.
      // They run their own getDeveloperApiKey() check, so we bypass the strict NOVADA_API_KEY
      // gate when a developer-api key is present.
      const KR6_TOOLS = new Set<string>([
        "novada_wallet_balance",
        "novada_wallet_usage_record",
        "novada_proxy_account_create",
        "novada_proxy_account_list",
        "novada_traffic_daily",
        "novada_plan_balance_all",
        "novada_capture_logs",
        "novada_account_summary",
        "novada_ip_whitelist",
      ]);
      const hasDeveloperKey = !!process.env.NOVADA_DEVELOPER_API_KEY?.trim();
      const isKr6Bypass = KR6_TOOLS.has(name) && hasDeveloperKey;

      if (!API_KEY && !isKr6Bypass) {
        return {
          content: [{
            type: "text" as const,
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
            type: "text" as const,
            text: `Tool '${name}' is not in the active set. NOVADA_TOOLS="${process.env.NOVADA_TOOLS ?? ""}" NOVADA_GROUPS="${process.env.NOVADA_GROUPS ?? ""}". Available: ${ACTIVE_TOOLS.map(t => t.name).join(", ")}`,
          }],
          isError: true,
        };
      }

      try {
        let result: string;

        switch (name) {
          case "novada_search":
            result = await novadaSearch(validateSearchParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_extract":
            result = await novadaExtract(validateExtractParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_crawl":
            result = await novadaCrawl(validateCrawlParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_research":
            result = await novadaResearch(validateResearchParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_map":
            result = await novadaMap(validateMapParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_site_copy":
            result = await novadaSiteCopy(validateSiteCopyParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_proxy":
            result = await novadaProxy(validateProxyParams(args as Record<string, unknown>));
            break;
          case "novada_scrape":
            result = await novadaScrape(validateScrapeParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_verify":
            result = await novadaVerify(validateVerifyParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_unblock":
            result = await novadaUnblock(validateUnblockParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_browser":
            result = await novadaBrowser(validateBrowserParams(args as Record<string, unknown>));
            break;
          case "novada_health":
            validateHealthParams(args as Record<string, unknown>);
            result = await novadaHealth(API_KEY!);
            break;
          case "novada_health_all":
            validateHealthAllParams(args as Record<string, unknown>);
            result = await novadaHealthAll(API_KEY!);
            break;
          case "novada_discover":
            result = await novadaDiscover(validateDiscoverParams(args as Record<string, unknown>));
            break;
          case "novada_scraper_submit":
            result = await novadaScraperSubmit(validateScraperSubmitParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_scraper_status":
            result = await novadaScraperStatus(validateScraperStatusParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_scraper_result":
            result = await novadaScraperResult(validateScraperResultParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_browser_flow":
            result = await novadaBrowserFlow(validateBrowserFlowParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_proxy_residential":
            result = await novadaProxyResidential(validateProxyResidentialParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_isp":
            result = await novadaProxyIsp(validateProxyIspParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_datacenter":
            result = await novadaProxyDatacenter(validateProxyDatacenterParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_mobile":
            result = await novadaProxyMobile(validateProxyMobileParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_static":
            result = await novadaProxyStatic(validateProxyStaticParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_dedicated":
            result = await novadaProxyDedicated(validateProxyDedicatedParams(args as Record<string, unknown>));
            break;
          case "novada_ai_monitor":
            result = await novadaAiMonitor(validateAiMonitorParams(args as Record<string, unknown>), API_KEY!);
            break;
          case "novada_monitor":
            result = await novadaMonitor(validateMonitorParams(args as Record<string, unknown>), API_KEY!);
            break;
          // ─── KR-6: developer-api account-management tools ──────────────────
          case "novada_wallet_balance":
            result = await novadaWalletBalance(validateWalletBalanceParams(args as Record<string, unknown>));
            break;
          case "novada_wallet_usage_record":
            result = await novadaWalletUsageRecord(validateWalletUsageRecordParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_account_create":
            result = await novadaProxyAccountCreate(validateProxyAccountCreateParams(args as Record<string, unknown>));
            break;
          case "novada_proxy_account_list":
            result = await novadaProxyAccountList(validateProxyAccountListParams(args as Record<string, unknown>));
            break;
          case "novada_traffic_daily":
            result = await novadaTrafficDaily(validateTrafficDailyParams(args as Record<string, unknown>));
            break;
          case "novada_plan_balance_all":
            result = await novadaPlanBalanceAll(validatePlanBalanceAllParams(args as Record<string, unknown>));
            break;
          case "novada_capture_logs":
            result = await novadaCaptureLogs(validateCaptureLogsParams(args as Record<string, unknown>));
            break;
          case "novada_account_summary":
            result = await novadaAccountSummary(validateAccountSummaryParams(args as Record<string, unknown>));
            break;
          case "novada_ip_whitelist":
            result = await novadaIpWhitelist(validateIpWhitelistParams(args as Record<string, unknown>));
            break;
          default:
            return {
              content: [{
                type: "text" as const,
                text: `Unknown tool: ${name}. Available: novada_search, novada_extract, novada_crawl, novada_research, novada_map, novada_site_copy, novada_scrape, novada_proxy, novada_proxy_residential, novada_proxy_isp, novada_proxy_datacenter, novada_proxy_mobile, novada_proxy_static, novada_proxy_dedicated, novada_verify, novada_unblock, novada_browser, novada_health, novada_health_all, novada_discover, novada_scraper_submit, novada_scraper_status, novada_scraper_result, novada_browser_flow, novada_setup, novada_wallet_balance, novada_wallet_usage_record, novada_proxy_account_create, novada_proxy_account_list, novada_traffic_daily, novada_plan_balance_all, novada_capture_logs, novada_ip_whitelist`,
              }],
              isError: true,
            };
        }

        return { content: [{ type: "text" as const, text: result }] };
      } catch (error) {
        // Zod validation errors → clear message for the agent
        if (error instanceof ZodError) {
          const issues = error.issues.map(i => {
            let msg = `  ${i.path.join(".")}: ${i.message}`;
            if (i.code === "invalid_value" && "values" in i) {
              msg += ` (valid values: ${(i.values as string[]).map(v => `'${v}'`).join(", ")})`;
            }
            return msg;
          }).join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `Invalid parameters for ${name}:\n${issues}\nNext step: Check parameter names and values — see tool description for valid options.`,
            }],
            isError: true,
          };
        }

        // Classified API/network errors with agent_instruction guidance
        const classified = classifyError(error);
        return {
          content: [{
            type: "text" as const,
            text: classified.toAgentString(),
          }],
          isError: true,
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Auto-provision proxy credentials: if NOVADA_PROXY_ENDPOINT is set but
    // NOVADA_PROXY_USER/PASS are missing, fetch them from /v1/proxy_account/list
    // using NOVADA_API_KEY as Bearer token, then inject into process.env so the
    // synchronous getProxyCredentials() picks them up for all proxy tool calls.
    if (
      process.env.NOVADA_PROXY_ENDPOINT &&
      (!process.env.NOVADA_PROXY_USER || !process.env.NOVADA_PROXY_PASS)
    ) {
      try {
        const autoCreds = await resolveProxyCredentials();
        if (autoCreds) {
          process.env.NOVADA_PROXY_USER = autoCreds.user;
          process.env.NOVADA_PROXY_PASS = autoCreds.pass;
          console.error(`[novada] Auto-provisioned proxy credentials (account: ${autoCreds.user})`);
        }
      } catch {
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
`);
  process.exit(0);
}

const server = new NovadaMCPServer();
server.run().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", msg);
  process.exit(1);
});
