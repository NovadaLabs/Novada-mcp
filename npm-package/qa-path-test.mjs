import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa", version: "0" }, { capabilities: {} });
await c.connect(t);

const r = await c.callTool({ name: "novada_extract", arguments: {
  url: "https://example.com",
  format: "markdown",
  render: "auto"
}});
const text = r.content?.[0]?.text ?? "";
console.log("=== Path leak test ===");
console.log("Contains /Users/:", text.includes('/Users/'));
console.log("Contains tongwu:", text.includes('tongwu'));
console.log("Contains [local-path]:", text.includes('[local-path]'));
// Check first 200 chars
console.log("First 200 chars:", text.slice(0, 200));

await c.close();
