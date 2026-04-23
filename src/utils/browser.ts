import { chromium } from "playwright-core";

/** Check if Browser API credentials are available */
export function isBrowserConfigured(): boolean {
  return !!process.env.NOVADA_BROWSER_WS;
}

/**
 * Fetch a URL using Novada Browser API via CDP WebSocket.
 * Connects to Novada's cloud browser, navigates to URL, returns rendered HTML.
 *
 * Requires: NOVADA_BROWSER_WS env var.
 * Cost: ~$3/GB. Use only when static/render modes fail.
 */
export async function fetchViaBrowser(
  url: string,
  options: { timeout?: number; waitForSelector?: string } = {}
): Promise<string> {
  const wsEndpoint = process.env.NOVADA_BROWSER_WS;
  if (!wsEndpoint) {
    throw new Error(
      "NOVADA_BROWSER_WS not configured. Set it to wss://user:pass@upg-scbr.novada.com to enable Browser API."
    );
  }

  const timeout = options.timeout ?? 30000;
  let browser;

  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

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
    await context.close();
    return html;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
