/**
 * QA: HTML format max_chars behavior + compact summary token math
 * Focus: HTML format ignores max_chars (hardcoded 10K)
 *        vs docs saying max_chars applies to "ALL formats"
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-perf-html-maxchars", version: "0" }, { capabilities: {} });
await c.connect(t);

// Test 1: HTML format with max_chars=2000 — should it honor max_chars=2000 or always 10000?
// From code:
//   if (html.length <= 10000) { htmlOutput = html; }
//   else { truncate at 10000 }
// max_chars is NEVER read in the HTML format path
// This means: if user passes max_chars=2000 with format=html, they get up to 10000 chars back
// Documented: "Maximum characters to return (default: 25000, max: 100000)"
// But HTML path ignores it entirely
console.log("=== HTML format vs max_chars ===\n");

// Get inputSchema to confirm
const toolList = await c.listTools();
const extractTool = toolList.tools.find(t => t.name === "novada_extract");
const maxCharsDesc = extractTool?.inputSchema?.properties?.max_chars?.description;
console.log("max_chars description:", maxCharsDesc?.slice(0, 200));

const formatDesc = extractTool?.inputSchema?.properties?.format?.description;
console.log("format description:", formatDesc);

// Test: HTML on a real-ish page (example.com is tiny, use something with more HTML)
// We'll use example.com which is ~600 chars HTML - so it's under 10K cap regardless
// But the BUG is the schema says max_chars applies but code doesn't apply it for html format

// Test 2: Does the compact batch summary output ever exceed max_chars?
// The batch compact summary uses perItemBudget per item but ALSO adds:
//   - "## Batch Extract Results" header
//   - Per-item headers "### [N/N] OK: url"
//   - Per-item metadata "title: ... chars: ... | content_truncated:..."
//   - Per-item snippet (perItemBudget chars)
//   - "---" separator
//   - "## Agent Hints" block
// None of these overhead characters are deducted from max_chars!
// For 10 items with max_chars=25000: perItemBudget = 2500
// But total output = 10 * (header ~50 + metadata ~100 + separator ~5 + snippet 2500)
//                  = 10 * ~2655 = ~26550 chars PLUS Agent Hints (~300)
// → Compact output can EXCEED max_chars by about 5-10%

// Let's verify with a real test measuring total output size relative to max_chars
const urls = Array.from({ length: 10 }, (_, i) => `https://example${i}.com/`);

for (const max_chars of [5000, 10000, 25000]) {
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: urls,
    max_chars,
  }});
  const text = r.content?.[0]?.text ?? "";
  const prefix = "path: [local-path]\n\n";
  const bodyLen = text.startsWith(prefix) ? text.length - prefix.length : text.length;
  console.log(`max_chars=${max_chars}: output=${text.length}, body=${bodyLen}, overflow=${bodyLen > max_chars ? bodyLen - max_chars : 0}`);
}

// Test 3: Compact summary - does it include ## Agent Memory block per item?
// Looking at T1 output above, items include:
//   ## Agent Memory\nremember: ...
// The snippet is taken from: r.content.slice(contentStart + 4) where contentStart = indexOf("---\n")
// But the FULL extractSingle output includes "## Agent Memory" section at the end
// The perItemBudget snippet might include this metadata section if content is short
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: ["https://example.com/", "https://example.org/"],
    max_chars: 5000,
  }});
  const text = r.content?.[0]?.text ?? "";
  console.log("\nSnippet includes Agent Memory:", text.includes("## Agent Memory"));
  console.log("Snippet includes Agent Hints:", text.includes("## Agent Hints"));
  // Extract the first item block
  const firstItem = text.match(/### \[1\/2\][\s\S]*?(?=### \[2\/|$)/)?.[0] ?? "";
  console.log("\nFirst item block:", firstItem);
}

// Test 4: Check url+urls conflict behavior
// When url=string AND urls=[array], what gets processed?
// From code: const urlList = params.urls ? params.urls : Array.isArray(params.url) ? ...
// So `urls` param takes priority over `url`!
// But in Test 2 result above: [1/2] was example.org (from urls array), not example.com (from url)
// This means: url param is required but SILENTLY IGNORED when urls is also provided
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: "https://example.com/",   // This should be IGNORED
    urls: ["https://example.org/", "https://example.net/"],  // This takes priority
    max_chars: 5000,
  }});
  const text = r.content?.[0]?.text ?? "";
  console.log("\nTest 4 - url=example.com (ignored), urls=[org, net]:");
  console.log("Has Batch Extract Results:", text.includes("Batch Extract Results"));
  console.log("Has example.com:", text.includes("example.com"));
  console.log("Has example.org:", text.includes("example.org"));
  console.log("Has example.net:", text.includes("example.net"));
  // Result: example.com is SILENTLY IGNORED even though it was passed as url
}

await c.close();
