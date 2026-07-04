/**
 * QA: Confirm url+urls silent override and document the exact behavior
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-url-override", version: "0" }, { capabilities: {} });
await c.connect(t);

console.log("=== url + urls silent override verification ===\n");

// When url=["a.com","b.com"] AND urls=["c.com","d.com"] — which set wins?
// Expected by agent: all 4 URLs processed
// Actual: only urls (c.com, d.com) processed; url is silently dropped
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: ["https://example.com/", "https://example.net/"],
    urls: ["https://example.org/", "https://iana.org/"],
    max_chars: 5000,
  }});
  const text = r.content?.[0]?.text ?? "";
  console.log("url=[example.com, example.net], urls=[example.org, iana.org]:");
  console.log("example.com in result:", text.includes("example.com"));
  console.log("example.net in result:", text.includes("example.net"));
  console.log("example.org in result:", text.includes("example.org"));
  console.log("iana.org in result:", text.includes("iana.org"));
  console.log("Total URLs processed:", (text.match(/### \[\d+\/\d+\]/g) || []).length);
  console.log("Header:", text.match(/urls:\d+ \|/)?.[0]);
}

// Also check: does the schema report "url" as required in the tool's inputSchema?
// If url is REQUIRED, agents using only urls= will ALWAYS get "Invalid input" error
const toolList = await c.listTools();
const extractTool = toolList.tools.find(t => t.name === "novada_extract");
const required = extractTool?.inputSchema?.required ?? [];
console.log("\nextract tool required fields:", JSON.stringify(required));
console.log("url is required:", required.includes("url"));
console.log("urls is required:", required.includes("urls"));

// Does the hosted MCP at mcp.novada.com expose the same schema?
// (We can check the schema is the same in local build)
const urlSchemaPresence = !!extractTool?.inputSchema?.properties?.urls;
const urlsSchemaHasDescription = extractTool?.inputSchema?.properties?.urls?.description?.includes("Alias for url");
console.log("\nurls param exists in schema:", urlSchemaPresence);
console.log("urls description says 'Alias for url':", urlsSchemaHasDescription);

// So: docs say urls is "Alias for url when passing multiple URLs"
// But schema requires url + urls is optional
// The combination means: if agent follows docs and passes ONLY urls, they get "url: Invalid input"
// This is the core contract violation

await c.close();
