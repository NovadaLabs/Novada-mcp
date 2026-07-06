/**
 * Unit-level test of classifyError() from the build
 * Tests the error classification logic directly
 */

// Import the built version to test classifyError
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

// We can't directly import classifyError since it's an internal module
// Let's use the MCP client to test classification indirectly
// by triggering specific error conditions

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Create a test harness that exercises specific error paths
// We'll use the map tool against URLs that produce specific HTTP errors

async function makeClient(apiKey = "dummy") {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: apiKey }),
  });
  const c = new Client({ name: "qa-unit", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { t, c };
}

const results = [];

// ── Test: ZodError format vs NovadaError format consistency ──────────────────
console.log("=== ZodError vs NovadaError format consistency ===");
{
  const { t, c } = await makeClient();

  // Path 1: Tool-internal makeNovadaError (has failure_class, retry_recommended)
  const r1 = await c.callTool({ name: "novada_search", arguments: { query: "x".repeat(600) } });
  const text1 = r1.content?.[0]?.text || "";

  // Path 2: Zod schema validation (NO failure_class, NO retry_recommended)
  const r2 = await c.callTool({ name: "novada_extract", arguments: { format: "markdown", render: "auto" } });
  const text2 = r2.content?.[0]?.text || "";

  // Path 3: Zod enum validation
  const r3 = await c.callTool({ name: "novada_extract", arguments: { url: "https://example.com", format: "invalid-format", render: "auto" } });
  const text3 = r3.content?.[0]?.text || "";

  // Path 4: Zod missing required + wrong type
  const r4 = await c.callTool({ name: "novada_crawl", arguments: { max_pages: "not-a-number" } });
  const text4 = r4.content?.[0]?.text || "";

  console.log("--- Path 1 (makeNovadaError - INVALID_PARAMS from search.ts) ---");
  console.log(text1.slice(0, 200));
  console.log("\n--- Path 2 (ZodError - missing url in extract) ---");
  console.log(text2.slice(0, 200));
  console.log("\n--- Path 3 (ZodError - invalid enum) ---");
  console.log(text3.slice(0, 200));
  console.log("\n--- Path 4 (ZodError - wrong type) ---");
  console.log(text4.slice(0, 200));

  // The key observation: Paths 2-4 are missing:
  // - Error [INVALID_PARAMS]:
  // - failure_class: permanent
  // - retry_recommended: false
  // This is a format inconsistency

  const path1Structured = /Error \[/.test(text1) && /failure_class:/.test(text1) && /retry_recommended:/.test(text1);
  const path2Structured = /Error \[/.test(text2) && /failure_class:/.test(text2) && /retry_recommended:/.test(text2);

  console.log("\n--- Format Analysis ---");
  console.log("Path 1 (makeNovadaError) has structured format:", path1Structured);
  console.log("Path 2 (ZodError) has structured format:", path2Structured);

  if (path1Structured && !path2Structured) {
    results.push({
      type: "FORMAT_INCONSISTENCY",
      description: "Two different INVALID_PARAMS error paths produce different formats",
      path1: "makeNovadaError inside tool → Error [INVALID_PARAMS] + failure_class + retry_recommended",
      path2: "ZodError from validateXxxParams → 'Invalid parameters for...' without structured fields",
      impact: "Agents parsing error responses have inconsistent contract: some INVALID_PARAMS have failure_class, some don't",
    });
  }

  await c.close();
}

// ── Test: agent_instruction has multi-line content inside quotes ──────────────
console.log("\n=== agent_instruction multi-line formatting ===");
{
  const { t, c } = await makeClient();
  const r = await c.callTool({ name: "novada_search", arguments: { query: "x".repeat(600) } });
  const text = r.content?.[0]?.text || "";
  console.log("Full INVALID_PARAMS error:");
  console.log(text);

  // The agent_instruction field spans multiple lines
  // The quotes start at `agent_instruction: "` and end at the final `"`
  // But within the quotes, there are newlines
  // This is technically fine for human reading but agents parsing it need to handle multi-line quotes
  const agentInstructionStart = text.indexOf('agent_instruction: "');
  if (agentInstructionStart >= 0) {
    const afterStart = text.slice(agentInstructionStart + 'agent_instruction: "'.length);
    const firstNewline = afterStart.indexOf('\n');
    const lastQuote = afterStart.lastIndexOf('"');
    console.log("\nagent_instruction spans multiple lines:", firstNewline > 0 && firstNewline < lastQuote);
    console.log("First newline at char:", firstNewline);
    console.log("Closing quote at char:", lastQuote);
  }
  await c.close();
}

console.log("\n=== Results ===");
console.log(JSON.stringify(results, null, 2));
