import { chromium } from "playwright-core";
import { TIMEOUTS } from "../config.js";
import { getBrowserWs, resolveBrowserWs } from "./credentials.js";
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes idle timeout
/**
 * Module-level session store. Scoped to the process (single-tenant MCP server use).
 * In multi-tenant SDK use, callers should use unique session_id values per client
 * (e.g., prefix with a client identifier) to prevent cross-client session access.
 */
const activeSessions = new Map();
/** Get existing session page or return null if expired/missing */
export function getSession(sessionId) {
    const entry = activeSessions.get(sessionId);
    if (!entry)
        return null;
    const now = Date.now();
    if (now - entry.lastUsed > SESSION_TTL_MS) {
        // TTL expired — clean up
        activeSessions.delete(sessionId);
        entry.page.close().catch(() => { });
        if (entry.context)
            entry.context.close().catch(() => { });
        if (entry.browser)
            entry.browser.close().catch(() => { });
        return null;
    }
    entry.lastUsed = now;
    return entry.page;
}
/** Store a page (and optionally its browser + context) under a session ID */
export function storeSession(sessionId, page, browser, context) {
    activeSessions.set(sessionId, { page, browser, context, createdAt: Date.now(), lastUsed: Date.now() });
}
/** Close and remove a session, tearing down page, context, and browser */
export async function closeSession(sessionId) {
    const entry = activeSessions.get(sessionId);
    if (!entry)
        return false;
    activeSessions.delete(sessionId);
    await entry.page.close().catch(() => { });
    if (entry.context)
        await entry.context.close().catch(() => { });
    if (entry.browser)
        await entry.browser.close().catch(() => { });
    return true;
}
/** List all active (non-expired) session IDs, cleaning up expired ones */
export function listSessions() {
    const now = Date.now();
    const active = [];
    for (const [id, entry] of activeSessions.entries()) {
        if (now - entry.lastUsed <= SESSION_TTL_MS) {
            active.push(id);
        }
        else {
            activeSessions.delete(id);
            entry.page.close().catch(() => { });
            if (entry.context)
                entry.context.close().catch(() => { });
            if (entry.browser)
                entry.browser.close().catch(() => { });
        }
    }
    return active;
}
// ─── Browser API ───────────────────────────────────────────────────────────
/** Check if Browser API credentials are available */
export function isBrowserConfigured() {
    return !!getBrowserWs();
}
/**
 * Fetch a URL using Novada Browser API via CDP WebSocket.
 * Connects to Novada's cloud browser, navigates to URL, returns rendered HTML.
 *
 * Requires: NOVADA_BROWSER_WS env var (or SDK-scoped browserWs credential).
 * Cost: ~$3/GB. Use only when static/render modes fail.
 *
 * @param sessionId - Optional session ID to reuse an existing browser page.
 */
export async function fetchViaBrowser(url, options = {}) {
    // Auto-resolve: NOVADA_BROWSER_WS env var OR auto-provision via NOVADA_API_KEY (product=10)
    const wsEndpoint = await resolveBrowserWs(process.env.NOVADA_API_KEY);
    if (!wsEndpoint) {
        throw new Error("Browser API not available. Set NOVADA_BROWSER_WS or ensure your NOVADA_API_KEY has Browser API access (product=10).");
    }
    const timeout = options.timeout ?? TIMEOUTS.BROWSER_PAGE;
    // If a session ID is provided, try to reuse existing page
    if (options.sessionId) {
        const existingPage = getSession(options.sessionId);
        if (existingPage) {
            await existingPage.goto(url, { waitUntil: "domcontentloaded", timeout });
            if (options.waitForSelector) {
                await existingPage.waitForSelector(options.waitForSelector, { timeout: 15000 }).catch(() => { });
            }
            if (options.wait_ms !== undefined && options.wait_ms >= 0) {
                await existingPage.waitForTimeout(options.wait_ms);
            }
            return existingPage.content();
        }
    }
    let browser;
    try {
        // Race connection against a timeout — connectOverCDP hangs indefinitely on dead endpoints
        browser = await Promise.race([
            chromium.connectOverCDP(wsEndpoint),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Browser API connection failed. ` +
                `agent_instruction: Credentials may be expired or a previous session is blocking new connections (Novada allows one active session per account). ` +
                `Refresh credentials at dashboard.novada.com/overview/browser/ and update NOVADA_BROWSER_WS env var. ` +
                `Alternatively, use render="render" mode in novada_extract for JS rendering without browser automation.`)), TIMEOUTS.BROWSER_CONNECT)),
        ]);
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        });
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {}, loadTimes: () => ({}) };
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                ]
            });
        });
        const page = await context.newPage();
        // Store in session map if session ID provided
        if (options.sessionId) {
            storeSession(options.sessionId, page, browser, context);
        }
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout,
        });
        // Wait for networkidle, fall back to domcontentloaded on timeout
        await page.waitForLoadState('networkidle', { timeout: 12000 })
            .catch(() => page.waitForLoadState('domcontentloaded'));
        // Check for Cloudflare challenge and wait it out
        const bodyText = await page.content().catch(() => '');
        if (bodyText.includes('cf-challenge') ||
            bodyText.includes('cf-turnstile') ||
            bodyText.includes('Just a moment') ||
            bodyText.includes('cf_chl_opt')) {
            await page.waitForTimeout(6000);
            await page.waitForLoadState('domcontentloaded').catch(() => { });
        }
        if (options.waitForSelector) {
            await page.waitForSelector(options.waitForSelector, { timeout: 15000 }).catch(() => {
                // Best effort — don't fail if selector not found
            });
        }
        if (options.wait_ms !== undefined && options.wait_ms >= 0) {
            await page.waitForTimeout(options.wait_ms);
        }
        const html = await page.content();
        // Only close context/browser if not in a session (session pages stay open)
        if (!options.sessionId) {
            await context.close();
        }
        return html;
    }
    finally {
        // Only close browser if not in a named session
        if (browser && !options.sessionId) {
            await browser.close();
        }
    }
}
//# sourceMappingURL=browser.js.map