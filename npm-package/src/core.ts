/**
 * core.ts — side-effect-free shared catalog + dispatch.
 *
 * NO top-level server construction, no process.exit, no stdio boot.
 * Safe to import from any transport (stdio index.ts, hosted mcp.ts, tests).
 *
 * Exports:
 *   TOOLS          — the MCP tool catalog, DERIVED from REGISTERED_TOOL_NAMES so it can
 *                    never drift from registry.ts. Tools in _TOOL_DEFINITIONS whose name
 *                    is absent from the registry are dispatch-only (hidden from ListTools).
 *   HIDDEN_ALIASES — tool names dispatched but intentionally absent from TOOLS
 *   dispatch()     — name → validated → tool fn → string result
 *                    THROWS on unknown tool and on tool errors (no envelope, no catch)
 *
 * Single source of truth: registry.ts controls the visible set. Add a name there to
 * surface it; remove a name there to hide it. _TOOL_DEFINITIONS holds the full
 * MCP schema for every dispatchable tool (visible + hidden).
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
  REGISTERED_TOOL_NAMES,
  TOOL_REGISTRY,
} from "./tools/index.js";
import { PLATFORM_SCRAPER_DEFS, PLATFORM_SCRAPER_HANDLERS } from "./tools/platform_scrapers.js";
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
  HealthParamsSchema,
  validateHealthParams,
} from "./tools/types.js";
import {
  _performRenderProbe,
  HEALTH_PROBE_DISCLAIMER,
  formatProbeSection,
} from "./tools/health.js";
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
// zodToMcpSchema lives in utils/mcp-schema.ts (not defined here) so BOTH this file's
// hand-written tool definitions AND tools/platform_scraper.ts's factory-generated
// ones share one conversion — factory-generated definitions must not import back
// from core.ts (core.ts spreads their output into _TOOL_DEFINITIONS below), so the
// shared function lives in a leaf util instead of either module.
import { zodToMcpSchema } from "./utils/mcp-schema.js";

// ─── Tool Definitions ────────────────────────────────────────────────────────
// _TOOL_DEFINITIONS holds the full MCP schema (description + inputSchema + annotations)
// for EVERY dispatchable tool — both visible (in registry) and hidden (dispatch-only).
// Exported (read-only, for test/introspection use only — e.g. tests/tools/tool-definitions.test.ts
// and tests/contract/output-schema.test.ts import it directly instead of parsing this file as
// text, so factory-generated entries below are just as visible to those guards as hand-written
// ones). The public `TOOLS` below is still the real dispatch/ListTools contract — external code
// and tools/index.ts consumers should keep using `TOOLS`/`dispatch()`, not this array.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const _TOOL_DEFINITIONS: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean> }> = [
  {
    name: "novada_search",
    description: `Search the web for clean, ready-to-use content — titles, URLs, snippets, reranked by relevance. For multi-source questions, use novada_research instead (faster, more thorough).

**Use for:** current events, URL lookup, fact-checking, competitive research. enrich_top=true auto-extracts the #1 result.
**Not for:** a known URL (novada_extract) or a multi-source report (novada_research).
**Tip:** engine='google' (default) is fastest/most reliable; duckduckgo/yandex are slower fallbacks.
**Domain filtering:** includeDomains/excludeDomains inject \`site:domain\` into the query (not API-side).
**Project grouping:** \`project="my-project"\` groups outputs under a subfolder (~/Downloads/novada-mcp/<date>/<project>/).`,
    inputSchema: zodToMcpSchema(SearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_extract",
    description: `Extract content from any URL. Auto-handles Cloudflare/DataDome/Kasada via escalation (static → JS render → Browser CDP). Batch mode: pass url as an array for up to 10 pages in parallel.

**Format selection:**
- \`format="markdown"\` (default): full-page content for reading/analysis.
- \`format="json"\`: structured object (url, title, content, quality, links, structured_data, fields, hints, mode, fetched_at). Use with \`fields=["price","title"]\` to populate \`fields\`. Common mistake: using markdown when you need specific fields — use format="json"+fields instead.
- \`format="html"\`: raw HTML (truncated at 100K chars by default; adjust via max_chars).
- \`clean=true\`: strip nav/sidebar, main content only (~15K chars vs ~100K full page).

**Use for:** reading pages, batch-extracting search results, structured fields (price, author, date) — works on anti-bot pages automatically.
**Not for:** URL discovery (novada_map), multi-page crawl (novada_crawl), rich platform data like Amazon/LinkedIn (novada_scrape).
**Key rule:** leave render="auto" (default) — 15-100x faster on static sites; only set render="render" for known JS-heavy SPAs.
**Geo-routing:** \`country="de"\` (ISO 2-letter) routes render fetches through that country's exit IP — for localized pricing or geo-restricted content.
**Auto-saved:** every extraction is written to \`~/Downloads/novada-mcp/YYYY-MM-DD/\` (path shown in the response).
**Project grouping:** \`project="my-project"\` groups outputs under a subfolder.`,
    inputSchema: zodToMcpSchema(ExtractParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_crawl",
    description: `Use when you need content from a bounded set of pages (up to 20) and don't have the URLs yet. Crawls BFS/DFS, extracts each page inline. Use select_paths globs to target sections (e.g. "/docs/api/**").

**Wrong tool for whole-site jobs:** for >20 pages or a full docs site on disk, use \`novada_site_copy\` instead (up to 1000 pages, streams to disk, returns a manifest). novada_crawl hard-caps at 20 pages and returns bodies inline.

**Best for:** competitive content analysis, a handful of related pages inline (returns bodies directly).
**Not for:** a single page (novada_extract), URL discovery only (novada_map — much faster), a whole site to disk (novada_site_copy).
**Performance:** avoid max_pages > 10 on large sites — crawl time scales ~1.4s/page (max_pages=20 ≈ 28s minimum). Use select_paths to narrow scope before raising max_pages.
**Rendering:** \`render\` defaults to "auto" (static first, escalates to JS on detection) — not static-only.`,
    inputSchema: zodToMcpSchema(CrawlParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_research",
    description: `One call → 3-10 parallel searches across Google/Bing/DuckDuckGo → dedup → extracts full content from top sources → returns CITED SOURCE MATERIAL (numbered passages), not a written answer. Extractive, not generative — you compose the final answer from the gathered passages.

**Use for:** complex questions needing passages from ≥3 independent sources in one call — comparative analysis, market research, technical deep dives, competitive intelligence. Replaces 5-10 manual search+extract calls.
**Not for:** a single fact or one URL (novada_search — faster/cheaper), a known URL (novada_extract), or a finished prose report (this returns source material, not an answer).
**Depth:** "quick" (3 queries), "deep" (6), "comprehensive" (8-9), "auto" (default — quick or deep by question length, never comprehensive).
**Project grouping:** \`project="my-project"\` groups outputs under a subfolder.
**Recency:** \`time_range\` ("day"|"week"|"month"|"year"), \`start_date\`/\`end_date\` (ISO YYYY-MM-DD) propagate to every internal search call.`,
    inputSchema: zodToMcpSchema(ResearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_map",
    description: `Discover URLs on a site before deciding what to read. Tries sitemap.xml first (fast), falls back to BFS crawl. Returns URLs only — no content. Hard cap: 100 URLs.

**Best for:** site structure discovery, finding the right subpage, pre-flight before novada_crawl/novada_extract.
**Not for:** reading content (use novada_crawl/novada_extract) or copying a whole site to disk (novada_site_copy).
**Note:** limited results on JS SPAs — flagged in the output.`,
    inputSchema: zodToMcpSchema(MapParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_site_copy",
    description: `Copy an entire docs site/section to disk as clean markdown — one .md file per page — returning a COMPACT manifest, not page bodies. Use for a whole knowledge base on disk (offline docs ingest, RAG corpus, full-site mirror).

**Discovery order:** (1) llms.txt/llms-full.txt if present, (2) sitemap.xml, (3) scoped same-host BFS to completion. select_paths/exclude_paths and same-host are always enforced.
**Best for:** "copy all of docs.x.com", a local docs corpus, ingesting an llms.txt index.
**Not for:** a single page (novada_extract), a few pages inline (novada_crawl), URL discovery only (novada_map).
**Output:** each page streams to \`~/Downloads/novada-mcp/<date>/<project|domain>/site-copy/<slug>.md\`; \`manifest.json\` records {url,file,title,word_count,depth,bytes,status} per page. The tool returns a compact summary + manifest path, not inline content — read the .md files or manifest.json after it completes.
**Scale:** max_pages default 200, hard max ${SITE_COPY_HARD_MAX}, drained until the queue is empty or the ceiling is hit.`,
    inputSchema: zodToMcpSchema(SiteCopyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_scrape",
    description: `Use for structured data from a specific platform — clean tabular records, not raw HTML. Supports 16 platforms (~87 operations): Amazon, Walmart, SHEIN, Google (incl. Shopping), Bing, DuckDuckGo, Yandex, X/Twitter, TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub, ChatGPT, Perplexity.

**Best for:** e-commerce product data, social posts/comments, job listings, reviews, real estate, market data.
**Not for:** general web pages outside this platform list — use novada_extract instead.
**Output formats:** markdown (default table), json (records array inside a fenced "## Scrape Results" block), toon (pipe-separated, 40-65% smaller — best for large result sets), csv, excel (base64), html.
**Example:** platform="amazon.com", operation="amazon_product_keywords", params={keyword:"iphone 16", num:5}.
**Amazon price fields:** trust \`final_price\`/\`price\` (check \`_price_source\`) — \`initial_price\` and \`buybox_prices.final_price\` are often 0 by design, not a bug; \`buybox_prices.unit_price\` is raw per-unit data, never the listing price.
**Discover platforms:** read the \`novada://scraper-platforms\` resource for the full operation list.
**Resume:** pass \`task_id\` from a prior status:processing call to fetch the result without a new billable task (platform/operation still required, display-only).
**Project grouping:** \`project="my-project"\` groups outputs under a subfolder.`,
    inputSchema: zodToMcpSchema(ScrapeParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  // novada_scrape_amazon (and, as they're added, its 15 per-platform siblings) is
  // GENERATED by the platform-scraper factory (src/tools/platform_scraper.ts) from a
  // declarative config (src/tools/scrape_amazon.ts) — spread here rather than
  // hand-written so this definition can never drift from the generated tool, and so
  // adding a new per-platform tool never requires touching this array again.
  ...PLATFORM_SCRAPER_DEFS,
  {
    name: "novada_proxy",
    description: `Route your own HTTP requests through residential or mobile IPs — geo-targeting, IP rotation, bypassing IP-based rate limits. Returns a proxy URL, shell exports, or a curl --proxy flag.

**Best for:** a specific country/city IP, sticky multi-step sessions, testing geo-restricted content.
**Not for:** page extraction (novada_extract — proxy is automatic) or web search (novada_search).
**Formats:** "url" (Node.js/Python), "env" (shell vars), "curl" (CLI).
**Requires:** NOVADA_PROXY_ENDPOINT env var; NOVADA_PROXY_USER/PASS auto-fetch from your account via NOVADA_API_KEY if unset.

**\`type\` guide:**
- \`residential\` — strongest anti-bot bypass, real home ISP IPs; escalate here when blocked
- \`isp\` — looks like a home user; best for social/ecommerce; ignores country param
- \`datacenter\` — fastest/cheapest; non-anti-bot, high-volume targets
- \`mobile\` — 4G/5G device IPs; mobile-targeted content and app APIs
- \`static\` — same dedicated ISP IP every request (needs session_id + country); account-management workflows
- \`dedicated\` — exclusive datacenter IP (needs session_id); high-trust platforms

**Escalation when blocked:** datacenter → isp → residential.`,
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
    description: `Check whether a factual claim is supported by web sources. Runs 3 parallel searches (supporting, skeptical, fact-check angles) and returns a verdict: supported / unsupported / contested / insufficient_data.

**Best for:** checking claims before citing them, cross-validating findings, detecting misinformation.
**Not for:** open-ended questions (novada_research) or reading a specific URL (novada_extract).
**Note:** signal-based (search balance), not definitive. Confidence 0–100 indicates certainty.`,
    inputSchema: zodToMcpSchema(VerifyParamsSchema),
    // idempotentHint:false — novada_verify runs live web searches; results are non-deterministic
    // (search index changes between calls). Two identical calls may return different verdicts.
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_browser",
    description: `Interact with a web page — click, fill forms, scroll, screenshot, or run JavaScript. Chain multiple actions in one call.

**Best for:** login flows, paginated content, SPAs, form submission, visual verification, scraping behind interactions.
**Not for:** simple page reads (novada_extract), structured data (novada_scrape), raw HTML (novada_extract format="html").
**Actions:** navigate, click, type, screenshot, snapshot, aria_snapshot, evaluate, wait, scroll, hover, press_key, select — up to 20/call. snapshot = full DOM text; aria_snapshot = smaller semantic tree (prefer it for extraction).
**Sessions:** session_id reuses the same page (cookies, login) across calls — reliable only on the local/long-lived server; on hosted serverless, treat each call as one-shot. close_session releases early.
**Auth:** NOVADA_API_KEY auto-provisions Browser API credentials; NOVADA_BROWSER_WS optionally overrides.
**SPAs:** wait with domcontentloaded, never networkidle. \`country\` is accepted but not yet applied to the browser exit node — don't rely on it for geo-routing.
**Constraint:** close_session/list_sessions must be the ONLY action in the call.`,
    inputSchema: zodToMcpSchema(BrowserParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_discover",
    description: `List all available Novada tools — name, description, category, group, and status.

**agent_instruction:** call this first when starting a task to find the right tool.
**Returns:** a markdown table grouped by category, plus a Tool Groups reference (core/scrapers/account/meta).
**Filter:** category narrows the catalog (e.g. category="Proxy"); NOVADA_GROUPS/NOVADA_TOOLS (local) or ?groups=/?tools= (hosted) narrow the actual tool set exposed on this connection.
**Status:** active = available now. Output includes server_version.

**ONE API KEY COVERS ALL PRODUCTS.** NOVADA_API_KEY authenticates search/extract/research/crawl/scrape/unblock/proxy auto-provisioning — no separate keys needed. NOVADA_BROWSER_WS/NOVADA_PROXY_ENDPOINT unlock extras, no extra key. On tool failure, call novada_account (section="summary") for balance/plans/entitlements.`,
    inputSchema: zodToMcpSchema(DiscoverParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_scraper_submit",
    description: `Deprecated alias — novada_scrape now returns records synchronously in one call; use novada_scrape instead. Pass platform, operation, and optional params — identical to novada_scrape. For resuming a slow job, pass task_id to novada_scrape directly.`,
    inputSchema: zodToMcpSchema(ScraperSubmitParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_scraper_status",
    description: `Deprecated alias — novada_scrape now returns records synchronously in one call; use novada_scrape instead. Pass task_id to novada_scrape to resume a slow job without submitting a new billable task.`,
    inputSchema: zodToMcpSchema(ScraperStatusParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_scraper_result",
    description: `Deprecated alias — novada_scrape now returns records synchronously in one call; use novada_scrape instead. Pass task_id to novada_scrape to resume a slow job without submitting a new billable task.`,
    inputSchema: zodToMcpSchema(ScraperResultParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_browser_flow",
    description: `Simplified browser automation — 5 actions (click, scroll, wait, type, screenshot). Use only if you need this simpler interface or novada_browser is unavailable.

**novada_browser is primary/more capable** — full CDP access, 12 action types + 2 session-management actions. Prefer it for new automation.
**Use this when:** you need the simplified flow API or have an existing workflow built on it.
**Actions:** click, scroll, wait, type, screenshot — up to 20/call.
**Sessions:** session_id reuses the browser instance (cookies, login) across calls; expires after 10 min idle.
**Not for:** reading one URL without interaction (novada_extract) or structured platform data (novada_scrape).`,
    inputSchema: zodToMcpSchema(BrowserFlowParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_ai_monitor",
    description: `Search PUBLIC indexed pages on AI-company domains (chatgpt.com/openai.com, perplexity.ai, anthropic.com, etc.) for brand mentions and sentiment. NOT page-change monitoring (novada_monitor) and does NOT query live AI models — a brand absent from indexed pages may still be discussed live; this only reflects indexed-page coverage.

**How it works:** for each selected domain group, runs a Google search scoped to that domain (e.g. site:openai.com "brandname") and analyzes snippets for sentiment, claims, and competitor co-mentions.
**Best for:** checking brand presence on AI-company public docs/blogs/changelogs.
**Not for:** live model answers about your brand (query the model directly), general web search (novada_search), real-time social monitoring (novada_scrape with twitter/reddit).
**Output:** per-domain sentiment (positive/neutral/negative), key claims from indexed snippets, competitor mentions, mention counts, source URLs.
**Domains:** chatgpt.com+openai.com, perplexity.ai, grok.com+x.com/i/grok, claude.ai+anthropic.com, gemini.google.com. Default: chatgpt, perplexity, grok.`,
    inputSchema: zodToMcpSchema(AiMonitorParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_monitor",
    description: `Detect changes on a web page over time. Extracts content, computes a hash, and compares it with the previous check. Returns changed/unchanged plus field-level diffs.

**Use for:** e-commerce price monitoring, stock tracking, content-change detection, competitive pricing alerts.
**How:** the first call sets a baseline; later calls compare against it and report changes. Pass fields=["price","availability"] for field-level % diffs.
**Not for:** one-time extraction (novada_extract) or a full crawl (novada_crawl).

⚠️ **Hosted endpoint (mcp.novada.com) limitation:** baselines do NOT survive between calls on hosted's serverless runtime — every call is a cold function with no prior state, so change detection always returns baseline_recorded. Use the local server (\`npx novada-mcp\`) or diff externally for real change detection.`,
    inputSchema: zodToMcpSchema(MonitorParamsSchema),
    // idempotentHint:false — novada_monitor is explicitly stateful: each call may write a new
    // baseline to monitorStore. Repeated calls on the same URL intentionally produce different
    // responses (changed vs unchanged). Marking it idempotent would mislead orchestrators.
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "novada_setup",
    description: `The onboarding concierge and first-run front door. Call this FIRST when starting out, or whenever a tool reports a missing/invalid key.

**What it does:**
1. **Validates your key** — one cheap account read (wallet balance) confirms it works and shows your balance. No per-product probes, no credit cost.
2. **Guides you if keyless** — register at the Novada dashboard (free credits included), copy your API key, get exact config snippets for Claude Code/Desktop/Cursor/VS Code/Windsurf.
3. **Orients you** — a plain-language list of core capabilities (search, extract, scrape, browser, account) plus add-ons.

**Reports one of 3 states:** valid key (ready) · invalid key (fix it) · no key (register). Output includes server_version.
**Auth-free by design:** a missing key never errors here — it guides, with a machine-usable agent_instruction for what to tell the user next.
**Unified key:** NOVADA_API_KEY covers search/extract/unblock/scraper/research/crawl/map/browser/proxy auto-provisioning. NOVADA_BROWSER_WS/NOVADA_PROXY_ENDPOINT are optional add-ons needing no separate key.`,
    inputSchema: zodToMcpSchema(SetupParamsSchema),
    // openWorldHint:true — now performs one authoritative account read to validate the key.
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  // ─── KR-6: developer-api account-management tools ─────────────────────────
  {
    name: "novada_account",
    description: `Single-call account & billing dashboard. Composes wallet balance, plan balances, capture logs, and health entitlements via the \`section\` param.

**Best for:** "what's my account status / balance" one-shot checks.
**section="summary" (default):** wallet balance + plan quotas + recent capture logs + product entitlements.
**section="balance":** master wallet currency balance.
**section="usage":** paginated transaction history (start_time/end_time/page/page_size).
**section="plans":** per-product plan balances (residential/isp/mobile/datacenter/static/capture); filter with products[].
**section="traffic":** daily proxy traffic consumption; filter with start_time/end_time/products[].
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).
**Aliases:** novada_wallet_balance, novada_wallet_usage_record, novada_plan_balance_all, novada_traffic_daily, novada_capture_logs, novada_account_summary, novada_health, novada_health_all all route here.`,
    inputSchema: zodToMcpSchema(AccountParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_account_create",
    description: `⚠️ WRITE — Create a proxy sub-account. Two-step confirm gate.

**Behavior:** without \`confirm: true\`, returns a \`confirmation_required\` JSON preview (password masked) and does NOT hit the API. Show the preview to the human; only re-call with \`confirm: true\` after explicit approval.

**Best for:** provisioning a team-member or per-project sub-account against your master plan.
**Params:** product ("1"=Residential, "2"=Rotating ISP, "3"=Rotating Datacenter, "4"=Unlimited, "7"=Unblocker, "9"=Mobile), account (3-64, [a-zA-Z0-9_-]), password (8-64), status ("1" active default | "-3" disabled), remark?, limit_flow? (GB cap), confirm.
**Wire format:** multipart/form-data.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(ProxyAccountCreateParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_proxy_account_list",
    description: `List proxy sub-accounts (wraps developer-api POST /v1/proxy_account/list).

**Best for:** auditing sub-accounts, finding account names before rotating credentials.
**Params:** product (REQUIRED — same codes as create), page, limit (max 200), status? ("1"|"-3"), account? (exact-match filter).
**Wire format:** multipart/form-data.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(ProxyAccountListParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_ip_whitelist",
    description: `Manage the proxy IP whitelist — add/list/delete/remark — for Residential (1), Unlimited (4), and Static ISP (5).

**Actions:** "add" (WRITE, requires confirm), "list" (read-only), "del" (WRITE, requires confirm), "remark" (update a note).
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
    description: `Get or reset the Capture API key (wraps POST /v1/capture/get_apikey and /v1/capture/reset_apikey).

**Actions:** "get" = retrieve the current key (read-only). "reset" = regenerate it — DESTRUCTIVE, invalidates the old key, requires confirm:true.
**Behavior:** without confirm:true on "reset", returns a warning preview and does NOT call the API.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(CaptureApikeyParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "novada_scraper_task_mgmt",
    description: `Deprecated alias — novada_scrape now returns records synchronously in one call; use novada_scrape instead. Pass task_id to novada_scrape to resume a slow job without submitting a new billable task.`,
    inputSchema: zodToMcpSchema(ScraperTaskMgmtParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_static_ip_mgmt",
    description: `Manage static ISP IPs (wraps /v1/static_house/* developer-api endpoints).

**Actions:** "open" = purchase new IPs (WRITE, requires confirm:true). "renew" = renew existing IPs (WRITE, requires confirm:true). "export"/"list" = read-only.
**Behavior:** without confirm:true on "open"/"renew", returns a preview and does NOT hit the API.
**Auth:** NOVADA_DEVELOPER_API_KEY (falls back to NOVADA_API_KEY).`,
    inputSchema: zodToMcpSchema(StaticIpMgmtParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false },
  },
  // ─── NOV-321 / NOV-323: session telemetry + search feedback ───────────────
  {
    name: "novada_session_stats",
    description: `Per-process / per-session usage telemetry: tool-call counts, the last-N calls, and process uptime.

**Best for:** "what have I called this session?" / debugging an agent loop / seeing which tools dominate usage.
**Returns:** session_started, uptime, total_calls, per-tool counts (high→low), most-recent calls (newest first, capped by recent_limit).
**Scope:** in-memory, per-process — resets on restart. Nothing persists or leaves the process. Auth-free.`,
    inputSchema: zodToMcpSchema(SessionStatsParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "novada_search_feedback",
    description: `Record search-result quality so future ranking can learn from it. Returns a thank-you/echo confirmation with an agent_instruction.

**Best for:** after a novada_search call, report which result URLs were useful and rate the set (good/ok/bad) — biases future ranking.
**Params:** search_id (prior search's id), query, rating ('good'|'ok'|'bad'), useful_urls? (max 50), note? (what was missing).
**Scope:** in-memory, per-process — resets on restart. Nothing persists. Auth-free.`,
    inputSchema: zodToMcpSchema(SearchFeedbackParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
];

/**
 * TOOLS — the MCP ListTools surface, DERIVED from the registry.
 *
 * Only entries whose `name` appears in REGISTERED_TOOL_NAMES are exported here.
 * Everything else in _TOOL_DEFINITIONS remains dispatchable (the switch handles
 * all names) but is hidden from agents' tool lists — no ListTools drift possible.
 *
 * To surface a new tool: add it to TOOL_REGISTRY in registry.ts AND add its
 * definition to _TOOL_DEFINITIONS above. To hide one: remove it from TOOL_REGISTRY.
 * Never edit this export directly.
 *
 * `title` (F-7, W-B1): attached here from TOOL_REGISTRY — the single class-driven
 * table (registry.ts) — rather than hand-added per _TOOL_DEFINITIONS entry above.
 * Every TOOL_REGISTRY row has a required `title` field (TypeScript enforces this
 * at the registry level), so this lookup can never silently omit one; the `?? t.name`
 * fallback only guards a theoretical registry/definitions desync, never expected
 * to trigger in practice.
 */
const _TITLE_BY_NAME: ReadonlyMap<string, string> = new Map(TOOL_REGISTRY.map((t) => [t.name, t.title]));

export const TOOLS = _TOOL_DEFINITIONS
  .filter((t) => REGISTERED_TOOL_NAMES.has(t.name))
  .map((t) => ({ ...t, title: _TITLE_BY_NAME.get(t.name) ?? t.name }));

// ─── Hidden Aliases ────────────────────────────────────────────────────────
// Names dispatched via switch but intentionally absent from TOOLS/ListTools.
// Includes: backward-compat aliases, deprecated tool names, and the 10 tools
// hidden from the visible surface in TOW2-256 T1+T2:
//   - 6 proxy variants → novadaProxy(type=...)
//   - 4 scraper stubs  → novadaScrape / benign stub

export const HIDDEN_ALIASES: ReadonlySet<string> = new Set([
  // Backward-compat aliases → novada_extract(format:"html")
  "novada_unblock",
  // Backward-compat aliases → novada_account(section=...)
  "novada_health",
  "novada_health_all",
  "novada_wallet_balance",
  "novada_wallet_usage_record",
  "novada_traffic_daily",
  "novada_plan_balance_all",
  "novada_capture_logs",
  "novada_account_summary",
  // Proxy type variants → novada_proxy(type=...) [TOW2-256 T2]
  "novada_proxy_residential",
  "novada_proxy_isp",
  "novada_proxy_datacenter",
  "novada_proxy_mobile",
  "novada_proxy_static",
  "novada_proxy_dedicated",
  // Scraper stubs → dispatch preserved but description was misleading [TOW2-256 T1]
  "novada_scraper_submit",
  "novada_scraper_status",
  "novada_scraper_result",
  "novada_scraper_task_mgmt",
]);

// ─── Dispatch ─────────────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  apiKey?: string,
  ctx?: { onProgress?: ProgressReporter; visibleTools?: ReadonlySet<string> }
): Promise<string> {
  const onProgress = ctx?.onProgress;

  // Platform-scraper family (novada_scrape_amazon and, as they're added, its 15
  // siblings) is GENERATED by the factory in tools/platform_scraper.ts — routed here
  // by a name -> handler map (tools/platform_scrapers.ts) instead of one switch `case`
  // per platform, so adding a new platform config never requires touching dispatch().
  const platformScraperHandler = PLATFORM_SCRAPER_HANDLERS[name];
  if (platformScraperHandler) return platformScraperHandler(args, apiKey!);

  switch (name) {
    case "novada_search":
      // TOW2-240: pass feedbackToolAvailable so search.ts omits the
      // novada_search_feedback agent_instruction when the tool is absent from
      // the active tool set (e.g. the hosted 15-tool endpoint).
      return novadaSearch(validateSearchParams(args), apiKey!, {
        feedbackToolAvailable: ctx?.visibleTools
          ? ctx.visibleTools.has("novada_search_feedback")
          : true,
      });
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
    // plus an honest disclaimer and optional render probe (probe:true, billed).
    case "novada_health":
    case "novada_health_all": {
      const { probe } = validateHealthParams(args);
      const base = await novadaAccount(validateAccountParams({ section: "summary" }), apiKey);
      const disclaimer = "\n\n" + HEALTH_PROBE_DISCLAIMER;
      if (!probe) return base + disclaimer;
      // probe:true — perform ONE real render call billed to the caller's account.
      const probeResult = await _performRenderProbe(apiKey ?? "");
      return base + disclaimer + formatProbeSection(probeResult);
    }
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
        message: "The async scraper flow was replaced — novada_scrape now returns results inline in one call.",
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
      return novadaProxyAccountCreate(validateProxyAccountCreateParams(args), apiKey);
    case "novada_proxy_account_list":
      return novadaProxyAccountList(validateProxyAccountListParams(args), apiKey);
    case "novada_ip_whitelist":
      return novadaIpWhitelist(validateIpWhitelistParams(args), apiKey);
    case "novada_capture_apikey":
      return novadaCaptureApikey(validateCaptureApikeyParams(args), apiKey);
    case "novada_static_ip_mgmt":
      return novadaStaticIpMgmt(validateStaticIpMgmtParams(args), apiKey);
    default:
      // F-5 (class-not-instance): DERIVE the tool list from the live registry
      // instead of a hand-maintained string — the old hardcoded list omitted
      // 14 of 15 pinned scrapers + novada_session_stats + novada_search_feedback
      // and presented 10 hidden aliases as if they were listed tools. TOOLS and
      // HIDDEN_ALIASES are the SAME single source of truth tools/list itself
      // uses, so this can never drift again; a 39th tool needs no edit here.
      throw new Error(
        `Unknown tool: ${name}. Available: ${TOOLS.map((t) => t.name).join(", ")}. ` +
        `Backward-compat aliases (dispatch but unlisted): ${[...HIDDEN_ALIASES].join(", ")}.`
      );
  }
}
