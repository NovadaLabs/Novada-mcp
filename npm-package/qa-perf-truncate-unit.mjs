/**
 * Unit test truncatePreservingTable directly
 */
import { truncatePreservingTable } from "/Users/tongwu/Projects/novada-mcp/build/utils/html.js";

// Test 2 revisited: table at 25% of content (NOT in last 30%) — should NOT be preserved
// But Test 2 showed table preserved: true even when table is at 30% (before 70% boundary)
// Let's verify: table at tableStartIdx=3000, content.length=12600, 70% = 8820
// Since 3000 < 8820, the condition `tableStartIdx > content.length * 0.7` is FALSE
// So it SHOULD fall through to standard truncation
// But Test 2 showed table preserved: true — that means the standard truncation
// happened to include the table start (table is at 3000, maxChars=5000)

console.log("=== Verifying Test 2 anomaly ===");
const prose2 = "B".repeat(3000);
const table2 = `| Col1 | Col2 |\n|------|------|\n| row1 | val1 |\n`.repeat(200);
const content2 = prose2 + table2;
const maxChars2 = 5000;
const result2 = truncatePreservingTable(content2, maxChars2);
console.log("Table starts at:", prose2.length);
console.log("70% of content:", content2.length * 0.7);
console.log("Table start < 70%:", prose2.length < content2.length * 0.7);
console.log("maxChars:", maxChars2);
console.log("Standard truncation includes table start:", maxChars2 > prose2.length);
console.log("Result length:", result2.length);
console.log("Table found in result:", result2.includes("| Col1 |"));
// Table is at 3000, maxChars=5000, so standard truncation INCLUDES the table start
// The "preserved:true" in test 2 is a false positive in my test design, not a bug

// ========================================================
// Real bug verification: slice inside table rows
// ========================================================
console.log("\n=== Verifying table mid-row slice bug ===");

// Setup: table in last 30%, table+prefix exceeds maxChars, table itself fits
// trimmedPrefix + tableBlock → still sliced to maxChars
const longProse = "X".repeat(8000);  // 80% of content
const table = `| Header1 | Header2 | Header3 | Header4 |\n`
  + `|---------|---------|---------|------- |\n`
  + `| Value1  | Value2  | Value3  | Value4  |\n`
  + `| Value5  | Value6  | Value7  | Value8  |\n`;
const content = longProse + table;
console.log("Content length:", content.length);
console.log("Table starts at:", longProse.length);
console.log("70% boundary:", content.length * 0.7);
console.log("Table in last 30%:", longProse.length > content.length * 0.7);

// maxChars such that prefix must be trimmed, table fits, but trimmedPrefix + tableBlock > maxChars
// prefixBudget = maxChars - tableLen
// trimmedPrefix = prefix.slice(prefix.length - prefixBudget)
// Then (trimmedPrefix + tableBlock).slice(0, maxChars)
const tableLen = table.length;
console.log("Table length:", tableLen);

// Choose maxChars = tableLen + some_prefix - small_amount_that_causes_slice
const maxCharsA = longProse.length + tableLen - 50;  // slightly less than full content
const resultA = truncatePreservingTable(content, maxCharsA);
console.log("\nmaxChars =", maxCharsA, "(full content - 50):");
console.log("Result length:", resultA.length);
console.log("Table header intact:", resultA.includes("| Header1 | Header2 | Header3 | Header4 |"));
console.log("Table separator intact:", resultA.includes("|---------|"));
console.log("All table rows:", resultA.includes("Value1") && resultA.includes("Value5"));
console.log("Last chars:", JSON.stringify(resultA.slice(-60)));

// Choose maxChars that cuts INSIDE the last table row
// Table header + sep = first 2 lines = ~90 chars
// Table data row = ~50 chars each
// Set maxChars to cut mid-way through second data row
const tableHeaderSep = `| Header1 | Header2 | Header3 | Header4 |\n|---------|---------|---------|------- |\n`;
const tableRow1 = `| Value1  | Value2  | Value3  | Value4  |\n`;
// For table preservation: prefixBudget = maxChars - tableLen
// If maxChars = tableLen + 100 (very small prefix)
const maxCharsB = tableLen + 100;  // almost just the table + tiny prefix
const resultB = truncatePreservingTable(content, maxCharsB);
console.log("\nmaxChars =", maxCharsB, "(table + 100 prefix):");
console.log("Result length:", resultB.length);
console.log("Table header intact:", resultB.includes("| Header1 |"));
console.log("Last chars:", JSON.stringify(resultB.slice(-60)));

// Try: table in last 30%, maxChars cuts mid-table
const prose3 = "Y".repeat(7001);  // just over 70%
const tableC = `| Col1 | Col2 |\n|------|------|\n` + `| data | info |\n`.repeat(100); // ~2500 chars
const contentC = prose3 + tableC;
console.log("\nContent C length:", contentC.length);
console.log("Table starts at:", prose3.length, "70% boundary:", contentC.length * 0.7);
const maxCharsC = 8000; // table won't all fit
const resultC = truncatePreservingTable(contentC, maxCharsC);
console.log("maxChars:", maxCharsC, "tableLen:", tableC.length);
console.log("Result length:", resultC.length);
console.log("Table header intact:", resultC.includes("| Col1 | Col2 |"));
console.log("Last chars:", JSON.stringify(resultC.slice(-80)));
console.log("Last char is pipe (mid-cell)?:", resultC.trim().endsWith("|") || resultC.trim().includes("| data | info |"));
// Check if the last row is complete
const lastTableRow = `| data | info |`;
const lastRowIdx = resultC.lastIndexOf(lastTableRow);
console.log("Last complete row ends at index:", lastRowIdx + lastTableRow.length, "vs result length:", resultC.length);
