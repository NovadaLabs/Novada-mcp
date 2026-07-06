/**
 * Debug static/dedicated masking: why does "ax0k***" appear in command but test fails?
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DUMMY_KEY = "dummy";
// 4-char prefix is "ax0k" from "ax0kSJ8snE6wF1mR"
const VALID_LIST = "151.242.47.74:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR";

const env = Object.assign({}, process.env, {
  NOVADA_API_KEY: DUMMY_KEY,
  NOVADA_STATIC_PROXY_LIST: VALID_LIST,
  NOVADA_DEDICATED_PROXY_LIST: VALID_LIST,
});
delete env.NOVADA_PROXY_USER;
delete env.NOVADA_PROXY_PASS;
delete env.NOVADA_PROXY_ENDPOINT;

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env,
});
const c = new Client({ name: "qa-debug", version: "0" }, { capabilities: {} });
await c.connect(t);

// Test static url format
const r1 = await c.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1" } });
const text1 = r1.content[0].text;
console.log("=== Static URL format ===");
console.log(text1);
console.log("");
console.log("Includes 'ax0k***'?", text1.includes("ax0k***"));
console.log("Includes 'ax0kSJ8snE6wF1mR' (FULL USERNAME)?", text1.includes("ax0kSJ8snE6wF1mR"));
console.log("");

// Test dedicated url format
const r2 = await c.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "sess1" } });
const text2 = r2.content[0].text;
console.log("=== Dedicated URL format ===");
console.log(text2);
console.log("");
console.log("Includes 'ax0k***'?", text2.includes("ax0k***"));
console.log("Includes 'ax0kSJ8snE6wF1mR' (FULL USERNAME)?", text2.includes("ax0kSJ8snE6wF1mR"));

await c.close();
