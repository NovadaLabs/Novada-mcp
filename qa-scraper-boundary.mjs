import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-bound", version: "0" }, { capabilities: {} });
await c.connect(t);

// 59989 chars in data = 60000 total bytes - should PASS the 60KB check
// But individual param > 2000 chars check fires first
// Let's use multiple small params to test the total cap
const params = {};
for (let i = 0; i < 30; i++) {
  params[`field${i}`] = "x".repeat(1999);  // 1999 chars each, 30 fields = ~60KB total
}
const r = await c.callTool({ name: "novada_scraper_submit", arguments: {
  platform: "amazon.com",
  operation: "amazon_product_asin",
  params
}});
console.log("30x1999 params:", JSON.stringify(r).slice(0, 600));

// Check JSON total
console.log("total JSON size:", JSON.stringify(params).length);

await c.close();
