/**
 * QA: truncatePreservingTable edge case testing
 * Tests: table at last 30%, table bigger than maxChars, no table, very small maxChars
 */

// Import the compiled build utility by running a direct test via eval in node
// Instead, test the behavior by constructing content and observing extract output

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
});
const c = new Client({ name: "qa-perf-truncate", version: "0" }, { capabilities: {} });
await c.connect(t);

// We can't directly call truncatePreservingTable, but we can analyze the source
// and test it by reading the compiled build

// Let's load the built code and call the exported function directly
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Direct unit test of truncatePreservingTable via the compiled build
// The function is exported from build/utils/html.js
console.log("=== Testing truncatePreservingTable logic directly ===\n");

try {
  const htmlUtils = await import("/Users/tongwu/Projects/novada-mcp/build/utils/html.js");
  const { truncatePreservingTable } = htmlUtils;

  // Test 1: table in last 30%, fits within maxChars → use table-preservation path
  const longProse = "A".repeat(7000);  // 70% of 10000
  const table = `| Col1 | Col2 | Col3 |\n|------|------|------|\n| val1 | val2 | val3 |\n| val4 | val5 | val6 |\n`;
  const tableLen = table.length;
  const content1 = longProse + table;
  const maxChars1 = 8000;
  const result1 = truncatePreservingTable(content1, maxChars1);
  console.log("Test 1 - table in last 30%, fits within maxChars:");
  console.log("  input length:", content1.length);
  console.log("  maxChars:", maxChars1);
  console.log("  result length:", result1.length);
  console.log("  table preserved:", result1.includes("| Col1 |"));
  console.log("  tableStartIdx:", content1.indexOf("|"));
  console.log("  30% boundary:", content1.length * 0.7);

  // Test 2: table starts before 70% mark — should use standard truncation (table NOT preserved)
  const prose2 = "B".repeat(3000);  // only 30% before table
  const table2 = `| Col1 | Col2 |\n|------|------|\n| row1 | val1 |\n`.repeat(200);  // very long table
  const content2 = prose2 + table2;
  const maxChars2 = 5000;
  const result2 = truncatePreservingTable(content2, maxChars2);
  console.log("\nTest 2 - table starts at 30% mark, long table:");
  console.log("  input length:", content2.length);
  console.log("  tableStartIdx:", prose2.length);
  console.log("  70% boundary:", content2.length * 0.7);
  console.log("  result length:", result2.length);
  console.log("  table preserved:", result2.includes("| Col1 |"));

  // Test 3: table itself exceeds maxChars → fall through to standard truncation
  const prose3 = "C".repeat(100);
  const bigTable = `| Col1 | Col2 |\n|------|------|\n` + `| data | data |\n`.repeat(5000);  // 150K chars
  const content3 = prose3 + bigTable;
  const maxChars3 = 1000;  // tiny max
  const result3 = truncatePreservingTable(content3, maxChars3);
  console.log("\nTest 3 - table itself exceeds maxChars:");
  console.log("  input length:", content3.length);
  console.log("  maxChars:", maxChars3);
  console.log("  result length:", result3.length);
  console.log("  result <= maxChars:", result3.length <= maxChars3);

  // Test 4: Multiple tables — last one is checked
  const prose4 = "D".repeat(5000);
  const table4a = `| First | Table |\n|-------|-------|\n| a | b |\n`;
  const middle4 = "E".repeat(2000);
  const table4b = `| Second | Table |\n|--------|-------|\n| c | d |\n`;
  const content4 = prose4 + table4a + middle4 + table4b;
  const maxChars4 = 8000;
  const result4 = truncatePreservingTable(content4, maxChars4);
  console.log("\nTest 4 - two tables, last one in last 30%:");
  console.log("  content4 length:", content4.length);
  console.log("  last table starts at:", prose4.length + table4a.length + middle4.length);
  console.log("  70% of content4:", content4.length * 0.7);
  console.log("  result length:", result4.length);
  console.log("  First table preserved:", result4.includes("| First |"));
  console.log("  Second table preserved:", result4.includes("| Second |"));

  // Test 5: No table — standard paragraph truncation
  const noTable = "Word ".repeat(10000);  // 50000 chars
  const maxChars5 = 1000;
  const result5 = truncatePreservingTable(noTable, maxChars5);
  console.log("\nTest 5 - no table, standard truncation:");
  console.log("  result length:", result5.length);
  console.log("  result <= maxChars5:", result5.length <= maxChars5);

  // Test 6: Edge case - table starts exactly at 70% boundary
  const exactBoundary = "F".repeat(7000);
  const tableAtBoundary = `| X | Y |\n|---|---|\n| a | b |\n`;
  const content6 = exactBoundary + tableAtBoundary;
  const maxChars6 = 8000;
  const result6 = truncatePreservingTable(content6, maxChars6);
  console.log("\nTest 6 - table starts exactly at 70% boundary:");
  console.log("  tableStart:", exactBoundary.length);
  console.log("  70% boundary:", content6.length * 0.7);
  console.log("  table starts past 70%?:", exactBoundary.length > content6.length * 0.7);
  console.log("  table preserved:", result6.includes("| X |"));

  // Test 7: truncatePreservingTable with content ALREADY within maxChars - should return as-is
  const shortContent = "Short content.\n\nParagraph 2.";
  const result7 = truncatePreservingTable(shortContent, 10000);
  console.log("\nTest 7 - content fits in maxChars:");
  console.log("  result === shortContent:", result7 === shortContent);

  // Test 8: Table preservation path - trimmedPrefix + tableBlock may be slightly over maxChars
  // From code: return (trimmedPrefix + tableBlock).slice(0, maxChars);
  // .slice(0, maxChars) is applied at the end, so it CAN cut the table header mid-cell
  const prose8 = "G".repeat(7500);
  const table8 = `| ColA | ColB | ColC | ColD | ColE | ColF |\n|------|------|------|------|------|------|\n| val1 | val2 | val3 | val4 | val5 | val6 |\n`;
  const content8 = prose8 + table8;
  // maxChars where table preservation applies but the .slice(0, maxChars) truncates table
  const tableStart8 = prose8.length;  // > 70% of content8.length
  const tableEnd8 = content8.length;
  const tableLen8 = table8.length;
  const maxChars8 = tableStart8 + Math.floor(table8.length / 2);  // cut table in half
  const result8 = truncatePreservingTable(content8, maxChars8);
  console.log("\nTest 8 - table preservation path .slice cuts table:");
  console.log("  tableLen:", tableLen8, "maxChars:", maxChars8);
  console.log("  result length:", result8.length);
  console.log("  table header intact:", result8.includes("| ColA | ColB | ColC | ColD | ColE | ColF |"));
  console.log("  table separator intact:", result8.includes("|------|"));
  console.log("  last chars of result:", JSON.stringify(result8.slice(-50)));

} catch (e) {
  console.log("Error importing html utils:", e.message);
}

await c.close();
