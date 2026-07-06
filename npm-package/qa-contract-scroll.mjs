/**
 * Test: scroll action direction required vs default
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-scroll", version: "0" }, { capabilities: {} });
await c.connect(t);

// Test 1: scroll WITHOUT direction (schema says it's required but Zod has .default("down"))
try {
  const r1 = await c.callTool({ name: "novada_browser", arguments: {
    actions: [{ action: "scroll" }],  // no direction field
    timeout: 60000
  }});
  console.log("scroll_no_direction:", JSON.stringify(r1).slice(0, 200));
} catch (e) {
  console.log("scroll_no_direction_threw:", e.message);
}

// Test 2: scroll WITH direction (should always work)
try {
  const r2 = await c.callTool({ name: "novada_browser", arguments: {
    actions: [{ action: "scroll", direction: "down" }],
    timeout: 60000
  }});
  console.log("scroll_with_direction:", JSON.stringify(r2).slice(0, 200));
} catch (e) {
  console.log("scroll_with_direction_threw:", e.message);
}

// Test 3: navigate WITHOUT wait_until (schema says it's required, and Zod also requires it)
try {
  const r3 = await c.callTool({ name: "novada_browser", arguments: {
    actions: [{ action: "navigate", url: "https://example.com" }],  // no wait_until
    timeout: 60000
  }});
  console.log("navigate_no_wait_until:", JSON.stringify(r3).slice(0, 200));
} catch (e) {
  console.log("navigate_no_wait_until_threw:", e.message);
}

// Test 4: check what tools/list says about scroll's required fields
const toolsResult = await c.listTools();
const browserTool = toolsResult.tools.find(t => t.name === "novada_browser");
const actionsSchema = browserTool?.inputSchema?.properties?.actions;
const scrollSchema = actionsSchema?.items?.oneOf?.find(a => a.properties?.action?.const === "scroll");
console.log("scroll schema from tools/list:", JSON.stringify(scrollSchema, null, 2));
const navigateSchema = actionsSchema?.items?.oneOf?.find(a => a.properties?.action?.const === "navigate");
console.log("navigate schema required:", JSON.stringify(navigateSchema?.required));
console.log("navigate wait_until has default:", JSON.stringify(navigateSchema?.properties?.wait_until));

await c.close();
