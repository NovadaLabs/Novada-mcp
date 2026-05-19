import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const _pkg = _require("../package.json") as { version: string };
export const VERSION = _pkg.version;

// Scraper API — platform scraper endpoint (POST /request with Bearer token auth).
// Only /request is live. Returns code 11006 when Scraper product is not activated on account.
export const SCRAPER_API_BASE = "https://scraper.novada.com";

// Scraper task result download — uses apikey query param, not Bearer token.
// GET /scraper_download?task_id=...&file_type=json&apikey=...
// Returns {"code":27202} when pending, or JSON array when complete.
export const SCRAPER_DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy";

// SERP / Search API — correct domain per official Novada docs.
// Endpoint: POST /search with JSON body { serpapi_query: { engine, q, api_key, num, ... } }
// Returns code 402 when account lacks SERP quota (separate plan from Scraper/Unblocker).
export const SCRAPERAPI_BASE = "https://scraperapi.novada.com";

// Web Unblocker — JS-rendered pages, POST /request with Bearer token auth.
// Response: { code: 0, data: { code: 200, html: "...", use_balance: N } }
export const WEB_UNBLOCKER_BASE = "https://webunlocker.novada.com";

// Scraper status/result polling — async scraper task status endpoint.
// GET /v1/scraper/{task_id} with Bearer token auth.
export const SCRAPER_STATUS_BASE = "https://api-m.novada.com/v1/scraper";

// Optional: Browser API WebSocket endpoint (CDP)
// Format: wss://username:password@upg-scbr2.novada.com
export const BROWSER_WS_ENDPOINT = process.env.NOVADA_BROWSER_WS;

// Optional: Proxy credentials
export const PROXY_USER = process.env.NOVADA_PROXY_USER;
export const PROXY_PASS = process.env.NOVADA_PROXY_PASS;
export const PROXY_ENDPOINT = process.env.NOVADA_PROXY_ENDPOINT;

// JS-heavy detection: content shorter than this triggers render escalation
export const JS_DETECTION_THRESHOLD = 200;

// Timeout configuration (milliseconds)
export const TIMEOUTS = {
  STATIC_FETCH: 30000,
  PROXY_FETCH: 45000,
  RENDER: 60000,
  BROWSER_CONNECT: 10000,
  BROWSER_PAGE: 30000,
  SITEMAP: 8000,
  CRAWL_STATIC: 15000,
  CRAWL_RENDER: 60000,
} as const;

// Excel max sheet name length
export const EXCEL_MAX_SHEET_NAME = 31;
