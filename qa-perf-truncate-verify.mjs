/**
 * Precise verification of truncatePreservingTable mid-row cut
 */
import { truncatePreservingTable } from "/Users/tongwu/Projects/novada-mcp/build/utils/html.js";

// Test: content where trimmedPrefix + tableBlock > maxChars
// This can happen when:
// prefixBudget = maxChars - tableLen
// trimmedPrefix = prefix.slice(prefix.length - prefixBudget)
// → trimmedPrefix.length = min(prefix.length, prefixBudget)
// → trimmedPrefix + tableBlock = min(prefix.length, prefixBudget) + tableLen ≤ maxChars
// So the math is tight... let me trace what actually happens in the test case

// From test 8 output, table header was intact but second row cut:
// "------|---------|------- |\n| Value1  | Value2  | Value3  | Va"
// So the table was partially cut!

// Setup from test 8:
const longProse = "X".repeat(8000);
const table = `| Header1 | Header2 | Header3 | Header4 |\n`
  + `|---------|---------|---------|------- |\n`
  + `| Value1  | Value2  | Value3  | Value4  |\n`
  + `| Value5  | Value6  | Value7  | Value8  |\n`;
const content = longProse + table;
const maxCharsA = content.length - 50;  // 8117

console.log("=== Precise analysis of test 8 cut ===");
console.log("content.length:", content.length);  // 8167
console.log("table.length:", table.length);  // 167
console.log("table starts at:", longProse.length);  // 8000
console.log("70% boundary:", content.length * 0.7);  // 5716.9
console.log("table in last 30%:", longProse.length > content.length * 0.7);  // 8000 > 5716.9 = true
console.log("maxChars:", maxCharsA);  // 8117

// findTableEnd is supposed to return the end index of the table
// The table ends at: longProse.length + table.length = 8000 + 167 = 8167
// tableEnd = content.length = 8167
// tableEnd <= maxChars? 8167 <= 8117? NO → so we go into the else branch (table extends beyond maxChars)
console.log("tableEnd:", content.length);
console.log("tableEnd <= maxChars:", content.length <= maxCharsA);  // 8167 <= 8117 = FALSE

// So we try table preservation:
// tableBlock = content.slice(8000, 8167) = table (167 chars)
// tableLen = 167
// tableLen <= maxChars (167 <= 8117) = TRUE → we have room
// prefixBudget = maxChars - tableLen = 8117 - 167 = 7950
// prefix = content.slice(0, 8000) = 8000 chars of X's
// trimmedPrefix = prefix.slice(8000 - 7950) = prefix.slice(50) = 7950 chars
// trimmedPrefix + tableBlock = 7950 + 167 = 8117 chars
// .slice(0, 8117) = exactly the full combination → NO cut!

console.log("tableBlock length:", table.length);
console.log("prefixBudget:", maxCharsA - table.length);  // 7950
const trimmedPrefixLen = Math.min(longProse.length, maxCharsA - table.length);
console.log("trimmedPrefix length:", trimmedPrefixLen);  // min(8000, 7950) = 7950
console.log("total trimmedPrefix + table:", trimmedPrefixLen + table.length);  // 7950+167 = 8117

// So in test 8, the combined is exactly maxChars → .slice(0, maxChars) should NOT cut
// But the actual output showed: "------|---------|------- |\n| Value1  | Value2  | Value3  | Va"
// This means the table WAS cut! Let me check manually...

const resultA = truncatePreservingTable(content, maxCharsA);
console.log("\nActual result length:", resultA.length);
console.log("Expected:", maxCharsA);
console.log("All table rows:", resultA.includes("| Value1  |") && resultA.includes("| Value5  |"));
console.log("Last 100 chars:", JSON.stringify(resultA.slice(-100)));

// AHA: The issue might be that findTableEnd counts table length differently
// Let me trace findTableEnd behavior
// The table has 4 lines (header, sep, row1, row2) each ending with \n
// findTableEnd counts: tableStartIdx + sum of (line.length + 1) for table lines
// Until it finds a line that doesn't start with |
// The content ends at index 8167 (last char is the \n at end of table)
// After the table there's NOTHING, so findTableEnd might overshoot

// Let me check what findTableEnd returns for our content
// lines after tableStartIdx = 8000:
// Line 0: "| Header1 | Header2 | Header3 | Header4 |" (42 chars) → charCount = 8000+43=8043
// Line 1: "|---------|---------|---------|------- |" (41 chars) → charCount = 8043+42=8085
// Line 2: "| Value1  | Value2  | Value3  | Value4  |" (43 chars) → charCount = 8085+44=8129
// Line 3: "| Value5  | Value6  | Value7  | Value8  |" (43 chars) → charCount = 8129+44=8173
// Line 4: "" (empty after final \n) → doesn't start with | → BREAK
// So findTableEnd returns min(8173, 8167) = 8167 ✓

// Now: tableEnd=8167 > maxChars=8117 → table preservation path
// tableBlock = content.slice(8000, 8167) = 167 chars
// tableLen = 167 ≤ maxChars(8117) → fits
// prefixBudget = 8117 - 167 = 7950
// prefix = content.slice(0, 8000) = 8000 chars
// trimmedPrefix = prefix.slice(8000-7950) = prefix.slice(50) = 7950 chars
// trimmedPrefix + tableBlock = 7950 + 167 = 8117
// .slice(0, 8117) = all 8117 chars

// So the result SHOULD be 8117 chars with the full table
// But test 8 showed table was cut: only got up to "Va" in row 2
// Let me re-examine test 8 more carefully - maybe my table was wider

// Let me count actual table chars:
const tableHeader = `| Header1 | Header2 | Header3 | Header4 |\n`;
const tableSep = `|---------|---------|---------|------- |\n`;
const tableRow1 = `| Value1  | Value2  | Value3  | Value4  |\n`;
const tableRow2 = `| Value5  | Value6  | Value7  | Value8  |\n`;
console.log("\nTable line lengths:");
console.log("header:", tableHeader.length);  // 43
console.log("sep:", tableSep.length);  // 42 -- Note: "------- " has 8 chars vs header's " Header4" (8)
console.log("row1:", tableRow1.length);  // 44
console.log("row2:", tableRow2.length);  // 44
console.log("total:", table.length);

// Let me recheck: the ORIGINAL test 8 used longProse=8000, maxCharsA = 8000+167-50 = 8117
// And the last chars were: "------|---------|------- |\n| Value1  | Value2  | Value3  | Va"
// That suggests the result DID include the full separator and start of row1
// Let me count from the start of the table:
// "| Header1..." = 43 chars
// "|---------|..." = 42 chars
// "| Value1..." up to "Va" = we can count

const charBeforeVa = tableHeader.length + tableSep.length;
console.log("\nChars for header+sep:", charBeforeVa);  // 85
const snippetInRow1 = `| Value1  | Value2  | Value3  | Va`;
console.log("snippet in row1:", snippetInRow1.length);  // 34
console.log("total table chars shown:", charBeforeVa + snippetInRow1.length);  // 119

// So the full table block that's shown = 8000 prefix + 119 partial table = 8119
// But maxChars is 8117!
// trimmedPrefix(7950) + table header (43) + sep(42) + partial row(34) = 8069
// That's not 8117...
// Actually the trimmedPrefix starts at offset 50 not beginning
// trimmedPrefix = Xs from position 50 to 8000 = 7950 chars
// + tableHeader (43) + tableSep (42) + beginning of row1 cut at some point...

// The .slice(0, maxChars) is applied AFTER concatenation:
// [7950 X's][tableHeader 43][tableSep 42][tableRow1 44][tableRow2 44] = 8123 chars
// .slice(0, 8117) = cuts at position 8117 from start
// Position in row1 = 8117 - 7950 - 43 - 42 = 82 chars into row1... but row1 is 44 chars!
// Something doesn't add up

// Let me just run the exact scenario to see
const resultB = truncatePreservingTable(content, maxCharsA);
const tableStartInResult = resultB.lastIndexOf("| Header1");
console.log("\nTable starts in result at:", tableStartInResult);
console.log("Result from table start:", JSON.stringify(resultB.slice(tableStartInResult)));
