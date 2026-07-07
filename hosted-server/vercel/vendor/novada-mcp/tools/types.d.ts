import { z } from "zod";
export declare const SearchParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    query: z.ZodString;
    engine: z.ZodDefault<z.ZodEnum<{
        google: "google";
        bing: "bing";
        duckduckgo: "duckduckgo";
        yandex: "yandex";
    }>>;
    num: z.ZodDefault<z.ZodNumber>;
    country: z.ZodDefault<z.ZodString>;
    language: z.ZodDefault<z.ZodString>;
    time_range: z.ZodOptional<z.ZodEnum<{
        day: "day";
        week: "week";
        month: "month";
        year: "year";
    }>>;
    start_date: z.ZodOptional<z.ZodString>;
    end_date: z.ZodOptional<z.ZodString>;
    include_domains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    exclude_domains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    source_type: z.ZodOptional<z.ZodEnum<{
        social: "social";
        research: "research";
        any: "any";
        news: "news";
        official: "official";
    }>>;
    exclude_social: z.ZodOptional<z.ZodBoolean>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
    }>>;
    enrich_top: z.ZodOptional<z.ZodBoolean>;
    project: z.ZodOptional<z.ZodString>;
    extract_options: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
        format: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            json: "json";
            text: "text";
            html: "html";
            markdown: "markdown";
        }>>>;
        fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        max_chars: z.ZodOptional<z.ZodNumber>;
        top_n: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>>;
}, z.core.$strip>>;
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
export declare const ExtractParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    url: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    urls: z.ZodOptional<z.ZodArray<z.ZodString>>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        text: "text";
        html: "html";
        markdown: "markdown";
    }>>;
    query: z.ZodOptional<z.ZodString>;
    render: z.ZodDefault<z.ZodEnum<{
        static: "static";
        render: "render";
        js: "js";
        browser: "browser";
        auto: "auto";
    }>>;
    fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    max_chars: z.ZodOptional<z.ZodNumber>;
    wait_for: z.ZodOptional<z.ZodString>;
    wait_ms: z.ZodOptional<z.ZodNumber>;
    clean: z.ZodOptional<z.ZodBoolean>;
    project: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export declare const CrawlParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    url: z.ZodString;
    max_pages: z.ZodDefault<z.ZodNumber>;
    strategy: z.ZodDefault<z.ZodEnum<{
        bfs: "bfs";
        dfs: "dfs";
    }>>;
    instructions: z.ZodOptional<z.ZodString>;
    select_paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
    exclude_paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
    }>>;
    render: z.ZodDefault<z.ZodEnum<{
        static: "static";
        render: "render";
        auto: "auto";
    }>>;
}, z.core.$strip>>;
export declare const ResearchParamsSchema: z.ZodObject<{
    question: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    depth: z.ZodDefault<z.ZodEnum<{
        auto: "auto";
        quick: "quick";
        deep: "deep";
        comprehensive: "comprehensive";
    }>>;
    focus: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const MapParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    url: z.ZodString;
    search: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    include_subdomains: z.ZodDefault<z.ZodBoolean>;
    max_depth: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>>;
/** Hard ceiling on pages a single site_copy run will fetch (safety bound). */
export declare const SITE_COPY_HARD_MAX = 1000;
export declare const SiteCopyParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    url: z.ZodString;
    max_pages: z.ZodDefault<z.ZodNumber>;
    select_paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
    exclude_paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
    max_depth: z.ZodDefault<z.ZodNumber>;
    include_subdomains: z.ZodDefault<z.ZodBoolean>;
    render: z.ZodDefault<z.ZodEnum<{
        static: "static";
        render: "render";
        auto: "auto";
    }>>;
    project: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type SiteCopyParams = z.infer<typeof SiteCopyParamsSchema>;
export declare function validateSiteCopyParams(args: Record<string, unknown> | undefined): SiteCopyParams;
export declare const VerifyParamsSchema: z.ZodObject<{
    claim: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const HealthParamsSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        quick: "quick";
        full: "full";
    }>>;
}, z.core.$strip>;
export type HealthParams = z.infer<typeof HealthParamsSchema>;
export declare function validateHealthParams(args: Record<string, unknown> | undefined): HealthParams;
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
export declare function validateSearchParams(args: Record<string, unknown> | undefined): SearchParams;
export declare function validateExtractParams(args: Record<string, unknown> | undefined): ExtractParams;
export declare function validateCrawlParams(args: Record<string, unknown> | undefined): CrawlParams;
export declare function validateResearchParams(args: Record<string, unknown> | undefined): ResearchParams;
export declare function validateMapParams(args: Record<string, unknown> | undefined): MapParams;
export declare function validateVerifyParams(args: Record<string, unknown> | undefined): VerifyParams;
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
    data?: {
        organic_results?: NovadaSearchResult[];
    };
    organic_results?: NovadaSearchResult[];
}
export declare const ProxyParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<{
        static: "static";
        residential: "residential";
        datacenter: "datacenter";
        isp: "isp";
        mobile: "mobile";
        dedicated: "dedicated";
    }>>;
    country: z.ZodOptional<z.ZodString>;
    city: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>>;
export type ProxyParams = z.infer<typeof ProxyParamsSchema>;
/** Backward-compat: old typed-proxy tool name → the `type` value to inject into novada_proxy.
 * The 6 typed tools were merged into one novada_proxy(type=...) in 0.9.4; old names still route here. */
export declare const PROXY_ALIAS_MAP: Record<string, ProxyParams["type"]>;
export declare function validateProxyParams(args: Record<string, unknown> | undefined): ProxyParams;
/** Shared regex for task_id validation across scraper tools (L-2: single source of truth) */
export declare const TASK_ID_REGEX: RegExp;
export declare const TASK_ID_REGEX_MSG = "task_id must be alphanumeric with underscores/hyphens/dots only";
/** MCP tool schema — agent-optimized formats only */
export declare const ScrapeParamsSchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        html: "html";
        markdown: "markdown";
        csv: "csv";
        excel: "excel";
        toon: "toon";
    }>>;
    project: z.ZodOptional<z.ZodString>;
    platform: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    limit: z.ZodDefault<z.ZodNumber>;
    task_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** CLI/SDK schema — all output formats */
export declare const ScrapeParamsFullSchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        html: "html";
        markdown: "markdown";
        csv: "csv";
        xlsx: "xlsx";
        excel: "excel";
        toon: "toon";
    }>>;
    platform: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    limit: z.ZodDefault<z.ZodNumber>;
    task_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** MCP-restricted type: only markdown/json/toon formats (matches ScrapeParamsSchema) */
export type ScrapeParams = z.infer<typeof ScrapeParamsSchema>;
/** Full type including CLI/SDK formats: csv/html/xlsx */
export type ScrapeParamsFullType = z.infer<typeof ScrapeParamsFullSchema>;
export declare function validateScrapeParams(args: Record<string, unknown> | undefined): ScrapeParams;
export declare function validateScrapeParamsFull(args: Record<string, unknown> | undefined): ScrapeParamsFullType;
export declare const UnblockParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    url: z.ZodString;
    method: z.ZodDefault<z.ZodEnum<{
        render: "render";
        browser: "browser";
    }>>;
    country: z.ZodOptional<z.ZodString>;
    wait_for: z.ZodOptional<z.ZodString>;
    timeout: z.ZodDefault<z.ZodNumber>;
    max_chars: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>;
export type UnblockParams = z.infer<typeof UnblockParamsSchema>;
export declare function validateUnblockParams(args: Record<string, unknown> | undefined): UnblockParams;
declare const BrowserActionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"navigate">;
    url: z.ZodString;
    wait_until: z.ZodDefault<z.ZodEnum<{
        load: "load";
        domcontentloaded: "domcontentloaded";
        networkidle: "networkidle";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"click">;
    selector: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"type">;
    selector: z.ZodString;
    text: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"screenshot">;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"snapshot">;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"aria_snapshot">;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"evaluate">;
    script: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"wait">;
    selector: z.ZodOptional<z.ZodString>;
    ms: z.ZodOptional<z.ZodNumber>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"scroll">;
    direction: z.ZodDefault<z.ZodEnum<{
        down: "down";
        up: "up";
        bottom: "bottom";
        top: "top";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"hover">;
    selector: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"press_key">;
    key: z.ZodString;
    selector: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"select">;
    selector: z.ZodString;
    value: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"close_session">;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"list_sessions">;
}, z.core.$strip>], "action">;
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
/**
 * Browser params need a bespoke alias step: `BrowserActionSchema` is a
 * z.discriminatedUnion, which rejects a preprocess-wrapped option (the
 * discriminator must be statically readable). So the top-level preprocess
 * both maps `sessionId`→`session_id` AND normalizes each action element's
 * camelCase keys (e.g. `waitUntil`→`wait_until`) before the union validates.
 */
export declare const BrowserParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        action: z.ZodLiteral<"navigate">;
        url: z.ZodString;
        wait_until: z.ZodDefault<z.ZodEnum<{
            load: "load";
            domcontentloaded: "domcontentloaded";
            networkidle: "networkidle";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"click">;
        selector: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"type">;
        selector: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"screenshot">;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"snapshot">;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"aria_snapshot">;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"evaluate">;
        script: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"wait">;
        selector: z.ZodOptional<z.ZodString>;
        ms: z.ZodOptional<z.ZodNumber>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"scroll">;
        direction: z.ZodDefault<z.ZodEnum<{
            down: "down";
            up: "up";
            bottom: "bottom";
            top: "top";
        }>>;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"hover">;
        selector: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"press_key">;
        key: z.ZodString;
        selector: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"select">;
        selector: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"close_session">;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"list_sessions">;
    }, z.core.$strip>], "action">>;
    country: z.ZodOptional<z.ZodString>;
    timeout: z.ZodDefault<z.ZodNumber>;
    session_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type BrowserParams = z.infer<typeof BrowserParamsSchema>;
export declare function validateBrowserParams(args: Record<string, unknown> | undefined): BrowserParams;
/** Known AI-company domain groups ai_monitor can scope a search to. Must stay in
 *  sync with MODEL_DOMAINS in ai_monitor.ts. */
export declare const AI_MONITOR_MODELS: readonly ["chatgpt", "perplexity", "grok", "claude", "gemini"];
export declare const AiMonitorParamsSchema: z.ZodObject<{
    brand: z.ZodString;
    models: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodArray<z.ZodEnum<{
        chatgpt: "chatgpt";
        perplexity: "perplexity";
        grok: "grok";
        claude: "claude";
        gemini: "gemini";
    }>>>>;
    topics: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type AiMonitorParams = z.infer<typeof AiMonitorParamsSchema>;
export declare function validateAiMonitorParams(args: Record<string, unknown> | undefined): AiMonitorParams;
export {};
//# sourceMappingURL=types.d.ts.map