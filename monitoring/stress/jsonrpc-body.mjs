/**
 * monitoring/stress/jsonrpc-body.mjs
 *
 * Parse a hosted-MCP HTTP response body that may be plain JSON or an SSE
 * stream ("data: {...}" frames) into a JSON-RPC object. Shared by
 * k6-stress.js (k6 runtime) and jsonrpc-body.selftest.mjs (node) — keep it
 * dependency-free and k6-compatible (no node: imports).
 *
 * 2026-11-25 fix: k6-stress.js used `body.indexOf("data:") !== -1` to decide
 * "this is SSE". Any plain-JSON body whose TEXT contains "data:" — e.g.
 * novada_discover's catalog ("**Structured data:** Use `novada_scrape` …") —
 * was then parsed as SSE, found no frame, returned null, and failed the
 * "jsonrpc response has result" check (30 false failures in the 2026-11-24
 * stress run, = the discover quarter of the request mix). SSE detection now
 * matches monitoring/lib/mcp-client.mjs and monitoring/dingtalk/checks.mjs:
 * the Content-Type header, or a field name at the START of a line.
 *
 * @param {string | null | undefined} body
 * @param {string | null | undefined} [contentType]
 * @returns {object | null}
 */
export function parseJsonRpcBody(body, contentType) {
  if (!body) {
    return null;
  }
  const trimmed = String(body).trim();
  if (trimmed === "") {
    return null;
  }
  const looksLikeSse =
    String(contentType || "").toLowerCase().indexOf("text/event-stream") !== -1 ||
    /^(event:|data:|id:|retry:|:)/m.test(trimmed);
  if (!looksLikeSse) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return null;
    }
  }
  const payloads = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.indexOf("data:") === 0)
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
  // The JSON-RPC response is the LAST frame (notifications may precede it).
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(payloads[i]);
    } catch (e) {
      // try the previous data: frame
    }
  }
  return null;
}
