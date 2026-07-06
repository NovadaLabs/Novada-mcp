/**
 * Deep investigation: isError field on crawl/map responses
 * MCP spec: errors should have isError=true, successes isError=false (or undefined/absent)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-iserror", version: "0" }, { capabilities: {} });
await c.connect(t);

async function call(name, args) {
  try {
    return await c.callTool({ name, arguments: args });
  } catch (e) {
    return { _thrown: true, error: String(e) };
  }
}

// Test 1: Zod validation error → isError should be true
const zodResult = await call("novada_crawl", { url: "ftp://example.com" });
console.log("Zod validation error:");
console.log("  isError:", zodResult.isError, "(type:", typeof zodResult.isError, ")");
console.log("  content[0].text preview:", (zodResult.content?.[0]?.text ?? "").slice(0, 100));
console.log("");

// Test 2: successful crawl of example.com → isError should be false/undefined
const successResult = await call("novada_crawl", { url: "https://example.com", max_pages: 1 });
console.log("Successful crawl result:");
console.log("  isError:", successResult.isError, "(type:", typeof successResult.isError, ")");
console.log("  content[0].text preview:", (successResult.content?.[0]?.text ?? "").slice(0, 100));
console.log("");

// Test 3: URL_UNREACHABLE error (unreachable host)
// Use an invalid hostname that will fail DNS
const unreachResult = await call("novada_crawl", { url: "https://this-domain-definitely-does-not-exist-qa-test.invalid", max_pages: 1 });
console.log("URL_UNREACHABLE error (invalid hostname):");
console.log("  isError:", unreachResult.isError, "(type:", typeof unreachResult.isError, ")");
console.log("  content[0].text preview:", (unreachResult.content?.[0]?.text ?? "").slice(0, 200));
console.log("");

// Test 4: novada_map with invalid hostname → isError=true?
const mapUnreachResult = await call("novada_map", { url: "https://this-domain-definitely-does-not-exist-qa-test.invalid" });
console.log("novada_map URL_UNREACHABLE:");
console.log("  isError:", mapUnreachResult.isError, "(type:", typeof mapUnreachResult.isError, ")");
console.log("  content[0].text preview:", (mapUnreachResult.content?.[0]?.text ?? "").slice(0, 200));
console.log("");

// Test 5: SPA detection (example.com — returns SPA message)
const spaResult = await call("novada_map", { url: "https://example.com", max_depth: 1 });
console.log("SPA detection:");
console.log("  isError:", spaResult.isError, "(type:", typeof spaResult.isError, ")");
console.log("  content[0].text preview:", (spaResult.content?.[0]?.text ?? "").slice(0, 100));
console.log("");

// MCP spec note: isError is a boolean field on CallToolResult
// undefined = field absent = treated as false (success) by clients
// According to MCP spec, tool errors must set isError=true in the result
// Let's check what the MCP SDK actually returns for each case

console.log("=== ANALYSIS ===");
console.log("MCP spec: isError=true for errors, isError=false or absent for success");
console.log("Zod validation isError:", zodResult.isError, "(expected: true)");
console.log("Success isError:", successResult.isError, "(expected: false or undefined)");
console.log("URL_UNREACHABLE isError:", unreachResult.isError, "(expected: true)");
console.log("Map SPA detection isError:", spaResult.isError, "(expected: false — SPA is NOT an error)");

await c.close();
