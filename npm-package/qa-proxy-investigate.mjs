/**
 * Deep investigation of failing tests: static/dedicated masking and env format
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DUMMY_KEY = "dummy";
const VALID_LIST = "151.242.47.74:8886:ax0kSJ8snE6wF1mR:p3K0rNpsP2iR";

const makeClientWithList = async (envKey, list) => {
  const env = Object.assign({}, process.env, {
    NOVADA_API_KEY: DUMMY_KEY,
    [envKey]: list,
  });
  delete env.NOVADA_PROXY_USER;
  delete env.NOVADA_PROXY_PASS;
  delete env.NOVADA_PROXY_ENDPOINT;

  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-inv", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return c;
};

async function main() {
  // Test 1: Static proxy url format - what does the raw output look like?
  console.log("=== Static proxy URL format RAW OUTPUT ===");
  const staticClient = await makeClientWithList("NOVADA_STATIC_PROXY_LIST", VALID_LIST);
  const r1 = await staticClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1" } });
  console.log("isError:", r1.isError);
  console.log("FULL OUTPUT:");
  console.log(r1.content[0].text);
  console.log("\n---");

  // Test 2: Static proxy env format - what does it look like?
  console.log("=== Static proxy ENV format RAW OUTPUT ===");
  const r2 = await staticClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1", format: "env" } });
  console.log("isError:", r2.isError);
  console.log("FULL OUTPUT:");
  console.log(r2.content[0].text);
  console.log("\n---");

  // Test 3: Static proxy curl format
  console.log("=== Static proxy CURL format RAW OUTPUT ===");
  const r3 = await staticClient.callTool({ name: "novada_proxy_static", arguments: { country: "us", session_id: "sess1", format: "curl" } });
  console.log("isError:", r3.isError);
  console.log("FULL OUTPUT:");
  console.log(r3.content[0].text);
  console.log("\n---");

  await staticClient.close();

  // Test 4: Dedicated proxy url format
  console.log("=== Dedicated proxy URL format RAW OUTPUT ===");
  const dedicatedClient = await makeClientWithList("NOVADA_DEDICATED_PROXY_LIST", VALID_LIST);
  const r4 = await dedicatedClient.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "sess1" } });
  console.log("isError:", r4.isError);
  console.log("FULL OUTPUT:");
  console.log(r4.content[0].text);
  console.log("\n---");

  // Test 5: Dedicated proxy env format
  console.log("=== Dedicated proxy ENV format RAW OUTPUT ===");
  const r5 = await dedicatedClient.callTool({ name: "novada_proxy_dedicated", arguments: { session_id: "sess1", format: "env" } });
  console.log("isError:", r5.isError);
  console.log("FULL OUTPUT:");
  console.log(r5.content[0].text);
  console.log("\n---");

  await dedicatedClient.close();

  // Test 6: Residential env format for comparison
  console.log("=== Residential proxy ENV format RAW OUTPUT (for comparison) ===");
  const env = Object.assign({}, process.env, {
    NOVADA_API_KEY: DUMMY_KEY,
    NOVADA_PROXY_USER: "testuser12345",
    NOVADA_PROXY_PASS: "supersecretpass",
    NOVADA_PROXY_ENDPOINT: "proxy.novada.com:7777",
  });
  const resClient = new Client({ name: "qa-inv", version: "0" }, { capabilities: {} });
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  await resClient.connect(t);
  const r6 = await resClient.callTool({ name: "novada_proxy_residential", arguments: { format: "env" } });
  console.log("FULL OUTPUT:");
  console.log(r6.content[0].text);
  await resClient.close();
}

main().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
