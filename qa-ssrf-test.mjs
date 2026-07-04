import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" })
});
const c = new Client({ name: "qa-ssrf", version: "0" }, { capabilities: {} });
await c.connect(t);

async function test(label, tool, args) {
  try {
    const r = await c.callTool({ name: tool, arguments: args });
    const isError = !!r.isError;
    const text = (r.content?.[0]?.text ?? "").slice(0, 200);
    console.log(JSON.stringify({ test: label, isError, text }));
  } catch(e) {
    console.log(JSON.stringify({ test: label, threw: true, err: String(e).slice(0, 200) }));
  }
}

// Test 1: browser_flow with 0.0.0.1 (0.0.0.0/8 - loopback on Linux - SHOULD be blocked)
await test("BF_SSRF_0001", "novada_browser_flow", {
  url: "http://0.0.0.1/secret", actions: [{ type: "screenshot" }], country: ""
});

// Test 2: browser_flow with fc00::1 (IPv6 ULA - SHOULD be blocked)
await test("BF_SSRF_fc001", "novada_browser_flow", {
  url: "http://[fc00::1]/secret", actions: [{ type: "screenshot" }], country: ""
});

// Test 3: browser_flow with 100.64.0.1 (CGNAT - SHOULD be blocked)
await test("BF_SSRF_CGNAT", "novada_browser_flow", {
  url: "http://100.64.0.1/secret", actions: [{ type: "screenshot" }], country: ""
});

// Test 4: novada_browser (canonical) with same IPs for comparison
await test("BROWSER_SSRF_0001", "novada_browser", {
  actions: [{ action: "navigate", url: "http://0.0.0.1/secret", wait_until: "domcontentloaded" }],
  timeout: 60000
});

await test("BROWSER_SSRF_fc001", "novada_browser", {
  actions: [{ action: "navigate", url: "http://[fc00::1]/secret", wait_until: "domcontentloaded" }],
  timeout: 60000
});

await c.close();
