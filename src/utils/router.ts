import { fetchViaProxy, fetchWithRender, detectJsHeavyContent } from "./http.js";
import { fetchViaBrowser, isBrowserConfigured } from "./browser.js";

export type RenderMode = "auto" | "static" | "render" | "browser";
export type UsedMode = "static" | "render" | "browser" | "render-failed";
export type CostTier = "low" | "medium" | "high";

export interface RouteResult {
  html: string;
  mode: UsedMode;
  cost: CostTier;
}

const MODE_COST: Record<UsedMode, CostTier> = {
  static: "low",
  render: "medium",
  browser: "high",
  "render-failed": "low",
};

/**
 * Smart rendering router. Fetches a URL using the cheapest viable method.
 *
 * Escalation chain (auto mode):
 *   1. Static fetch via Scraper API proxy ($0) — cheapest
 *   2. Web Unblocker with JS rendering ($0.001/req) — mid
 *   3. Browser API via CDP ($3/GB) — most expensive
 *
 * The router detects JS-heavy pages (SPAs, Cloudflare challenges) and
 * auto-escalates. Forced modes skip the chain entirely.
 */
export async function routeFetch(
  url: string,
  options: {
    render?: RenderMode;
    apiKey?: string;
    timeout?: number;
    waitForSelector?: string;
  } = {}
): Promise<RouteResult> {
  const renderMode = options.render ?? "auto";
  const timeout = options.timeout ?? 30000;

  // Force browser mode
  if (renderMode === "browser") {
    const html = await fetchViaBrowser(url, { timeout, waitForSelector: options.waitForSelector });
    return { html, mode: "browser", cost: "high" };
  }

  // Force render mode (Web Unblocker)
  if (renderMode === "render") {
    const response = await fetchWithRender(url, options.apiKey);
    if (typeof response.data !== "string") {
      throw new Error("Response is not HTML. The URL may return JSON or binary data.");
    }
    return { html: response.data, mode: "render", cost: "medium" };
  }

  // Static mode — no escalation
  if (renderMode === "static") {
    const response = await fetchViaProxy(url, options.apiKey);
    if (typeof response.data !== "string") {
      throw new Error("Response is not HTML. The URL may return JSON or binary data.");
    }
    return { html: response.data, mode: "static", cost: "low" };
  }

  // Auto mode: static -> render -> browser
  const response = await fetchViaProxy(url, options.apiKey);
  if (typeof response.data !== "string") {
    throw new Error("Response is not HTML. The URL may return JSON or binary data.");
  }
  let html = response.data;

  if (!detectJsHeavyContent(html)) {
    return { html, mode: "static", cost: "low" };
  }

  // Static returned JS-heavy content — escalate to render
  try {
    const renderResponse = await fetchWithRender(url, options.apiKey);
    const renderHtml = String(renderResponse.data);
    if (!detectJsHeavyContent(renderHtml)) {
      return { html: renderHtml, mode: "render", cost: "medium" };
    }

    // Render also JS-heavy — try browser if configured
    if (isBrowserConfigured()) {
      const browserHtml = await fetchViaBrowser(url, { timeout, waitForSelector: options.waitForSelector });
      return { html: browserHtml, mode: "browser", cost: "high" };
    }

    // No browser — return render result (better than static)
    return { html: renderHtml, mode: "render", cost: "medium" };
  } catch {
    // Render failed — try browser as last resort
    if (isBrowserConfigured()) {
      const browserHtml = await fetchViaBrowser(url, { timeout, waitForSelector: options.waitForSelector });
      return { html: browserHtml, mode: "browser", cost: "high" };
    }

    // Nothing worked — return the static HTML with a flag
    return { html, mode: "render-failed", cost: "low" };
  }
}

/** Map UsedMode to its cost tier */
export function getModeCost(mode: UsedMode): CostTier {
  return MODE_COST[mode];
}
