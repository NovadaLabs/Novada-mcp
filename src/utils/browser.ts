import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import { TIMEOUTS } from "../config.js";
import { getBrowserWs } from "./credentials.js";

// ─── Session Management ────────────────────────────────────────────────────

interface SessionEntry {
  page: Page;
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
    entry.page.close().catch(() => {});
    activeSessions.delete(sessionId);
    return null;
  }
  entry.lastUsed = now;
  return entry.page;
}

/** Store a page under a session ID */
export function storeSession(sessionId: string, page: Page): void {
  activeSessions.set(sessionId, { page, createdAt: Date.now(), lastUsed: Date.now() });
}

/** Close and remove a session */
export async function closeSession(sessionId: string): Promise<boolean> {
  const entry = activeSessions.get(sessionId);
  if (!entry) return false;
  await entry.page.close().catch(() => {});
  activeSessions.delete(sessionId);
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
      entry.page.close().catch(() => {});
      activeSessions.delete(id);
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
 * Fetch a URL using Novada Browser API via CDP WebSocket.
 * Connects to Novada's cloud browser, navigates to URL, returns rendered HTML.
 *
 * Requires: NOVADA_BROWSER_WS env var (or SDK-scoped browserWs credential).
 * Cost: ~$3/GB. Use only when static/render modes fail.
 *
 * @param sessionId - Optional session ID to reuse an existing browser page.
 */
export async function fetchViaBrowser(
  url: string,
  options: { timeout?: number; waitForSelector?: string; sessionId?: string } = {}
): Promise<string> {
  const wsEndpoint = getBrowserWs();
  if (!wsEndpoint) {
    throw new Error(
      "NOVADA_BROWSER_WS not configured. Set it to wss://user:pass@upg-scbr.novada.com to enable Browser API."
    );
  }

  const timeout = options.timeout ?? TIMEOUTS.BROWSER_PAGE;

  // If a session ID is provided, try to reuse existing page
  if (options.sessionId) {
    const existingPage = getSession(options.sessionId);
    if (existingPage) {
      await existingPage.goto(url, { waitUntil: "domcontentloaded", timeout });
      if (options.waitForSelector) {
        await existingPage.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {});
      }
      return existingPage.content();
    }
  }

  let browser;
  try {
    // Race connection against a timeout — connectOverCDP hangs indefinitely on dead endpoints
    browser = await Promise.race([
      chromium.connectOverCDP(wsEndpoint),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          `Browser API connection failed. ` +
          `agent_instruction: Credentials may be expired or a previous session is blocking new connections (Novada allows one active session per account). ` +
          `Refresh credentials at dashboard.novada.com/overview/browser/ and update NOVADA_BROWSER_WS env var. ` +
          `Alternatively, use render="render" mode in novada_extract for JS rendering without browser automation.`
        )), TIMEOUTS.BROWSER_CONNECT)
      ),
    ]);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Store in session map if session ID provided
    if (options.sessionId) {
      storeSession(options.sessionId, page);
    }

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {
        // Best effort — don't fail if selector not found
      });
    }

    const html = await page.content();

    // Only close context/browser if not in a session (session pages stay open)
    if (!options.sessionId) {
      await context.close();
    }
    return html;
  } finally {
    // Only close browser if not in a named session
    if (browser && !options.sessionId) {
      await browser.close();
    }
  }
}
