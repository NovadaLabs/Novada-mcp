export declare const VERSION: string;
export declare const SCRAPER_API_BASE = "https://scraper.novada.com";
export declare const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";
export declare const SCRAPERAPI_BASE = "https://scraperapi.novada.com";
export declare const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";
export declare const SCRAPER_STATUS_BASE = "https://api-m.novada.com/v1/scraper";
export declare const BROWSER_WS_ENDPOINT: string | undefined;
export declare const PROXY_USER: string | undefined;
export declare const PROXY_PASS: string | undefined;
export declare const PROXY_ENDPOINT: string | undefined;
export declare const JS_DETECTION_THRESHOLD = 200;
export declare const TIMEOUTS: {
    readonly STATIC_FETCH: 15000;
    readonly PROXY_FETCH: 45000;
    readonly RENDER: 60000;
    readonly BROWSER_CONNECT: 10000;
    readonly BROWSER_PAGE: 30000;
    readonly SITEMAP: 8000;
    readonly CRAWL_STATIC: 15000;
    readonly CRAWL_RENDER: 60000;
    readonly TOTAL_REQUEST_CEILING: 90000;
    readonly SEARCH_SUBMIT_TIMEOUT: 30000;
    readonly SEARCH_POLL_TIMEOUT: 60000;
    readonly SEARCH_TOTAL_CEILING: 90000;
};
export declare const EXCEL_MAX_SHEET_NAME = 31;
//# sourceMappingURL=config.d.ts.map