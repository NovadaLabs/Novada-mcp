import type { z } from "zod";
import { type PlatformScraperConfig } from "./platform_scraper.js";
export declare const GOOGLE_OPERATIONS: Readonly<{
    readonly web_search: "google_search";
    readonly web_search_by_domain: "google_serp_web";
    readonly search_by_url: "google_search_url";
    readonly ai_mode: "google_ai_mode";
    readonly hotels: "google_serp_hotels";
    readonly jobs: "google_serp_jobs";
    readonly videos: "google_serp_videos";
    readonly shopping: "google_shopping_keywords";
    readonly maps_by_location: "google_map-details_location";
    readonly maps_by_place_id: "google_map-details_placeid";
    readonly maps_by_cid: "google_map-details_cid";
    readonly maps_by_url: "google_map-details_url";
    readonly maps_reviews_by_url: "google_comment_url";
}>;
export type GoogleOperation = keyof typeof GOOGLE_OPERATIONS;
/** Google's declarative platform-scraper config — the factory's sole input for this tool. */
export declare const GOOGLE_SCRAPER_CONFIG: PlatformScraperConfig<GoogleOperation>;
/** The materialized Google platform-scraper tool (definition + registry entry + handler). */
export declare const GOOGLE_SCRAPER_TOOL: {
    toolDefinition: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: {
            readOnlyHint: boolean;
            idempotentHint: boolean;
            destructiveHint: boolean;
            openWorldHint: boolean;
        };
    };
    registryEntry: import("./registry.js").ToolMeta;
    ParamsSchema: z.ZodObject<{
        operation: z.ZodEnum<{
            web_search: "web_search";
            web_search_by_domain: "web_search_by_domain";
            search_by_url: "search_by_url";
            ai_mode: "ai_mode";
            hotels: "hotels";
            jobs: "jobs";
            videos: "videos";
            shopping: "shopping";
            maps_by_location: "maps_by_location";
            maps_by_place_id: "maps_by_place_id";
            maps_by_cid: "maps_by_cid";
            maps_by_url: "maps_by_url";
            maps_reviews_by_url: "maps_reviews_by_url";
        }>;
        params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        limit: z.ZodDefault<z.ZodNumber>;
        format: z.ZodDefault<z.ZodEnum<{
            json: "json";
            html: "html";
            markdown: "markdown";
            csv: "csv";
            excel: "excel";
            toon: "toon";
        }>>;
        task_id: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    validateParams: (args: Record<string, unknown> | undefined) => {
        operation: "web_search" | "web_search_by_domain" | "search_by_url" | "ai_mode" | "hotels" | "jobs" | "videos" | "shopping" | "maps_by_location" | "maps_by_place_id" | "maps_by_cid" | "maps_by_url" | "maps_reviews_by_url";
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    };
    handler: (params: {
        operation: "web_search" | "web_search_by_domain" | "search_by_url" | "ai_mode" | "hotels" | "jobs" | "videos" | "shopping" | "maps_by_location" | "maps_by_place_id" | "maps_by_cid" | "maps_by_url" | "maps_reviews_by_url";
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    }, apiKey: string) => Promise<string>;
    config: PlatformScraperConfig<"web_search" | "web_search_by_domain" | "search_by_url" | "ai_mode" | "hotels" | "jobs" | "videos" | "shopping" | "maps_by_location" | "maps_by_place_id" | "maps_by_cid" | "maps_by_url" | "maps_reviews_by_url">;
};
export declare const ScrapeGoogleParamsSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        web_search: "web_search";
        web_search_by_domain: "web_search_by_domain";
        search_by_url: "search_by_url";
        ai_mode: "ai_mode";
        hotels: "hotels";
        jobs: "jobs";
        videos: "videos";
        shopping: "shopping";
        maps_by_location: "maps_by_location";
        maps_by_place_id: "maps_by_place_id";
        maps_by_cid: "maps_by_cid";
        maps_by_url: "maps_by_url";
        maps_reviews_by_url: "maps_reviews_by_url";
    }>;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    limit: z.ZodDefault<z.ZodNumber>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        html: "html";
        markdown: "markdown";
        csv: "csv";
        excel: "excel";
        toon: "toon";
    }>>;
    task_id: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ScrapeGoogleParams = z.infer<typeof ScrapeGoogleParamsSchema>;
export declare function validateScrapeGoogleParams(args: Record<string, unknown> | undefined): ScrapeGoogleParams;
/**
 * novada_scrape_google — a thin, Google-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "google.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export declare function novadaScrapeGoogle(params: ScrapeGoogleParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scrape_google.d.ts.map