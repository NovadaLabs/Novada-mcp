import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_KEY = "process.env.NOVADA_API_KEY";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: { ...process.env, NOVADA_API_KEY: API_KEY },
});
const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(transport);

// Check: inputSchema has max_pages/max_depth/include_subdomains/render in 'required'
// Even though they all have defaults. This is a schema doc bug — it would mislead agents
// into thinking these are mandatory.
const tools = await client.listTools();
const t = tools.tools.find(t => t.name === "novada_site_copy");
const schema = t.inputSchema;
console.log("required array:", JSON.stringify(schema.required));
console.log("Fields with defaults:");
for (const [k, v] of Object.entries(schema.properties ?? {})) {
  if ("default" in v) {
    console.log(`  ${k}: default=${JSON.stringify(v.default)}, in required: ${schema.required?.includes(k)}`);
  }
}

// Now check: does calling with ONLY url work fine (all defaults kick in)?
console.log("\n=== Only url - does it succeed? ===");
const r = await client.callTool({ name: "novada_site_copy", arguments: { url: "https://example.com" } });
console.log("isError:", r.isError ?? false);
console.log("First 200 chars:", (r.content?.[0]?.text ?? "").slice(0, 200));

await transport.close();
