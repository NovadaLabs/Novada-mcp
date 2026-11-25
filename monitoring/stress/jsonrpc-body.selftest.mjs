#!/usr/bin/env node
/**
 * Offline self-test for monitoring/stress/jsonrpc-body.mjs (no network, no key).
 *   node monitoring/stress/jsonrpc-body.selftest.mjs
 */
import { parseJsonRpcBody } from "./jsonrpc-body.mjs";

const OK = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };
const DISCOVER_LIKE = {
  jsonrpc: "2.0",
  id: 2,
  result: { content: [{ type: "text", text: "## Catalog\n- **Structured data:** Use `novada_scrape`\ndata: not a frame" }] },
};
const NOTIFY = { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } };

const cases = [
  // [label, body, contentType, expected (object | null)]
  ["plain JSON", JSON.stringify(OK), "application/json", OK],
  ["plain JSON whose text contains 'data:' (2026-11-24 regression)", JSON.stringify(DISCOVER_LIKE), "application/json", DISCOVER_LIKE],
  ["same, no Content-Type header", JSON.stringify(DISCOVER_LIKE), undefined, DISCOVER_LIKE],
  ["pretty-printed JSON (real newlines)", JSON.stringify(DISCOVER_LIKE, null, 2), "application/json", DISCOVER_LIKE],
  ["SSE single frame", `event: message\ndata: ${JSON.stringify(OK)}\n\n`, "text/event-stream", OK],
  ["SSE frame without Content-Type", `data: ${JSON.stringify(OK)}\n\n`, undefined, OK],
  ["SSE notification then response -> response", `data: ${JSON.stringify(NOTIFY)}\n\ndata: ${JSON.stringify(OK)}\n\n`, "text/event-stream", OK],
  ["SSE response then [DONE]", `data: ${JSON.stringify(OK)}\n\ndata: [DONE]\n\n`, "text/event-stream; charset=utf-8", OK],
  ["SSE with no data frame", "event: ping\n\n", "text/event-stream", null],
  ["invalid JSON", "{not json", "application/json", null],
  ["empty body", "", "application/json", null],
  ["null body", null, undefined, null],
];

let failures = 0;
for (const [label, body, ct, expected] of cases) {
  const got = parseJsonRpcBody(body, ct);
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) failures += 1;
  console.log(`${pass ? "  ✓" : "  ✗ FAIL:"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)?.slice(0, 120)}`}`);
}
if (failures > 0) {
  console.error(`[jsonrpc-body selftest] ${failures} failure(s)`);
  process.exit(1);
}
console.log(`[jsonrpc-body selftest] OK — ${cases.length} case(s)`);
