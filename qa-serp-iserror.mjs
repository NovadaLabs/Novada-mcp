/**
 * Test SERP_UNAVAILABLE isError flag
 * Key question: when search silently swallows AxiosError and returns SERP_UNAVAILABLE text,
 * does isError=true or false?
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

// Call search with a valid short query (will fail at API level due to dummy key)
// This should hit the AxiosError branch and return SERP_UNAVAILABLE
// CRITICAL: Since SERP_UNAVAILABLE is returned normally (not thrown), isError should be false
const r = await c.callTool({ name: "novada_search", arguments: { query: "hello world" } });
console.log("=== SERP_UNAVAILABLE isError check ===");
console.log("isError:", r.isError);
console.log("content:", r.content?.[0]?.text?.slice(0, 500));

// If isError is false/undefined but content is SERP_UNAVAILABLE, this is a contract bug:
// the tool is silently returning a "failure" message as a "success" response

await c.close();
