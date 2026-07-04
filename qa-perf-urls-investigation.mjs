/**
 * QA: Investigate the `urls` param validation failure in S9
 * The schema says `url` is REQUIRED and `urls` is optional ALIAS.
 * When only `urls` is passed (without `url`), the schema fails `url` validation.
 * This is a contract bug: the docs say `urls` is an alias for batching, but schema
 * requires `url` be present even when `urls` is provided.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-perf-urls-inv", version: "0" }, { capabilities: {} });
await c.connect(t);

console.log("=== Investigating `urls` param behavior ===");

// Test 1: only `urls` (no `url`) — documented alias, should work
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    urls: ["https://example.com/", "https://example.org/"],
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 1 - urls only (no url):", r.isError ? "ERROR" : "OK");
  console.log(text.slice(0, 400));
}

// Test 2: both `url` and `urls` — what wins?
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: "https://example.com/",
    urls: ["https://example.org/"],
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 2 - both url and urls:", r.isError ? "ERROR" : "OK");
  console.log(text.slice(0, 400));
}

// Test 3: urls with empty url string (to pass schema)
{
  try {
    const r = await c.callTool({ name: "novada_extract", arguments: {
      url: null,
      urls: ["https://example.com/"],
    }});
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    console.log("\nTest 3 - url=null, urls provided:", r.isError ? "ERROR" : "OK");
    console.log(text.slice(0, 400));
  } catch(e) {
    console.log("\nTest 3 threw:", e.message.slice(0, 200));
  }
}

// Test 4: what does the inputSchema say about url/urls?
const toolList = await c.listTools();
const extractTool = toolList.tools.find(t => t.name === "novada_extract");
console.log("\n=== novada_extract inputSchema for url/urls fields ===");
const urlSchema = extractTool?.inputSchema?.properties?.url;
const urlsSchema = extractTool?.inputSchema?.properties?.urls;
const requiredFields = extractTool?.inputSchema?.required ?? [];
console.log("url schema:", JSON.stringify(urlSchema, null, 2));
console.log("urls schema:", JSON.stringify(urlsSchema, null, 2));
console.log("required:", JSON.stringify(requiredFields));

await c.close();
