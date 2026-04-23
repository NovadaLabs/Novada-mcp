export const VERSION = "0.8.0";

// Scraper API — structured platform scraper (129 sites), POST JSON
export const SCRAPER_API_BASE = "https://scraper.novada.com";

// Web Unblocker — JS-rendered pages, POST JSON with target_url + js_render
export const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";

// Optional: Browser API WebSocket endpoint (CDP)
// Format: wss://username:password@upg-scbr2.novada.com
export const BROWSER_WS_ENDPOINT = process.env.NOVADA_BROWSER_WS;

// Optional: Proxy credentials
export const PROXY_USER = process.env.NOVADA_PROXY_USER;
export const PROXY_PASS = process.env.NOVADA_PROXY_PASS;
export const PROXY_ENDPOINT = process.env.NOVADA_PROXY_ENDPOINT;

// JS-heavy detection: content shorter than this triggers render escalation
export const JS_DETECTION_THRESHOLD = 200;
