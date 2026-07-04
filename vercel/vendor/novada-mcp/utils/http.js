import https from "https";
import crypto from "crypto";
import axios, { AxiosError } from "axios";
import { WEB_UNBLOCKER_BASE, JS_DETECTION_THRESHOLD, TIMEOUTS, VERSION } from "../config.js";
import { getResidentialProxyCredentials, resolveProxyCredentials, getWebUnblockerKey } from "./credentials.js";
import { assertUrlSafe, safeLookup } from "./ssrf.js";
import { logRequest } from "../_core/request-log.js";
const _sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
/**
 * NOV-321: per-request telemetry headers (`x-mcp-*`) attached to every outbound
 * Novada API request. These let the Novada backend attribute traffic to the MCP
 * server, the calling tool, and a single process/session without carrying any
 * secret or PII.
 *
 *  - x-mcp-client:  server identity + version, e.g. "novada-mcp/0.8.2".
 *  - x-mcp-session: an opaque, in-process random id, regenerated each process
 *    start. Lets the backend group a session's requests; it is NOT a user id and
 *    never leaves as anything but a random hex string.
 *  - x-mcp-tool:    the originating MCP tool ("extract", "search", …), threaded
 *    through the fetch helpers' `tool` option. Best-effort: "unknown" if a caller
 *    doesn't supply it.
 */
const MCP_CLIENT_ID = `novada-mcp/${VERSION}`;
const MCP_SESSION_ID = crypto.randomBytes(8).toString("hex");
/**
 * Build the x-mcp-* header set for a given calling tool. client/session are
 * process-stable; only the tool varies per call.
 */
function telemetryHeaders(tool) {
    return {
        "x-mcp-client": MCP_CLIENT_ID,
        "x-mcp-session": MCP_SESSION_ID,
        "x-mcp-tool": tool ?? "unknown",
    };
}
/**
 * `safeLookup` is the DNS-rebinding guard (utils/ssrf.ts). Its runtime shape matches what
 * axios calls, but axios types `family` as the literal union 4|6 whereas Node's dns types
 * it as `number`; the structural difference is purely nominal, so we cast once here and use
 * the typed alias on every request config.
 */
const SAFE_LOOKUP = safeLookup;
/**
 * axios `beforeRedirect` hook: re-validate every 3xx redirect target against the SSRF
 * blocklist. Without this, a Zod-validated public URL can 30x-redirect to
 * http://169.254.169.254/ or http://localhost/ and the request would still be issued.
 * Throwing here aborts the redirect chain. Spread into every axios config that follows
 * redirects (maxRedirects > 0).
 */
function beforeRedirect(options) {
    const target = options.href ?? `${options.protocol ?? "https:"}//${options.hostname ?? ""}`;
    assertUrlSafe(target, "redirect target");
}
const SSL_ERROR_CODES = new Set([
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "ERR_TLS_CERT_ALTNAME_INVALID",
]);
// Rotate through 3 realistic Chrome UAs to appear more human
const BROWSER_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];
function getRandomUA() {
    return BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];
}
/** @deprecated Use getRandomUA() for content fetches. Kept for interface compatibility. */
export const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
/** HTTP GET with exponential backoff retry on 429/503/network errors */
export async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    // SSRF chokepoint: every fetch (incl. runtime-discovered URLs) is re-validated here,
    // not just at the Zod boundary. beforeRedirect re-checks each 3xx hop.
    assertUrlSafe(url);
    // Strip MCP-only extras before they reach axios; keep them for telemetry/logging.
    const { tool, __noLog, ...axiosOptions } = options;
    const startMs = Date.now();
    try {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const resp = await axios.get(url, {
                    headers: {
                        "User-Agent": getRandomUA(),
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                        "Accept-Encoding": "gzip, deflate, br",
                        "Connection": "keep-alive",
                        ...telemetryHeaders(tool),
                    },
                    timeout: TIMEOUTS.STATIC_FETCH,
                    maxRedirects: 5,
                    beforeRedirect,
                    maxContentLength: 10 * 1024 * 1024, // 10MB cap — prevents OOM on huge pages
                    maxBodyLength: 10 * 1024 * 1024,
                    httpsAgent: _sharedHttpsAgent,
                    ...axiosOptions,
                    // DNS-rebinding guard: re-check the RESOLVED IP before connect. Placed after the
                    // spread so a caller option can never disable it. On proxied requests this resolves
                    // the (public) proxy host; on direct requests it resolves the real target.
                    lookup: SAFE_LOOKUP,
                });
                if (!__noLog)
                    logRequest({ tool: tool ?? "unknown", url, status: resp.status, ms: Date.now() - startMs, mode: "static" });
                return resp;
            }
            catch (error) {
                // Intercept 10MB cap violation and surface an actionable error
                if (error instanceof AxiosError && error.message?.toLowerCase().includes("maxcontentlength")) {
                    throw new Error(`Response from ${url} exceeds the 10MB content limit. This is usually a binary file, a very large page, or a misconfigured server. ` +
                        "Try a more specific subpage URL, or use novada_map to find the exact page you need.");
                }
                // SSL error: retry once ignoring certificate validation — common for small Chinese sites with expired/self-signed certs
                if (error instanceof AxiosError && SSL_ERROR_CODES.has(error.cause?.code ?? error.code ?? "")) {
                    const resp = await axios.get(url, {
                        headers: {
                            "User-Agent": getRandomUA(),
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                            "Accept-Language": "en-US,en;q=0.5",
                            "Accept-Encoding": "gzip, deflate, br",
                            "Connection": "keep-alive",
                            ...telemetryHeaders(tool),
                        },
                        maxRedirects: 5,
                        beforeRedirect,
                        httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 10, rejectUnauthorized: false }),
                        ...axiosOptions,
                        lookup: SAFE_LOOKUP, // DNS-rebinding guard (see main GET) — non-bypassable.
                    });
                    if (!__noLog)
                        logRequest({ tool: tool ?? "unknown", url, status: resp.status, ms: Date.now() - startMs, mode: "static" });
                    return resp;
                }
                if (attempt === retries)
                    throw error;
                const isRetryable = error instanceof AxiosError &&
                    (error.response?.status === 429 ||
                        error.response?.status === 503 ||
                        !error.response);
                if (!isRetryable)
                    throw error;
                const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                const jitter = Math.random() * base;
                await new Promise((resolve) => setTimeout(resolve, Math.min(jitter, 30_000)));
            }
        }
        throw new Error(`Failed after ${retries + 1} attempts: ${url}`);
    }
    catch (err) {
        if (!__noLog) {
            const status = err instanceof AxiosError ? err.response?.status : undefined;
            logRequest({ tool: tool ?? "unknown", url, status, ms: Date.now() - startMs, mode: "static", error: err instanceof Error ? err.message : String(err) });
        }
        throw err;
    }
}
const proxyCircuits = new Map();
const PROXY_CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 minutes
function getCircuit(tier, endpoint) {
    const key = `${tier}:${endpoint}`;
    let state = proxyCircuits.get(key);
    if (!state) {
        state = { available: null, disabledAt: null };
        proxyCircuits.set(key, state);
    }
    return state;
}
export async function fetchViaProxy(url, apiKey, options = {}) {
    // SSRF chokepoint (also guards runtime-discovered URLs: sitemap/robots/llms.txt/BFS).
    assertUrlSafe(url);
    const { proxyTier, tool, __noLog, ...axiosOptionsRaw } = options;
    // Inner fetchWithRetry calls carry telemetry (tool) but suppress their own log line
    // (__noLog) — this wrapper emits exactly one request-log entry per logical proxy fetch,
    // regardless of how many direct/proxy/race sub-fetches it spawns.
    const axiosOptions = { ...axiosOptionsRaw, tool, __noLog: true };
    const _proxyStartMs = Date.now();
    // Emit one request-log line for the resolved proxy fetch, then hand the response back.
    const _logOk = (resp) => {
        logRequest({ tool: tool ?? "unknown", url, status: resp.status, ms: Date.now() - _proxyStartMs, mode: "proxy" });
        return resp;
    };
    // Credentials: use residential creds if proxyTier === "residential", else resolve via apiKey.
    // resolveProxyCredentials(apiKey) prefers caller-supplied key for auto-fetch so on the hosted
    // server the caller's account is billed, not the server account.
    let effectiveTier = proxyTier ?? "datacenter";
    const proxyCreds = proxyTier === "residential"
        ? (() => {
            const residentialSpecific = process.env.NOVADA_RESIDENTIAL_PROXY_USER &&
                process.env.NOVADA_RESIDENTIAL_PROXY_PASS &&
                process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
            if (!residentialSpecific) {
                console.warn("[novada-mcp] NOVADA_RESIDENTIAL_PROXY_* env vars not set — " +
                    "falling back to datacenter proxy credentials for residential tier. " +
                    "Set NOVADA_RESIDENTIAL_PROXY_USER/PASS/ENDPOINT to use dedicated residential proxies.");
                effectiveTier = "datacenter";
            }
            return getResidentialProxyCredentials();
        })()
        : await resolveProxyCredentials(apiKey);
    const proxyUser = proxyCreds?.user;
    const proxyPass = proxyCreds?.pass;
    const proxyEndpoint = proxyCreds?.endpoint;
    try {
        if (proxyUser && proxyPass && proxyEndpoint) {
            const circuit = getCircuit(effectiveTier, proxyEndpoint);
            // Auto-reset circuit breaker after TTL (recovers from transient failures)
            if (circuit.available === false && circuit.disabledAt !== null && Date.now() - circuit.disabledAt > PROXY_CIRCUIT_RESET_MS) {
                circuit.available = null;
                circuit.disabledAt = null;
            }
            if (circuit.available === false) {
                return _logOk(await fetchWithRetry(url, axiosOptions));
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
                return _logOk(await fetchWithRetry(url, { headers: { "User-Agent": getRandomUA(), "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Connection": "keep-alive" }, proxy: proxyConfig, timeout: TIMEOUTS.PROXY_FETCH, ...axiosOptions }));
            }
            // Unknown state: race proxy vs direct fetch — take the first successful response.
            // Probe proxy with 0 retries: a single failure is enough to mark circuit open and
            // fall back to direct without burning 3 retries × exponential backoff (~7s).
            const proxyProbeOptions = { headers: { "User-Agent": getRandomUA(), "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Connection": "keep-alive" }, proxy: proxyConfig, timeout: TIMEOUTS.PROXY_FETCH, ...axiosOptions };
            const proxyFetch = fetchWithRetry(url, proxyProbeOptions, 0)
                .then(r => { circuit.available = true; return r; })
                .catch((error) => {
                if (error instanceof AxiosError) {
                    const status = error.response?.status;
                    if (status === 407) {
                        throw new Error("Proxy authentication failed (HTTP 407). " +
                            "Verify NOVADA_PROXY_USER and NOVADA_PROXY_PASS are correct. " +
                            "Get credentials at: https://dashboard.novada.com → Residential Proxies → Endpoint Generator");
                    }
                    if (status === 401 || status === 403) {
                        throw error; // Auth failure — surface it, don't fall back
                    }
                }
                circuit.available = false;
                circuit.disabledAt = Date.now();
                return null; // signal: proxy unavailable, caller will use directFetch result
            });
            const directFetch = fetchWithRetry(url, axiosOptions).catch((err) => {
                throw Object.assign(new Error(`Direct fetch failed: ${err instanceof Error ? err.message : String(err)}. Proxy circuit: ${circuit.available === false ? "open (disabled)" : "unknown"}`), { cause: err });
            });
            // Use Promise.any semantics: whichever non-null result arrives first wins.
            // This lets directFetch resolve immediately if proxy fails fast (e.g., parse error),
            // without waiting for proxy to finish its full timeout window.
            const result = await Promise.any([
                proxyFetch.then(r => { if (r === null)
                    throw new Error("proxy-unavailable"); return r; }),
                directFetch,
            ]).catch(async () => {
                // Both failed — last resort: return whatever we have (proxy null + direct error surfaced)
                const [proxyResult, directResult] = await Promise.allSettled([proxyFetch, directFetch]);
                if (proxyResult.status === "fulfilled" && proxyResult.value !== null)
                    return proxyResult.value;
                if (directResult.status === "fulfilled")
                    return directResult.value;
                throw directResult.status === "rejected" ? directResult.reason : new Error("All fetch paths failed");
            });
            return _logOk(result);
        }
        return _logOk(await fetchWithRetry(url, axiosOptions));
    }
    catch (err) {
        logRequest({ tool: tool ?? "unknown", url, status: err instanceof AxiosError ? err.response?.status : undefined, ms: Date.now() - _proxyStartMs, mode: "proxy", error: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}
/**
 * Fetch a URL through Novada Web Unblocker (JS rendering, anti-bot bypass).
 * Endpoint: webunlocker.novada.com — uses NOVADA_WEB_UNBLOCKER_KEY (separate from scraper key).
 * Falls back to fetchViaProxy if web unblocker key is not configured.
 */
export async function fetchWithRender(url, scraperApiKey, options = {}) {
    // SSRF chokepoint: validate the target before it is handed to the unblocker or the
    // proxy fallback. The unblocker POST itself targets Novada's own endpoint.
    assertUrlSafe(url);
    // Resolve web unblocker key via the credential store/env chain:
    //   store.webUnblockerKey → store.apiKey → NOVADA_WEB_UNBLOCKER_KEY → NOVADA_API_KEY
    // The store.apiKey path is the L3 unified-key fix: on the hosted server, withCredentials()
    // populates store.apiKey with the caller's key, so getWebUnblockerKey() returns it
    // without requiring a separate NOVADA_WEB_UNBLOCKER_KEY per-caller.
    // NOTE: scraperApiKey is the scraper-API key (different service) — never use it as the unblocker key.
    const unblockerKey = getWebUnblockerKey();
    const { country, proxyTier, tool, __noLog, ...axiosOptions } = options;
    const _renderStartMs = Date.now();
    if (unblockerKey) {
        // Web Unblocker API is intermittently flaky — inner data.code returns 403/502
        // on ~30% of requests even for simple targets. Retry up to 2 times on transient failures.
        const MAX_RETRIES = 2;
        let lastError = null;
        try {
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const params = new URLSearchParams();
                    params.append("target_url", url);
                    params.append("response_format", "html");
                    params.append("js_render", "true");
                    if (country)
                        params.append("country", country);
                    const resp = await axios.post(`${WEB_UNBLOCKER_BASE}/request`, params.toString(), {
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Authorization": `Bearer ${unblockerKey}`,
                            ...telemetryHeaders(tool),
                        },
                        timeout: TIMEOUTS.RENDER,
                        maxContentLength: 10 * 1024 * 1024,
                        maxBodyLength: 10 * 1024 * 1024,
                        httpsAgent: _sharedHttpsAgent,
                        ...axiosOptions,
                    });
                    // Response format: { code: 0, data: { code: 200, html: "...", msg, msg_detail } }
                    // F10: outer code=5001 → PRODUCT_UNAVAILABLE — short-circuit immediately, no retries.
                    // Retrying will not help: the product must be activated in the dashboard first.
                    if (resp.data?.code === 5001 || resp.data?.data?.code === 5001) {
                        throw new Error(`Web Unblocker not activated (code=5001) — render/js modes unavailable on this account. ` +
                            `Activate at https://dashboard.novada.com/overview/web-unblocker/ or use render=static. ` +
                            `Retrying will not help.`);
                    }
                    if (resp.data?.code === 0 && resp.data?.data?.html) {
                        if (!__noLog)
                            logRequest({ tool: tool ?? "unknown", url, status: resp.data.data.code ?? resp.status, ms: Date.now() - _renderStartMs, mode: "render" });
                        return { ...resp, data: resp.data.data.html };
                    }
                    // Inner code check — outer code=0 but inner data.code indicates a transient error
                    if (resp.data?.data?.code && resp.data.data.code !== 200) {
                        const innerCode = resp.data.data.code;
                        const innerMsg = resp.data.data.msg ?? "";
                        // 503 "Faulted After Too Many Retries" means the unblocker already exhausted its
                        // own internal retry budget — the target is genuinely hard (Cloudflare challenge,
                        // bot detection, etc.). Retrying from our side wastes serverless budget and won't
                        // succeed. Throw immediately so the caller can surface a useful error faster.
                        // NOV-GB2: Part B — hosted render 503 fix.
                        if (innerCode === 503 && innerMsg.toLowerCase().includes("faulted")) {
                            throw new Error(`Web Unblocker error (503): ${innerMsg || "Faulted After Too Many Retries"} — ` +
                                `the target rejected all render attempts. Use render="static" or the GitBook .md fallback instead.`);
                        }
                        // 403/429/500/502/503 are transient — retry
                        if ([403, 429, 500, 502, 503].includes(innerCode) && attempt < MAX_RETRIES) {
                            lastError = new Error(`Web Unblocker error (${innerCode}): ${innerMsg || "unknown"}`);
                            const _base1 = Math.pow(2, attempt) * 1000;
                            const _jitter1 = Math.random() * _base1;
                            await new Promise(r => setTimeout(r, Math.min(_jitter1, 30_000)));
                            continue;
                        }
                        throw new Error(`Web Unblocker error (${innerCode}): ${innerMsg || "unknown"}`);
                    }
                    if (resp.data?.code !== 0) {
                        throw new Error(`Web Unblocker error: ${resp.data?.msg ?? "unknown"}`);
                    }
                    if (!__noLog)
                        logRequest({ tool: tool ?? "unknown", url, status: resp.status, ms: Date.now() - _renderStartMs, mode: "render" });
                    return resp;
                }
                catch (error) {
                    if (error instanceof AxiosError && error.message?.toLowerCase().includes("maxcontentlength")) {
                        throw new Error(`Web Unblocker response from ${url} exceeds the 10MB content limit. ` +
                            "The rendered page may contain large embedded assets. Try a more specific subpage URL.");
                    }
                    // Retry on HTTP-level transient errors (502, 503, timeout)
                    const status = error?.response?.status;
                    if (status && [502, 503, 429].includes(status) && attempt < MAX_RETRIES) {
                        lastError = error instanceof Error ? error : new Error(String(error));
                        const _base2 = Math.pow(2, attempt) * 1000;
                        const _jitter2 = Math.random() * _base2;
                        await new Promise(r => setTimeout(r, Math.min(_jitter2, 30_000)));
                        continue;
                    }
                    throw error;
                }
            }
            // All retries exhausted
            throw lastError ?? new Error("Web Unblocker failed after retries");
        }
        catch (err) {
            if (!__noLog)
                logRequest({ tool: tool ?? "unknown", url, status: err instanceof AxiosError ? err.response?.status : undefined, ms: Date.now() - _renderStartMs, mode: "render", error: err instanceof Error ? err.message : String(err) });
            throw err;
        }
    }
    // Fallback: no unblocker key configured — use proxy/direct fetch (best effort).
    // Thread tool through so the fallback proxy fetch still carries telemetry + logs once.
    return fetchViaProxy(url, scraperApiKey, { ...axiosOptions, ...(proxyTier ? { proxyTier } : {}), tool });
}
/** Detect if fetched HTML is a JS-required page (empty shell, Cloudflare, etc.) */
export function detectJsHeavyContent(html) {
    if (!html || html.length < JS_DETECTION_THRESHOLD)
        return true;
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
export function detectBotChallenge(html) {
    if (!html)
        return false;
    const lower = html.toLowerCase();
    let signals = 0;
    // --- Known challenge strings (each counts as 1 definitive signal) ---
    // ONLY strings that unambiguously indicate a bot challenge page.
    // Short/ambiguous patterns (ips.js, cd.js, _px, press & hold, akamaized)
    // moved to heuristic section below to avoid false positives.
    //
    // IMPORTANT — three patterns require STRUCTURAL context, not bare substring:
    //   "just a moment"  → only when it is the <title> AND a CF challenge element is present
    //   "ray id"         → only via class="ray-id" or "Ray ID: <hex>" inside a CF challenge block
    //                      (NOT in prose, NOT in CF error-page error sections)
    //   "datadome"       → only via challenge markers (dd_challenge div, /datadome/captcha/ action,
    //                      "powered by datadome" text); NOT the passive SDK <script src="js.datadome.co">
    const knownChallengeStrings = [
        // Cloudflare — structural tokens (unambiguous)
        "cf-browser-verification",
        "__cf_chl_opt",
        "cf_chl_",
        "__cf_bm",
        "checking your browser",
        // Akamai (specific bot-management cookies only — NOT "akamaized" which matches CDN asset URLs)
        "_abck",
        "bm_sz",
        "ak_bmsc",
        // Imperva / Incapsula
        "incap_ses_",
        "visid_incap_",
        "_incap_",
        // Generic (unambiguous)
        "please wait while we verify",
        "human verification",
        "human-challenge",
        // DataDome challenge page markers (not just the cookie name or SDK script src)
        "robot check",
        "enter the characters you see below",
        "sorry, we just need to make sure",
        // Amazon WAF
        "to discuss automated access to amazon data",
        "apologies, but we're having trouble saving your cookie",
    ];
    for (const signal of knownChallengeStrings) {
        if (lower.includes(signal)) {
            // A single known challenge string is sufficient to declare a challenge
            return true;
        }
    }
    // --- Structural context checks for ambiguous strings ---
    // These strings appear in both legitimate content AND challenge pages; require
    // co-presence of structural challenge markers to avoid false positives.
    // "just a moment" — only a challenge when it is the page <title> AND a CF challenge
    // element/script is co-present. Prose that mentions the phrase must not trigger.
    const titleLower = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim().toLowerCase();
    const hasCfChallengeStructure = lower.includes("cf-browser-verification") ||
        lower.includes("__cf_chl_opt") ||
        lower.includes("cf_chl_") ||
        lower.includes("__cf_bm") ||
        lower.includes("cf-im-under-attack") ||
        lower.includes("cf-hcaptcha-container") ||
        /window\.__cf\b/.test(lower);
    if (titleLower.includes("just a moment") && hasCfChallengeStructure) {
        return true;
    }
    // "ray id" — only a challenge when it appears as a CSS class `ray-id` on a
    // CF challenge page, NOT in prose text, NOT in CF error pages (5xx).
    // CF bot-challenge pages don't use "Ray ID" prominently — it appears as a
    // footer diagnostic on error pages.  We skip this pattern entirely as a
    // standalone definitive signal; the CF challenge is always caught by
    // __cf_chl_opt / cf-browser-verification / cf_chl_ above.
    // (No action needed here — "ray id" is removed from the definitive list above.)
    // "datadome" — only a challenge via explicit DataDome challenge-page structures.
    // The passive SDK script (src="js.datadome.co/tags.js") is present on allowed
    // pages and must NOT trigger detection.
    const hasDataDomeChallengeStructure = lower.includes("dd_challenge") ||
        lower.includes("/datadome/captcha/") ||
        lower.includes("powered by datadome") ||
        lower.includes("datadome-captcha");
    if (hasDataDomeChallengeStructure) {
        return true;
    }
    // Cloudflare hard-block pages (error 1009 "you have been blocked" / banned IP).
    // These are not JS challenge pages but ARE bot-detection blocks — they must NOT
    // be returned as successful content.
    // Detection: "sorry, you have been blocked" co-present with CF error layout markers.
    // The CF error footer / error-details IDs are specific to CF error/block pages.
    // A 5xx error page (522, 524) won't contain "sorry, you have been blocked" so
    // this does NOT trigger on pure network error pages.
    const hasCfBlockLayout = lower.includes("cf-error-footer") ||
        (lower.includes("cf-error-details") && lower.includes("cf-wrapper"));
    if (lower.includes("sorry, you have been blocked") && hasCfBlockLayout) {
        return true;
    }
    // Also catch Cloudflare "Attention Required" hard-block pages regardless of the
    // exact blocked-message variant — the CF error layout is the key structural signal.
    if (lower.includes("attention required") && hasCfBlockLayout) {
        return true;
    }
    // --- Heuristic signals (need 2+ to trigger) ---
    // Ambiguous patterns that could appear on legitimate pages — only count as signals, not definitive.
    // Kasada scripts (ips.js, cd.js can match tooltips.js etc. as substrings)
    if (/["'/]ips\.js(\?|"|'|$)/i.test(html) || /["'/]cd\.js(\?|"|'|$)/i.test(html))
        signals++;
    // PerimeterX (_px2, _px3 etc. — not bare "_px" which matches _pxref, analytics)
    if (/_px[2-9]\b/.test(lower))
        signals++;
    // "press & hold" — appears in UI docs, music players; only a signal when combined
    if (lower.includes("press & hold"))
        signals++;
    // "akamaized" in a script src context (not just CDN asset URLs)
    if (/src=["'][^"']*akamaized[^"']*\.js/i.test(html))
        signals++;
    // Body text length < 1500 chars after stripping scripts/styles
    const bodyTextLen = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
    if (bodyTextLen < 1500)
        signals++;
    // Blank or missing title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = titleMatch ? titleMatch[1].trim() : "";
    if (!titleText)
        signals++;
    // Body contains only a single small <div> with no real content
    const divCount = (html.match(/<div[\s\S]*?>/gi) ?? []).length;
    const pCount = (html.match(/<p[\b\s>]/gi) ?? []).length;
    if (divCount < 3 && pCount === 0)
        signals++;
    return signals >= 2;
}
/**
 * Identify which anti-bot provider is active in a page's HTML.
 * Returns a human-readable provider name, or null if none detected.
 * Unlike detectBotChallenge (boolean gate), this pinpoints the specific provider
 * for diagnostic output and escalation metadata.
 */
export function identifyAntiBot(html) {
    if (!html)
        return null;
    const lower = html.toLowerCase();
    // Cloudflare — most common, check first
    if (lower.includes("cf_chl_") || lower.includes("cf-browser-verification") || lower.includes("__cf_chl_opt") || lower.includes("__cf_bm")) {
        return "cloudflare";
    }
    // DataDome (datadome cookie/script is unambiguous; dd.js is too short — require path context)
    if (lower.includes("datadome")) {
        return "datadome";
    }
    // Kasada (require script src context to avoid matching tooltips.js etc.)
    if (/["'/]ips\.js(\?|"|'|$)/i.test(html) || /["'/]cd\.js(\?|"|'|$)/i.test(html)) {
        return "kasada";
    }
    // PerimeterX (require _px2/_px3 etc., not bare _px which matches analytics prefixes)
    if (/_px[2-9]\b/.test(lower) || lower.includes("human-challenge")) {
        return "perimeterx";
    }
    // Akamai (specific bot-management cookies — NOT "akamaized" CDN URLs)
    if (lower.includes("_abck") || lower.includes("ak_bmsc") || lower.includes("bm_sz")) {
        return "akamai";
    }
    // Imperva / Incapsula
    if (lower.includes("incap_ses_") || lower.includes("visid_incap_")) {
        return "incapsula";
    }
    return null;
}
//# sourceMappingURL=http.js.map