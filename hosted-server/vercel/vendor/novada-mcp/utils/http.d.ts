import { AxiosRequestConfig, AxiosResponse } from "axios";
/**
 * Build the x-mcp-* header set for a given calling tool. client/session are
 * process-stable; only the tool varies per call.
 */
export declare function telemetryHeaders(tool: string | undefined): Record<string, string>;
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
/**
 * Resolve the charset to decode with, from (1) Content-Type header, else
 * (2) a `<meta charset>`/`<meta http-equiv>` tag sniffed from the raw bytes,
 * else (3) "utf-8". The sniff decodes only the first `META_CHARSET_SNIFF_BYTES`
 * bytes as latin1 (1 byte → 1 code unit, so it can never corrupt the tag
 * itself) — safe because `<meta charset=...>` is pure ASCII syntax in every
 * encoding this function is ever asked to detect (Shift_JIS, GBK/GB18030,
 * EUC-KR, windows-1252 are all ASCII-compatible in their single-byte range).
 */
export declare function detectCharset(buf: Buffer, contentType: string): string;
/** Decode a buffer as windows-1252 ourselves (see WINDOWS_1252_LABELS'
 *  doc comment for why TextDecoder can't be trusted for this one family on
 *  every supported Node runtime). Every code point here fits in one UTF-16
 *  code unit (no surrogate pairs), so a plain `String.fromCharCode` per byte
 *  is correct, not just an approximation. */
export declare function decodeWindows1252(buf: Buffer): string;
/**
 * Decode raw response bytes using the detected charset. windows-1252 and
 * every label that aliases to it (WINDOWS_1252_LABELS above) are decoded by
 * decodeWindows1252, not TextDecoder — see its doc comment. Every other
 * legacy label this function can encounter in practice (shift_jis,
 * gbk/gb18030/gb2312, euc-kr, big5, etc.) goes through Node's `TextDecoder`
 * (ICU-backed; correct for these on every officially-supported Node version
 * this package targets). An unrecognized/garbled label (a lying
 * Content-Type) throws RangeError — caught here and never allowed to fail
 * the fetch; falls back to the prior, always-safe utf-8 decode instead.
 */
export declare function decodeHtmlBuffer(buf: Buffer, contentType: string): string;
/** HTTP GET with exponential backoff retry on 429/503/network errors */
export declare function fetchWithRetry(url: string, options?: Partial<AxiosRequestConfig> & FetchExtras, retries?: number): Promise<AxiosResponse>;
export declare function fetchViaProxy(url: string, apiKey: string | undefined, options?: Partial<AxiosRequestConfig> & {
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