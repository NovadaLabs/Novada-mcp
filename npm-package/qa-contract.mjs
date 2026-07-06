// MCP-CONTRACT QA PERSPECTIVE: required/defaults, additionalProperties, annotations
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" })
});
const c = new Client({ name: "qa-contract", version: "0" }, { capabilities: {} });
await c.connect(t);

// ---- 1. Dump full schema for offline analysis ----
const tools = await c.listTools();
console.log("SCHEMA_DUMP:", JSON.stringify(tools, null, 2));

await c.close();
