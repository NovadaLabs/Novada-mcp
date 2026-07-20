import type { z } from "zod";
import { type PlatformScraperConfig } from "./platform_scraper.js";
export declare const AMAZON_OPERATIONS: Readonly<{
    readonly product_by_asin: "amazon_product_asin";
    readonly product_by_url: "amazon_product_url";
    readonly products_by_keywords: "amazon_product_keywords";
    readonly bestsellers: "amazon_product_best-sellers";
    readonly reviews_by_url: "amazon_comment_url";
    readonly seller_by_url: "amazon_seller_url";
    readonly listings_by_keyword: "amazon_product-list_keywords-domain";
    readonly global_product_by_url: "amazon_global-product_url";
    readonly global_product_by_category_url: "amazon_global-product_category-url";
    readonly global_product_by_keyword_and_brand: "amazon_global-product_keywords-brand";
}>;
export type AmazonOperation = keyof typeof AMAZON_OPERATIONS;
/** Amazon's declarative platform-scraper config — the factory's sole input for this tool. */
export declare const AMAZON_SCRAPER_CONFIG: PlatformScraperConfig<AmazonOperation>;
/** The materialized Amazon platform-scraper tool (definition + registry entry + handler). */
export declare const AMAZON_SCRAPER_TOOL: {
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
            product_by_url: "product_by_url";
            product_by_asin: "product_by_asin";
            products_by_keywords: "products_by_keywords";
            bestsellers: "bestsellers";
            reviews_by_url: "reviews_by_url";
            seller_by_url: "seller_by_url";
            listings_by_keyword: "listings_by_keyword";
            global_product_by_url: "global_product_by_url";
            global_product_by_category_url: "global_product_by_category_url";
            global_product_by_keyword_and_brand: "global_product_by_keyword_and_brand";
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
        operation: "product_by_url" | "product_by_asin" | "products_by_keywords" | "bestsellers" | "reviews_by_url" | "seller_by_url" | "listings_by_keyword" | "global_product_by_url" | "global_product_by_category_url" | "global_product_by_keyword_and_brand";
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    };
    handler: (params: {
        operation: "product_by_url" | "product_by_asin" | "products_by_keywords" | "bestsellers" | "reviews_by_url" | "seller_by_url" | "listings_by_keyword" | "global_product_by_url" | "global_product_by_category_url" | "global_product_by_keyword_and_brand";
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    }, apiKey: string) => Promise<string>;
    config: PlatformScraperConfig<"product_by_url" | "product_by_asin" | "products_by_keywords" | "bestsellers" | "reviews_by_url" | "seller_by_url" | "listings_by_keyword" | "global_product_by_url" | "global_product_by_category_url" | "global_product_by_keyword_and_brand">;
};
export declare const ScrapeAmazonParamsSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        product_by_url: "product_by_url";
        product_by_asin: "product_by_asin";
        products_by_keywords: "products_by_keywords";
        bestsellers: "bestsellers";
        reviews_by_url: "reviews_by_url";
        seller_by_url: "seller_by_url";
        listings_by_keyword: "listings_by_keyword";
        global_product_by_url: "global_product_by_url";
        global_product_by_category_url: "global_product_by_category_url";
        global_product_by_keyword_and_brand: "global_product_by_keyword_and_brand";
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
export type ScrapeAmazonParams = z.infer<typeof ScrapeAmazonParamsSchema>;
export declare function validateScrapeAmazonParams(args: Record<string, unknown> | undefined): ScrapeAmazonParams;
/**
 * novada_scrape_amazon — a thin, Amazon-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "amazon.com", and delegates everything else — the HTTP call, polling, output
 * rendering, price/availability normalization, and error classification — to
 * novadaScrape. No HTTP/FormData logic is duplicated here.
 */
export declare function novadaScrapeAmazon(params: ScrapeAmazonParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scrape_amazon.d.ts.map