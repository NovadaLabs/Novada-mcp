import { z, ZodError } from "zod";

// ─── URL Safety ─────────────────────────────────────────────────────────────

/** Only allow HTTP/HTTPS URLs — block file://, ftp://, gopher://, internal IPs */
const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1\]|\[::ffff:[^\]]+\]|\[fe80:[^\]]*\]|\[0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,1}1\])$/i;

const safeUrl = z.string()
  .url("A valid URL is required")
  .refine(
    (url) => /^https?:\/\//i.test(url),
    "Only HTTP and HTTPS URLs are supported"
  )
  .refine(
    (url) => {
      try { return !BLOCKED_HOSTS.test(new URL(url).hostname); }
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
  extract_options: z.object({
    format: z.enum(["text", "markdown", "html"]).optional().default("markdown"),
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
  format: z.enum(["text", "markdown", "html"]).default("markdown"),
  query: z.string().optional()
    .describe("Optional query for relevance context. Helps the calling agent focus on relevant sections."),
  render: z.enum(["auto", "static", "render", "browser"]).default("auto")
    .describe("Rendering mode. 'auto' (default): tries static first, escalates if JS-heavy. 'static': static HTML only. 'render': force JS rendering via Web Unblocker. 'browser': force Browser API CDP (requires NOVADA_BROWSER_WS)."),
  fields: z.array(z.string().min(1)).max(20).optional()
    .describe("Specific fields to extract (e.g. ['price', 'author', 'availability', 'rating']). Returns a structured ## Requested Fields block. JSON-LD structured data is checked first; falls back to pattern matching."),
  max_chars: z.number().int().min(1000).max(100000).optional()
    .describe(
      "Maximum characters to return (default: 25000, max: 100000). " +
      "When content exceeds this limit, it is truncated and a notice is appended. " +
      "Common mistake: do not set max_chars=100000 by default — use 25000 for most pages."
    ),
});

export const CrawlParamsSchema = z.object({
  url: safeUrl,
  max_pages: z.number().int().min(1).max(20).default(5),
  strategy: z.enum(["bfs", "dfs"]).default("bfs")
    .describe("Crawl traversal order. 'bfs' (default): breadth-first — visits all pages at current depth before going deeper, good for broad discovery. 'dfs': depth-first — follows links deeply before backtracking, good for exploring specific paths."),
  instructions: z.string().optional()
    .describe("Natural language hint for which pages to prioritize. E.g. 'only API reference pages', 'skip blog and changelog'. Applied as path-level filtering; semantic filtering is agent-side."),
  select_paths: z.array(z.string()).optional()
    .describe("Regex patterns to restrict crawled URL paths. E.g. ['/docs/.*', '/api/.*']."),
  exclude_paths: z.array(z.string()).optional()
    .describe("Regex patterns for URL paths to skip entirely. E.g. ['/blog/.*', '/changelog/.*']."),
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
export type CrawlParams = z.infer<typeof CrawlParamsSchema>;
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

// ─── Structured Error Types ─────────────────────────────────────────────────

export enum NovadaErrorCode {
  INVALID_API_KEY = "INVALID_API_KEY",
  RATE_LIMITED = "RATE_LIMITED",
  URL_UNREACHABLE = "URL_UNREACHABLE",
  API_DOWN = "API_DOWN",
  INVALID_PARAMS = "INVALID_PARAMS",
  UNKNOWN = "UNKNOWN",
}

export interface NovadaError {
  code: NovadaErrorCode;
  message: string;
  retryable: boolean;
  docsUrl?: string;
}

const DOCS_BASE = "https://www.novada.com";

/** Strip API keys and sensitive URL params from any string */
function sanitizeMessage(msg: string): string {
  return msg
    .replace(/api_key=[^&\s"')]+/gi, "api_key=***")
    .replace(/https?:\/\/scraperapi\.novada\.com[^\s"')]+/gi, "[novada-api-url]");
}

// ─── Proxy Params ────────────────────────────────────────────────────────────

export const ProxyParamsSchema = z.object({
  type: z.enum(["residential", "mobile", "isp", "datacenter"]).default("residential")
    .describe("Proxy type. 'residential' for most anti-bot scenarios, 'mobile' for app automation, 'isp' for sticky sessions, 'datacenter' for high-volume/low-cost."),
  country: z.string().length(2).optional()
    .describe("ISO 2-letter country code (e.g. 'us', 'gb', 'de'). Omit for any country."),
  city: z.string().optional()
    .describe("City name for city-level targeting. Requires country to be set."),
  session_id: z.string().optional()
    .describe("Session ID for sticky routing — same session_id returns same IP across requests."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string. 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyParams = z.infer<typeof ProxyParamsSchema>;

export function validateProxyParams(args: Record<string, unknown> | undefined): ProxyParams {
  return ProxyParamsSchema.parse(args ?? {});
}

// ─── Scrape Params ────────────────────────────────────────────────────────────

const scrapeBase = {
  platform: z.string().min(1)
    .describe("Platform domain to scrape. E.g. 'amazon.com', 'reddit.com', 'tiktok.com', 'linkedin.com', 'google.com'."),
  operation: z.string().min(1)
    .describe("Scraping operation ID. Examples: 'amazon_product_by-keywords', 'amazon_product_by-asin', 'reddit_posts_by-keywords', 'tiktok_user_videos', 'linkedin_job_listings', 'github_repository_details', 'glassdoor_jobs_by-keywords', 'zillow_listings'. Read novada://scraper-platforms resource for the complete list with required params."),
  params: z.record(z.string(), z.unknown()).default({})
    .describe("Operation-specific parameters. E.g. { keyword: 'iphone 16', num: 5 } for keyword search, { url: 'https://...' } for URL-based ops, { asin: 'B09...' } for ASIN lookup."),
  limit: z.number().int().min(1).max(100).default(20)
    .describe("Max records to return. Default 20, max 100."),
};

/** MCP tool schema — agent-optimized formats only */
export const ScrapeParamsSchema = z.object({
  ...scrapeBase,
  format: z.enum(["markdown", "json"]).default("markdown")
    .describe("Output format. 'markdown' (default): structured table, easy to read and reason over. 'json': raw records array for programmatic processing."),
});

/** CLI/SDK schema — all output formats */
export const ScrapeParamsFullSchema = z.object({
  ...scrapeBase,
  format: z.enum(["markdown", "json", "csv", "html", "xlsx"]).default("markdown")
    .describe("Output format. 'markdown'/'json' for agents/code. 'csv'/'html'/'xlsx' for human download."),
});

export type ScrapeParams = z.infer<typeof ScrapeParamsFullSchema>;

export function validateScrapeParams(args: Record<string, unknown> | undefined): ScrapeParams {
  return ScrapeParamsSchema.parse(args ?? {});
}

export function validateScrapeParamsFull(args: Record<string, unknown> | undefined): ScrapeParams {
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
  z.object({ action: z.literal("evaluate"), script: z.string().min(1) }),
  z.object({
    action: z.literal("wait"),
    selector: z.string().optional(),
    timeout: z.number().int().min(100).max(30000).default(5000),
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
    .describe("Array of browser actions to execute sequentially. Max 20 per call."),
  country: z.string().length(2).optional()
    .describe("ISO 2-letter country code for browser exit node (e.g. 'us', 'gb'). Required for platforms with geo-restrictions (TikTok is banned in India — use country='us'). Omit for no targeting."),
  timeout: z.number().int().min(5000).max(120000).default(60000)
    .describe("Total timeout for all actions in ms. Default 60000."),
  session_id: z.string().optional()
    .describe("Optional session ID for persistent browser state across calls. Reuses the same browser page (cookies, localStorage, login state). Sessions expire after 10 minutes of inactivity."),
});

export type BrowserParams = z.infer<typeof BrowserParamsSchema>;

export function validateBrowserParams(args: Record<string, unknown> | undefined): BrowserParams {
  return BrowserParamsSchema.parse(args ?? {});
}

// ─── Error Classification ────────────────────────────────────────────────────

export function classifyError(error: unknown): NovadaError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("401") || msg.includes("api_key") || msg.includes("unauthorized")) {
      return {
        code: NovadaErrorCode.INVALID_API_KEY,
        message: `Invalid or missing API key. Get one at ${DOCS_BASE}`,
        retryable: false,
        docsUrl: DOCS_BASE,
      };
    }
    if (msg.includes("429") || msg.includes("rate") || msg.includes("limit")) {
      return {
        code: NovadaErrorCode.RATE_LIMITED,
        message: "Rate limit exceeded. Wait and retry.",
        retryable: true,
        docsUrl: DOCS_BASE,
      };
    }
    if (msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("enotfound")) {
      return {
        code: NovadaErrorCode.URL_UNREACHABLE,
        message: `URL unreachable: ${sanitizeMessage(error.message)}`,
        retryable: true,
      };
    }
    if (msg.includes("503") || msg.includes("502")) {
      return {
        code: NovadaErrorCode.API_DOWN,
        message: "Novada API is temporarily unavailable. Retry in a moment.",
        retryable: true,
      };
    }
  }
  if (error instanceof ZodError) {
    return {
      code: NovadaErrorCode.INVALID_PARAMS,
      message: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
      retryable: false,
    };
  }
  const rawMsg = error instanceof Error ? error.message : String(error);
  return {
    code: NovadaErrorCode.UNKNOWN,
    message: sanitizeMessage(rawMsg),
    retryable: false,
  };
}
