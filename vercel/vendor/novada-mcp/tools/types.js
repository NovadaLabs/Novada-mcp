import { z } from "zod";
import { isBlockedHost } from "../utils/ssrf.js";
// ─── snake_case Aliasing (NOV-327) ───────────────────────────────────────────
/**
 * Copy any present camelCase alias key onto its snake_case canonical key on a
 * shallow clone of `obj`. Shared by the object-level wrapper and the bespoke
 * browser preprocess (which also walks the nested `actions[]`).
 *
 * Rules:
 *  - canonical wins: if the snake_case key is already present, the alias is
 *    ignored — no silent overwrite.
 *  - non-destructive: input is shallow-cloned; unknown keys are left for Zod
 *    to strip as usual.
 *
 * @param aliases map of camelCaseAlias → snake_case_canonical
 */
function remapAliases(obj, aliases) {
    const out = { ...obj };
    for (const [camel, snake] of Object.entries(aliases)) {
        if (camel in out && !(snake in out)) {
            out[snake] = out[camel];
            delete out[camel];
        }
    }
    return out;
}
/**
 * Backwards-compat shim: snake_case is the canonical wire format for every tool
 * param, but older callers (and the legacy SDK shape) sent camelCase keys
 * (maxChars, waitFor, maxPages, …). This wraps a Zod object in a `z.preprocess`
 * that maps the camelCase aliases to snake_case BEFORE validation, so those
 * callers keep working without the camelCase keys ever appearing in the
 * agent-facing JSON schema (`.toJSONSchema()` reflects only the inner object).
 * Non-object / nullish input is passed through untouched so Zod reports the
 * real type error.
 *
 * @param aliases map of camelCaseAlias → snake_case_canonical
 */
function withCamelCaseAliases(schema, aliases) {
    return z.preprocess((input) => {
        if (input === null || typeof input !== "object" || Array.isArray(input)) {
            return input;
        }
        return remapAliases(input, aliases);
    }, schema);
}
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
    .refine((url) => /^https?:\/\//i.test(url), "Only HTTP and HTTPS URLs are supported")
    .refine((url) => {
    try {
        return !isBlockedHost(new URL(url).hostname);
    }
    catch {
        return false;
    }
}, "URLs pointing to localhost or private network ranges are not allowed")
    .refine((url) => !url.includes("\n") && !url.includes("\r"), "URL must not contain newline characters");
// ─── Zod Schemas ────────────────────────────────────────────────────────────
export const SearchParamsSchema = withCamelCaseAliases(z.object({
    query: z.string().min(1, "Search query is required"),
    engine: z.enum(["google", "bing", "duckduckgo", "yahoo", "yandex"]).default("google")
        .describe("Search engine to use. 'google': best general relevance + fastest (default, recommended). 'duckduckgo': privacy-focused (markedly slower). 'yandex': Russian/Eastern European content. 'bing': CURRENTLY DEGRADED — may return zero results; avoid. 'yahoo': NOT SUPPORTED — returns an error; do not use."),
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
    extract_options: withCamelCaseAliases(z.object({
        format: z.enum(["text", "markdown", "html", "json"]).optional().default("markdown")
            .describe("Output format. 'markdown' (default): structured readable output. 'json': structured JSON object with typed fields — best for programmatic agent consumption."),
        fields: z.array(z.string()).optional(),
        max_chars: z.number().int().min(1000).max(100000).optional(),
        top_n: z.number().int().min(1).max(10).optional().default(3)
            .describe("Number of top search results to auto-extract. Default: 3. Max: 10."),
    }), { maxChars: "max_chars", topN: "top_n" }).optional()
        .describe("When provided, automatically extracts content from the top top_n search result URLs " +
        "and appends it to each result. Eliminates a separate novada_extract call. " +
        "Note: adds latency proportional to top_n * extract_latency. Use top_n=1-3 for most queries."),
}), {
    timeRange: "time_range",
    startDate: "start_date",
    endDate: "end_date",
    includeDomains: "include_domains",
    excludeDomains: "exclude_domains",
    sourceType: "source_type",
    excludeSocial: "exclude_social",
    enrichTop: "enrich_top",
    extractOptions: "extract_options",
});
// Inner schema — validated after preprocess
const _ExtractParamsInner = z.object({
    url: z.union([
        safeUrl,
        z.array(safeUrl).min(1).max(10),
    ]).describe("URL or array of URLs (max 10) to extract. " +
        "Batch mode processes in parallel. " +
        "Accepted shapes: single string, array of strings, or use the urls alias."),
    urls: z.array(safeUrl).min(1).max(10).optional()
        .describe("Array of URLs to extract in parallel (max 10). " +
        "Alias for url when passing multiple URLs. " +
        "Use for batch research workflows extracting from several pages in one call. " +
        "Returns a structured markdown document with one labeled section per URL (### [1/N] url). Single url param still returns a single markdown document."),
    format: z.enum(["text", "markdown", "html", "json"]).default("markdown")
        .describe("Output format. 'markdown' (default): structured readable output. 'text': plain text. 'html': raw HTML (truncated at 10K). 'json': structured JSON object with typed fields — best for programmatic agent consumption."),
    query: z.string().optional()
        .describe("Optional query for relevance context. Helps the calling agent focus on relevant sections."),
    render: z.enum(["auto", "static", "render", "js", "browser"]).default("auto")
        .describe("Rendering mode. 'auto' (default): tries static first, escalates if JS-heavy. 'static': static HTML only. 'js' (or 'render'): force JS rendering via Web Unblocker. 'browser': force Browser API CDP (requires NOVADA_BROWSER_WS)."),
    fields: z.array(z.string().min(1)).max(20).optional()
        .describe("Specific fields to extract (e.g. ['price', 'author', 'availability', 'rating']). Returns a structured ## Requested Fields block. JSON-LD structured data is checked first; falls back to pattern matching."),
    max_chars: z.number().int().min(1000).max(100000).optional()
        .describe("Maximum characters to return (default: 25000, max: 100000). " +
        "When content exceeds this limit, it is truncated and content_truncated:true plus total_chars are emitted. " +
        "Raise up to 100000 only when you need the full page — do not set 100000 by default."),
    wait_for: z.string().optional()
        .describe("CSS selector to wait for before capturing content (browser mode only). E.g. '.price', '#product-title', '[data-testid=price]'. Delays capture until the element appears in the DOM. Max wait: 15s."),
    wait_ms: z.number().int().min(0).max(30000).optional()
        .describe("Fixed milliseconds to wait after page load before capturing content. Use wait_for (CSS selector) instead when possible — it is more reliable. wait_ms is a fallback for pages with no stable selector. Max: 30000ms."),
    clean: z.boolean().optional()
        .describe("Set true to extract only main article content (strips nav, footer, ads). Default false returns full page markdown for maximum content coverage."),
    project: z.string().max(30).optional()
        .describe("Optional project name to group related outputs in a subfolder. E.g. 'france-vs-norway'."),
});
/**
 * Public ExtractParamsSchema — wraps the inner schema with two preprocess layers:
 *
 * 1. urls → url promotion (F11): when `urls` is present and `url` is absent,
 *    copy `urls` into `url` so the required `url` field is satisfied. This lets
 *    callers pass ONLY `urls=[...]` as the documented alias without hitting a
 *    ZodError on the `url` required field.
 *
 * 2. camelCase → snake_case aliasing (NOV-327): maxChars → max_chars, etc.
 *
 * Both layers run inside a single z.preprocess so Zod sees the normalised input.
 */
export const ExtractParamsSchema = z.preprocess((input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return input;
    }
    const obj = input;
    // Layer 1: urls → url promotion — copy urls into url when url is missing
    let out = { ...obj };
    if ("urls" in out && !("url" in out)) {
        out = { ...out, url: out["urls"] };
    }
    // Layer 2: camelCase → snake_case (NOV-327) aliases
    out = remapAliases(out, {
        maxChars: "max_chars",
        waitFor: "wait_for",
        waitMs: "wait_ms",
    });
    return out;
}, _ExtractParamsInner);
export const CrawlParamsSchema = withCamelCaseAliases(z.object({
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
    // NOV-673: `limit` (alias for max_pages) and `mode` (alias for strategy) removed.
    // Both were dead: Zod's .default() on max_pages/strategy always filled those fields,
    // making the `??` fallbacks in crawl.ts unreachable. Removing them from the schema
    // closes the false contract — the schema no longer advertises params that are silently
    // ignored. Canonical fields: max_pages and strategy.
}), {
    maxPages: "max_pages",
    selectPaths: "select_paths",
    excludePaths: "exclude_paths",
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
export const MapParamsSchema = withCamelCaseAliases(z.object({
    url: safeUrl,
    search: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    include_subdomains: z.boolean().default(false),
    max_depth: z.number().int().min(1).max(5).default(2)
        .describe("Link-hops from root to follow. Default 2. Higher = more pages found but slower."),
}), {
    includeSubdomains: "include_subdomains",
    maxDepth: "max_depth",
});
// ─── Site Copy Params ─────────────────────────────────────────────────────────
/** Hard ceiling on pages a single site_copy run will fetch (safety bound). */
export const SITE_COPY_HARD_MAX = 1000;
export const SiteCopyParamsSchema = withCamelCaseAliases(z.object({
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
}), {
    maxPages: "max_pages",
    selectPaths: "select_paths",
    excludePaths: "exclude_paths",
    maxDepth: "max_depth",
    includeSubdomains: "include_subdomains",
});
export function validateSiteCopyParams(args) {
    return SiteCopyParamsSchema.parse(args ?? {});
}
export const VerifyParamsSchema = z.object({
    claim: z.string().min(10).describe("The factual claim to verify (min 10 chars)"),
    context: z.string().optional().describe("Optional context to narrow the search (e.g. 'as of 2024', 'in the US')"),
});
// ─── Health Params ────────────────────────────────────────────────────────────
export const HealthParamsSchema = z.object({
    mode: z.enum(["quick", "full"]).default("quick")
        .describe("'quick' (default): wallet balance + proxy/browser entitlement from account data (no synthetic probes, no credit cost). 'full': quick + per-product proxy plan balances with expiry (= novada_health_all). Reports account state, not live tool status — to confirm a tool works, call it."),
});
export function validateHealthParams(args) {
    return HealthParamsSchema.parse(args ?? {});
}
// ─── Validation Functions ───────────────────────────────────────────────────
export function validateSearchParams(args) {
    return SearchParamsSchema.parse(args ?? {});
}
export function validateExtractParams(args) {
    return ExtractParamsSchema.parse(args ?? {});
}
export function validateCrawlParams(args) {
    return CrawlParamsSchema.parse(args ?? {});
}
export function validateResearchParams(args) {
    return ResearchParamsSchema.parse(args ?? {});
}
export function validateMapParams(args) {
    return MapParamsSchema.parse(args ?? {});
}
export function validateVerifyParams(args) {
    return VerifyParamsSchema.parse(args ?? {});
}
// ─── Proxy Params ────────────────────────────────────────────────────────────
export const ProxyParamsSchema = withCamelCaseAliases(z.object({
    type: z.enum(["residential", "isp", "datacenter", "mobile", "static", "dedicated"]).default("residential")
        .describe("Proxy type. 'residential' for most anti-bot scenarios, 'mobile' for app automation, 'isp' for sticky sessions, 'datacenter' for high-volume/low-cost, 'static' for a dedicated ISP IP (same IP every request, requires session_id), 'dedicated' for an exclusive datacenter IP (not shared, requires session_id)."),
    country: z.string().regex(/^[a-zA-Z]{2}$/, "country must be a 2-letter ISO code (e.g. 'us', 'gb', 'de')").optional()
        .describe("ISO 2-letter country code (e.g. 'us', 'gb', 'de'). Omit for any country. NOTE: country targeting is NOT applied when type='isp' — it is silently ignored for that proxy type."),
    city: z.string().max(50).regex(/^[a-zA-Z\s\-]+$/, "city must contain only letters, spaces, or hyphens").optional()
        .describe("City name for city-level targeting. Requires country to be set."),
    session_id: z.string().max(64).regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only").optional()
        .describe("Session ID for sticky routing — same session_id returns same IP across requests."),
    format: z.enum(["url", "env", "curl"]).default("url")
        .describe("Output format. 'url': proxy URL string. 'env': shell export commands. 'curl': curl --proxy flag."),
}), { sessionId: "session_id" });
/** Backward-compat: old typed-proxy tool name → the `type` value to inject into novada_proxy.
 * The 6 typed tools were merged into one novada_proxy(type=...) in 0.9.4; old names still route here. */
export const PROXY_ALIAS_MAP = {
    novada_proxy_residential: "residential",
    novada_proxy_isp: "isp",
    novada_proxy_datacenter: "datacenter",
    novada_proxy_mobile: "mobile",
    novada_proxy_static: "static",
    novada_proxy_dedicated: "dedicated",
};
export function validateProxyParams(args) {
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
    // Resume path: when task_id is provided, skip submitting a new task and go directly
    // to fetching the result for that task_id — NO new billable task is submitted.
    // Use this to resume a previous call that returned status:processing without re-charging.
    task_id: z.string()
        .regex(TASK_ID_REGEX, TASK_ID_REGEX_MSG)
        .optional()
        .describe("Optional. When provided, skips submitting a new scrape task and fetches the result " +
        "of this existing task_id directly — no new billable task is created. " +
        "Use this to resume a previous novada_scrape call that returned status:processing " +
        "without incurring a duplicate charge. platform and operation are still required " +
        "(used for display only when resuming)."),
};
/** MCP tool schema — agent-optimized formats only */
export const ScrapeParamsSchema = z.object({
    ...scrapeBase,
    format: z.enum(["json", "csv", "excel", "html", "markdown", "toon"]).default("markdown")
        .describe("Output format. 'markdown' (default): structured table, easy to read and reason over. 'json': clean structured records array — key fields (title/price/rating/url) surfaced, noise trimmed. 'csv': inline CSV text, header row + one row per record, copy-paste into any spreadsheet. 'excel': real .xlsx returned as inline base64 — paste the base64 block into a decoder or use the provided download hint. 'html': inline HTML <table> (header row + one row per record) ready to drop into a page or open in a browser. 'toon': token-optimized pipe-separated format (40-65% smaller than JSON/markdown)."),
    project: z.string().max(30).optional()
        .describe("Optional project name to group related outputs in a subfolder. E.g. 'france-vs-norway'."),
});
/** CLI/SDK schema — all output formats */
export const ScrapeParamsFullSchema = z.object({
    ...scrapeBase,
    format: z.enum(["markdown", "json", "toon", "csv", "excel", "html", "xlsx"]).default("markdown")
        .describe("Output format. 'markdown'/'json'/'toon' for agents/code. 'csv'/'excel'/'html'/'xlsx' for human download. 'excel' = alias for 'xlsx' (inline base64)."),
});
export function validateScrapeParams(args) {
    return ScrapeParamsSchema.parse(args ?? {});
}
export function validateScrapeParamsFull(args) {
    return ScrapeParamsFullSchema.parse(args ?? {});
}
// ─── Unblock Params ──────────────────────────────────────────────────────────
export const UnblockParamsSchema = withCamelCaseAliases(z.object({
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
        .describe("Maximum characters of raw HTML to return (default: 100000, max: 500000). " +
        "When content exceeds this limit, it is truncated and a notice is appended. " +
        "Raw HTML is typically much larger than extracted text — increase this if you need the full DOM."),
}), {
    waitFor: "wait_for",
    maxChars: "max_chars",
});
export function validateUnblockParams(args) {
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
            .refine(s => /^[\x20-\x7E\n\r\t]*$/.test(s), "evaluate script must contain only ASCII printable characters")
            // Block network-access and dynamic-code-execution APIs (literal names)
            .refine(s => !/fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|eval\s*\(|new\s+Function/i.test(s), "evaluate script must not make network requests or execute dynamic code (no fetch, XMLHttpRequest, WebSocket, sendBeacon, EventSource, eval, Function constructor)")
            // Block bracket-property access on global objects (string-concat bypass: window["fe"+"tch"])
            .refine(s => !/\b(window|self|globalThis|frames|parent|top)\s*\[/.test(s), "evaluate script must not use bracket-property access on global objects")
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
/** camelCase aliases for keys nested inside a single browser action. */
const BROWSER_ACTION_ALIASES = { waitUntil: "wait_until" };
/**
 * Browser params need a bespoke alias step: `BrowserActionSchema` is a
 * z.discriminatedUnion, which rejects a preprocess-wrapped option (the
 * discriminator must be statically readable). So the top-level preprocess
 * both maps `sessionId`→`session_id` AND normalizes each action element's
 * camelCase keys (e.g. `waitUntil`→`wait_until`) before the union validates.
 */
export const BrowserParamsSchema = z.preprocess((input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return input;
    }
    const out = remapAliases(input, { sessionId: "session_id" });
    if (Array.isArray(out.actions)) {
        out.actions = out.actions.map((a) => a !== null && typeof a === "object" && !Array.isArray(a)
            ? remapAliases(a, BROWSER_ACTION_ALIASES)
            : a);
    }
    return out;
}, z.object({
    actions: z.array(BrowserActionSchema).min(1).max(20)
        .describe("Array of browser actions to execute sequentially. Max 20 per call. " +
        "Each action MUST use the discriminated union format: {action: \"<type>\", ...fields}. " +
        "Examples: " +
        "{action: \"navigate\", url: \"https://example.com\"} | " +
        "{action: \"click\", selector: \"#btn\"} | " +
        "{action: \"type\", selector: \"#input\", text: \"hello\"} | " +
        "{action: \"wait\", ms: 2000} | " +
        "{action: \"screenshot\"} | " +
        "{action: \"aria_snapshot\"}. " +
        "Do NOT use string format (\"navigate\") or object-key format ({navigate: \"url\"}) — both are invalid."),
    country: z.string().length(2).optional()
        .describe("ISO 2-letter country code (e.g. 'us', 'gb'). NOTE: accepted but NOT yet applied — the browser exit node is not geo-routed by this param today. Do not rely on it for geo-restricted platforms."),
    timeout: z.number().int().min(5000).max(120000).default(60000)
        .describe("Total timeout for all actions in ms. Default 60000."),
    session_id: z.string().max(64).regex(/^[a-zA-Z0-9_\-]+$/, "session_id must be alphanumeric, hyphens, or underscores only").optional()
        .describe("Optional session ID for persistent browser state across calls. Reuses the same browser page (cookies, localStorage, login state). Warm reuse is ~5x faster (~1.5s vs ~8s cold start). Sessions expire after 10 minutes of inactivity."),
}).refine(
// NOV-664: close_session and list_sessions are session-management actions that must be the
// sole action in a call — mixing them with other actions causes undefined behaviour.
(data) => {
    const SOLE_ACTIONS = new Set(["close_session", "list_sessions"]);
    const hasSoleAction = data.actions.some((a) => SOLE_ACTIONS.has(a.action));
    return !hasSoleAction || data.actions.length === 1;
}, { message: "close_session / list_sessions must be the only action in the call — they cannot be combined with other actions (NOV-664)" }));
export function validateBrowserParams(args) {
    return BrowserParamsSchema.parse(args ?? {});
}
// ─── AI Monitor ──────────────────────────────────────────────────────────────
/** Known AI-company domain groups ai_monitor can scope a search to. Must stay in
 *  sync with MODEL_DOMAINS in ai_monitor.ts. */
export const AI_MONITOR_MODELS = ["chatgpt", "perplexity", "grok", "claude", "gemini"];
export const AiMonitorParamsSchema = z.object({
    // H5 / M8: cap length + strip quote chars so a `"` can't break the site: scoping
    // and inject search operators (result-manipulation only — transport is form-encoded).
    brand: z.string().min(1).max(200)
        .describe("Brand or product name to search for on AI-company public web domains. E.g. 'novada', 'firecrawl', 'stripe'."),
    // H5: validate against the known model keys (lowercased) so an unknown value —
    // including prototype-pollution keys like "__proto__" — is rejected at the Zod
    // boundary with a clear INVALID_PARAMS message instead of crashing the runtime
    // (MODEL_DOMAINS["__proto__"] would return Object.prototype → uncaught TypeError)
    // or silently becoming a mislabeled unscoped global search.
    models: z.preprocess((v) => Array.isArray(v) ? v.map(m => typeof m === "string" ? m.toLowerCase() : m) : v, z.array(z.enum(AI_MONITOR_MODELS)).min(1).max(5)).optional()
        .describe("Domain groups to search (each key → a set of AI-company public web domains, e.g. 'chatgpt' → chatgpt.com + openai.com). This does NOT query the live AI models — it searches their indexed public pages. Options: 'chatgpt', 'perplexity', 'grok', 'claude', 'gemini'. Default: ['chatgpt', 'perplexity', 'grok']."),
    topics: z.array(z.string().max(200)).max(10).optional()
        .describe("Topic filter to narrow the search. Only the FIRST entry is used; the rest are ignored. E.g. ['pricing']. Default: general brand mentions."),
});
export function validateAiMonitorParams(args) {
    const parsed = AiMonitorParamsSchema.parse(args ?? {});
    // M8: strip quote chars so a `"`/`'` can't break site: scoping / inject search
    // operators. Done POST-parse (not via .transform() in the schema) because the
    // schema is converted to JSON Schema for the MCP inputSchema, and Zod transforms
    // cannot be represented there (they crash zodToMcpSchema at module load).
    const strip = (s) => s.replace(/["']/g, "").trim();
    return {
        ...parsed,
        brand: strip(parsed.brand),
        ...(parsed.topics ? { topics: parsed.topics.map(strip) } : {}),
    };
}
//# sourceMappingURL=types.js.map