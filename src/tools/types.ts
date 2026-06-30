import { z } from "zod";
import { isBlockedHost } from "../utils/ssrf.js";

// ─── URL Safety ─────────────────────────────────────────────────────────────

/**
 * Only allow HTTP/HTTPS URLs — block file://, ftp://, gopher://, internal IPs.
 *
 * The private/loopback/link-local host decision is delegated to `isBlockedHost` in
 * utils/ssrf.ts — the SAME helper the runtime fetch chokepoint uses — so the Zod boundary
 * and the fetch-time guard can never drift. That helper parses the host numerically
 * (net.isIP) and blocks by range, covering forms a string regex misses (0.0.0.0/8,
 * 100.64.0.0/10 CGNAT, fc00::/7 ULA, IPv4-mapped/compatible loopback).
 */
const safeUrl = z.string()
  .url("A valid URL is required")
  .refine(
    (url) => /^https?:\/\//i.test(url),
    "Only HTTP and HTTPS URLs are supported"
  )
  .refine(
    (url) => {
      try {
        return !isBlockedHost(new URL(url).hostname);
      }
      catch { return false; }
    },
    "URLs pointing to localhost or private network ranges are not allowed"
  )
  .refine(
    (url) => !url.includes("\n") && !url.includes("\r"),
    "URL must not contain newline characters"
  );

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const SearchParamsSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  engine: z.enum(["google", "bing", "duckduckgo", "yahoo", "yandex"]).default("google")
    .describe("Search engine to use. 'google': best general relevance (default). 'bing': good for news and local. 'duckduckgo': privacy-focused. 'yahoo': broad index. 'yandex': Russian/Eastern European content."),
  num: z.number().int().min(1).max(20).default(10),
  country: z.string().default(""),
  language: z.string().default(""),
  time_range: z.enum(["day", "week", "month", "year"]).optional()
    .describe("Limit results to a time window. 'day'=last 24h, 'week'=last 7 days, 'month'=last 30 days, 'year'=last 12 months."),
  start_date: z.string().optional()
    .describe("ISO date YYYY-MM-DD. Return results published on or after this date."),
  end_date: z.string().optional()
    .describe("ISO date YYYY-MM-DD. Return results published on or before this date."),
  include_domains: z.array(z.string()).optional()
    .describe("Only return results from these domains. E.g. ['github.com', 'arxiv.org']. Max 10."),
  exclude_domains: z.array(z.string()).optional()
    .describe("Exclude results from these domains. E.g. ['reddit.com', 'quora.com']. Max 10."),
  source_type: z.enum(["any", "news", "research", "official", "social"]).optional()
    .describe("Bias result authority. 'research'/'official': prepend social+PR domains to the query exclusions and boost authoritative sources (*.gov, *.edu, sec.gov, arxiv.org, reuters.com, wikipedia.org, nature.com …). 'social': keep social results (no down-rank). 'news'/'any'/omitted: mild default reranking. Independent of, and combined with, automatic query-intent detection."),
  exclude_social: z.boolean().optional()
    .describe("When true, hard-drop social and press-release results (facebook, linkedin, x/twitter, instagram, tiktok, reddit, quora, medium, prnewswire, businesswire, globenewswire, prweb, einpresswire) from the response after fetching."),
  format: z.enum(["markdown", "json"]).default("markdown")
    .describe("Output format. 'markdown': human-readable (default). 'json': structured object for programmatic agent use."),
  enrich_top: z.boolean().optional()
    .describe("Auto-extract full content from the top result. Shorthand for extract_options.top_n=1. Adds ~2-4s latency. Default: false."),
  project: z.string().max(30).optional()
    .describe("Optional project name to group related outputs in a subfolder. E.g. 'france-vs-norway'."),
  extract_options: z.object({
    format: z.enum(["text", "markdown", "html", "json"]).optional().default("markdown")
      .describe("Output format. 'markdown' (default): structured readable output. 'json': structured JSON object with typed fields — best for programmatic agent consumption."),
    fields: z.array(z.string()).optional(),
    max_chars: z.number().int().min(1000).max(100000).optional(),
    top_n: z.number().int().min(1).max(10).optional().default(3)
      .describe("Number of top search results to auto-extract. Default: 3. Max: 10."),
  }).optional()
    .describe(
      "When provided, automatically extracts content from the top top_n search result URLs " +
      "and appends it to each result. Eliminates a separate novada_extract call. " +
      "Note: adds latency proportional to top_n * extract_latency. Use top_n=1-3 for most queries."
    ),
});

export const ExtractParamsSchema = z.object({
  url: z.union([
    safeUrl,
    z.array(safeUrl).min(1).max(10),
  ]).describe("URL or array of URLs (max 10) to extract. Batch mode processes in parallel. For multiple URLs, use the urls array param instead."),
  urls: z.array(safeUrl).min(1).max(10).optional()
    .describe(
      "Array of URLs to extract in parallel (max 10). " +
      "Alias for url when passing multiple URLs. " +
      "Use for batch research workflows extracting from several pages in one call. " +
      "Returns a structured markdown document with one labeled section per URL (### [1/N] url). Single url param still returns a single markdown document."
    ),
  format: z.enum(["text", "markdown", "html", "json"]).default("markdown")
    .describe("Output format. 'markdown' (default): structured readable output. 'text': plain text. 'html': raw HTML (truncated at 10K). 'json': structured JSON object with typed fields — best for programmatic agent consumption."),
  query: z.string().optional()
    .describe("Optional query for relevance context. Helps the calling agent focus on relevant sections."),
  render: z.enum(["auto", "static", "render", "js", "browser"]).default("auto")
    .describe("Rendering mode. 'auto' (default): tries static first, escalates if JS-heavy. 'static': static HTML only. 'js' (or 'render'): force JS rendering via Web Unblocker. 'browser': force Browser API CDP (requires NOVADA_BROWSER_WS)."),
  fields: z.array(z.string().min(1)).max(20).optional()
    .describe("Specific fields to extract (e.g. ['price', 'author', 'availability', 'rating']). Returns a structured ## Requested Fields block. JSON-LD structured data is checked first; falls back to pattern matching."),
  max_chars: z.number().int().min(1000).max(100000).optional()
    .describe(
      "Maximum characters to return (default: 25000, max: 100000). " +
      "When content exceeds this limit, it is truncated and content_truncated:true plus total_chars are emitted. " +
      "Raise up to 100000 only when you need the full page — do not set 100000 by default."
    ),
  wait_for: z.string().optional()
    .describe("CSS selector to wait for before capturing content (browser mode only). E.g. '.price', '#product-title', '[data-testid=price]'. Delays capture until the element appears in the DOM. Max wait: 15s."),
  wait_ms: z.number().int().min(0).max(30000).optional()
    .describe("Fixed milliseconds to wait after page load before capturing content. Use wait_for (CSS selector) instead when possible — it is more reliable. wait_ms is a fallback for pages with no stable selector. Max: 30000ms."),
  clean: z.boolean().optional()
    .describe("Set true to extract only main article content (strips nav, footer, ads). Default false returns full page markdown for maximum content coverage."),
  project: z.string().max(30).optional()
    .describe("Optional project name to group related outputs in a subfolder. E.g. 'france-vs-norway'."),
});

export const CrawlParamsSchema = z.object({
  url: safeUrl,
  max_pages: z.number().int().min(1).max(20).default(5),
  strategy: z.enum(["bfs", "dfs"]).default("bfs")
    .describe("Crawl traversal order. 'bfs' (default): breadth-first — visits all pages at current depth before going deeper, good for broad discovery. 'dfs': depth-first — follows links deeply before backtracking, good for exploring specific paths."),
  instructions: z.string().optional()
    .describe("Natural language hint for which pages to prioritize. E.g. 'only API reference pages', 'skip blog and changelog'. Applied as path-level filtering; semantic filtering is agent-side."),
  select_paths: z.array(z.string().min(1).max(200)).max(20).optional()
    .describe("Glob patterns to restrict crawled URL paths. '*' matches within a path segment, '**' matches across segments, '?' matches one char. E.g. ['/docs/**', '/api/**']."),
  exclude_paths: z.array(z.string().min(1).max(200)).max(20).optional()
    .describe("Glob patterns for URL paths to skip entirely. '*' matches within a path segment, '**' matches across segments. E.g. ['/blog/**', '/changelog/**']."),
  format: z.enum(["markdown", "json"]).default("markdown")
    .describe("Output format. 'markdown': human-readable (default). 'json': structured object for programmatic agent use."),
  render: z.enum(["auto", "static", "render"]).default("auto")
    .describe("Rendering mode. 'auto': uses static, escalates to render on first JS-heavy page detection. 'static': always static. 'render': always render (slower, handles JS sites)."),
  limit: z.number().int().min(1).max(20).optional()
    .describe("Alias for max_pages — use max_pages for the canonical name. Max 20."),
  mode: z.enum(["bfs", "dfs"]).optional()
    .describe("Alias for strategy — use strategy for the canonical name."),
});

export const ResearchParamsSchema = z.object({
  question: z.string().min(5, "Research question must be at least 5 characters").optional(),
  query: z.string().optional().describe("Alias for 'question' — use either"),
  depth: z.enum(["quick", "deep", "auto", "comprehensive"]).default("auto")
    .describe("'quick'=3 searches, 'deep'=5-6, 'comprehensive'=8-10, 'auto'=server decides based on question complexity."),
  focus: z.string().optional()
    .describe("Optional focus area to guide sub-query generation. E.g. 'technical implementation', 'business impact', 'recent news only'."),
  project: z.string().max(30).optional()
    .describe("Optional project name to group related outputs in a subfolder. E.g. 'france-vs-norway'."),
}).refine(data => !!(data.question || data.query), {
  message: "Either 'question' or 'query' must be provided",
});

export const MapParamsSchema = z.object({
  url: safeUrl,
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  include_subdomains: z.boolean().default(false),
  max_depth: z.number().int().min(1).max(5).default(2)
    .describe("Link-hops from root to follow. Default 2. Higher = more pages found but slower."),
});

// ─── Site Copy Params ─────────────────────────────────────────────────────────

/** Hard ceiling on pages a single site_copy run will fetch (safety bound). */
export const SITE_COPY_HARD_MAX = 1000;

export const SiteCopyParamsSchema = z.object({
  url: safeUrl,
  max_pages: z.number().int().min(1).max(SITE_COPY_HARD_MAX).default(200)
    .describe(`Maximum pages to copy. Default 200, hard max ${SITE_COPY_HARD_MAX}. The run drains the in-scope queue until empty or this ceiling is hit — it is a safety bound, not a target.`),
  select_paths: z.array(z.string().min(1).max(200)).max(20).optional()
    .describe("Glob patterns to restrict copied URL paths. '*' matches within a path segment, '**' matches across segments, '?' matches one char. E.g. ['/docs/**', '/api/**']. Same-host is always enforced."),
  exclude_paths: z.array(z.string().min(1).max(200)).max(20).optional()
    .describe("Glob patterns for URL paths to skip entirely. '*' matches within a path segment, '**' matches across segments. E.g. ['/blog/**', '/changelog/**']."),
  max_depth: z.number().int().min(1).max(10).default(5)
    .describe("BFS link-hops from root when no llms.txt/sitemap is found. Default 5. Ignored for llms.txt/sitemap discovery (which is flat)."),
  include_subdomains: z.boolean().default(false)
    .describe("When true, also copy pages on subdomains of the root host. Default false (same-host only)."),
  render: z.enum(["auto", "static", "render"]).default("auto")
    .describe("Rendering mode for each page fetch. 'auto' (default): static, escalate to render on JS-heavy detection. 'static': always static. 'render': always render (slower)."),
  project: z.string().max(30).optional()
    .describe("Optional project name to group outputs under ~/Downloads/novada-mcp/<date>/<project>/site-copy/. Defaults to the site domain."),
});

export type SiteCopyParams = z.infer<typeof SiteCopyParamsSchema>;

export function validateSiteCopyParams(args: Record<string, unknown> | undefined): SiteCopyParams {
  return SiteCopyParamsSchema.parse(args ?? {});
}

export const VerifyParamsSchema = z.object({
  claim: z.string().min(10).describe("The factual claim to verify (min 10 chars)"),
  context: z.string().optional().describe("Optional context to narrow the search (e.g. 'as of 2024', 'in the US')"),
});

// ─── Health Params ────────────────────────────────────────────────────────────

export const HealthParamsSchema = z.object({});
export type HealthParams = z.infer<typeof HealthParamsSchema>;
export function validateHealthParams(args: Record<string, unknown> | undefined): HealthParams {
  return HealthParamsSchema.parse(args ?? {});
}

// ─── Inferred Types ─────────────────────────────────────────────────────────

export type SearchParams = z.infer<typeof SearchParamsSchema>;
export type ExtractParams = z.infer<typeof ExtractParamsSchema>;
/** Public crawl params + an internal-only ceiling override.
 *  `_maxPagesCeiling` is NOT part of CrawlParamsSchema, so MCP callers cannot set it
 *  (Zod strips unknown keys). Only in-process callers (site_copy) pass it to raise the
 *  flat 20-page cap; default novada_crawl behaviour is unchanged. */
export type CrawlParams = z.infer<typeof CrawlParamsSchema> & {
  /** Internal: raise the hard page cap above the default 20 (site_copy only). */
  _maxPagesCeiling?: number;
};
export type ResearchParams = z.infer<typeof ResearchParamsSchema>;
export type MapParams = z.infer<typeof MapParamsSchema>;
export type VerifyParams = z.infer<typeof VerifyParamsSchema>;

// ─── Validation Functions ───────────────────────────────────────────────────

export function validateSearchParams(args: Record<string, unknown> | undefined): SearchParams {
  return SearchParamsSchema.parse(args ?? {});
}

export function validateExtractParams(args: Record<string, unknown> | undefined): ExtractParams {
  return ExtractParamsSchema.parse(args ?? {});
}

export function validateCrawlParams(args: Record<string, unknown> | undefined): CrawlParams {
  return CrawlParamsSchema.parse(args ?? {});
}

export function validateResearchParams(args: Record<string, unknown> | undefined): ResearchParams {
  return ResearchParamsSchema.parse(args ?? {});
}

export function validateMapParams(args: Record<string, unknown> | undefined): MapParams {
  return MapParamsSchema.parse(args ?? {});
}

export function validateVerifyParams(args: Record<string, unknown> | undefined): VerifyParams {
  return VerifyParamsSchema.parse(args ?? {});
}

// ─── API Response Types ─────────────────────────────────────────────────────

export interface NovadaSearchResult {
  title?: string;
  url?: string;
  link?: string;
  description?: string;
  snippet?: string;
  published?: string;
  date?: string;
}

export interface NovadaApiResponse {
  code?: number;
  msg?: string;
  data?: { organic_results?: NovadaSearchResult[] };
  organic_results?: NovadaSearchResult[];
}

// ─── Proxy Params ────────────────────────────────────────────────────────────

export const ProxyParamsSchema = z.object({
  type: z.enum(["residential", "mobile", "isp", "datacenter"]).default("residential")
    .describe("Proxy type. 'residential' for most anti-bot scenarios, 'mobile' for app automation, 'isp' for sticky sessions, 'datacenter' for high-volume/low-cost."),
  country: z.string().length(2).optional()
    .describe("ISO 2-letter country code (e.g. 'us', 'gb', 'de'). Omit for any country."),
  city: z.string().max(50).regex(/^[a-zA-Z\s\-]+$/, "city must contain only letters, spaces, or hyphens").optional()
    .describe("City name for city-level targeting. Requires country to be set."),
  session_id: z.string().max(64).regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only").optional()
    .describe("Session ID for sticky routing — same session_id returns same IP across requests."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string. 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyParams = z.infer<typeof ProxyParamsSchema>;

export function validateProxyParams(args: Record<string, unknown> | undefined): ProxyParams {
  return ProxyParamsSchema.parse(args ?? {});
}

// ─── Scrape Params ────────────────────────────────────────────────────────────

/** Shared regex for task_id validation across scraper tools (L-2: single source of truth) */
export const TASK_ID_REGEX = /^[a-zA-Z0-9_\-\.]{1,128}$/;
export const TASK_ID_REGEX_MSG = "task_id must be alphanumeric with underscores/hyphens/dots only";

const scrapeBase = {
  platform: z.string().min(1).max(100)
    .regex(/^[a-zA-Z0-9._\-]+$/, "platform must be a valid domain name (alphanumeric, dots, hyphens)")
    .describe("Platform domain to scrape. E.g. 'amazon.com', 'reddit.com', 'tiktok.com', 'linkedin.com', 'google.com'."),
  operation: z.string().min(1).max(100)
    .regex(/^[a-zA-Z0-9_\-]+$/, "operation must be alphanumeric with underscores/hyphens")
    .describe("Scraping operation ID. Examples: 'amazon_product_keywords', 'amazon_product_asin', 'tiktok_posts_url', 'linkedin_company_information_url', 'github_repository_repo-url', 'twitter_profile_username', 'youtube_video_search_label'. Read novada://scraper-platforms resource for the complete list with required params."),
  params: z.record(z.string(), z.unknown()).default({})
    .describe("Operation-specific parameters. E.g. { keyword: 'iphone 16', num: 5 } for keyword search, { url: 'https://...' } for URL-based ops, { asin: 'B09...' } for ASIN lookup."),
  limit: z.number().int().min(1).max(100).default(20)
    .describe("Max records to return. Default 20, max 100."),
};

/** MCP tool schema — agent-optimized formats only */
export const ScrapeParamsSchema = z.object({
  ...scrapeBase,
  format: z.enum(["markdown", "json", "toon"]).default("markdown")
    .describe("Output format. 'markdown' (default): structured table, easy to read and reason over. 'json': raw records array for programmatic processing. 'toon': token-optimized pipe-separated format (40-65% smaller than JSON/markdown)."),
  project: z.string().max(30).optional()
    .describe("Optional project name to group related outputs in a subfolder. E.g. 'france-vs-norway'."),
});

/** CLI/SDK schema — all output formats */
export const ScrapeParamsFullSchema = z.object({
  ...scrapeBase,
  format: z.enum(["markdown", "json", "toon", "csv", "html", "xlsx"]).default("markdown")
    .describe("Output format. 'markdown'/'json'/'toon' for agents/code. 'csv'/'html'/'xlsx' for human download."),
});

/** MCP-restricted type: only markdown/json/toon formats (matches ScrapeParamsSchema) */
export type ScrapeParams = z.infer<typeof ScrapeParamsSchema>;

/** Full type including CLI/SDK formats: csv/html/xlsx */
export type ScrapeParamsFullType = z.infer<typeof ScrapeParamsFullSchema>;

export function validateScrapeParams(args: Record<string, unknown> | undefined): ScrapeParams {
  return ScrapeParamsSchema.parse(args ?? {});
}

export function validateScrapeParamsFull(args: Record<string, unknown> | undefined): ScrapeParamsFullType {
  return ScrapeParamsFullSchema.parse(args ?? {});
}

// ─── Unblock Params ──────────────────────────────────────────────────────────

export const UnblockParamsSchema = z.object({
  url: safeUrl,
  method: z.enum(["render", "browser"]).default("render")
    .describe("Rendering method. 'render': JS rendering via Web Unblocker (requires NOVADA_WEB_UNBLOCKER_KEY). 'browser': full Chromium CDP (requires NOVADA_BROWSER_WS). Unlike novada_extract which uses 'render=', this tool uses 'method='."),
  country: z.string().length(2).optional()
    .describe("ISO 2-letter country code for geo-targeted rendering."),
  wait_for: z.string().optional()
    .describe("CSS selector to wait for before capturing HTML. E.g. '.price', '#product-title'."),
  timeout: z.number().int().min(5000).max(120000).default(30000)
    .describe("Timeout in ms. Default 30000, max 120000."),
  max_chars: z.number().int().min(1000).max(500000).optional()
    .describe(
      "Maximum characters of raw HTML to return (default: 100000, max: 500000). " +
      "When content exceeds this limit, it is truncated and a notice is appended. " +
      "Raw HTML is typically much larger than extracted text — increase this if you need the full DOM."
    ),
});

export type UnblockParams = z.infer<typeof UnblockParamsSchema>;

export function validateUnblockParams(args: Record<string, unknown> | undefined): UnblockParams {
  return UnblockParamsSchema.parse(args ?? {});
}

// ─── Browser Params ──────────────────────────────────────────────────────────

const BrowserActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("navigate"),
    url: safeUrl,
    wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).default("domcontentloaded")
      .describe("Page load event to wait for. Default 'domcontentloaded' works for most sites including SPAs (X, TikTok). Avoid 'networkidle' for SPAs — they continuously poll and never reach networkidle, causing a 30s timeout."),
  }),
  z.object({ action: z.literal("click"), selector: z.string().min(1) }),
  z.object({ action: z.literal("type"), selector: z.string().min(1), text: z.string() }),
  z.object({ action: z.literal("screenshot") }),
  z.object({ action: z.literal("snapshot") }),
  z.object({ action: z.literal("aria_snapshot") }),
  z.object({
    action: z.literal("evaluate"),
    script: z.string().min(1).max(2000)
      // ASCII-only: blocks Unicode homoglyph substitution (e.g. Cyrillic е → "fetch" bypass)
      .refine(
        s => /^[\x20-\x7E\n\r\t]*$/.test(s),
        "evaluate script must contain only ASCII printable characters"
      )
      // Block network-access and dynamic-code-execution APIs (literal names)
      .refine(
        s => !/fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|eval\s*\(|new\s+Function/i.test(s),
        "evaluate script must not make network requests or execute dynamic code (no fetch, XMLHttpRequest, WebSocket, sendBeacon, EventSource, eval, Function constructor)"
      )
      // Block bracket-property access on global objects (string-concat bypass: window["fe"+"tch"])
      .refine(
        s => !/\b(window|self|globalThis|frames|parent|top)\s*\[/.test(s),
        "evaluate script must not use bracket-property access on global objects"
      )
      .describe("JavaScript expression to evaluate in the page context. Max 2000 chars. ASCII only. Must not make network requests."),
  }),
  z.object({
    action: z.literal("wait"),
    selector: z.string().optional()
      .describe("CSS selector to wait for (e.g. '#results'). If omitted, waits for ms milliseconds."),
    ms: z.number().int().min(100).max(30000).optional()
      .describe("Milliseconds to wait (100–30000). Example: {action: \"wait\", ms: 2000}"),
    timeout: z.number().int().min(100).max(30000).optional()
      .describe("Alias for ms — prefer ms for clarity. Example: {action: \"wait\", timeout: 2000}"),
  }),
  z.object({
    action: z.literal("scroll"),
    direction: z.enum(["down", "up", "bottom", "top"]).default("down"),
  }),
  z.object({
    action: z.literal("hover"),
    selector: z.string().min(1).describe("CSS selector to hover over."),
  }),
  z.object({
    action: z.literal("press_key"),
    key: z.string().min(1).describe("Key to press. E.g. 'Enter', 'Tab', 'Escape', 'ArrowDown', 'Space'. Follows Playwright key names."),
    selector: z.string().optional().describe("Optional CSS selector to focus before pressing the key."),
  }),
  z.object({
    action: z.literal("select"),
    selector: z.string().min(1).describe("CSS selector for the <select> element."),
    value: z.string().min(1).describe("The option value (or label text) to select."),
  }),
  z.object({ action: z.literal("close_session") }),
  z.object({ action: z.literal("list_sessions") }),
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const BrowserParamsSchema = z.object({
  actions: z.array(BrowserActionSchema).min(1).max(20)
    .describe(
      "Array of browser actions to execute sequentially. Max 20 per call. " +
      "Each action MUST use the discriminated union format: {action: \"<type>\", ...fields}. " +
      "Examples: " +
      "{action: \"navigate\", url: \"https://example.com\"} | " +
      "{action: \"click\", selector: \"#btn\"} | " +
      "{action: \"type\", selector: \"#input\", text: \"hello\"} | " +
      "{action: \"wait\", ms: 2000} | " +
      "{action: \"screenshot\"} | " +
      "{action: \"aria_snapshot\"}. " +
      "Do NOT use string format (\"navigate\") or object-key format ({navigate: \"url\"}) — both are invalid."
    ),
  country: z.string().length(2).optional()
    .describe("ISO 2-letter country code for browser exit node (e.g. 'us', 'gb'). Required for platforms with geo-restrictions (TikTok is banned in India — use country='us'). Omit for no targeting."),
  timeout: z.number().int().min(5000).max(120000).default(60000)
    .describe("Total timeout for all actions in ms. Default 60000."),
  session_id: z.string().max(64).regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only").optional()
    .describe("Optional session ID for persistent browser state across calls. Reuses the same browser page (cookies, localStorage, login state). Warm reuse is ~5x faster (~1.5s vs ~8s cold start). Sessions expire after 10 minutes of inactivity."),
});

export type BrowserParams = z.infer<typeof BrowserParamsSchema>;

export function validateBrowserParams(args: Record<string, unknown> | undefined): BrowserParams {
  return BrowserParamsSchema.parse(args ?? {});
}

// ─── AI Monitor ──────────────────────────────────────────────────────────────

export const AiMonitorParamsSchema = z.object({
  brand: z.string().min(1).describe("Brand or product name to monitor across AI models. E.g. 'novada', 'firecrawl', 'stripe'."),
  models: z.array(z.string()).optional()
    .describe("AI models to check. Options: 'chatgpt', 'perplexity', 'grok', 'claude', 'gemini'. Default: ['chatgpt', 'perplexity', 'grok']."),
  topics: z.array(z.string()).optional()
    .describe("Topic filters to narrow the search. E.g. ['pricing', 'comparison', 'recommendation']. Default: general brand mentions."),
});

export type AiMonitorParams = z.infer<typeof AiMonitorParamsSchema>;

export function validateAiMonitorParams(args: Record<string, unknown> | undefined): AiMonitorParams {
  return AiMonitorParamsSchema.parse(args ?? {});
}

