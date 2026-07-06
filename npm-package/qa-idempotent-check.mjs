import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa-idempotent", version: "0" }, { capabilities: {} });
await c.connect(t);

const tools = (await c.listTools()).tools;
const monitorTool = tools.find(t => t.name === "novada_monitor");
const verifyTool = tools.find(t => t.name === "novada_verify");
const searchTool = tools.find(t => t.name === "novada_search");

console.log("novada_monitor annotations:", JSON.stringify(monitorTool?.annotations, null, 2));
console.log("novada_verify annotations:", JSON.stringify(verifyTool?.annotations, null, 2));
console.log("novada_search annotations:", JSON.stringify(searchTool?.annotations, null, 2));

// Also check additionalProperties presence for a sample schema
const searchSchema = searchTool?.inputSchema;
console.log("novada_search additionalProperties:", searchSchema?.additionalProperties);

// Check novada_verify required[] 
const verifyRequired = verifyTool?.inputSchema?.required ?? [];
console.log("novada_verify required:", verifyRequired);

await c.close();
