/**
 * MCP contract tests for crawl and map:
 * - Tool listing includes correct schemas
 * - isError flag set correctly
 * - Error message structure
 * - Stale alias behavior (mode/limit)
 * - crawl JSON output structure when returned
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";
const FINDINGS = [];

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY })
});
const c = new Client({ name: "qa-contract", version: "0" }, { capabilities: {} });
await c.connect(t);

// ─── List tools and verify crawl + map exist with expected schema fields ───────
const toolList = await c.listTools();
const tools = toolList.tools;
const crawlTool = tools.find(t => t.name === "novada_crawl");
const mapTool = tools.find(t => t.name === "novada_map");

console.log("=== TOOL SCHEMA INSPECTION ===\n");

if (!crawlTool) {
  FINDINGS.push({ finding: "CRITICAL: novada_crawl not in tool list!" });
} else {
  console.log("novada_crawl schema properties:", Object.keys(crawlTool.inputSchema.properties));
  console.log("novada_crawl required:", crawlTool.inputSchema.required);

  // Check: 'limit' and 'mode' removed from schema (NOV-673)
  const hasLimit = 'limit' in (crawlTool.inputSchema.properties ?? {});
  const hasMode = 'mode' in (crawlTool.inputSchema.properties ?? {});
  console.log(`\ncrawl schema has 'limit': ${hasLimit} (should be FALSE after NOV-673)`);
  console.log(`crawl schema has 'mode': ${hasMode} (should be FALSE after NOV-673)`);

  if (hasLimit) {
    FINDINGS.push({
      finding: "NOV-673 contract: 'limit' alias still in crawl JSON schema even after NOV-673 removal",
      severity: "Medium",
      evidence: JSON.stringify(crawlTool.inputSchema.properties['limit'])
    });
  }
  if (hasMode) {
    FINDINGS.push({
      finding: "NOV-673 contract: 'mode' alias still in crawl JSON schema after NOV-673 removal",
      severity: "Medium",
      evidence: JSON.stringify(crawlTool.inputSchema.properties['mode'])
    });
  }

  // Check: max_pages max constraint
  const maxPagesSchema = crawlTool.inputSchema.properties?.max_pages;
  console.log(`\ncrawl max_pages schema: ${JSON.stringify(maxPagesSchema)}`);

  // Check: select_paths and exclude_paths documented as GLOB not regex
  const selectDesc = crawlTool.inputSchema.properties?.select_paths?.description;
  const excludeDesc = crawlTool.inputSchema.properties?.exclude_paths?.description;
  console.log(`\nselect_paths description: ${selectDesc}`);
  console.log(`exclude_paths description: ${excludeDesc}`);

  // Check if schema says "glob" not "regex"
  if (selectDesc && selectDesc.toLowerCase().includes("regex")) {
    FINDINGS.push({
      finding: "crawl select_paths description mentions 'regex' but implementation uses GLOB semantics",
      severity: "Medium - documentation mismatch"
    });
  }
}

if (!mapTool) {
  FINDINGS.push({ finding: "CRITICAL: novada_map not in tool list!" });
} else {
  console.log("\nnovada_map schema properties:", Object.keys(mapTool.inputSchema.properties));
  console.log("novada_map required:", mapTool.inputSchema.required);

  const maxDepthSchema = mapTool.inputSchema.properties?.max_depth;
  console.log(`\nmap max_depth schema: ${JSON.stringify(maxDepthSchema)}`);

  // Check: map lacks format parameter (unlike crawl which has json/markdown)
  const hasFormat = 'format' in (mapTool.inputSchema.properties ?? {});
  console.log(`\nmap has 'format' parameter: ${hasFormat} (crawl has it, map does NOT)`);
  if (hasFormat) {
    console.log("map format:", JSON.stringify(mapTool.inputSchema.properties.format));
  }
}

// ─── isError contract: error responses must have isError=true ─────────────────
console.log("\n=== isError CONTRACT TESTS ===\n");

async function call(name, args) {
  try {
    return await c.callTool({ name, arguments: args });
  } catch (e) {
    return { isError: true, error: String(e), content: [{ type: "text", text: String(e) }] };
  }
}

// Zod validation error should be isError=true
const zodErr = await call("novada_crawl", { url: "ftp://example.com" });
console.log(`Zod error isError: ${zodErr.isError} (expected: true)`);
if (!zodErr.isError) FINDINGS.push({ finding: "Zod validation error did not set isError=true", severity: "High - MCP contract violation" });

// URL_UNREACHABLE error should be isError=true
const unreachErr = await call("novada_crawl", { url: "https://example.com", max_pages: 1 });
console.log(`URL_UNREACHABLE isError: ${unreachErr.isError} (expected: true)`);
if (!unreachErr.isError) FINDINGS.push({ finding: "URL_UNREACHABLE error did not set isError=true", severity: "High - MCP contract violation" });

// SPA_NO_URLS_FOUND for novada_map should be isError=FALSE (caught and returned as string)
const spaResult = await call("novada_map", { url: "https://example.com", max_depth: 1 });
console.log(`SPA map result isError: ${spaResult.isError} (expected: false for SPA detection)`);
if (spaResult.isError) FINDINGS.push({
  finding: "novada_map SPA detection returns isError=true — MCP contract violation",
  severity: "High",
  evidence: JSON.stringify(spaResult.content).slice(0, 300)
});

// ─── Error message structure check ────────────────────────────────────────────
console.log("\n=== ERROR MESSAGE STRUCTURE ===\n");

const errMsg = zodErr.content?.[0]?.text ?? "";
console.log("Zod error message structure:");
console.log(errMsg.slice(0, 500));

// Check agent_instruction is in error
if (!errMsg.includes("agent_instruction")) {
  FINDINGS.push({ finding: "Zod error messages missing agent_instruction field", severity: "Medium" });
}

// URL_UNREACHABLE structure
const unreachMsg = unreachErr.content?.[0]?.text ?? "";
console.log("\nURL_UNREACHABLE error structure (first 500 chars):");
console.log(unreachMsg.slice(0, 500));

if (!unreachMsg.includes("agent_instruction")) {
  FINDINGS.push({ finding: "URL_UNREACHABLE error missing agent_instruction field", severity: "Medium" });
}
if (!unreachMsg.includes("retry_recommended")) {
  FINDINGS.push({ finding: "URL_UNREACHABLE error missing retry_recommended field", severity: "Low" });
}

// ─── Check: crawl stale alias behavior (limit/mode silently ignored) ──────────
console.log("\n=== STALE ALIAS BEHAVIOR (NOV-673) ===\n");

// limit=2 should NOT change max_pages behavior.
// After NOV-673, limit is stripped by Zod (unknown key), max_pages defaults to 5.
// But limit is NOT in the schema, so passing it as extra key would be stripped.
// Let's verify: call with limit=1 — if max_pages defaults to 5, the error still happens
// (no pages fetched) regardless of limit. Can't verify page count without live network.
const limitTest = await call("novada_crawl", { url: "https://example.com", limit: 1 });
console.log(`limit=1 test isError: ${limitTest.isError}`);
const limitMsg = limitTest.content?.[0]?.text ?? "";
// We expect URL_UNREACHABLE, not a schema error about 'limit' — because it's just stripped.
const isSchemaError = limitMsg.includes("Invalid parameters");
const isUrlError = limitMsg.includes("URL_UNREACHABLE");
console.log(`  - schema error: ${isSchemaError}, url error: ${isUrlError}`);
// If it returns URL_UNREACHABLE, 'limit' was silently ignored (stripped by Zod) — correct behavior
// If it returns schema error mentioning 'limit', there's a contract issue
if (isSchemaError && limitMsg.includes("limit")) {
  FINDINGS.push({
    finding: "Passing 'limit' to novada_crawl generates a schema error — user-facing regression since schema no longer documents 'limit'",
    severity: "Medium",
    note: "Expected: limit silently ignored (stripped). Actual: Zod error about limit"
  });
} else {
  console.log("  -> 'limit' silently stripped (correct per NOV-673)");
}

// mode=dfs silently stripped
const modeTest = await call("novada_crawl", { url: "https://example.com", mode: "dfs" });
const modeMsg = modeTest.content?.[0]?.text ?? "";
const modeSchemaError = modeMsg.includes("Invalid parameters");
console.log(`mode=dfs test: schema error: ${modeSchemaError}, url error: ${modeMsg.includes("URL_UNREACHABLE")}`);
if (modeSchemaError && modeMsg.includes("mode")) {
  FINDINGS.push({
    finding: "Passing 'mode' to novada_crawl generates a schema error",
    severity: "Medium"
  });
} else {
  console.log("  -> 'mode' silently stripped (correct per NOV-673)");
}

// ─── Content structure check: map returns text content type ───────────────────
console.log("\n=== RESPONSE CONTENT TYPE ===\n");

const mapResult = await call("novada_map", { url: "https://example.com" });
console.log(`map result content[0].type: ${mapResult.content?.[0]?.type}`);
if (mapResult.content?.[0]?.type !== "text") {
  FINDINGS.push({ finding: "novada_map returned non-text content type", severity: "Medium" });
}

// ─── Check: _maxPagesCeiling internal param is stripped by MCP callers ────────
console.log("\n=== _maxPagesCeiling INTERNAL PARAM STRIPPING ===\n");
// If an MCP caller passes _maxPagesCeiling, it should be stripped by Zod (unknown key)
// and not raise a page ceiling above 20
const ceilingTest = await call("novada_crawl", {
  url: "https://example.com",
  _maxPagesCeiling: 1000,
  max_pages: 20
});
const ceilingMsg = ceilingTest.content?.[0]?.text ?? "";
console.log(`_maxPagesCeiling test: isError=${ceilingTest.isError}`);
console.log(`message preview: ${ceilingMsg.slice(0, 200)}`);
// Since network is offline, it will fail with URL_UNREACHABLE either way
// What we check: does the schema reject _maxPagesCeiling?
const ceilingSchemaError = ceilingMsg.includes("Invalid parameters");
console.log(`Schema error mentioning ceiling: ${ceilingSchemaError && ceilingMsg.includes("Ceiling")}`);
// We expect: no schema error (Zod strips unknown keys silently = safe)
console.log("  -> _maxPagesCeiling should be silently stripped by Zod (not in schema)");

// ─── Check: crawl JSON output when results DO exist ───────────────────────────
// We can't test this with dummy key + offline host.
// Checking the source: format=json branch produces { status, root_url, pages_crawled, ... }
console.log("\n=== SOURCE CODE REVIEW: JSON output structure ===\n");
console.log("From crawl.ts source (line 336-356), json output contains:");
console.log("{ status, root_url, pages_crawled, strategy, source, total_words, failed,");
console.log("  js_missing, pages: [...], agent_instruction }");
console.log("js_missing is undefined (not 0) when no JS missing — this is correct behavior");
console.log("(omitting falsy values is standard API practice)");

console.log("\n=== FINAL FINDINGS ===\n");
console.log(JSON.stringify(FINDINGS, null, 2));

await c.close();
