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
 * Scope (2026-07-29): Layer C measures whether OUR GATEWAY stays HEALTHY
 * under a 20-VU burst — no 5xx, bounded latency — NOT whether every request
 * succeeds. The gateway rate-limits at 60 req/min per IP
 * (hosted-server/vercel/api/mcp.ts, RATE_LIMIT_PER_MIN). A single CI runner
 * IP driving 20 VUs sends far more than 60 req/min, so the large majority of
 * requests are CORRECTLY rejected with HTTP 429 — that is the rate-limiter
 * doing its job (shedding excess load fast, not falling over), not a
 * failure. This test therefore treats 429 as an EXPECTED status (see the
 * `http.setResponseCallback` below). It fails only on: a real gateway failure
 * rate above 5% (`http_req_failed` — 5xx / network errors, 429 excluded), p95
 * latency over 15s (`http_req_duration`), or the gateway serving almost nothing
 * under load (`served_200` count floor — catches a limiter that rejects ~100%).
 * Backend/scraper content correctness is out of scope here too
 * (that is Layer B's Tier-1/Tier-3 and Layer D's daily full-tools probe); the
 * request mix below is restricted to tools that never call the Novada
 * Scraper API backend (scraper.novada.com) — novada_setup/novada_discover
 * (free/local), novada_account (wallet-balance read), and novada_extract
 * against a static page. A Scraper API backend outage (e.g. the `50004:
 * context deadline exceeded` timeout reproduced 2026-07-28 via a raw curl,
 * zero MCP involved) must NOT trip this load test — see http_req_failed's
 * threshold rationale below, which now genuinely only measures gateway
 * health (429s are excluded from it entirely).
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
import { Counter } from "k6/metrics";

// 429 (rate-limited) is an EXPECTED, correctly-shed response at this VU
// count — see the file-header Scope note. Registering it here means k6's
// BUILT-IN `http_req_failed` metric no longer counts a 429 as a failure at
// all (only non-2xx/non-expected statuses and network/transport errors do),
// so `http_req_failed` becomes a genuine gateway-health signal: real 5xx
// responses and network errors, nothing else. Supported since k6 v0.31;
// confirmed present on the installed k6 v2.1.0 (`k6 version`).
http.setResponseCallback(http.expectedStatuses(200, 429));

// Floor signal: count real HTTP 200s (a genuinely SERVED response, not a 429
// rejection). Because 429s are excluded from http_req_failed above, a gateway
// that rejected ~100% of requests under load — a rate limiter misconfigured to
// near-zero, or a KV-counter bug — would otherwise leave this test GREEN (0%
// http_req_failed, fast 429s) while the box is effectively dead under
// concurrency: exactly what a load test must catch. The `served_200: count>10`
// threshold below fails the run if almost nothing gets through.
const served200 = new Counter("served_200");

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
    // Layer C measures GATEWAY LOAD CAPACITY / HEALTH only — can our box take
    // concurrency without falling over — NOT backend/scraper content
    // correctness (that's Layer B's Tier-1/Tier-3 and Layer D's daily
    // full-tools probe). Gate on HTTP failure rate + latency:
    //
    // http_req_failed now measures REAL gateway failures only. Because
    // `http.setResponseCallback(http.expectedStatuses(200, 429))` is
    // registered above, k6 excludes 429 (rate-limited, expected at 20 VUs
    // against a 60 req/min-per-IP limit) from this metric entirely — only
    // 5xx responses and network/transport errors count toward it. So
    // `rate<0.05` is a meaningful "gateway is healthy" gate, not something a
    // correctly-functioning rate limiter can trip.
    http_req_failed: ["rate<0.05"],
    // Floor: at least SOME requests must get a real HTTP 200 through the gateway
    // under load. Since 429s are excluded from http_req_failed, without this a
    // ~100%-rejection gateway (limiter misconfigured to near-zero, or a KV bug)
    // would stay green; count>10 fails the run if the box serves almost nothing.
    // A normal ~2min run serves ~120 200s (the 60 req/min-per-IP allowance over
    // the run), so >10 has wide margin and never false-reds at the default 20 VUs.
    served_200: ["count>10"],
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
      // 429 is the rate-limiter correctly shedding excess load at 20 VUs
      // against the gateway's 60 req/min-per-IP limit — see the file-header
      // Scope note. It is NOT a failure, so it passes this check alongside
      // 200. Only a non-200/non-429 status (5xx, network error, etc.) fails
      // here.
      "status is 200 or 429 (rate-limited, expected)": (r) => r.status === 200 || r.status === 429,
      // A 429 response has no JSON-RPC body to inspect (it's a plain gateway
      // rejection), so this check is only applicable to actual 200s — for a
      // 429 it evaluates to true (not-applicable = pass) rather than failing
      // a check that was never meant to run against a rate-limit response.
      "jsonrpc response has result (no error)": () =>
        res.status !== 200 || (!!parsed && parsed.error === undefined && parsed.result !== undefined),
    },
    { tool: tag }
  );

  // Floor metric (see the `served_200` threshold): only a genuine 200 counts,
  // so a gateway serving ~nothing under load fails the run instead of passing.
  served200.add(res.status === 200 ? 1 : 0);

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
