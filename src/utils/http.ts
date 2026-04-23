import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { SCRAPER_API_BASE, WEB_UNBLOCKER_BASE, JS_DETECTION_THRESHOLD } from "../config.js";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/** HTTP GET with exponential backoff retry on 429/503/network errors */
export async function fetchWithRetry(
  url: string,
  options: Partial<AxiosRequestConfig> = {},
  retries: number = MAX_RETRIES
): Promise<AxiosResponse> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 30000,
        maxRedirects: 5,
        ...options,
      });
    } catch (error) {
      if (attempt === retries) throw error;
      const isRetryable =
        error instanceof AxiosError &&
        (error.response?.status === 429 ||
          error.response?.status === 503 ||
          !error.response);
      if (!isRetryable) throw error;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed after ${retries + 1} attempts: ${url}`);
}

/**
 * Fetch a URL through Novada Scraper API (generic web fetch, no JS rendering).
 * Endpoint: scraper.novada.com — uses NOVADA_API_KEY.
 */
// Session-level circuit breaker: skip Scraper API proxy once we know it's unavailable
let scraperProxyAvailable: boolean | null = null;

export async function fetchViaProxy(
  url: string,
  apiKey: string | undefined,
  options: Partial<AxiosRequestConfig> = {}
): Promise<AxiosResponse> {
  if (apiKey && scraperProxyAvailable !== false) {
    const proxyParams = new URLSearchParams({ api_key: apiKey, url });
    const proxyUrl = `${SCRAPER_API_BASE}?${proxyParams.toString()}`;

    if (scraperProxyAvailable === true) {
      // Known-good: use proxy directly
      return fetchWithRetry(proxyUrl, { headers: { "User-Agent": USER_AGENT }, timeout: 45000, ...options });
    }

    // Unknown state: race proxy vs direct fetch — take the first successful response
    const proxyFetch = fetchWithRetry(proxyUrl, { headers: { "User-Agent": USER_AGENT }, timeout: 45000, ...options })
      .then(r => { scraperProxyAvailable = true; return r; })
      .catch((error: unknown) => {
        if (error instanceof AxiosError && (error.response?.status === 401 || error.response?.status === 403)) {
          throw error; // Auth failure — surface it, don't fall back
        }
        scraperProxyAvailable = false;
        return null;
      });

    const directFetch = fetchWithRetry(url, options);

    // Await both; return proxy result if it succeeded, otherwise direct
    const [proxyResult, directResult] = await Promise.all([proxyFetch, directFetch]);
    return (proxyResult ?? directResult) as AxiosResponse;
  }
  return fetchWithRetry(url, options);
}

/**
 * Fetch a URL through Novada Web Unblocker (JS rendering, anti-bot bypass).
 * Endpoint: webunlocker.novada.com — uses NOVADA_WEB_UNBLOCKER_KEY (separate from scraper key).
 * Falls back to fetchViaProxy if web unblocker key is not configured.
 */
export async function fetchWithRender(
  url: string,
  scraperApiKey: string | undefined,
  options: Partial<AxiosRequestConfig> = {}
): Promise<AxiosResponse> {
  const unblockerKey = process.env.NOVADA_WEB_UNBLOCKER_KEY;

  if (unblockerKey) {
    try {
      const resp = await axios.post(
        `${WEB_UNBLOCKER_BASE}/request`,
        { target_url: url, response_format: "html", js_render: true, country: "" },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${unblockerKey}`,
          },
          timeout: 60000,
          ...options,
        }
      );
      // Response format: { code: 0, data: { code: 200, html: "...", msg, msg_detail } }
      if (resp.data?.code === 0 && resp.data?.data?.html) {
        return { ...resp, data: resp.data.data.html };
      }
      if (resp.data?.code !== 0) {
        throw new Error(`Web Unblocker error: ${resp.data?.msg ?? "unknown"}`);
      }
      return resp;
    } catch (error) {
      if (
        error instanceof AxiosError &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        throw error;
      }
    }
  }

  // Fallback: scraper API without render (best effort)
  return fetchViaProxy(url, scraperApiKey, options);
}

/** Detect if fetched HTML is a JS-required page (empty shell, Cloudflare, etc.) */
export function detectJsHeavyContent(html: string): boolean {
  if (!html || html.length < JS_DETECTION_THRESHOLD) return true;

  const lower = html.toLowerCase();
  const jsSignals = [
    "enable javascript",
    "please enable js",
    "javascript is required",
    "javascript must be enabled",
    "just a moment",
    "checking your browser",
    "ddos-guard",
    "ray id",
    "cf-browser-verification",
    "__cf_chl",
    "loading...</p>",
    'id="root"></div>',
    'id="app"></div>',
  ];

  return jsSignals.some(signal => lower.includes(signal));
}

/**
 * Detect if a rendered response is a bot challenge page (not real content).
 * This is different from JS-heavy: challenge pages may look like "complete" HTML
 * but contain only a verification loop, not actual content.
 */
export function detectBotChallenge(html: string): boolean {
  if (!html) return false;

  const lower = html.toLowerCase();
  let signals = 0;

  // --- Known challenge strings (each counts as 1 definitive signal) ---
  const knownChallengeStrings = [
    "just a moment",
    "cf-browser-verification",
    "__cf_chl_opt",
    "ray id",
    "checking your browser",
    "_abck",
    "bm_sz",
    "ak_bmsc",
    "incap_ses",
    "_incap_",
    "please wait while we verify",
    "human verification",
    "access denied",
  ];

  for (const signal of knownChallengeStrings) {
    if (lower.includes(signal)) {
      // A single known challenge string is sufficient to declare a challenge
      return true;
    }
  }

  // --- Heuristic signals (need 2+ to trigger) ---

  // Body text length < 1500 chars after stripping scripts/styles
  const bodyTextLen = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  if (bodyTextLen < 1500) signals++;

  // Blank or missing title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : "";
  if (!titleText) signals++;

  // Body contains only a single small <div> with no real content
  const divCount = (html.match(/<div[\s\S]*?>/gi) ?? []).length;
  const pCount = (html.match(/<p[\b\s>]/gi) ?? []).length;
  if (divCount < 3 && pCount === 0) signals++;

  return signals >= 2;
}
