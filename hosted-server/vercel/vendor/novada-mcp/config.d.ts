export declare const VERSION: string;
export declare const SCRAPER_API_BASE = "https://scraper.novada.com";
export declare const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";
export declare const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";
/**
 * True on serverless hosts (Vercel / AWS Lambda) that cannot hold a persistent
 * WebSocket. The Browser API is CDP-over-WebSocket, so `render="browser"` can
 * never run there — callers use this to fail fast with a clear error and to keep
 * `render="auto"` from escalating into an impossible tier. (health.ts /
 * health_all.ts carry local copies; dedupe to this in a follow-up.)
 */
export declare function isHostedEnvironment(): boolean;
export declare const BROWSER_WS_ENDPOINT: string | undefined;
export declare const PROXY_USER: string | undefined;
export declare const PROXY_PASS: string | undefined;
export declare const PROXY_ENDPOINT: string | undefined;
export declare const JS_DETECTION_THRESHOLD = 200;
export declare const HOSTED_FUNCTION_LIMIT_MS = 60000;
export declare const HOSTED_SAFE_CEILING_MS = 50000;
export declare const TIMEOUTS: {
    readonly STATIC_FETCH: 15000;
    readonly PROXY_FETCH: 45000;
    readonly RENDER: 48000;
    readonly BROWSER_CONNECT: 10000;
    readonly BROWSER_PAGE: 30000;
    readonly SITEMAP: 8000;
    readonly CRAWL_STATIC: 15000;
    readonly CRAWL_RENDER: 48000;
    readonly TOTAL_REQUEST_CEILING: 50000;
    readonly SEARCH_SUBMIT_TIMEOUT: 25000;
    readonly SEARCH_POLL_TIMEOUT: 45000;
    readonly SEARCH_TOTAL_CEILING: 50000;
};
export declare const EXCEL_MAX_SHEET_NAME = 31;
//# sourceMappingURL=config.d.ts.map