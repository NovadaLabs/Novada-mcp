import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const ENV = {
  NOVADA_PROXY_USER: "customer-testaccount-zone-res",
  NOVADA_PROXY_PASS: "secretpassword999",
  NOVADA_PROXY_ENDPOINT: "proxy.novada.com:1234"
};

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }, ENV),
});
const c = new Client({ name: "qa-mask", version: "0" }, { capabilities: {} });
await c.connect(t);

const r = await c.callTool({ name: "novada_proxy_residential", arguments: { format: "url", country: "us" } });
const txt = r.content?.[0]?.text ?? "";
console.log("RESIDENTIAL URL full output:");
console.log(txt);
console.log("\n--- CHECKS ---");
console.log("contains testaccount:", txt.includes("testaccount"));
console.log("contains secretpassword999:", txt.includes("secretpassword999"));
console.log("contains customer-testaccount-zone-res (full):", txt.includes("customer-testaccount-zone-res"));
// The masking should show "cust***-zone-res" pattern
console.log("contains cust*** pattern:", txt.includes("cust***"));

await c.close();
