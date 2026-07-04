/**
 * QA: Verify compact batch summary can overflow max_chars
 * The batch mode uses perItemBudget = max(500, floor(max_chars/N))
 * But the total output is: path line + header + N*(section_headers + metadata + snippet) + Agent Hints
 * Section headers and metadata are NOT deducted from max_chars
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-perf-overflow", version: "0" }, { capabilities: {} });
await c.connect(t);

console.log("=== Compact batch summary overflow test ===\n");

// Scenario: 10 items, max_chars=5000
// perItemBudget = max(500, floor(5000/10)) = 500
// Overhead per item: "### [N/10] OK: url\ntitle: ...\nchars: ... | content_truncated:...\n\n<snippet>\n\n---\n\n"
// That's roughly: 4+2+10+20 (header) + 7+50 (title) + 6+6+10+20 (chars meta) + 2 + snippet + 2 + 4 + 2
// ≈ 150+ chars overhead per item PLUS 500 chars snippet = 650 chars per item
// 10 items = 6500 chars
// Plus: "path: [local-path]\n\n" (~22) + "## Batch Extract Results\n" (~27) + "urls:10 | ...\n" (~30)
// Plus: "## Agent Hints\n" (~18) + 3 hint lines (~150)
// Total estimated: 6500 + 22 + 27 + 30 + 18 + 150 = ~6747 chars
// This EXCEEDS max_chars=5000 by ~1747 chars (35%)

for (const [n_urls, max_chars] of [
  [10, 5000],
  [5, 5000],
  [3, 5000],
  [2, 5000],
  [1, 5000],  // single URL, no batch mode - different path
]) {
  const urls = Array.from({ length: n_urls }, (_, i) => `https://example${i}.com/`);
  const args = n_urls === 1 ? { url: urls[0], max_chars } : { url: urls, max_chars };
  const r = await c.callTool({ name: "novada_extract", arguments: args });
  const text = r.content?.[0]?.text ?? "";
  // Count chars WITHOUT the path prefix (it's not content)
  const pathPrefixLen = text.startsWith("path:") ? (text.indexOf("\n\n") + 2) : 0;
  const bodyLen = text.length - pathPrefixLen;
  const overflowBy = bodyLen > max_chars ? bodyLen - max_chars : 0;
  console.log(`N=${n_urls}, max_chars=${max_chars}: total_body=${bodyLen} | overflow_by=${overflowBy} (${(overflowBy/max_chars*100).toFixed(1)}%)`);
}

// Now with max_chars=1000 (minimum) and 10 URLs
// perItemBudget = max(500, floor(1000/10)) = max(500, 100) = 500
// So perItemBudget is forced to 500, which is half of max_chars
// With 10 items each getting 500 char snippets: 10*500 = 5000 minimum content chars
// Completely blows max_chars=1000
console.log("\n--- max_chars=1000 (minimum) with 10 URLs ---");
{
  const urls = Array.from({ length: 10 }, (_, i) => `https://example${i}.com/`);
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: urls,
    max_chars: 1000,  // minimum allowed
  }});
  const text = r.content?.[0]?.text ?? "";
  const pathPrefixLen = text.startsWith("path:") ? (text.indexOf("\n\n") + 2) : 0;
  const bodyLen = text.length - pathPrefixLen;
  console.log(`max_chars=1000, 10 URLs: total_body=${bodyLen} (${(bodyLen/1000*100).toFixed(0)}% of max_chars)`);
  console.log("perItemBudget was forced to 500 (min floor) even though max_chars/10=100");
}

await c.close();
