import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }),
});
const c = new Client({ name: "qa-verify", version: "0" }, { capabilities: {} });
await c.connect(t);

const tests = [
  { name: "newline_only", claim: "\n" },
  { name: "empty_claim", claim: "" },
  { name: "javascript_lower", claim: "javascript:alert(1)" },
  { name: "javascript_leading_space", claim: " javascript:alert(1)" },
  { name: "unicode_rtl", claim: "test \u202Eclaim" },
  { name: "normal_valid", claim: "The sky is blue" },
];

for (const { name, claim } of tests) {
  try {
    const r = await c.callTool({ name: "novada_verify", arguments: { claim } });
    const txt = r.content?.[0]?.text ?? JSON.stringify(r);
    const isError = r.isError === true;
    console.log(name + ": isError=" + isError + " | " + txt.slice(0, 120));
  } catch (e) {
    console.log(name + ": THREW: " + (e.message?.slice(0, 80) ?? e));
  }
}

await c.close();
