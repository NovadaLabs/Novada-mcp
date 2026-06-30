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

// Hosted Vercel function wall-clock limit (see novada-mcpserver/vercel/api/mcp.ts
// `config.maxDuration`). When a tool's own time budget exceeds this, Vercel kills
// the function mid-flight and returns a BARE HTTP 504 that is NOT valid JSON-RPC,
// which breaks MCP clients (#5). Every long-running tool ceiling below MUST stay
// under this so the tool returns a structured result/error FIRST. The ~10s margin
// covers transport flush + serialization before the hard kill.
export const HOSTED_FUNCTION_LIMIT_MS = 60_000;
export const HOSTED_SAFE_CEILING_MS = 50_000; // tool budgets must stay <= this

// Timeout configuration (milliseconds)
// NOTE: long-running ceilings (RENDER, CRAWL_RENDER, TOTAL_REQUEST_CEILING,
// SEARCH_*) are capped at HOSTED_SAFE_CEILING_MS so the tool emits a structured
// JSON-RPC result before the hosted 504 kill (#5). Do not raise above 50s without
// also raising the Vercel function maxDuration.
export const TIMEOUTS = {
  STATIC_FETCH: 15000,       // was 30000; halved to cut worst-case static time (3 retries = 45s max)
  PROXY_FETCH: 45000,
  RENDER: 48_000,            // was 60000; under HOSTED_SAFE_CEILING_MS so render returns before the hosted 504
  BROWSER_CONNECT: 10000,
  BROWSER_PAGE: 30000,
  SITEMAP: 8000,
  CRAWL_STATIC: 15000,
  CRAWL_RENDER: 48_000,      // was 60000; under HOSTED_SAFE_CEILING_MS (#5)
  TOTAL_REQUEST_CEILING: 50_000, // was 90000; hard per-URL ceiling in extractSingle via Promise.race — capped for hosted (#5)
  SEARCH_SUBMIT_TIMEOUT: 25_000, // was 30000; leaves headroom under the 50s total ceiling
  SEARCH_POLL_TIMEOUT: 45_000,   // was 60000; under HOSTED_SAFE_CEILING_MS (#5)
  SEARCH_TOTAL_CEILING: 50_000,  // was 90000; capped so search returns before the hosted 504 (#5)
} as const;

// Excel max sheet name length
export const EXCEL_MAX_SHEET_NAME = 31;
