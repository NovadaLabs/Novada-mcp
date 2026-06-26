import { z } from "zod";
export declare const SearchParamsSchema: z.ZodObject<{
    query: z.ZodString;
    engine: z.ZodDefault<z.ZodEnum<{
        google: "google";
        bing: "bing";
        duckduckgo: "duckduckgo";
        yahoo: "yahoo";
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
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
    }>>;
    enrich_top: z.ZodOptional<z.ZodBoolean>;
    project: z.ZodOptional<z.ZodString>;
    extract_options: z.ZodOptional<z.ZodObject<{
        format: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            json: "json";
            text: "text";
            html: "html";
            markdown: "markdown";
        }>>>;
        fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        max_chars: z.ZodOptional<z.ZodNumber>;
        top_n: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ExtractParamsSchema: z.ZodObject<{
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
        js: "js";
        static: "static";
        render: "render";
        browser: "browser";
        auto: "auto";
    }>>;
    fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    max_chars: z.ZodOptional<z.ZodNumber>;
    wait_for: z.ZodOptional<z.ZodString>;
    wait_ms: z.ZodOptional<z.ZodNumber>;
    clean: z.ZodOptional<z.ZodBoolean>;
    project: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CrawlParamsSchema: z.ZodObject<{
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
    limit: z.ZodOptional<z.ZodNumber>;
    mode: z.ZodOptional<z.ZodEnum<{
        bfs: "bfs";
        dfs: "dfs";
    }>>;
}, z.core.$strip>;
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
export declare const MapParamsSchema: z.ZodObject<{
    url: z.ZodString;
    search: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    include_subdomains: z.ZodDefault<z.ZodBoolean>;
    max_depth: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const VerifyParamsSchema: z.ZodObject<{
    claim: z.ZodString;
    context: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const HealthParamsSchema: z.ZodObject<{}, z.core.$strip>;
export type HealthParams = z.infer<typeof HealthParamsSchema>;
export declare function validateHealthParams(args: Record<string, unknown> | undefined): HealthParams;
export type SearchParams = z.infer<typeof SearchParamsSchema>;
export type ExtractParams = z.infer<typeof ExtractParamsSchema>;
export type CrawlParams = z.infer<typeof CrawlParamsSchema>;
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
export declare const ProxyParamsSchema: z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<{
        residential: "residential";
        datacenter: "datacenter";
        mobile: "mobile";
        isp: "isp";
    }>>;
    country: z.ZodOptional<z.ZodString>;
    city: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        url: "url";
        env: "env";
        curl: "curl";
    }>>;
}, z.core.$strip>;
export type ProxyParams = z.infer<typeof ProxyParamsSchema>;
export declare function validateProxyParams(args: Record<string, unknown> | undefined): ProxyParams;
/** Shared regex for task_id validation across scraper tools (L-2: single source of truth) */
export declare const TASK_ID_REGEX: RegExp;
export declare const TASK_ID_REGEX_MSG = "task_id must be alphanumeric with underscores/hyphens/dots only";
/** MCP tool schema — agent-optimized formats only */
export declare const ScrapeParamsSchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
        toon: "toon";
    }>>;
    project: z.ZodOptional<z.ZodString>;
    platform: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
/** CLI/SDK schema — all output formats */
export declare const ScrapeParamsFullSchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        html: "html";
        markdown: "markdown";
        csv: "csv";
        xlsx: "xlsx";
        toon: "toon";
    }>>;
    platform: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
/** MCP-restricted type: only markdown/json/toon formats (matches ScrapeParamsSchema) */
export type ScrapeParams = z.infer<typeof ScrapeParamsSchema>;
/** Full type including CLI/SDK formats: csv/html/xlsx */
export type ScrapeParamsFullType = z.infer<typeof ScrapeParamsFullSchema>;
export declare function validateScrapeParams(args: Record<string, unknown> | undefined): ScrapeParams;
export declare function validateScrapeParamsFull(args: Record<string, unknown> | undefined): ScrapeParamsFullType;
export declare const UnblockParamsSchema: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodDefault<z.ZodEnum<{
        render: "render";
        browser: "browser";
    }>>;
    country: z.ZodOptional<z.ZodString>;
    wait_for: z.ZodOptional<z.ZodString>;
    timeout: z.ZodDefault<z.ZodNumber>;
    max_chars: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
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
export declare const BrowserParamsSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type BrowserParams = z.infer<typeof BrowserParamsSchema>;
export declare function validateBrowserParams(args: Record<string, unknown> | undefined): BrowserParams;
export declare const AiMonitorParamsSchema: z.ZodObject<{
    brand: z.ZodString;
    models: z.ZodOptional<z.ZodArray<z.ZodString>>;
    topics: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type AiMonitorParams = z.infer<typeof AiMonitorParamsSchema>;
export declare function validateAiMonitorParams(args: Record<string, unknown> | undefined): AiMonitorParams;
export {};
//# sourceMappingURL=types.d.ts.map