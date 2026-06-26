import type { Page } from "playwright-core";
/**
 * Strip credentials from WSS URLs in error messages.
 * wss://user:pass@host → wss://***:***@host
 */
export declare function sanitizeBrowserError(msg: string): string;
/** Get existing session page or return null if expired/missing */
export declare function getSession(sessionId: string): Page | null;
/** Store a page (and optionally its browser + context) under a session ID */
export declare function storeSession(sessionId: string, page: Page, browser?: import("playwright-core").Browser, context?: import("playwright-core").BrowserContext): void;
/** Close and remove a session, tearing down page, context, and browser */
export declare function closeSession(sessionId: string): Promise<boolean>;
/** List all active (non-expired) session IDs, cleaning up expired ones */
export declare function listSessions(): string[];
/** Check if Browser API credentials are available */
export declare function isBrowserConfigured(): boolean;
/**
 * Fetch a URL using Novada Browser API via CDP WebSocket.
 * Connects to Novada's cloud browser, navigates to URL, returns rendered HTML.
 *
 * Requires: NOVADA_BROWSER_WS env var (or SDK-scoped browserWs credential).
 * Cost: ~$3/GB. Use only when static/render modes fail.
 *
 * @param sessionId - Optional session ID to reuse an existing browser page.
 */
export declare function fetchViaBrowser(url: string, options?: {
    timeout?: number;
    waitForSelector?: string;
    sessionId?: string;
    wait_ms?: number;
}): Promise<string>;
//# sourceMappingURL=browser.d.ts.map