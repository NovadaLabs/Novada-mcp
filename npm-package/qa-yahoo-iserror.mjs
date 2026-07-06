/**
 * Test Yahoo engine path - SERP_UNAVAILABLE isError
 * Yahoo returns immediately before any API call, so tests the isError contract
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa", version: "0" }, { capabilities: {} });
await c.connect(t);

// Yahoo returns SERP_UNAVAILABLE immediately without API call
// This tests whether soft-failure paths get isError: true
const r = await c.callTool({ name: "novada_search", arguments: { query: "hello", engine: "yahoo" } });
console.log("=== Yahoo SERP_UNAVAILABLE ===");
console.log("isError:", r.isError);
console.log("content:", r.content?.[0]?.text?.slice(0, 400));
console.log();

// Check YAHOO_UNAVAILABLE - different from SERP_UNAVAILABLE
// YAHOO_UNAVAILABLE = "Yahoo Search is not available on this account."
if (!r.isError && r.content?.[0]?.text?.includes("not available")) {
  console.log("FINDING: Yahoo path returns soft failure without isError: true");
} else if (r.isError) {
  console.log("OK: Yahoo path sets isError: true");
} else {
  console.log("UNEXPECTED: unexpected response");
}

await c.close();
