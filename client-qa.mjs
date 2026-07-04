// QA verify-your-setup + health_all live check
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY;
if (!KEY) { console.error("QA_KEY not set"); process.exit(1); }

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, {
    NOVADA_API_KEY: KEY,
    // deliberately NOT setting NOVADA_BROWSER_WS / NOVADA_PROXY_ENDPOINT
    // to simulate a fresh customer with only API key
  })
});
const c = new Client({ name: "cfg-verify-qa", version: "0" }, { capabilities: {} });
await c.connect(t);

// 1. List all tools
const toolList = await c.listTools();
const toolNames = toolList.tools.map(x => x.name);
console.log("=== TOOL COUNT ===", toolList.tools.length);
console.log("TOOLS:", toolNames.join(", "));

// 2. novada_setup
console.log("\n=== novada_setup ===");
let setupResult;
try {
  setupResult = await c.callTool({ name: "novada_setup", arguments: {} });
  const text = setupResult.content?.[0]?.text ?? JSON.stringify(setupResult).slice(0, 5000);
  console.log(text.slice(0, 5000));
} catch(e) {
  console.error("novada_setup ERROR:", e.message);
}

// 3. novada_health_all
console.log("\n=== novada_health_all ===");
let healthResult;
try {
  healthResult = await c.callTool({ name: "novada_health_all", arguments: {} });
  const text = healthResult.content?.[0]?.text ?? JSON.stringify(healthResult).slice(0, 5000);
  console.log(text.slice(0, 6000));
} catch(e) {
  console.error("novada_health_all ERROR:", e.message);
}

// 4. novada_health (quick version)
console.log("\n=== novada_health ===");
try {
  const healthQuick = await c.callTool({ name: "novada_health", arguments: {} });
  const text = healthQuick.content?.[0]?.text ?? JSON.stringify(healthQuick).slice(0, 3000);
  console.log(text.slice(0, 3000));
} catch(e) {
  console.error("novada_health ERROR:", e.message);
}

// 5. novada_search live
console.log("\n=== novada_search live test ===");
try {
  const sr = await c.callTool({ name: "novada_search", arguments: { query: "best open-source vector databases 2026", num: 3, engine: "google" }});
  const text = sr.content?.[0]?.text ?? JSON.stringify(sr).slice(0, 3000);
  console.log("SEARCH_RESULT_OK (first 1000 chars):", text.slice(0, 1000));
} catch(e) {
  console.error("novada_search ERROR:", e.message);
}

await c.close();
