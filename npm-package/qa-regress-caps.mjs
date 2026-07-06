import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
async function makeClient(extraEnv = {}) {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }, extraEnv),
  });
  const c = new Client({ name: "qa-caps", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c };
}

async function callTool(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

const { client } = await makeClient();

// Test scraper_submit with 65KB params
const bigPayload = "a".repeat(65000);
const r1 = await callTool(client, "novada_scraper_submit", {
  platform: "amazon.com",
  operation: "amazon_product_asin",
  params: { data: bigPayload }
});
console.log("scraper_submit 65KB:", JSON.stringify(r1).slice(0, 600));

// Test scraper_submit with valid but just-under-60KB params
const borderPayload = "b".repeat(59900);
const r2 = await callTool(client, "novada_scraper_submit", {
  platform: "amazon.com",
  operation: "amazon_product_asin",
  params: { data: borderPayload }
});
console.log("scraper_submit 59.9KB:", JSON.stringify(r2).slice(0, 600));

// Test scraper_submit with exactly 60KB params
const exactPayload = "c".repeat(60000);
const r3 = await callTool(client, "novada_scraper_submit", {
  platform: "amazon.com",
  operation: "amazon_product_asin",
  params: { data: exactPayload }
});
console.log("scraper_submit 60KB:", JSON.stringify(r3).slice(0, 600));

// Test proxy username masking in proxy url format  
const { client: c2 } = await makeClient({
  NOVADA_PROXY_USER: "customer-testaccount-zone-res",
  NOVADA_PROXY_PASS: "testpassword123",
  NOVADA_PROXY_ENDPOINT: "proxy.novada.com:1234"
});
const r4 = await callTool(c2, "novada_proxy", { type: "residential", format: "url" });
const r4Str = JSON.stringify(r4);
// The username should be partially masked in the URL
console.log("proxy url masking:", r4Str.slice(0, 800));
const hasUnmaskedUser = r4Str.includes("customer-testaccount-zone-res");
console.log("proxy url contains unmasked username:", hasUnmaskedUser);

// Proxy env format - check same
const r5 = await callTool(c2, "novada_proxy", { type: "residential", format: "env" });
const r5Str = JSON.stringify(r5);
console.log("proxy env masking:", r5Str.slice(0, 800));

// Proxy curl format - check same  
const r6 = await callTool(c2, "novada_proxy", { type: "residential", format: "curl" });
const r6Str = JSON.stringify(r6);
console.log("proxy curl masking:", r6Str.slice(0, 800));

await client.close();
await c2.close();
