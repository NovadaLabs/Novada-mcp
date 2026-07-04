import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-ls", version: "0" }, { capabilities: {} });
await c.connect(t);

async function call(name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    return { ok: !r.isError, isError: r.isError ?? false, text };
  } catch(e) {
    return { ok: false, isError: true, text: String(e), threw: true };
  }
}

// U+2028 LINE SEPARATOR in middle of query
const lsMid = "test result";
const r1 = await call("novada_search", { query: lsMid, engine: "google", num: 3 });
console.log("U+2028 in middle:", JSON.stringify({ len: lsMid.length, trimResult: lsMid.trim(), isError: r1.isError, preview: r1.text.slice(0, 300) }));

// U+2029 PARAGRAPH SEPARATOR in middle
const psMid = "test result";
const r2 = await call("novada_search", { query: psMid, engine: "google", num: 3 });
console.log("U+2029 in middle:", JSON.stringify({ len: psMid.length, trimResult: psMid.trim(), isError: r2.isError, preview: r2.text.slice(0, 300) }));

// Check novada_browser with "中文" country code 
const r3 = await call("novada_browser", { 
  actions: [{ action: "screenshot" }], 
  timeout: 30000, 
  country: "中文"  // 2 CJK chars = .length 2
});
console.log("CJK country in browser:", JSON.stringify({ isError: r3.isError, isValidationError: r3.text.includes("country"), preview: r3.text.slice(0, 300) }));

// Check novada_unblock with "中文" country
const r4 = await call("novada_unblock", {
  url: "https://example.com",
  method: "render",
  timeout: 5000,
  country: "中文"
});
console.log("CJK country in unblock:", JSON.stringify({ isError: r4.isError, isValidationError: r4.text.includes("country"), preview: r4.text.slice(0, 300) }));

await c.close();
