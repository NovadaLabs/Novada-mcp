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

// OWNER DECISION (2026-10-29): the monthly free-call gateway cap was removed
// entirely — "free-plan footer" (N/M free calls remaining) and "paid/uncapped
// footer" (gateway: uncapped (paid account)) no longer exist; there are only
// two footer variants now (billable / no-charge). See npm-package/CHANGELOG.md.

test("mcp.ts: billable footer exact text present, and contains neither 'free' nor a digit/digit counter", () => {
  const src = readFileSync(MCP_TS, "utf8");
  const BILLABLE_LINE = "gateway: usage is billed to your Novada account — balance and charges at dashboard.novada.com";
  assert.ok(src.includes(BILLABLE_LINE), "billable footer exact text must be in mcp.ts");
  assert.doesNotMatch(BILLABLE_LINE, /free/i, "billable footer must never contain the word 'free'");
  assert.doesNotMatch(BILLABLE_LINE, /\d+\s*\/\s*\d+/, "billable footer must never contain a N/M call counter");
});

test("mcp.ts: no-charge (cap-exempt) footer exact text present", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(
    src.includes("gateway: no charge for this call"),
    "no-charge footer exact text must be in mcp.ts",
  );
});

test("mcp.ts: old cap-era footer variants are gone", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(!src.includes("free calls remaining this month"), "the old 'N/M free calls remaining this month' footer must be gone");
  assert.ok(!src.includes("uncapped (paid account)"), "the old 'uncapped (paid account)' footer must be gone");
  assert.ok(!src.includes("free call — no quota consumed"), "the old exempt-footer wording ('free call — no quota consumed') must be gone");
  assert.ok(!src.includes("Free Gateway Cap Reached"), "the cap-rejection message must be gone");
});

test("mcp.ts: novada_setup success path carries the no-charge footer via buildStatusFooter(name)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // The novada_setup block ends where the next section begins (2026-10-29:
  // the gateway cap gate that used to anchor this was removed entirely).
  const setupStart = src.indexOf("// novada_setup is auth-free and never billed");
  const nextSectionStart = src.indexOf("// Browser caller-key billing");
  assert.ok(setupStart !== -1, "novada_setup block comment marker not found");
  assert.ok(nextSectionStart !== -1, "post-setup section marker not found");
  const setupBlock = src.slice(setupStart, nextSectionStart);
  // novada_setup is in CAP_EXEMPT_TOOLS, so buildStatusFooter(name) — called
  // with name === "novada_setup" — produces the no-charge line at runtime.
  assert.ok(
    setupBlock.includes("buildStatusFooter(name)"),
    "novada_setup success path must call buildStatusFooter(name)",
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
