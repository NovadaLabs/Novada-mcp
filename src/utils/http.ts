import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { WEB_UNBLOCKER_BASE, JS_DETECTION_THRESHOLD, TIMEOUTS } from "../config.js";
import { getProxyCredentials, getWebUnblockerKey } from "./credentials.js";

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
        maxContentLength: 10 * 1024 * 1024, // 10MB cap — prevents OOM on huge pages
        maxBodyLength: 10 * 1024 * 1024,
        ...options,
      });
    } catch (error) {
      // Intercept 10MB cap violation and surface an actionable error
      if (error instanceof AxiosError && error.message?.toLowerCase().includes("maxcontentlength")) {
        throw new Error(
          `Response from ${url} exceeds the 10MB content limit. This is usually a binary file, a very large page, or a misconfigured server. ` +
          "Try a more specific subpage URL, or use novada_map to find the exact page you need."
        );
      }
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
 * Fetch a URL through Novada Residential Proxy (generic web fetch, no JS rendering).
 * Uses NOVADA_PROXY_USER / NOVADA_PROXY_PASS / NOVADA_PROXY_ENDPOINT env vars.
 * Falls back to direct fetch if proxy env vars are not set.
 *
 * Note: _apiKey param is kept for interface compatibility but unused.
 * For JS-rendered pages use fetchWithRender; for platform scrapers use the /request endpoint.
 */
// Session-level circuit breaker: skip proxy once we know it's unavailable this session.
// Auto-resets after PROXY_CIRCUIT_RESET_MS to recover from transient failures.
// Keyed by proxy endpoint so multiple SDK clients with different proxy credentials
// do not interfere with each other's circuit state.
interface CircuitState {
  available: boolean | null;
  disabledAt: number | null;
}
const proxyCircuits = new Map<string, CircuitState>();
const PROXY_CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 minutes

function getCircuit(endpoint: string): CircuitState {
  let state = proxyCircuits.get(endpoint);
  if (!state) {
    state = { available: null, disabledAt: null };
    proxyCircuits.set(endpoint, state);
  }
  return state;
}

export async function fetchViaProxy(
  url: string,
  _apiKey: string | undefined,
  options: Partial<AxiosRequestConfig> = {}
): Promise<AxiosResponse> {
  // Credentials: SDK-scoped (via AsyncLocalStorage) > NOVADA_PROXY_* env vars
  const proxyCreds = getProxyCredentials();
  const proxyUser = proxyCreds?.user;
  const proxyPass = proxyCreds?.pass;
  const proxyEndpoint = proxyCreds?.endpoint;

  if (proxyUser && proxyPass && proxyEndpoint) {
    const circuit = getCircuit(proxyEndpoint);

    // Auto-reset circuit breaker after TTL (recovers from transient failures)
    if (circuit.available === false && circuit.disabledAt !== null && Date.now() - circuit.disabledAt > PROXY_CIRCUIT_RESET_MS) {
      circuit.available = null;
      circuit.disabledAt = null;
    }

    if (circuit.available === false) {
      return fetchWithRetry(url, options);
    }

    const [proxyHost, proxyPortStr] = proxyEndpoint.split(":");
    const proxyPort = parseInt(proxyPortStr ?? "7777", 10);
    const proxyConfig = {
      host: proxyHost,
      port: proxyPort,
      auth: { username: proxyUser, password: proxyPass },
      protocol: "http",
    };

    if (circuit.available === true) {
      // Known-good: use proxy directly
      return fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT }, proxy: proxyConfig, timeout: TIMEOUTS.PROXY_FETCH, ...options });
    }

    // Unknown state: race proxy vs direct fetch — take the first successful response.
    // Probe proxy with 0 retries: a single failure is enough to mark circuit open and
    // fall back to direct without burning 3 retries × exponential backoff (~7s).
    const proxyProbeOptions = { headers: { "User-Agent": USER_AGENT }, proxy: proxyConfig, timeout: TIMEOUTS.PROXY_FETCH, ...options };
    const proxyFetch: Promise<AxiosResponse | null> = fetchWithRetry(url, proxyProbeOptions, 0)
      .then(r => { circuit.available = true; return r; })
      .catch((error: unknown) => {
        if (error instanceof AxiosError) {
          const status = error.response?.status;
          if (status === 407) {
            throw new Error(
              "Proxy authentication failed (HTTP 407). " +
              "Verify NOVADA_PROXY_USER and NOVADA_PROXY_PASS are correct. " +
              "Get credentials at: https://dashboard.novada.com → Residential Proxies → Endpoint Generator"
            );
          }
          if (status === 401 || status === 403) {
            throw error; // Auth failure — surface it, don't fall back
          }
        }
        circuit.available = false;
        circuit.disabledAt = Date.now();
        return null; // signal: proxy unavailable, caller will use directFetch result
      });

    const directFetch = fetchWithRetry(url, options).catch((err: unknown) => {
      throw Object.assign(
        new Error(`Direct fetch failed: ${err instanceof Error ? err.message : String(err)}. Proxy circuit: ${circuit.available === false ? "open (disabled)" : "unknown"}`),
        { cause: err }
      );
    });

    // Use Promise.any semantics: whichever non-null result arrives first wins.
    // This lets directFetch resolve immediately if proxy fails fast (e.g., parse error),
    // without waiting for proxy to finish its full timeout window.
    const result = await Promise.any([
      proxyFetch.then(r => { if (r === null) throw new Error("proxy-unavailable"); return r; }),
      directFetch,
    ]).catch(async () => {
      // Both failed — last resort: return whatever we have (proxy null + direct error surfaced)
      const [proxyResult, directResult] = await Promise.allSettled([proxyFetch, directFetch]);
      if (proxyResult.status === "fulfilled" && proxyResult.value !== null) return proxyResult.value;
      if (directResult.status === "fulfilled") return directResult.value;
      throw directResult.status === "rejected" ? directResult.reason : new Error("All fetch paths failed");
    });
    return result as AxiosResponse;
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
  options: Partial<AxiosRequestConfig> & { country?: string } = {}
): Promise<AxiosResponse> {
  const unblockerKey = getWebUnblockerKey();
  const { country, ...axiosOptions } = options;

  if (unblockerKey) {
    try {
      const resp = await axios.post(
        `${WEB_UNBLOCKER_BASE}/request`,
        { target_url: url, response_format: "html", js_render: true, country: country ?? "" },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${unblockerKey}`,
          },
          timeout: TIMEOUTS.RENDER,
          maxContentLength: 10 * 1024 * 1024, // 10MB cap — prevents OOM on huge pages
          maxBodyLength: 10 * 1024 * 1024,
          ...axiosOptions,
        }
      );
      // Response format: { code: 0, data: { code: 200, html: "...", msg, msg_detail } }
      if (resp.data?.code === 0 && resp.data?.data?.html) {
        return { ...resp, data: resp.data.data.html };
      }
      // Inner code check — outer code=0 but inner data.code indicates an error (200-always pattern)
      if (resp.data?.data?.code && resp.data.data.code !== 200) {
        throw new Error(`Web Unblocker error (${resp.data.data.code}): ${resp.data.data.msg ?? "unknown"}`);
      }
      if (resp.data?.code !== 0) {
        throw new Error(`Web Unblocker error: ${resp.data?.msg ?? "unknown"}`);
      }
      return resp;
    } catch (error) {
      // Intercept 10MB cap violation for POST path and surface an actionable error
      if (error instanceof AxiosError && error.message?.toLowerCase().includes("maxcontentlength")) {
        throw new Error(
          `Web Unblocker response from ${url} exceeds the 10MB content limit. ` +
          "The rendered page may contain large embedded assets. Try a more specific subpage URL."
        );
      }
      // Always re-throw — callers handle escalation logic and mode tracking.
      // Silently falling back to proxy would give callers a static result while
      // they believe they have a JS-rendered page (wrong mode metadata).
      throw error;
    }
  }

  // Fallback: no unblocker key configured — use proxy/direct fetch (best effort)
  return fetchViaProxy(url, scraperApiKey, axiosOptions);
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
    // Single-quote variants emitted by React, Vue, and Angular scaffolds
    "id='root'></div>",
    "id='app'></div>",
    // Angular universal / Next.js hydration targets
    'id="__next"></div>',
    "id='__next'></div>",
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
    // "access denied" removed — too broad: appears in legitimate AWS S3, CDN, and error pages.
    // Rely on stronger heuristic signals below instead.
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
