import type { Page } from "playwright-core";
import { TIMEOUTS } from "../config.js";
import { getBrowserWs, resolveBrowserWs } from "./credentials.js";
import { assertUrlSafe, isUrlSafe } from "./ssrf.js";

/**
 * Strip credentials from WSS URLs in error messages.
 * wss://user:pass@host → wss://***:***@host
 */
export function sanitizeBrowserError(msg: string): string {
  return msg.replace(/wss:\/\/[^:]+:[^@]+@/g, "wss://***:***@");
}

// ─── Session Management ────────────────────────────────────────────────────

interface SessionEntry {
  page: Page;
  browser?: import("playwright-core").Browser;
  context?: import("playwright-core").BrowserContext;
  createdAt: number;
  lastUsed: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes idle timeout

/**
 * Module-level session store. Scoped to the process (single-tenant MCP server use).
 * In multi-tenant SDK use, callers should use unique session_id values per client
 * (e.g., prefix with a client identifier) to prevent cross-client session access.
 */
const activeSessions = new Map<string, SessionEntry>();

/** Get existing session page or return null if expired/missing */
export function getSession(sessionId: string): Page | null {
  const entry = activeSessions.get(sessionId);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.lastUsed > SESSION_TTL_MS) {
    // TTL expired — clean up
    activeSessions.delete(sessionId);
    entry.page.close().catch(() => {});
    if (entry.context) entry.context.close().catch(() => {});
    if (entry.browser) entry.browser.close().catch(() => {});
    return null;
  }
  entry.lastUsed = now;
  return entry.page;
}

/** Store a page (and optionally its browser + context) under a session ID */
export function storeSession(
  sessionId: string,
  page: Page,
  browser?: import("playwright-core").Browser,
  context?: import("playwright-core").BrowserContext
): void {
  activeSessions.set(sessionId, { page, browser, context, createdAt: Date.now(), lastUsed: Date.now() });
}

/** Close and remove a session, tearing down page, context, and browser */
export async function closeSession(sessionId: string): Promise<boolean> {
  const entry = activeSessions.get(sessionId);
  if (!entry) return false;
  activeSessions.delete(sessionId);
  await entry.page.close().catch(() => {});
  if (entry.context) await entry.context.close().catch(() => {});
  if (entry.browser) await entry.browser.close().catch(() => {});
  return true;
}

/** List all active (non-expired) session IDs, cleaning up expired ones */
export function listSessions(): string[] {
  const now = Date.now();
  const active: string[] = [];
  for (const [id, entry] of activeSessions.entries()) {
    if (now - entry.lastUsed <= SESSION_TTL_MS) {
      active.push(id);
    } else {
      activeSessions.delete(id);
      entry.page.close().catch(() => {});
      if (entry.context) entry.context.close().catch(() => {});
      if (entry.browser) entry.browser.close().catch(() => {});
    }
  }
  return active;
}

// ─── Browser API ───────────────────────────────────────────────────────────

/** Check if Browser API credentials are available */
export function isBrowserConfigured(): boolean {
  return !!getBrowserWs();
}

/**
 * Post-navigation SSRF check. `page.goto` follows 3xx redirects internally and
 * Playwright/CDP exposes no `beforeRedirect` hook, so a public URL can land on a
 * private host (e.g. 30x → http://169.254.169.254/). Re-validate the final
 * `page.url()` and throw before any content is read.
 */
function assertLandingSafe(page: Page): void {
  const landed = page.url();
  if (landed && !isUrlSafe(landed)) {
    assertUrlSafe(landed, "browser redirect landing");
  }
}

/**
 * Fetch a URL using Novada Browser API via CDP WebSocket.
 * Connects to Novada's cloud browser, navigates to URL, returns rendered HTML.
 *
 * Requires: NOVADA_BROWSER_WS env var (or SDK-scoped browserWs credential).
 * Cost: ~$3/GB. Use only when static/render modes fail.
 *
 * Performance: Callers making repeated requests to the same domain should pass
 * `sessionId` to reuse the browser page (~1.5s warm vs ~8s cold start).
 *
 * @param sessionId - Optional session ID to reuse an existing browser page.
 */
export async function fetchViaBrowser(
  url: string,
  options: { timeout?: number; waitForSelector?: string; sessionId?: string; wait_ms?: number } = {}
): Promise<string> {
  // SSRF chokepoint: the CDP fetch path never passed through http.ts's assertUrlSafe,
  // and the enrich_top/render="browser" paths can feed it a non-Zod-validated URL
  // (scraped SERP result, or a forced browser mode). Validate before any page.goto.
  assertUrlSafe(url, "browser navigate");

  // Auto-resolve: NOVADA_BROWSER_WS env var OR auto-provision via NOVADA_API_KEY (product=10)
  const wsEndpoint = await resolveBrowserWs(process.env.NOVADA_API_KEY);
  if (!wsEndpoint) {
    throw new Error(
      "Browser API not available. Set NOVADA_BROWSER_WS or ensure your NOVADA_API_KEY has Browser API access (product=10)."
    );
  }

  const timeout = options.timeout ?? TIMEOUTS.BROWSER_PAGE;

  // If a session ID is provided, try to reuse existing page
  if (options.sessionId) {
    const existingPage = getSession(options.sessionId);
    if (existingPage) {
      await existingPage.goto(url, { waitUntil: "domcontentloaded", timeout });
      assertLandingSafe(existingPage);
      if (options.waitForSelector) {
        await existingPage.waitForSelector(options.waitForSelector, { timeout: 15000 }).catch(() => {});
      }
      if (options.wait_ms !== undefined && options.wait_ms >= 0) {
        await existingPage.waitForTimeout(options.wait_ms);
      }
      return existingPage.content();
    }
  }

  // NOV-577 cold-start: playwright-core is heavy and only needed when the Browser API path runs.
  // Load chromium lazily here so importing this module (pulled in eagerly via the utils barrel)
  // doesn't pay the dep cost on every process start — only on an actual browser fetch.
  const { chromium } = await import("playwright-core");

  let browser;
  try {
    // Race connection against a timeout — connectOverCDP hangs indefinitely on dead endpoints.
    // NOV-577 review: a naked setTimeout-reject inside Promise.race leaks a pending timer that
    // rejects ~BROWSER_CONNECT ms after a *successful* connect, surfacing as an unhandledRejection.
    // Hold the timer id and clear it in finally so it can never reject an already-settled race.
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      browser = await Promise.race([
        chromium.connectOverCDP(wsEndpoint),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(() => reject(new Error(
            `Browser API connection failed. ` +
            `agent_instruction: Credentials may be expired or a previous session is blocking new connections (Novada allows one active session per account). ` +
            `Refresh credentials at dashboard.novada.com/overview/browser/ and update NOVADA_BROWSER_WS env var. ` +
            `Alternatively, use render="render" mode in novada_extract for JS rendering without browser automation.`
          )), TIMEOUTS.BROWSER_CONNECT);
        }),
      ]);
    } finally {
      clearTimeout(connectTimer);
    }
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = { runtime: {}, loadTimes: () => ({}) };
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
    assertLandingSafe(page);

    // Wait for DOM ready + fixed 2s for JS to render initial content
    // (networkidle never fires on SPAs — saves ~5s on JS-heavy pages)
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Check for Cloudflare challenge and wait it out
    const bodyText = await page.content().catch(() => '');
    if (
      bodyText.includes('cf-challenge') ||
      bodyText.includes('cf-turnstile') ||
      bodyText.includes('Just a moment') ||
      bodyText.includes('cf_chl_opt')
    ) {
      // Smart CF wait: poll until challenge resolves (usually 2-3s, max 8s)
      await page.waitForFunction(() => {
        return !document.body.innerText.includes('Just a moment') &&
               !document.querySelector('#cf-challenge-running');
      }, { timeout: 8000 }).catch(() => {
        // Fallback: wait 3s if waitForFunction fails
        return page.waitForTimeout(3000);
      });
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
  } catch (err) {
    // P0 SECURITY: strip WSS credentials from any playwright error message
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(sanitizeBrowserError(msg));
  } finally {
    if (browser && !options.sessionId) {
      await browser.close();
    }
  }
}
