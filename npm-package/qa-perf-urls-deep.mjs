/**
 * QA: Deep investigation of urls vs url batching behavior and token overflow risks
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-perf-urls-deep", version: "0" }, { capabilities: {} });
await c.connect(t);

console.log("=== Deep investigation ===\n");

// Test 1: url=array of 2 (correct documented way) - check that both items appear in compact summary
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: ["https://example.com/", "https://example.org/"],
    max_chars: 25000,
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("Test 1 - url as array of 2 (correct way):", r.isError ? "ERROR" : "OK");
  console.log("Contains [1/2]:", text.includes("[1/2]"));
  console.log("Contains [2/2]:", text.includes("[2/2]"));
  const summaryLines = text.split("\n").slice(0, 20).join("\n");
  console.log(summaryLines);
}

// Test 2: When both url=single and urls=array, what is processed?
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: "https://example.com/",
    urls: ["https://example.org/", "https://example.net/"],
    max_chars: 25000,
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 2 - url=single + urls=array (what wins?):", r.isError ? "ERROR" : "OK");
  console.log("Is batch?:", text.includes("Batch Extract"));
  console.log("First 400 chars:", text.slice(0, 400));
}

// Test 3: Verify perItemBudget calculation with 10 items, max_chars=5000
// Expected: max(500, floor(5000/10)) = max(500, 500) = 500
// But wait: is the result compact summary total size within max_chars?
// The compact summary has headers + metadata per item PLUS the snippet
// Headers are NOT counted within perItemBudget
// Total output could significantly exceed max_chars
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: ["https://example.com/", "https://example.org/", "https://example.net/"],
    max_chars: 3000,  // 3 items, so perItemBudget = max(500, 1000) = 1000
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 3 - 3 items max_chars=3000 (perItemBudget should be 1000):", r.isError ? "ERROR" : "OK");
  console.log("Total output length:", text.length);
  // Find per-item snippets and check they're ≤ 1000 chars
  const matches = text.match(/### \[\d+\/\d+\][\s\S]*?(?=### \[|## Agent Hints|$)/g) || [];
  for (const m of matches) {
    console.log("Item block length:", m.length, m.slice(0, 100));
  }
}

// Test 4: Check the compact summary total output size with 10 URLs, max_chars=25000
// perItemBudget = max(500, floor(25000/10)) = max(500, 2500) = 2500
// Plus headers, metadata, Agent Hints section...
// Total could be > 25000
{
  const urls = Array.from({ length: 10 }, (_, i) => `https://example${i}.com/`);
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: urls,
    max_chars: 25000,
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 4 - 10 items max_chars=25000 (default), total output size:", text.length);
  console.log("Exceeds max_chars?:", text.length > 25000);
  // Also check: does the compact summary say it's a compact summary?
  console.log("Has compact hint:", text.includes("compact snippet"));
}

// Test 5: Investigate if HTML format ignores max_chars entirely
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: "https://example.com/",
    format: "html",
    max_chars: 2000,  // Should HTML truncate at 2000 or always at 10000?
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 5 - HTML format with max_chars=2000 (HTML always caps at 10K, ignores max_chars):");
  console.log("Text length:", text.length);
  console.log("Contains 10000 truncation:", text.includes("10,000 characters"));
  console.log("First 300:", text.slice(0, 300));
}

// Test 6: Check if compact summary's per-item path: leak is redacted
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: ["https://example.com/", "https://example.org/"],
    max_chars: 5000,
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 6 - batch path leak check:");
  console.log("Contains 'path:':", text.includes("path:"));
  console.log("Contains home dir pattern (~):", text.includes("~") || text.includes("/Users/") || text.includes("/home/"));
  const pathLines = text.match(/^path:.*$/m);
  console.log("Path line:", pathLines?.[0]?.slice(0, 100));
}

// Test 7: Compact summary - does it correctly report content_truncated for items?
// extractSingle output has content_truncated in metadata line
// parseItemStats reads it from the full extractSingle output
// But in compact mode the snippet is just first N chars - the actual content per item
// might say content_truncated:true if item was truncated at max_chars (default 25k)
{
  const r = await c.callTool({ name: "novada_extract", arguments: {
    url: ["https://example.com/", "https://example.org/"],
    max_chars: 25000,
  }});
  const text = r.content?.[0]?.text ?? JSON.stringify(r);
  console.log("\nTest 7 - content_truncated in compact summary:");
  // Look for the metadata rows in compact summary
  const metaLines = text.match(/chars:\d+ \| content_truncated:\w+/g) || [];
  console.log("Metadata lines:", metaLines);
}

await c.close();
