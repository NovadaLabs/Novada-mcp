import type { NovadaClientConfig, SearchResult, ExtractResult, CrawlPage, ResearchResult, MapResult, ProxyConfig, ScrapeResult, VerifyResult } from "./types.js";
/**
 * NovadaClient — TypeScript SDK for Novada web intelligence APIs.
 *
 * Install: npm install novada
 * Import:  import { NovadaClient } from 'novada/sdk'
 */
export declare class NovadaClient {
    private config;
    private toolCreds;
    constructor(config: NovadaClientConfig);
    /** Search the web. Returns typed array of results. */
    search(query: string, options?: {
        engine?: "google" | "bing" | "duckduckgo";
        num?: number;
        country?: string;
        timeRange?: "day" | "week" | "month" | "year";
    }): Promise<SearchResult[]>;
    /** Extract content from a URL. Returns typed ExtractResult. */
    extract(url: string, options?: {
        format?: "text" | "markdown" | "html";
        query?: string;
        render?: "auto" | "static" | "render" | "browser";
    }): Promise<ExtractResult>;
    /** Extract multiple URLs in parallel. Max 10 URLs per call. Throws if limit exceeded. */
    batchExtract(urls: string[], options?: {
        format?: "text" | "markdown" | "html";
        query?: string;
    }): Promise<ExtractResult[]>;
    /** Crawl a website and return typed page array. */
    crawl(url: string, options?: {
        maxPages?: number;
        strategy?: "bfs" | "dfs";
        render?: "auto" | "static" | "render";
    }): Promise<CrawlPage[]>;
    /** Multi-step research. Returns structured report. */
    research(question: string, options?: {
        depth?: "quick" | "deep" | "auto" | "comprehensive";
        focus?: string;
    }): Promise<ResearchResult>;
    /** Discover all URLs on a website. */
    map(url: string, options?: {
        search?: string;
        limit?: number;
        maxDepth?: number;
    }): Promise<MapResult>;
    /**
     * Scrape structured data from 13 supported platforms.
     * Returns raw records array plus the formatted string output.
     */
    scrape(platform: string, operation: string, params?: Record<string, unknown>, options?: {
        format?: "markdown" | "json" | "csv" | "html" | "xlsx";
        limit?: number;
    }): Promise<ScrapeResult>;
    /** Verify a factual claim against live web sources. Returns verdict + confidence. */
    verify(claim: string, context?: string): Promise<VerifyResult>;
    /** Get proxy configuration for use in HTTP clients. Throws if proxy not configured. */
    proxy(options?: {
        type?: "residential" | "mobile" | "isp" | "datacenter";
        country?: string;
        sessionId?: string;
    }): ProxyConfig;
}
export type { NovadaClientConfig, SearchResult, ExtractResult, CrawlPage, ResearchResult, MapResult, ProxyConfig, ScrapeResult, VerifyResult, } from "./types.js";
//# sourceMappingURL=index.d.ts.map