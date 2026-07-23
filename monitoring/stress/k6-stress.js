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
 * Safety notes:
 *   - Conservative default load (20 VUs) so this does not DDoS prod or churn credits.
 *   - Only cheap, read-only tools are exercised: novada_search (num:1), novada_discover
 *     (free), novada_extract (a static example.com page). No write tools. No expensive
 *     async scrapers / research calls that would cost real money or skew latency.
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
    // Allow up to 5% request failure — some backend flakiness is expected.
    http_req_failed: ["rate<0.05"],
    // Research isn't in this mix; cheap ops should stay well under 15s at p95.
    http_req_duration: ["p(95)<15000"],
    // The JSON-RPC "has a result, not an error" check must pass ~everywhere.
    checks: ["rate>0.95"],
  },
};

// ---------------------------------------------------------------------------
// Sample inputs (cheap, deterministic-ish, read-only)
// ---------------------------------------------------------------------------

const SEARCH_QUERIES = [
  "weather today",
  "latest technology news",
  "current stock market summary",
  "how to make coffee",
  "what is the capital of France",
];

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
// Weighted scenario mix: ~70% search / ~20% discover / ~10% extract
// ---------------------------------------------------------------------------

function doSearch() {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  callTool("novada_search", { query, num: 1 }, "search");
}

function doDiscover() {
  callTool("novada_discover", {}, "discover");
}

function doExtract() {
  callTool("novada_extract", { url: EXTRACT_URL }, "extract");
}

export default function () {
  const roll = Math.random();

  if (roll < 0.7) {
    doSearch();
  } else if (roll < 0.9) {
    doDiscover();
  } else {
    doExtract();
  }

  sleep(1);
}
