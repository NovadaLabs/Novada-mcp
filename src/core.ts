/**
 * core.ts — side-effect-free shared catalog + dispatch.
 *
 * NO top-level server construction, no process.exit, no stdio boot.
 * Safe to import from any transport (stdio index.ts, hosted mcp.ts, tests).
 *
 * Exports:
 *   TOOLS          — the MCP tool catalog (array literal, verbatim from index.ts)
 *   HIDDEN_ALIASES — tool names dispatched but intentionally absent from TOOLS
 *   dispatch()     — name → validated → tool fn → string result
 *                    THROWS on unknown tool and on tool errors (no envelope, no catch)
 */

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
  novadaBrowser,
  novadaDiscover,
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
  PROXY_ALIAS_MAP,
  validateScrapeParams,
  validateVerifyParams,
  validateBrowserParams,
  validateDiscoverParams,
  validateBrowserFlowParams,
} from "./tools/index.js";
import type { ProgressReporter } from "./tools/crawl.js";
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
  BrowserParamsSchema,
  AiMonitorParamsSchema,
  validateAiMonitorParams,
} from "./tools/types.js";
import { DiscoverParamsSchema } from "./tools/discover.js";
import { BrowserFlowParamsSchema } from "./tools/browser_flow.js";
import { MonitorParamsSchema } from "./tools/monitor.js";
import {
  ProxyResidentialParamsSchema,
  validateProxyResidentialParams,
  ProxyIspParamsSchema,
  validateProxyIspParams,
  ProxyDatacenterParamsSchema,
  validateProxyDatacenterParams,
  ProxyMobileParamsSchema,
  validateProxyMobileParams,
  ProxyStaticParamsSchema,
  validateProxyStaticParams,
  ProxyDedicatedParamsSchema,
  validateProxyDedicatedParams,
  novadaSetup,
  validateSetupParams,
  SetupParamsSchema,
  novadaAccount,
  validateAccountParams,
  AccountParamsSchema,
  WalletBalanceParamsSchema,
  WalletUsageRecordParamsSchema,
  novadaProxyAccountCreate,
  validateProxyAccountCreateParams,
  ProxyAccountCreateParamsSchema,
  novadaProxyAccountList,
  validateProxyAccountListParams,
  ProxyAccountListParamsSchema,
  TrafficDailyParamsSchema,
  PlanBalanceAllParamsSchema,
  CaptureLogsParamsSchema,
  AccountSummaryParamsSchema,
  novadaIpWhitelist,
  validateIpWhitelistParams,
  IpWhitelistParamsSchema,
  novadaCaptureApikey,
  validateCaptureApikeyParams,
  CaptureApikeyParamsSchema,
  novadaScraperTaskMgmt,
  validateScraperTaskMgmtParams,
  ScraperTaskMgmtParamsSchema,
  novadaStaticIpMgmt,
  validateStaticIpMgmtParams,
  StaticIpMgmtParamsSchema,
  novadaSessionStats,
  validateSessionStatsParams,
  SessionStatsParamsSchema,
  novadaSearchFeedback,
  validateSearchFeedbackParams,
  SearchFeedbackParamsSchema,
  ScraperSubmitParamsSchema,
  ScraperStatusParamsSchema,
  ScraperResultParamsSchema,
} from "./tools/index.js";

/** Convert a Zod v4 schema to MCP-compatible JSON Schema.
 * Uses Zod's native .toJSONSchema() — zod-to-json-schema v3 does not support Zod v4.
 *
 * Two contract fixes applied here (single root-cause location):
 *
 * 1. required[] accuracy: Zod v4 .toJSONSchema() includes all object keys in required[],
 *    even those with a .default() (which makes them truly optional at runtime). We strip any
 *    key from required[] that has a corresponding "default" in its property definition, so
 *    the declared schema matches what Zod actually enforces. Covers ~25 tools in one fix.
 *
 * 2. additionalProperties policy: we previously declared additionalProperties:false but Zod
 *    strips unknown keys silently rather than rejecting them — so the declaration was a lie.
 *    We remove additionalProperties entirely; the actual behavior (strip-unknown) is handled
 *    by Zod's parseUnknown semantics, and we choose NOT to surface a rejection error for
 *    unknown params (MCP clients may add meta fields). Declare nothing, lie nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  // Strip meta-schema declarations that MCP clients don't need
  const { $schema, $defs, additionalProperties: _ap, ...rest } = jsonSchema as Record<string, unknown>;

  // Fix 1: strip keys with a .default() from required[] — they are optional at runtime.
  // Zod v4 .toJSONSchema() does not do this automatically.
  const props = rest.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && Array.isArray(rest.required)) {
    rest.required = (rest.required as string[]).filter(
      key => !(props[key] && "default" in props[key])
    );
  }

  return rest;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "novada_search",
    description: `Search the web via 4 working engines (Google, Bing, DuckDuckGo, Yandex). Returns titles, URLs, snippets — reranked by relevance. For complex questions needing multiple sources, use novada_research instead (it's faster and more thorough).

**Use for:** Current events, finding URLs, fact lookup, competitive research. Set enrich_top=true to auto-extract the #1 result.
**Not for:** Reading a known URL (novada_extract), multi-source report (novada_research).
**Tip:** engine='google' (default) is the fastest and most reliable. duckduckgo/yandex are fallbacks and can be markedly slower; 'bing' is currently degraded — avoid it. 'yahoo' is NOT supported — it returns an error, do not use it.
**Domain filtering:** includeDomains/excludeDomains are applied by injecting \`site:domain\` operators into the query (not API-side filtering).
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
- \`format="html"\`: raw HTML source (truncated at 100K chars by default; pass max_chars to adjust). Best for debugging or custom DOM parsing.
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
    description: `Use when you need content from a bounded set of pages (up to 20) and don't have the URLs yet. Crawls BFS or DFS, extracts content from each page inline. Use select_paths globs to target specific sections (e.g. "/docs/api/**").

**Best for:** Competitive content analysis, extracting a handful of related pages inline (returns page bodies directly).
**Not for:** A single page (use novada_extract), URL discovery without content extraction (use novada_map — much faster), copying an entire site to disk (use novada_site_copy — it handles hundreds of pages and writes files).

Common mistakes:
- Do NOT set max_pages > 10 for large sites — crawl time scales linearly (~1.4s/page). At max_pages=20, expect 28s minimum.
- Do NOT use novada_crawl to fetch one page — use novada_extract which is faster and simpler.
- Use select_paths to restrict to relevant URL patterns before setting max_pages high.

When to use:
- You need content from a small set of related pages on one domain (e.g., all /docs/* pages, up to 20).
- You need BFS discovery of related content under a path prefix and want bodies inline.

Not for:
- Single-URL extraction — use novada_extract.
- Finding all URLs on a site without downloading content — use novada_map.
- Copying a whole docs site or knowledge base to disk — use novada_site_copy (handles hundreds of pages, returns a manifest).`,
    inputSchema: zodToMcpSchema(CrawlParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_research",
    description: `One call → 3-10 parallel searches across Google/Bing/DuckDuckGo → dedup → extract full content from top sources → returns CITED SOURCE MATERIAL (numbered source sections), not a written answer. Extractive, not generative: it gathers and ranks the most relevant passages; YOU compose the final answer from them.

**Use for:** Any complex question where you want relevant passages from ≥3 independent sources gathered in one call. Comparative analysis, market research, technical deep dives, competitive intelligence. Replaces 5-10 manual search+extract calls.
**Not for:** Single fact lookup or finding one URL — use novada_search for that (faster, cheaper). Reading a known URL — use novada_extract. A finished prose report — this returns source material, you write the answer.
**Rule of thumb:** If the answer could fit in one search result snippet, use novada_search. If you need source material pulled from multiple pages to reason over, use novada_research.
**Depth:** "quick" (3 queries), "deep" (6), "comprehensive" (8-9), "auto" (default: picks quick or deep by question length — never comprehensive).
**Key advantage:** Agents call this ONCE instead of orchestrating search→extract manually. Saves tokens, time, and complexity.
**Project grouping:** Pass \`project="my-project"\` to group all outputs in a subfolder (e.g. ~/Downloads/novada-mcp/2026-06-26/my-project/). Useful for multi-step research tasks.`,
    inputSchema: zodToMcpSchema(ResearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_map",
    description: `Use when you need to know what URLs exist on a site before deciding what to read. Tries sitemap.xml first (fast), falls back to BFS crawl. Returns URL list only — no content. Hard cap: 100 URLs.

**Best for:** Site structure discovery, finding the correct subpage URL when you extracted the wrong page, pre-flight before novada_crawl or novada_extract.
**Not for:** Reading page content (follow with novada_extract or novada_crawl). Copying an entire site to disk (use novada_site_copy — it handles hundreds of pages).
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
    description: `Use when you need structured data from a specific platform — not raw HTML, but clean tabular records. Supports 13 platforms (~78 operations): Amazon, Walmart, Google (incl. Shopping), Bing, DuckDuckGo, Yandex, X/Twitter, TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub.

**Best for:** E-commerce product data, social posts/comments, job listings, reviews, real estate, market data.
**Not for:** General web pages not in the platform list — use novada_extract for arbitrary URLs instead.
**Output formats:** "markdown" (default, agent-optimized table), "json" (structured, for programmatic use), "toon" (token-optimized pipe-separated format — 40-65% smaller than JSON/markdown, best for large result sets in context-constrained situations).
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
    // idempotentHint:false — novada_verify runs live web searches; results are non-deterministic
    // (search index changes between calls). Two identical calls may return different verdicts.
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_browser",
    description: `Use when you need to interact with a web page — click buttons, fill forms, scroll, take screenshots, or execute JavaScript. Chain multiple actions in one call for efficiency.

**Best for:** Login flows, paginated content, interactive SPAs, form submission, visual verification, scraping behind user interactions.
**Not for:** Simple page reading (use novada_extract), structured data (use novada_scrape), raw HTML (use novada_extract with format="html").
**Actions:** navigate, click, type, screenshot, aria_snapshot, evaluate, wait, scroll, hover, press_key, select — up to 20 per call.
**Sessions:** Pass session_id to reuse the same browser page (cookies, login) across calls. Persistent cross-call sessions are reliable only on the local/long-lived server; on the hosted serverless endpoint treat each call as one-shot (a session_id may not survive between calls). Use close_session to release early.
**Auth:** NOVADA_API_KEY (auto-provisions Browser API credentials). NOVADA_BROWSER_WS is optional — set it to override auto-provision.
**Platform note:** Use wait with domcontentloaded (never networkidle) for SPAs. (The \`country\` param is accepted but NOT yet applied to the browser exit node — do not rely on it for geo-routing.)
**Constraint:** close_session and list_sessions must be the only action in the call — they cannot be combined with other actions.`,
    inputSchema: zodToMcpSchema(BrowserParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_discover",
    description: `List all available Novada tools with name, description, category, and status.

**agent_instruction:** Call this first to see all available Novada tools and capabilities — especially useful when starting a new task and you need to find the right tool.
**Returns:** Markdown table grouped by category — Content Retrieval, Scraping & Verification, Proxy, Browser & Rendering, Account & Billing, Health & Discovery.
**Filter:** Pass category to narrow to a specific group (e.g. category="Proxy" to see all proxy tools).
**Status legend:** active = available now.

**KEY FACT: ONE API KEY COVERS ALL PRODUCTS.** NOVADA_API_KEY authenticates search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. No separate keys needed for any product. NOVADA_BROWSER_WS and NOVADA_PROXY_ENDPOINT unlock additional capabilities but require no extra API key. If a tool fails, call novada_account (section="summary") to check your balance, plans, and entitlements.`,
    inputSchema: zodToMcpSchema(DiscoverParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_scraper_submit",
    description: `Run a structured scrape of a platform operation. Returns the records inline in one synchronous call — there is no separate task_id to poll. (Compatibility alias: this now behaves exactly like novada_scrape.)

**Best for:** Structured data from a platform operation (product/keyword/profile/repo lookups) in a single call.
**Params:** platform (the scraper domain, e.g. 'amazon.com'), operation (the operation ID for that platform), and optional params (operation-specific key/values). These three are the ONLY accepted fields — this tool takes no URL and no category/type selector; the platform + operation pair alone determines what runs.
**Valid platform values (scraper_name):** amazon.com, walmart.com, google.com, bing.com, duckduckgo.com, yandex.com, x.com, tiktok.com, instagram.com, facebook.com, youtube.com, linkedin.com, github.com. Read novada://scraper-platforms for the full operation IDs per platform.
**Next step:** The records are already in this response — no polling needed. novada_scraper_status / novada_scraper_result are retained only for old callers and just point back here.
**Note:** If the endpoint returns no records, contact Novada support at support@novada.com to confirm operation availability.
**Alternative:** novada_scrape is the canonical name for the same synchronous behavior.`,
    inputSchema: zodToMcpSchema(ScraperSubmitParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_scraper_status",
    description: `Check the status of an async scraping task by task_id. Returns: pending, running, complete, or failed.

**Required:** task_id (from novada_scraper_submit).
**Pending/running:** Retry in 5–10 seconds. Use exponential backoff (5s → 10s → 20s → 40s).
**Complete:** Call novada_scraper_result with the same task_id to retrieve formatted data.
**Failed:** Re-submit with novada_scraper_submit, or use novada_extract as an alternative.
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
**Not for:** Single URL reading without interaction (use novada_extract), structured platform data (use novada_scrape).`,
    inputSchema: zodToMcpSchema(BrowserFlowParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_ai_monitor",
    description: `Search the public web and AI-company domains (chatgpt.com/openai.com, perplexity.ai, anthropic.com, ...) for PUBLIC mentions and sentiment of a brand or product. NOTE: this searches INDEXED PUBLIC PAGES — it does NOT query the live AI models' responses. Returns per-source mention counts, sentiment signals, and competitor mentions. A brand not discussed on those indexed domains will show few/zero mentions — that reflects indexed-page coverage, not the models' actual behavior.

**How it works:** For each selected domain group, executes a Google search scoped to that domain (e.g. site:openai.com "brandname") and analyzes the returned page snippets for sentiment, claims, and competitor co-mentions.
**Best for:** Checking whether a brand appears on AI-company public docs/blogs/changelogs; competitive presence on indexed pages of AI platforms.
**Not for:** Finding out how ChatGPT/Perplexity/Claude actually answer questions about your brand (those are live model responses, not indexed pages); general web search (use novada_search); real-time social monitoring (use novada_scrape with twitter/reddit).
**Output:** Per-domain sentiment (positive/neutral/negative), key claims from indexed snippets, competitor mentions, source URLs.
**Domains searched:** chatgpt.com+openai.com, perplexity.ai, grok.com+x.com/i/grok, claude.ai+anthropic.com, gemini.google.com. Default: chatgpt, perplexity, grok.`,
    inputSchema: zodToMcpSchema(AiMonitorParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_monitor",
    description: `⚠️ Session-scoped only: state lost on server restart — baselines live in memory for the MCP session, not persisted to disk. For persistent, cross-session monitoring, schedule recurring novada_monitor (or novada_scrape) calls from your own job runner and diff/store results externally; this tool itself keeps no durable state.

Detect changes on a web page over time. Extracts content, computes a hash, compares with previous check. Returns changed/unchanged + field-level diffs.

**Use for:** E-commerce price monitoring, stock availability tracking, content change detection, competitive pricing alerts.
**How:** First call = baseline. Subsequent calls compare against baseline and report changes. Pass fields=["price","availability"] for field-level diffs with % change.
**Not for:** One-time extraction (novada_extract), full crawl (novada_crawl).`,
    inputSchema: zodToMcpSchema(MonitorParamsSchema),
    // idempotentHint:false — novada_monitor is explicitly stateful: each call may write a new
    // baseline to monitorStore. Repeated calls on the same URL intentionally produce different
    // responses (changed vs unchanged). Marking it idempotent would mislead orchestrators.
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_setup",
    description: `The onboarding concierge and first-run front door of the Novada MCP. Call this FIRST when starting out, or whenever a tool reports a missing/invalid key.

**What it does:**
1. **Validates your key** — makes one cheap, authoritative account read (wallet balance) to confirm your key actually works, and shows your balance. No synthetic per-product probes, no credit cost.
2. **Guides you if you have no key** — tells you to register at the Novada dashboard (free credits included for testing), where to copy your API key, and the exact config snippet for Claude Code / Claude Desktop / Cursor / VS Code / Windsurf.
3. **Orients you** — a plain-language list of the core things you can do (search, extract, scrape, browser, account) plus the add-ons.

**Three states it reports:** key present + valid (ready) · key present but rejected (fix it) · no key yet (register + free credits).

**Auth-free by design:** this is the tool that helps you GET a key, so a missing key is the normal first-run state — it guides, it never errors. Includes a machine-usable agent_instruction so an AI knows exactly what to tell the user next.

**Unified key:** NOVADA_API_KEY covers search, extract, unblock, scraper, research, crawl, map, browser and proxy auto-provisioning. NOVADA_BROWSER_WS and NOVADA_PROXY_ENDPOINT are optional add-ons that need no separate key.`,
    inputSchema: zodToMcpSchema(SetupParamsSchema),
    // openWorldHint:true — now performs one authoritative account read to validate the key.
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  // ─── KR-6: developer-api account-management tools ─────────────────────────
  {
    name: "novada_account",
    description: `Single-call account & billing dashboard. Composes wallet balance, plan balances, capture logs, and health entitlements based on the \`section\` param.

**Best for:** "What's my Novada account status?" / "How much do I have left?" / one-shot health snapshot.
**section="summary" (default):** Full dashboard — wallet balance + plan quotas + recent capture logs + product entitlements (proxy/browser/wallet-funded services). This is what novada_account_summary + novada_health combined.
**section="balance":** Master wallet currency balance.
**section="usage":** Paginated wallet transaction / usage history. Pass start_time/end_time/page/page_size.
**section="plans":** Per-product plan balances (residential/isp/mobile/datacenter/static/capture). Pass products[] to filter.
**section="traffic":** Daily proxy traffic consumption across products. Pass start_time/end_time/products[].
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).
**Aliases (backward compat):** novada_wallet_balance, novada_wallet_usage_record, novada_plan_balance_all, novada_traffic_daily, novada_capture_logs, novada_account_summary, novada_health, novada_health_all — all route here.`,
    inputSchema: zodToMcpSchema(AccountParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
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
    name: "novada_ip_whitelist",
    description: `Manage IP whitelist for proxy products. Supports add/list/delete/remark for Residential (1), Unlimited (4), and Static ISP (5) products.

**Actions:** "add" (WRITE — requires confirm), "list" (read-only), "del" (WRITE — requires confirm), "remark" (update note on entry).
**Required:** action, product (1=Residential, 4=Unlimited, 5=Static ISP).
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(IpWhitelistParamsSchema),
    // NOV-578 #5: action:"del" permanently removes whitelist entries → destructiveHint MUST be
    // true so MCP clients surface a confirmation. (add/remark also write; list is read-only, but
    // per-tool annotations can't vary by action, so the tool takes its most dangerous posture.)
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
  },
  // ─── Ghost tools wired in L3 fix ──────────────────────────────────────────
  {
    name: "novada_capture_apikey",
    description: `Get or reset the Capture API key for the account. Wraps POST /v1/capture/get_apikey and /v1/capture/reset_apikey.

**Actions:** "get" = retrieve the current capture/scraper API key (read-only). "reset" = regenerate the key — DESTRUCTIVE, invalidates the old key, requires confirm:true.
**Behavior:** Without confirm:true on "reset", returns a warning preview and does NOT call the API.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(CaptureApikeyParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "novada_scraper_task_mgmt",
    description: `Manage async scraper tasks via the developer-api. List tasks, check status by task_id(s), download results, or get the last task's status.

**Actions:** "list" (paginated task list), "status" (status by task_ids — comma-separated, max 200), "download" (download result by task_id), "last_status" (most recent task).
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).
**Note:** This wraps management endpoints on api-m.novada.com, separate from the scraper.novada.com submission API. For submitting new tasks use novada_scraper_submit; for polling a known task_id use novada_scraper_status.`,
    inputSchema: zodToMcpSchema(ScraperTaskMgmtParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_static_ip_mgmt",
    description: `Manage static ISP IPs on the account. Wraps /v1/static_house/* developer-api endpoints.

**Actions:** "open" = purchase new static IPs (WRITE, requires confirm:true). "renew" = renew existing IPs (WRITE, requires confirm:true). "export" = export filtered IP list (read-only). "list" = paginated IP list (read-only).
**Behavior:** Without confirm:true on "open"/"renew", returns a preview and does NOT hit the API.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(StaticIpMgmtParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
  },
  // ─── NOV-321 / NOV-323: session telemetry + search feedback ───────────────
  {
    name: "novada_session_stats",
    description: `Return per-process / per-session usage telemetry: tool-call counts, the last-N calls, and process uptime.

**Best for:** "What have I called this session?" / debugging an agent loop / seeing which Novada tools dominate usage.
**Returns:** session_started, uptime, total_calls, per-tool counts (high→low), and the most-recent calls (newest first, capped by recent_limit).
**Scope:** In-memory, per-process — resets when the MCP server restarts. Nothing is persisted to disk and nothing leaves the process. Auth-free (no API key needed).`,
    inputSchema: zodToMcpSchema(SessionStatsParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_search_feedback",
    description: `Record search-result quality so future ranking can learn from it. Returns a thank-you/echo confirmation with an agent_instruction.

**Best for:** After a novada_search call, tell Novada which result URLs were useful and rate the set (good/ok/bad). The signal biases future ranking.
**Params:** search_id (the prior search's id), query, rating ('good'|'ok'|'bad'), useful_urls? (results you clicked/cited, max 50), note? (what was missing).
**Scope:** In-memory feedback store, per-process — resets when the MCP server restarts. Nothing is persisted to disk. Auth-free (no API key needed).`,
    inputSchema: zodToMcpSchema(SearchFeedbackParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
];

// ─── Hidden Aliases ────────────────────────────────────────────────────────
// Names dispatched via switch but intentionally absent from TOOLS/ListTools.
// These are backward-compat aliases, deprecated tool names, and the auth-free
// pre-gate tools (novada_setup, novada_session_stats, novada_search_feedback
// are handled before dispatch() is called in index.ts and are also in TOOLS —
// they do NOT appear here since they ARE in TOOLS).

export const HIDDEN_ALIASES: ReadonlySet<string> = new Set([
  // Hidden alias: maps to novada_extract(format:"html")
  "novada_unblock",
  // Hidden aliases: map to novada_account(section="summary")
  "novada_health",
  "novada_health_all",
  // Hidden backward-compat aliases for novada_account sections
  "novada_wallet_balance",
  "novada_wallet_usage_record",
  "novada_traffic_daily",
  "novada_plan_balance_all",
  "novada_capture_logs",
  "novada_account_summary",
]);

// ─── Dispatch ─────────────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  apiKey?: string,
  ctx?: { onProgress?: ProgressReporter; visibleTools?: ReadonlySet<string> }
): Promise<string> {
  const onProgress = ctx?.onProgress;

  switch (name) {
    case "novada_search":
      return novadaSearch(validateSearchParams(args), apiKey!);
    case "novada_extract":
      return novadaExtract(validateExtractParams(args), apiKey!);
    case "novada_crawl":
      return novadaCrawl(validateCrawlParams(args), apiKey!, onProgress);
    case "novada_research":
      return novadaResearch(validateResearchParams(args), apiKey!, onProgress);
    case "novada_map":
      return novadaMap(validateMapParams(args), apiKey!);
    case "novada_site_copy":
      return novadaSiteCopy(validateSiteCopyParams(args), apiKey!);
    case "novada_proxy":
      return novadaProxy(validateProxyParams(args));
    case "novada_scrape":
      return novadaScrape(validateScrapeParams(args), apiKey!);
    case "novada_verify":
      return novadaVerify(validateVerifyParams(args), apiKey!);
    // novada_unblock → hidden alias → novada_extract(format:"html", render mapped from method)
    // method:"render" → render:"render"; method:"browser" → render:"browser"
    // Old callers still get raw HTML; max_chars/wait_for/url are preserved.
    case "novada_unblock": {
      const unblockRender = args["method"] === "browser" ? "browser" : "render";
      return novadaExtract(validateExtractParams({
        url: args["url"],
        format: "html",
        render: unblockRender,
        ...(args["max_chars"] !== undefined && { max_chars: args["max_chars"] }),
        ...(args["wait_for"] !== undefined && { wait_for: args["wait_for"] }),
      }), apiKey!);
    }
    case "novada_browser":
      return novadaBrowser(validateBrowserParams(args));
    // novada_health and novada_health_all are hidden aliases → novada_account(section="summary")
    case "novada_health": {
      // mode param removed from account (was a no-op) — always routes to full summary
      return novadaAccount(validateAccountParams({ section: "summary" }), apiKey);
    }
    case "novada_health_all":
      // Alias: novada_health_all → novada_account(section="summary") for back-compat
      return novadaAccount(validateAccountParams({ section: "summary" }), apiKey);
    case "novada_discover":
      // Pass the active-tool subset so the catalog reflects only what's usable in this
      // session (NOVADA_TOOLS/NOVADA_GROUPS restrictions). Undefined → full registry.
      return novadaDiscover(validateDiscoverParams(args), ctx?.visibleTools);
    // The async scraper trio (submit/status/result) is still listed in the exported TOOLS
    // array, but their behavior changed in 0.9.4: upstream returns results INLINE and the
    // poll endpoints never tracked /request tasks (NOV-697). submit now runs the sync scrape
    // and returns real records; status/result/task_mgmt return a benign ok pointing to
    // novada_scrape (task_mgmt routes here as a stub). No error status for old callers.
    case "novada_scraper_submit":
      return novadaScrape(validateScrapeParams(args), apiKey!);
    case "novada_scraper_status":
    case "novada_scraper_result":
    case "novada_scraper_task_mgmt":
      return JSON.stringify({
        status: "ok",
        message: "The async scraper flow was replaced in 0.9.4 — novada_scrape now returns results inline in one call.",
        agent_instruction: "Call novada_scrape with { platform, operation, params } to get the records directly. No polling needed.",
      }, null, 2);
    case "novada_browser_flow":
      return novadaBrowserFlow(validateBrowserFlowParams(args), apiKey!);
    // 0.9.4: the 6 typed proxy tools merged into novada_proxy(type=...).
    // Old names still work as aliases — inject the type and route to novadaProxy. No error for old callers.
    case "novada_proxy_residential":
    case "novada_proxy_isp":
    case "novada_proxy_datacenter":
    case "novada_proxy_mobile":
    case "novada_proxy_static":
    case "novada_proxy_dedicated": {
      const aliasType = PROXY_ALIAS_MAP[name];
      return novadaProxy(validateProxyParams({ ...args, type: aliasType }));
    }
    case "novada_ai_monitor":
      return novadaAiMonitor(validateAiMonitorParams(args), apiKey!);
    case "novada_monitor":
      return novadaMonitor(validateMonitorParams(args), apiKey!);
    // ─── KR-6: developer-api account-management tools ──────────────────
    case "novada_account":
      return novadaAccount(validateAccountParams(args), apiKey);
    // Backward-compat aliases — route to novada_account with the appropriate section.
    // These are hidden from tools/list but still dispatch correctly for old callers.
    case "novada_wallet_balance":
      return novadaAccount(validateAccountParams({ section: "balance" }), apiKey);
    case "novada_wallet_usage_record":
      return novadaAccount(validateAccountParams({ ...args, section: "usage" }), apiKey);
    case "novada_traffic_daily":
      return novadaAccount(validateAccountParams({ ...args, section: "traffic" }), apiKey);
    case "novada_plan_balance_all":
      return novadaAccount(validateAccountParams({ ...args, section: "plans" }), apiKey);
    case "novada_capture_logs":
      // capture_logs routed to summary since it's a sub-section of the dashboard
      return novadaAccount(validateAccountParams({ section: "summary" }), apiKey);
    case "novada_account_summary":
      return novadaAccount(validateAccountParams({ section: "summary" }), apiKey);
    case "novada_proxy_account_create":
      return novadaProxyAccountCreate(validateProxyAccountCreateParams(args));
    case "novada_proxy_account_list":
      return novadaProxyAccountList(validateProxyAccountListParams(args));
    case "novada_ip_whitelist":
      return novadaIpWhitelist(validateIpWhitelistParams(args));
    case "novada_capture_apikey":
      return novadaCaptureApikey(validateCaptureApikeyParams(args), apiKey);
    case "novada_static_ip_mgmt":
      return novadaStaticIpMgmt(validateStaticIpMgmtParams(args), apiKey);
    default:
      throw new Error(
        `Unknown tool: ${name}. Available: novada_search, novada_extract, novada_crawl, novada_research, novada_map, novada_site_copy, novada_scrape, novada_proxy, novada_proxy_residential, novada_proxy_isp, novada_proxy_datacenter, novada_proxy_mobile, novada_proxy_static, novada_proxy_dedicated, novada_verify, novada_browser, novada_account, novada_discover, novada_scraper_submit, novada_scraper_status, novada_scraper_result, novada_browser_flow, novada_ai_monitor, novada_monitor, novada_setup, novada_proxy_account_create, novada_proxy_account_list, novada_ip_whitelist, novada_capture_apikey, novada_scraper_task_mgmt, novada_static_ip_mgmt, novada_session_stats, novada_search_feedback`
      );
  }
}
