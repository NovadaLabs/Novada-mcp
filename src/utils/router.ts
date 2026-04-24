import { fetchViaProxy, fetchWithRender, detectJsHeavyContent, detectBotChallenge } from "./http.js";
import { fetchViaBrowser, isBrowserConfigured } from "./browser.js";
import { isPdfResponse, extractPdf } from "./pdf.js";

/**
 * Normalize axios response data to a string.
 * Axios auto-parses JSON responses to objects — this converts them back to text
 * so callers that expect HTML/text still receive a string.
 * Binary/Buffer responses are rejected (not useful for content extraction).
 */
function normalizeToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (data === null || data === undefined) return "";
  if (Buffer.isBuffer(data)) {
    throw new Error("Response is binary data (Buffer). The URL may return an image, PDF, or other binary file — not supported for content extraction.");
  }
  if (typeof data === "object") {
    // JSON response — stringify so agents can read and parse it
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

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
    country?: string;
  } = {}
): Promise<RouteResult> {
  const renderMode = options.render ?? "auto";
  const timeout = options.timeout ?? 30000;
  const country = options.country;

  // Force browser mode
  if (renderMode === "browser") {
    const html = await fetchViaBrowser(url, { timeout, waitForSelector: options.waitForSelector });
    return { html, mode: "browser", cost: "high" };
  }

  // Force render mode (Web Unblocker)
  if (renderMode === "render") {
    const response = await fetchWithRender(url, options.apiKey, { country });
    const contentType = String((response.headers as Record<string, string>)?.["content-type"] ?? "");
    if (isPdfResponse(url, contentType)) {
      const pdfBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data as string, "binary");
      const pdf = await extractPdf(pdfBuffer);
      return {
        html: `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`,
        mode: "render" as UsedMode,
        cost: "medium" as CostTier,
      };
    }
    return { html: normalizeToString(response.data), mode: "render", cost: "medium" };
  }

  // Static mode — no escalation
  if (renderMode === "static") {
    const response = await fetchViaProxy(url, options.apiKey);
    const contentType = String((response.headers as Record<string, string>)?.["content-type"] ?? "");
    if (isPdfResponse(url, contentType)) {
      const pdfBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data as string, "binary");
      const pdf = await extractPdf(pdfBuffer);
      return {
        html: `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`,
        mode: "static" as UsedMode,
        cost: "low" as CostTier,
      };
    }
    return { html: normalizeToString(response.data), mode: "static", cost: "low" };
  }

  // Auto mode: static -> render -> browser
  const response = await fetchViaProxy(url, options.apiKey);
  // Check for PDF before attempting HTML processing
  const autoContentType = String((response.headers as Record<string, string>)?.["content-type"] ?? "");
  if (isPdfResponse(url, autoContentType)) {
    const pdfBuffer = Buffer.isBuffer(response.data)
      ? response.data
      : Buffer.from(response.data as string, "binary");
    const pdf = await extractPdf(pdfBuffer);
    return {
      html: `pdf_pages:${pdf.pages}\n${pdf.title ? `title: ${pdf.title}\n` : ""}${pdf.text}`,
      mode: "static" as UsedMode,
      cost: "low" as CostTier,
    };
  }
  let html = normalizeToString(response.data);

  if (!detectJsHeavyContent(html) && !detectBotChallenge(html)) {
    return { html, mode: "static", cost: "low" };
  }

  // Static returned JS-heavy or bot-challenge content — escalate to render
  try {
    const renderResponse = await fetchWithRender(url, options.apiKey, { country });
    const renderHtml = String(renderResponse.data);
    // If render returned a bot challenge page, escalate to browser or fail
    if (detectBotChallenge(renderHtml)) {
      if (isBrowserConfigured()) {
        const browserHtml = await fetchViaBrowser(url, { timeout, waitForSelector: options.waitForSelector });
        return { html: browserHtml, mode: "browser", cost: "high" };
      }
      return { html, mode: "render-failed", cost: "low" };
    }
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
