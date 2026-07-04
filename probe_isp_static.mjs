import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = {
  ...process.env,
  NOVADA_API_KEY: "1f35b477c9e1802778ec64aee2a6adfa",
};
const transport = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env,
});
const client = new Client({ name: "qa-probe", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
const result = await client.callTool({ name: "novada_plan_balance_all", arguments: { products: ["isp", "static"] } });
console.log("isp+static result:", JSON.stringify(result, null, 2));
await client.close();
