import { AxiosRequestConfig, AxiosResponse } from "axios";
/**
 * Internal extension of AxiosRequestConfig carrying the MCP-specific options that
 * the fetch helpers consume but axios must never see (`tool` for telemetry/logging;
 * `__noLog` to suppress duplicate request-log lines when a public helper delegates
 * to fetchWithRetry internally). Stripped before any axios call.
 */
type FetchExtras = {
    tool?: string;
    __noLog?: boolean;
};
/** @deprecated Use getRandomUA() for content fetches. Kept for interface compatibility. */
export declare const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/** HTTP GET with exponential backoff retry on 429/503/network errors */
export declare function fetchWithRetry(url: string, options?: Partial<AxiosRequestConfig> & FetchExtras, retries?: number): Promise<AxiosResponse>;
export declare function fetchViaProxy(url: string, _apiKey: string | undefined, options?: Partial<AxiosRequestConfig> & {
    proxyTier?: "residential" | "datacenter";
} & FetchExtras): Promise<AxiosResponse>;
/**
 * Fetch a URL through Novada Web Unblocker (JS rendering, anti-bot bypass).
 * Endpoint: webunlocker.novada.com — uses NOVADA_WEB_UNBLOCKER_KEY (separate from scraper key).
 * Falls back to fetchViaProxy if web unblocker key is not configured.
 */
export declare function fetchWithRender(url: string, scraperApiKey: string | undefined, options?: Partial<AxiosRequestConfig> & {
    country?: string;
    proxyTier?: "residential" | "datacenter";
} & FetchExtras): Promise<AxiosResponse>;
/** Detect if fetched HTML is a JS-required page (empty shell, Cloudflare, etc.) */
export declare function detectJsHeavyContent(html: string): boolean;
/**
 * Detect if a rendered response is a bot challenge page (not real content).
 * This is different from JS-heavy: challenge pages may look like "complete" HTML
 * but contain only a verification loop, not actual content.
 */
export declare function detectBotChallenge(html: string): boolean;
/**
 * Identify which anti-bot provider is active in a page's HTML.
 * Returns a human-readable provider name, or null if none detected.
 * Unlike detectBotChallenge (boolean gate), this pinpoints the specific provider
 * for diagnostic output and escalation metadata.
 */
export declare function identifyAntiBot(html: string): string | null;
export {};
//# sourceMappingURL=http.d.ts.map