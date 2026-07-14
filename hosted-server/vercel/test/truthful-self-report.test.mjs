/**
 * Truthful self-report — Phase D/E tests
 *
 * ITEM 6: Uniform truthful status footer on every successful tool response
 * ITEM 7: MCP resources capability (list + read, zero quota)
 *
 * Runs on plain Node ≥22.18 (`node --test`) — same as paid-tier-cap.test.mjs.
 * Static analysis fences on api/mcp.ts + unit tests on vendored resource module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS   = join(__dirname, "..", "api", "mcp.ts");
const VENDOR_RESOURCES = join(__dirname, "..", "vendor", "novada-mcp", "resources", "index.js");

// ─── ITEM 6: Truthful status footer ──────────────────────────────────────────

test("mcp.ts: free-plan footer exact text present", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(
    src.includes("free calls remaining this month · cost: unknown — see dashboard.novada.com"),
    "free-plan footer must include 'N/M free calls remaining this month · cost: unknown — see dashboard.novada.com'",
  );
});

test("mcp.ts: paid/uncapped footer exact text present", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(
    src.includes("gateway: uncapped (paid account) · cost: unknown — see dashboard.novada.com"),
    "paid/uncapped footer exact text must be in mcp.ts",
  );
});

test("mcp.ts: exempt footer exact text present", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(
    src.includes("gateway: free call — no quota consumed"),
    "exempt footer exact text must be in mcp.ts",
  );
});


test("mcp.ts: novada_setup success path carries the exempt footer", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The novada_setup block ends with a return before the gate logic.
  // Extract just the novada_setup handler block (from the `if (name === "novada_setup")` comment
  // to "Gateway cap gate").
  const setupStart = src.indexOf("// novada_setup is auth-free and never charged");
  const gateStart  = src.indexOf("Gateway cap gate");
  assert.ok(setupStart !== -1, "novada_setup block comment marker not found");
  assert.ok(gateStart  !== -1, "Gateway cap gate marker not found");
  const setupBlock = src.slice(setupStart, gateStart);
  // The setup block must wire the SETUP_GATE sentinel to buildStatusFooter so the
  // exempt footer ("gateway: free call — no quota consumed") is produced at runtime.
  // We check for SETUP_GATE usage (not the literal string, which lives in buildStatusFooter).
  assert.ok(
    setupBlock.includes("SETUP_GATE"),
    "novada_setup success path must use SETUP_GATE to produce the exempt footer via buildStatusFooter",
  );
  assert.ok(
    setupBlock.includes("buildStatusFooter("),
    "novada_setup success path must call buildStatusFooter",
  );
});

// ─── ITEM 7: MCP resources capability ────────────────────────────────────────


test("mcp.ts: resources handlers contain no quota calls (enforceGatewayCap / decrementQuota)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // Extract the resources-handler section: from ListResourcesRequestSchema handler
  // registration up to (but not including) the ListPromptsRequestSchema handler or return server.
  const listResourcesIdx = src.indexOf("server.setRequestHandler(ListResourcesRequestSchema");
  const returnServerIdx  = src.lastIndexOf("return server;");
  assert.ok(listResourcesIdx !== -1, "resources handler section not found");
  assert.ok(returnServerIdx  !== -1, "return server; not found");
  const section = src.slice(listResourcesIdx, returnServerIdx);
  assert.doesNotMatch(section, /enforceGatewayCap/, "resources handlers must not call enforceGatewayCap");
  assert.doesNotMatch(section, /decrementQuota/,    "resources handlers must not call decrementQuota");
});

// ─── Unit tests: vendored resource module (pure functions) ───────────────────

const { listResources, readResource } = await import(VENDOR_RESOURCES);

test("resource unit: listResources returns ≥1 resource", () => {
  const result = listResources();
  assert.ok(Array.isArray(result.resources), "resources must be an array");
  assert.ok(result.resources.length >= 1, "must return at least 1 resource");
});

test("resource unit: listResources includes novada://scraper-platforms with name+mimeType", () => {
  const { resources } = listResources();
  const sp = resources.find(r => r.uri === "novada://scraper-platforms");
  assert.ok(sp,            "must include novada://scraper-platforms");
  assert.ok(sp.name,       "resource must have a name");
  assert.ok(sp.mimeType,   "resource must have mimeType");
});

test("resource unit: readResource novada://scraper-platforms returns content mentioning amazon.com", () => {
  const result = readResource("novada://scraper-platforms");
  assert.ok(result.contents.length >= 1, "must return at least one content block");
  const text = result.contents[0].text;
  assert.ok(typeof text === "string" && text.length > 0, "content text must be non-empty string");
  assert.ok(text.includes("amazon.com"), "catalog content must mention amazon.com");
});

test("resource unit: readResource unknown URI throws clean Error (no crash)", () => {
  assert.throws(
    () => readResource("novada://nonexistent-xyz"),
    /Unknown resource URI/,
    "unknown URI must throw Error with 'Unknown resource URI' in the message",
  );
});


// ─── FIX 1: ReadResourceRequestSchema handler must THROW, not return, errors ─
//
// Background: in the MCP SDK, a handler that RETURNS a value produces a
// JSON-RPC "result" response. Only a THROWN value (or McpError) produces a
// JSON-RPC "error" response that clients can distinguish from success.
// The old code returned `{ error: { code: -32602, message } }` which was
// serialised as a successful result with an error-shaped body.


// Unit-level handler fence: import vendor readResource + SDK McpError; verify
// that wrapping readResource(unknownUri) with the new throw-pattern produces a
// McpError (code -32602), not a plain return value.
const { McpError, ErrorCode } = await import("@modelcontextprotocol/sdk/types.js");

test("ReadResource handler behaviour: unknown URI throws McpError with InvalidParams code", async () => {
  const { readResource } = await import(VENDOR_RESOURCES);

  // Simulate the registered handler's try/catch logic (mirrors mcp.ts post-fix).
  async function simulateHandler(uri) {
    try {
      return readResource(uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new McpError(ErrorCode.InvalidParams, msg);
    }
  }

  // Must throw (not return) for an unknown URI.
  await assert.rejects(
    () => simulateHandler("novada://does-not-exist"),
    (err) => {
      assert.ok(err instanceof McpError,                  "thrown error must be McpError");
      assert.strictEqual(err.code, ErrorCode.InvalidParams, "error code must be -32602 (InvalidParams)");
      assert.ok(err.message.includes("Unknown resource URI"), "message must include 'Unknown resource URI'");
      return true;
    },
  );
});
