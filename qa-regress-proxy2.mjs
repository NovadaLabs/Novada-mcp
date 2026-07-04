import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
async function makeClient(extraEnv = {}) {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }, extraEnv),
  });
  const c = new Client({ name: "qa-proxy2", version: "0" }, { capabilities: {} });
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

const ENV = {
  NOVADA_PROXY_USER: "customer-testaccount-zone-res",
  NOVADA_PROXY_PASS: "secretpassword999",
  NOVADA_PROXY_ENDPOINT: "proxy.novada.com:1234"
};

const { client } = await makeClient(ENV);

// Test novada_proxy_static
const r1 = await callTool(client, "novada_proxy_static", { country: "us", session_id: "test123", format: "url" });
console.log("proxy_static url:", JSON.stringify(r1).slice(0, 600));
const r1Str = JSON.stringify(r1);
console.log("  contains 'testaccount':", r1Str.includes("testaccount"));
console.log("  contains 'secretpassword999':", r1Str.includes("secretpassword999"));

// Test novada_proxy_dedicated
const r2 = await callTool(client, "novada_proxy_dedicated", { session_id: "test456", format: "url" });
console.log("proxy_dedicated url:", JSON.stringify(r2).slice(0, 600));
const r2Str = JSON.stringify(r2);
console.log("  contains 'testaccount':", r2Str.includes("testaccount"));
console.log("  contains 'secretpassword999':", r2Str.includes("secretpassword999"));

// Test novada_proxy_residential with url format - check zone suffix masking
const r3 = await callTool(client, "novada_proxy_residential", { format: "url", country: "us" });
console.log("proxy_residential url:", JSON.stringify(r3).slice(0, 800));

// Test that error messages don't leak zone-suffixed usernames
// Trigger an error by passing invalid format
const r4 = await callTool(client, "novada_proxy", { type: "residential", format: "invalid" });
console.log("proxy invalid format error:", JSON.stringify(r4).slice(0, 600));
const r4Str = JSON.stringify(r4);
console.log("  contains 'testaccount':", r4Str.includes("testaccount"));

// Test novada_health_all with proxy set
const r5 = await callTool(client, "novada_health_all", {});
const r5Str = r5.result?.content?.[0]?.text ?? "";
console.log("health_all proxy configured_unverified:", r5Str.includes("configured_unverified") || r5Str.includes("Configured (not verified)") || r5Str.includes("configured (not verified)"));
console.log("health_all proxy active:", r5Str.includes("✅") && r5Str.toLowerCase().includes("proxy") && r5Str.includes("✅ Active"));
console.log("health_all sample:", r5Str.slice(0, 800));

await client.close();
