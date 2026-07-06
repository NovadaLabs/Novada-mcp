/**
 * Test: static proxy country param is required but ignored in IP selection
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Two entries - no country info in format (IP:PORT:USER:PASS doesn't encode country)
const LIST_US_DE = "1.1.1.1:8886:user_us:pass_us\n2.2.2.2:8887:user_de:pass_de";

const env = Object.assign({}, process.env, {
  NOVADA_API_KEY: "dummy",
  NOVADA_STATIC_PROXY_LIST: LIST_US_DE,
});
delete env.NOVADA_PROXY_USER;
delete env.NOVADA_PROXY_PASS;
delete env.NOVADA_PROXY_ENDPOINT;

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env,
});
const c = new Client({ name: "qa-country", version: "0" }, { capabilities: {} });
await c.connect(t);

// Request country=de
const r = await c.callTool({ name: "novada_proxy_static", arguments: { country: "de", session_id: "s1" } });
const text = r.content[0].text;
console.log("=== Static proxy country=de with mixed list ===");
console.log(text);
console.log("");
console.log("Returned 1.1.1.1 (first entry)?", text.includes("1.1.1.1"));
console.log("Returned 2.2.2.2 (second entry)?", text.includes("2.2.2.2"));
console.log("Shows 'DE' targeting?", text.includes("DE"));
console.log("");
console.log("FINDING: country=de was specified but IP selection always picks entries[0] (1.1.1.1).");
console.log("The schema marks country as required with description 'each country has a distinct pool'");
console.log("but selection logic ignores country entirely.");

await c.close();
