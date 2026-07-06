import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function test(label, args, c) {
  try {
    const r = await c.callTool({ name: "novada_unblock", arguments: args });
    return { label, isError: r.isError, text: (r.content?.[0]?.text ?? '').slice(0, 500) };
  } catch (err) {
    return { label, isError: true, error: err.message };
  }
}

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa2", version: "0" }, { capabilities: {} });
await c.connect(t);

const results = [];

// T21: Large max_chars exactly at 500000 (should be accepted schema-wise)
results.push(await test("T21_max_chars_exact_500000", { url: "https://example.com", method: "render", max_chars: 500000 }, c));

// T22: Negative timeout (below min 5000)
results.push(await test("T22_negative_timeout", { url: "https://example.com", method: "render", timeout: -1 }, c));

// T23: Timeout exactly at 5000 (min boundary) 
results.push(await test("T23_timeout_exact_min_5000", { url: "https://example.com", method: "render", timeout: 5000 }, c));

// T24: URL with file:// scheme
results.push(await test("T24_file_scheme", { url: "file:///etc/passwd", method: "render" }, c));

// T25: URL with data:// scheme
results.push(await test("T25_data_scheme", { url: "data:text/html,<script>alert(1)</script>", method: "render" }, c));

// T26: IPv4 CGNAT range (100.64.0.0/10 - private per schema)
results.push(await test("T26_cgnat_ip", { url: "http://100.64.0.1/test", method: "render" }, c));

// T27: wait_for with long string (no length limit in schema)
results.push(await test("T27_wait_for_long_string", { url: "https://example.com", method: "render", wait_for: "a".repeat(10000) }, c));

// T28: method omitted (should default to "render")
results.push(await test("T28_method_omitted", { url: "https://example.com" }, c));

// T29: Extra unknown param (should be stripped by Zod)
results.push(await test("T29_extra_unknown_param", { url: "https://example.com", method: "render", unknown_param: "value" }, c));

// T30: max_chars exactly at 1000 (min boundary)
results.push(await test("T30_max_chars_exact_min_1000", { url: "https://example.com", method: "render", max_chars: 1000 }, c));

// T31: country with tab char (length 2 but not alpha)
results.push(await test("T31_country_tab_char", { url: "https://example.com", method: "render", country: "u\t" }, c));

for (const r of results) {
  console.log(`\n=== ${r.label} ===`);
  console.log("isError:", r.isError);
  console.log("text/error:", r.text || r.error || "(empty)");
}

await c.close();
