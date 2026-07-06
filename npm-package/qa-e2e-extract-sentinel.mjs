/**
 * Focused test: verify the extract failure sentinel discrepancy
 * research.ts checks for "## Extract Failed" but extractSingle can also return
 * "## Extraction Error" (on timeout). This test verifies the gap.
 */
import { readFileSync } from "fs";

const researchSrc = readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/research.ts", "utf8");
const extractSrc = readFileSync("/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts", "utf8");

// Find all error sentinel strings in extract.ts
const extractErrorSentinels = [];
const extractFailedMatch = extractSrc.match(/`## Extract Failed`/g);
const extractionErrorMatch = extractSrc.match(/`## Extraction Error`/g);
if (extractFailedMatch) extractErrorSentinels.push("## Extract Failed");
if (extractionErrorMatch) extractErrorSentinels.push("## Extraction Error");

// Find all sentinel checks in research.ts
const researchChecks = researchSrc.match(/content\.startsWith\("##[^"]+"\)/g) || [];
const researchCheckStrings = researchChecks.map(m => m.match(/"([^"]+)"/)?.[1]).filter(Boolean);

console.error("Extract error sentinels:", extractErrorSentinels);
console.error("Research checks for:", researchCheckStrings);

const uncheckedSentinels = extractErrorSentinels.filter(s => !researchCheckStrings.includes(s));
if (uncheckedSentinels.length > 0) {
  console.error("UNCHECKED SENTINELS:", uncheckedSentinels);
  console.log(JSON.stringify({
    bug: true,
    description: "research.ts does not check for all extract failure sentinels",
    checked: researchCheckStrings,
    all_sentinels: extractErrorSentinels,
    unchecked: uncheckedSentinels,
  }));
} else {
  console.log(JSON.stringify({ bug: false, all_checked: true }));
}

// Also check: does the path prefix ("path: ~/...") appear before the sentinel?
// extractSingleInner returns content that is wrapped with "path: ..." prefix by extractSingle.
// The outer novadaExtract catch block creates "## Extract Failed" WITHOUT the path prefix.
// But extractSingle returns "## Extraction Error" WITHOUT the path prefix (it's in the catch).
// extractSingleInner returns the full output WITH the path prefix.

// The research.ts check: content.startsWith("## Extract Failed")
// Issue: if extractSingleInner succeeds but returns bad content with path prefix:
//   content = "path: ~/...\n\n## Extracted Content..."
//   → content.startsWith("## Extract Failed") is FALSE (correctly)
//   → cleaned to remove path: prefix, then content is processed

// But if extractSingle's timeout fires and returns "## Extraction Error" (no path prefix):
//   → content.startsWith("## Extract Failed") is FALSE
//   → it passes the ok=true path and "## Extraction Error" ends up in synthesis

// Verify: does extractSingle add the path prefix to "## Extraction Error"?
const extractionErrorIdx = extractSrc.indexOf("`## Extraction Error`");
const savePrefixInTimeout = extractSrc.indexOf("savePrefix", extractionErrorIdx);
const nextReturnInTimeout = extractSrc.indexOf("return", extractionErrorIdx);
const closestSavePrefix = savePrefixInTimeout > -1 ? savePrefixInTimeout : -1;

// The timeout path is inside the catch block BEFORE the savePrefix assignment
// (which is at the bottom of extractSingleInner). So ## Extraction Error has NO path prefix.
const timeoutBeforeSavePrefix = extractionErrorIdx < (extractSrc.indexOf("savePrefix ="));

console.error(`## Extraction Error at index ${extractionErrorIdx}, savePrefix assignment at index ${extractSrc.indexOf("savePrefix =")}`);
console.error(`Timeout return is BEFORE savePrefix assignment: ${timeoutBeforeSavePrefix}`);
console.log(JSON.stringify({
  extraction_error_has_path_prefix: !timeoutBeforeSavePrefix,
  timeout_is_before_save_prefix: timeoutBeforeSavePrefix,
  implication: timeoutBeforeSavePrefix
    ? "## Extraction Error is returned WITHOUT path: prefix — startsWith check would work IF research.ts checked it, but it does NOT"
    : "## Extraction Error IS after savePrefix — would have path: prefix",
}));
