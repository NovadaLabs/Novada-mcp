/**
 * k6 stress/load test (Layer C) for the live Novada hosted MCP.
 *
 * Endpoint:   https://mcp.novada.com/mcp  (auth via `Authorization: Bearer <KEY>` header)
 * Protocol:   JSON-RPC 2.0 over HTTP POST (method: "tools/call")
 * Responses:  may be plain JSON or SSE ("data: {...}" frames) — both are parsed.
 *
 * Run:
 *   k6 run -e NOVADA_TEST_KEY=<key> monitoring/stress/k6-stress.js
 *
 * Tunables (env vars, both optional):
 *   VUS      - peak virtual users held during the plateau stage (default 20)
 *   DURATION - length of the plateau/hold stage (default "60s")
 *
 * Scope (2026-07-28): Layer C measures OUR GATEWAY's load capacity — can the
 * hosted MCP box (Vercel function, auth, rate-limit) take concurrency — NOT
 * backend/scraper content correctness (that is Layer B's Tier-1/Tier-3 and
 * Layer D's daily full-tools probe). The request mix below is therefore
 * restricted to tools that never call the Novada Scraper API backend
 * (scraper.novada.com) — novada_setup/novada_discover (free/local),
 * novada_account (wallet-balance read), and novada_extract against a static
 * page. A Scraper API backend outage (e.g. the `50004: context deadline
 * exceeded` timeout reproduced 2026-07-28 via a raw curl, zero MCP involved)
 * must NOT trip this load test — see http_req_failed's threshold rationale
 * below, which now genuinely only measures gateway health.
 *
 * Safety notes:
 *   - Conservative default load (20 VUs) so this does not DDoS prod or churn credits.
 *   - Only cheap, read-only, gateway-only tools are exercised (see Scope above). No
 *     write tools. No scraper/SERP tools, and no expensive async research calls that
 *     would cost real money, skew latency, or touch the Scraper API backend.
 *   - The API key is read from the environment ONLY — never hardcode a key here.
 *   - The key is sent as an `Authorization: Bearer` header, never a `?token=`
 *     URL query param — this repo and its CI logs are public, and a key in
 *     the request URL risks leaking into an Actions log line on any
 *     error/redirect trace.
 */

import http from "k6/http";
import { check, sleep } from "k6";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const KEY = __ENV.NOVADA_TEST_KEY;
if (!KEY) {
  throw new Error(
    "NOVADA_TEST_KEY environment variable is required. " +
      "Usage: k6 run -e NOVADA_TEST_KEY=<key> monitoring/stress/k6-stress.js"
  );
}

const BASE_URL = "https://mcp.novada.com/mcp";

const PEAK_VUS = parseInt(__ENV.VUS || "20", 10);
const HOLD_DURATION = __ENV.DURATION || "60s";

export const options = {
  stages: [
    { duration: "30s", target: PEAK_VUS }, // ramp up
    { duration: HOLD_DURATION, target: PEAK_VUS }, // hold at peak
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: {
    // Layer C measures GATEWAY LOAD CAPACITY only — can our box take
    // concurrency — NOT backend/scraper content correctness (that's Layer B's
    // Tier-1/Tier-3 and Layer D's daily full-tools probe). Gate on HTTP
    // failure rate + latency:
    // Allow up to 5% request failure — some gateway-side flakiness is expected.
    http_req_failed: ["rate<0.05"],
    // Research isn't in this mix; cheap ops should stay well under 15s at p95.
    http_req_duration: ["p(95)<15000"],
    // NOTE: the JSON-RPC "has a result, not an error" check still RUNS and is
    // reported in the summary, but is intentionally NOT a hard threshold here.
    // As of the 2026-07-28 gateway-only mix, none of the exercised tools call
    // the Scraper API backend at all, so this check should normally pass —
    // but it stays non-gated as defense-in-depth: a *content* problem on any
    // of these tools is caught + fault-classified by Layer D daily, and must
    // never red the *load* test. (2026-07-27, scope narrowed 2026-07-28)
  },
};

// ---------------------------------------------------------------------------
// Sample inputs (cheap, deterministic-ish, read-only, gateway-only)
// ---------------------------------------------------------------------------

const EXTRACT_URL = "https://example.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a parsed JSON-RPC object from a response body that may be either
 * plain JSON or an SSE stream (one or more "data: {...}" frames).
 */
function parseJsonRpcBody(body) {
  if (!body) {
    return null;
  }

  if (body.indexOf("data:") !== -1) {
    const lines = body.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.indexOf("data:") === 0) {
        const jsonStr = trimmed.slice(5).trim();
        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          // keep scanning subsequent frames
        }
      }
    }
    return null;
  }

  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

/**
 * POSTs a single JSON-RPC "tools/call" request, tagged by tool name so k6's
 * summary breaks out per-tool latency (http_req_duration{tool:"..."}).
 */
function callTool(toolName, args, tag) {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e9),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  });

  const res = http.post(BASE_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${KEY}`,
    },
    tags: { tool: tag },
  });

  const parsed = parseJsonRpcBody(res.body);

  check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "jsonrpc response has result (no error)": () =>
        !!parsed && parsed.error === undefined && parsed.result !== undefined,
    },
    { tool: tag }
  );

  return res;
}

// ---------------------------------------------------------------------------
// Weighted scenario mix: 25% each across setup/discover/account-balance/extract
// — ALL four are gateway/meta-only tools that never call the Novada Scraper
// API backend (see the file header's Scope note). Deliberately no
// novada_search or any scraper/SERP tool in this mix: those go through
// scraper.novada.com and a backend outage there (e.g. `50004: context
// deadline exceeded`) would trip http_req_failed and false-red this LOAD
// test for a problem this layer does not own.
// ---------------------------------------------------------------------------

function doSetup() {
  callTool("novada_setup", {}, "setup");
}

function doDiscover() {
  callTool("novada_discover", {}, "discover");
}

function doAccountBalance() {
  callTool("novada_account", { section: "balance" }, "account_balance");
}

function doExtract() {
  callTool("novada_extract", { url: EXTRACT_URL }, "extract");
}

export default function () {
  const roll = Math.random();

  if (roll < 0.25) {
    doSetup();
  } else if (roll < 0.5) {
    doDiscover();
  } else if (roll < 0.75) {
    doAccountBalance();
  } else {
    doExtract();
  }

  sleep(1);
}
