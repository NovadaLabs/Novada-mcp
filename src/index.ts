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
} from "./tools/index.js";
import { classifyError, NovadaErrorCode } from "./_core/errors.js";
import { ZodError } from "zod";
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
} from "./tools/types.js";
import { HealthAllParamsSchema } from "./tools/health_all.js";
import { DiscoverParamsSchema } from "./tools/discover.js";
import { ScraperSubmitParamsSchema } from "./tools/scraper_submit.js";
import { ScraperStatusParamsSchema } from "./tools/scraper_status.js";
import { ScraperResultParamsSchema } from "./tools/scraper_result.js";
import { BrowserFlowParamsSchema } from "./tools/browser_flow.js";
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
} from "./tools/index.js";

// ─── Configuration ───────────────────────────────────────────────────────────

import { VERSION } from "./config.js";
import { listPrompts, getPrompt } from "./prompts/index.js";
import { listResources, readResource } from "./resources/index.js";

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
    description: `Use when you have a question or topic but no URL. Searches the web via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex) and returns titles, URLs, and snippets — reranked by relevance to your query.

**Best for:** Current events, finding relevant pages, fact lookup, competitive research. Add time_range="week" for recent results. Add include_domains to restrict sources.
**Not for:** Reading a URL you already have (use novada_extract), full multi-source report (use novada_research).
**Next step:** Call novada_extract with the returned URLs to read full content.
**Performance hint:** If engine='google' is slow or rate-limited, try engine='duckduckgo' — DDG responses average 329ms vs 1,092ms for Google in benchmarks. DDG is suitable for most factual and recent-news queries.`,
    inputSchema: zodToMcpSchema(SearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_extract",
    description: `Use when you have a URL and need its content. Extracts main text, title, and links. Supports batch extraction — pass url as an array to fetch up to 10 pages in parallel. Auto-escalates from static fetch → JS render → Browser CDP on anti-bot pages.

**Best for:** Reading specific pages, batch-reading search results, extracting docs.
**Not for:** Discovering which URLs exist on a site (use novada_map first), crawling many pages (use novada_crawl).
**Tip:** If content looks incomplete or JS-heavy, set render="render" or render="browser".

Common mistakes:
- Do NOT set render='render' for all pages. auto mode is 15x-113x faster for static sites. Only use render='render' for JavaScript-heavy SPAs (LinkedIn, Glassdoor, React SPAs, Next.js apps).
- Do NOT call novada_extract on a URL just to check if it exists — use novada_map for URL discovery.
- If fields extraction returns annotated values, prefer structured pages (product pages, GitHub repos) over generic homepages.

When to use:
- You need clean markdown, text, or HTML from a single URL or batch of URLs.
- You need specific structured fields (price, author, date) extracted from a page.
- You need render-mode bypass for bot-protected or JS-rendered pages.

Not for:
- Discovering what URLs exist on a site — use novada_map.
- Multi-page site traversal — use novada_crawl.
- Raw DOM access for CSS selector parsing — use novada_unblock.`,
    inputSchema: zodToMcpSchema(ExtractParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_crawl",
    description: `Use when you need content from multiple pages of a site and don't have the URLs yet. Crawls BFS or DFS up to 20 pages, extracts content from each. Use select_paths regex to target specific sections (e.g. "/docs/api/.*").

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
    description: `Use when you have a complex question needing multiple sources. Generates 3–10 diverse search queries in parallel, deduplicates results, extracts full content from top sources, returns a cited multi-source report.

**Best for:** Comparative analysis, topic overviews, questions needing multiple perspectives. One call replaces 3–10 manual searches.
**Not for:** Simple single-fact lookup (use novada_search), reading a specific URL (use novada_extract).
**Depth options:** "quick" (3 queries), "deep" (5–6), "comprehensive" (8–10), "auto" (default — inferred from question).`,
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
    name: "novada_scrape",
    description: `Use when you need structured data from a specific platform — not raw HTML, but clean tabular records. Supports 129 platforms: Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb, and more.

**Best for:** E-commerce product data, social posts/comments, job listings, reviews, real estate, market data.
**Not for:** General web pages (use novada_extract), unknown domains not in the platform list (use novada_crawl).
**Output formats:** "markdown" (default, agent-optimized table), "json" (structured, for programmatic use).
**Example:** platform="amazon.com", operation="amazon_product_keywords", params={keyword:"iphone 16", num:5}
**Discover platforms:** Read the \`novada://scraper-platforms\` MCP resource for the complete platform list with operation IDs and required params.`,
    inputSchema: zodToMcpSchema(ScrapeParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_proxy",
    description: `Use when you need to route your own HTTP requests through residential or mobile IPs — for geo-targeting, IP rotation, or bypassing IP-based rate limits. Returns proxy URL, shell export commands, or curl --proxy flag.

**Best for:** When you need a specific country/city IP, sticky sessions for multi-step workflows, or testing geo-restricted content.
**Not for:** Web page extraction (use novada_extract — proxy is automatic), web search (use novada_search).
**Formats:** "url" for Node.js/Python, "env" for shell variables, "curl" for CLI requests.
**Note:** Requires NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.
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
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
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
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
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
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
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
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
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
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
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
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
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
**Note:** wait_ms, block_resources, auto_runs are accepted but not yet implemented — they have no effect in the current version.

Common mistakes:
- This tool returns RAW HTML, not parsed/cleaned text. Passing the output directly to an LLM expecting markdown will produce garbled, token-heavy responses.
- For extracted content from bot-protected pages, use novada_extract (it calls the unblocker internally with render='render').
- Do not use novada_unblock for simple static pages — it adds 9-16 seconds of latency vs 112ms for novada_extract.

When to use:
- You need the original DOM structure for CSS selector parsing in a processing pipeline.
- You are feeding the HTML into a downstream parser, not directly to an LLM.
- You need raw access to a page's complete HTML before novada_extract's content selection.

Not for:
- Getting readable content from protected pages — use novada_extract with render='render'.`,
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
**Requires:** NOVADA_BROWSER_WS environment variable.
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
**Difference from novada_health:** This tool tests 6 products (vs 5), includes the Unblock API probe, and provides richer notes per product.`,
    inputSchema: zodToMcpSchema(HealthAllParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_discover",
    description: `List all available Novada tools with name, description, category, and status (active/todo).

**agent_instruction:** Call this first to see all available Novada tools and capabilities — especially useful when starting a new task and you need to find the right tool.
**Returns:** Markdown table grouped by category — Content Retrieval, Scraping & Verification, Proxy, Browser & Rendering, Health & Discovery, Auth.
**Filter:** Pass category to narrow to a specific group (e.g. category="Proxy" to see all proxy tools).
**Status legend:** active = available now; todo = planned but not yet implemented.`,
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
**Alternative:** For 129 supported platforms (Amazon, Reddit, TikTok), use novada_scrape instead — it's synchronous and returns results directly.`,
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
];

// ─── Tool & Group Filtering ──────────────────────────────────────────────────
// NOVADA_TOOLS="extract,search,crawl"  → only these tools (comma-separated, short or full names)
// NOVADA_GROUPS="search,proxy"          → category bundles (see CATEGORY_MAP below)
// Both set → union. Neither set → all tools (backward compatible).

/** Category bundles — each group name expands to multiple tools */
const CATEGORY_MAP: Record<string, string[]> = {
  search:  ["novada_search", "novada_extract", "novada_crawl", "novada_map", "novada_research", "novada_verify"],
  proxy:   ["novada_proxy", "novada_proxy_residential", "novada_proxy_isp", "novada_proxy_datacenter", "novada_proxy_mobile", "novada_proxy_static", "novada_proxy_dedicated"],
  browser: ["novada_browser", "novada_browser_flow"],
  scraper: ["novada_scrape", "novada_scraper_submit", "novada_scraper_status", "novada_scraper_result"],
  health:  ["novada_health", "novada_health_all", "novada_discover"],
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

  // Always include health so agents can diagnose issues
  allowed.add("novada_health");

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
      { name: "novada", version: VERSION },
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

      if (!API_KEY) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: NOVADA_API_KEY is not set. Get your API key at https://www.novada.com and set it as an environment variable.\n\nSetup: claude mcp add novada -e NOVADA_API_KEY=your-key -- npx -y novada",
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
            result = await novadaSearch(validateSearchParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_extract":
            result = await novadaExtract(validateExtractParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_crawl":
            result = await novadaCrawl(validateCrawlParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_research":
            result = await novadaResearch(validateResearchParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_map":
            result = await novadaMap(validateMapParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_proxy":
            result = await novadaProxy(validateProxyParams(args as Record<string, unknown>));
            break;
          case "novada_scrape":
            result = await novadaScrape(validateScrapeParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_verify":
            result = await novadaVerify(validateVerifyParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_unblock":
            result = await novadaUnblock(validateUnblockParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_browser":
            result = await novadaBrowser(validateBrowserParams(args as Record<string, unknown>));
            break;
          case "novada_health":
            validateHealthParams(args as Record<string, unknown>);
            result = await novadaHealth(API_KEY);
            break;
          case "novada_health_all":
            validateHealthAllParams(args as Record<string, unknown>);
            result = await novadaHealthAll(API_KEY);
            break;
          case "novada_discover":
            result = await novadaDiscover(validateDiscoverParams(args as Record<string, unknown>));
            break;
          case "novada_scraper_submit":
            result = await novadaScraperSubmit(validateScraperSubmitParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_scraper_status":
            result = await novadaScraperStatus(validateScraperStatusParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_scraper_result":
            result = await novadaScraperResult(validateScraperResultParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_browser_flow":
            result = await novadaBrowserFlow(validateBrowserFlowParams(args as Record<string, unknown>), API_KEY);
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
          default:
            return {
              content: [{
                type: "text" as const,
                text: `Unknown tool: ${name}. Available: novada_search, novada_extract, novada_crawl, novada_research, novada_map, novada_scrape, novada_proxy, novada_proxy_residential, novada_proxy_isp, novada_proxy_datacenter, novada_proxy_mobile, novada_proxy_static, novada_proxy_dedicated, novada_verify, novada_unblock, novada_browser, novada_health, novada_health_all, novada_discover, novada_scraper_submit, novada_scraper_status, novada_scraper_result, novada_browser_flow`,
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

Environment:
  NOVADA_API_KEY              Your Novada API key (required)
  NOVADA_WEB_UNBLOCKER_KEY    Web Unblocker key (enables JS rendering)
  NOVADA_BROWSER_WS           Browser API WebSocket (enables browser automation)
  NOVADA_PROXY_USER/PASS/ENDPOINT  Proxy credentials (enables novada_proxy)

Connect to Claude Code:
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada

Tools (${TOOLS.length}):
  novada_search              Search the web via Google, Bing, and 3 more engines
  novada_extract             Extract content from any URL (smart auto-routing)
  novada_crawl               Crawl a website (BFS/DFS, up to 20 pages)
  novada_research            Multi-step web research with synthesis
  novada_map                 Discover all URLs on a website (fast)
  novada_scrape              Structured data from 129 platforms (Amazon, TikTok, etc.)
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
`);
  process.exit(0);
}

const server = new NovadaMCPServer();
server.run().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", msg);
  process.exit(1);
});
