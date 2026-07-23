/**
 * monitoring/lib/mcp-client.mjs
 *
 * Minimal, dependency-free JSON-RPC 2.0 client for the LIVE Novada hosted MCP
 * endpoint (https://mcp.novada.com/mcp). Used by monitoring/smoke/*.
 *
 * - Node >=20 built-in `fetch`/`AbortController` only. No npm install, no SDK
 *   client, no axios. `node --check` on this file must pass with zero deps.
 * - Auth: `Authorization: Bearer <key>` header (matches hosted-server's Bearer
 *   auth path — see hosted-server/vercel/api/mcp.ts's `extractToken`'s
 *   `/^Bearer\s+/i` branch). Deliberately NOT sent as a `?token=` query param:
 *   this repo is public and CI logs are public, so a key in the request URL
 *   risks leaking into an Actions log line on any error/redirect trace. The
 *   key is read ONLY from `process.env.NOVADA_TEST_KEY` — never hardcode a
 *   key in this file or any file in this repo.
 * - Transport: the hosted endpoint runs the official MCP SDK's
 *   StreamableHTTPServerTransport (see hosted-server/vercel/api/mcp.ts). Its
 *   Accept-header contract REQUIRES the client to list both
 *   "application/json" and "text/event-stream" or the server replies 406 —
 *   see node_modules/@modelcontextprotocol/sdk .../webStandardStreamableHttp.js
 *   `handlePostRequest`. mcp.ts currently sets `enableJsonResponse: true`
 *   (plain JSON replies), but the transport is free to answer with SSE
 *   instead (and may in the future, or under different config) — so this
 *   client handles BOTH `application/json` and `text/event-stream` response
 *   bodies unconditionally.
 * - Stateless per-request: no `initialize` handshake, no `Mcp-Session-Id`
 *   needed — mcp.ts builds `sessionIdGenerator: undefined` (stateless mode)
 *   per request, and the SDK skips session/protocol-version validation
 *   entirely when no session ID has ever been issued.
 */

/** Hosted MCP endpoint URL. Override via `MCP_URL` env var (e.g. to point at
 * a local dev server) — defaults to the live production endpoint. */
export const MCP_URL = process.env.MCP_URL || "https://mcp.novada.com/mcp";

/**
 * Read the test API key from the environment. Throws a clear, actionable
 * error if unset — this is the ONLY place a key may enter this module, and
 * it must NEVER be hardcoded (test key or otherwise) in any committed file.
 *
 * Usage:
 *   NOVADA_TEST_KEY=<key> node monitoring/smoke/all-tools-smoke.mjs
 *
 * @returns {string} the raw API key
 */
export function requireTestKey() {
  const key = process.env.NOVADA_TEST_KEY;
  if (!key || key.trim() === "") {
    throw new Error(
      "[mcp-client] NOVADA_TEST_KEY is not set.\n" +
        "  Export a test key on the shell before running this script — never hardcode it in a file:\n" +
        "    NOVADA_TEST_KEY=<your-test-key> node monitoring/smoke/all-tools-smoke.mjs\n"
    );
  }
  return key;
}

let requestIdCounter = 0;
function nextRequestId() {
  requestIdCounter += 1;
  return requestIdCounter;
}

/**
 * Parse a raw HTTP response body as either plain JSON or an SSE
 * (`text/event-stream`) payload carrying JSON on `data:` lines. A single
 * JSON-RPC request yields at most one JSON-RPC response message, so on SSE
 * we scan `data:` lines from the end and return the last one that parses —
 * defensive against stray comment/keep-alive lines (`:`) or a leading
 * `event:` line preceding the actual payload.
 *
 * @param {string} rawText
 * @param {string} contentType
 * @returns {unknown} the parsed JSON-RPC message object
 */
function parseResponseBody(rawText, contentType) {
  const trimmed = rawText.trim();
  if (trimmed === "") {
    throw new Error("empty response body");
  }

  const looksLikeSse =
    contentType.includes("text/event-stream") || /^(event:|data:|id:|retry:|:)/m.test(trimmed);

  if (!looksLikeSse) {
    return JSON.parse(trimmed);
  }

  const dataPayloads = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");

  if (dataPayloads.length === 0) {
    throw new Error("SSE response contained no `data:` payload lines");
  }

  let lastParseError;
  for (let i = dataPayloads.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(dataPayloads[i]);
    } catch (err) {
      lastParseError = err;
    }
  }
  throw new Error(
    `SSE response's data: line(s) were not valid JSON: ${lastParseError?.message ?? "unknown parse error"}`
  );
}

/**
 * Pull the primary text payload out of a `tools/call` JSON-RPC response:
 * `result.content[0].text`. Falls back to a JSON-stringified `result` for
 * shapes that don't match (e.g. `tools/list`, or a future protocol change) —
 * defensive, should not happen against a spec-compliant MCP server.
 *
 * @param {any} parsed
 * @returns {string|null}
 */
function extractText(parsed) {
  const content = parsed?.result?.content;
  if (Array.isArray(content) && content.length > 0 && typeof content[0]?.text === "string") {
    return content[0].text;
  }
  if (parsed && Object.prototype.hasOwnProperty.call(parsed, "result")) {
    try {
      return JSON.stringify(parsed.result);
    } catch {
      return String(parsed.result);
    }
  }
  return null;
}

/**
 * Low-level JSON-RPC 2.0 request to the hosted MCP endpoint.
 *
 * `ok` is true only when: HTTP 200, the parsed body has a `result` key, there
 * is no top-level JSON-RPC `error`, AND the tool result itself does not carry
 * `isError: true` (the MCP convention hosted-server/vercel/api/mcp.ts uses for
 * validation/upstream/auth failures — these come back as a normal 200
 * `result`, not a JSON-RPC protocol error, so they must be checked
 * separately; see mcp.ts's `isError: true` call sites).
 *
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, httpStatus: number, timeMs: number, text: string|null, error: unknown, result: unknown}>}
 */
async function rpcRequest(method, params, { timeoutMs = 60000 } = {}) {
  const token = requireTestKey();
  const url = MCP_URL;
  const id = nextRequestId();
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The MCP SDK's StreamableHTTPServerTransport requires BOTH types to
        // be listed or it replies 406 Not Acceptable — see file header.
        accept: "application/json, text/event-stream",
        // Bearer header, never a URL query param — see file header.
        authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    });
    const timeMs = Math.round(performance.now() - startedAt);
    const httpStatus = res.status;
    const contentType = res.headers.get("content-type") || "";
    const rawText = await res.text();

    let parsed;
    try {
      parsed = parseResponseBody(rawText, contentType);
    } catch (parseErr) {
      return {
        ok: false,
        httpStatus,
        timeMs,
        text: rawText.slice(0, 2000),
        error: `response-parse-error: ${parseErr.message}`,
        result: null,
      };
    }

    const hasResult = Boolean(parsed) && Object.prototype.hasOwnProperty.call(parsed, "result");
    const hasRpcError =
      Boolean(parsed) && Object.prototype.hasOwnProperty.call(parsed, "error") && parsed.error != null;
    const isToolError = hasResult && parsed.result?.isError === true;

    const ok = httpStatus === 200 && hasResult && !hasRpcError && !isToolError;

    let error = null;
    if (hasRpcError) {
      error = parsed.error;
    } else if (isToolError) {
      error = { toolError: true, message: extractText(parsed) };
    }

    return {
      ok,
      httpStatus,
      timeMs,
      text: extractText(parsed),
      error,
      result: hasResult ? parsed.result : null,
    };
  } catch (err) {
    const timeMs = Math.round(performance.now() - startedAt);
    const isAbort = err?.name === "AbortError";
    return {
      ok: false,
      httpStatus: 0,
      timeMs,
      text: null,
      error: isAbort ? `timeout after ${timeoutMs}ms` : String(err?.message || err),
      result: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call a tool on the hosted MCP endpoint via `tools/call`.
 *
 * @param {string} name tool name, e.g. "novada_search"
 * @param {Record<string, unknown>} [args] tool arguments
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, httpStatus: number, timeMs: number, text: string|null, error: unknown}>}
 */
export async function callTool(name, args = {}, opts = {}) {
  // eslint-disable-next-line no-unused-vars
  const { result, ...publicShape } = await rpcRequest("tools/call", { name, arguments: args }, opts);
  return publicShape;
}

/**
 * List every tool currently served by the hosted MCP endpoint via
 * `tools/list`. This is the SINGLE SOURCE OF TRUTH for tool inventory —
 * callers must derive the tool-name list from this live call at runtime and
 * must never hardcode a tool-name list (that would silently drift from the
 * live/hosted surface — see config/surfaces.json's "hosted" manifest for why
 * this matters).
 *
 * @returns {Promise<Array<{name: string, annotations: unknown, inputSchema: unknown}>>}
 */
export async function listTools() {
  const res = await rpcRequest("tools/list", {}, { timeoutMs: 30000 });
  if (!res.ok) {
    throw new Error(
      `[mcp-client] tools/list failed: httpStatus=${res.httpStatus} error=${JSON.stringify(res.error)}`
    );
  }
  const tools = res.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("[mcp-client] tools/list response had no `result.tools` array");
  }
  return tools.map((t) => ({
    name: t.name,
    annotations: t.annotations ?? null,
    inputSchema: t.inputSchema ?? null,
  }));
}
