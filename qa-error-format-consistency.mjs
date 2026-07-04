/**
 * Probe: Consistency of error formats between different error paths
 *
 * Three distinct error paths exist in index.ts:
 * 1. Main ZodError handler (lines 1035-1054)
 * 2. search_feedback special ZodError handler (lines 848-861)
 * 3. classifyError() handler (lines 1057-1064) - toAgentString()
 * 4. no-api-key gate (lines 880-892)
 * 5. unknown tool (lines 1022-1028)
 * 6. tool-filter (lines 896-903)
 *
 * A consistent agent should have the same format across all error paths.
 * In particular: agent_instruction: "..." (with quotes) vs agent_instruction: text
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const makeClient = async (key = "dummy", extraEnv = {}) => {
  const env = Object.assign({}, process.env, { NOVADA_API_KEY: key }, extraEnv);
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-fmt", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c };
};

const makeClientNoKey = async () => {
  const env = Object.assign({}, process.env);
  delete env.NOVADA_API_KEY;
  delete env.NOVADA_DEVELOPER_API_KEY;
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-fmt-nokey", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c };
};

// Path 1: Main ZodError handler - search missing query
console.log("=== PATH 1: Main ZodError handler (novada_search missing query)");
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_search", arguments: {} });
  const txt = r.content?.[0]?.text ?? "";
  console.log("Text:\n" + txt);
  console.log("isError:", r.isError);
  // Check format: does it have failure_class? retry_recommended?
  console.log("  has failure_class:", txt.includes("failure_class"));
  console.log("  has retry_recommended:", txt.includes("retry_recommended"));
  console.log("  has agent_instruction (quoted):", txt.includes('agent_instruction:'));
  await c.close();
}

// Path 2: search_feedback special ZodError handler
console.log("\n=== PATH 2: search_feedback special ZodError");
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_search_feedback", arguments: {} });
  const txt = r.content?.[0]?.text ?? "";
  console.log("Text:\n" + txt);
  console.log("  has failure_class:", txt.includes("failure_class"));
  console.log("  has retry_recommended:", txt.includes("retry_recommended"));
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}

// Path 3: classifyError (INVALID_API_KEY from dummy key)
console.log("\n=== PATH 3: classifyError toAgentString() (dummy key on novada_search)");
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_search", arguments: { query: "test", engine: "google", num: 5 } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("Text:\n" + txt);
  console.log("  has failure_class:", txt.includes("failure_class"));
  console.log("  has retry_recommended:", txt.includes("retry_recommended"));
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}

// Path 4: no-api-key gate
console.log("\n=== PATH 4: no-api-key gate");
{
  const { client: c } = await makeClientNoKey();
  const r = await c.callTool({ name: "novada_search", arguments: { query: "test" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("Text:\n" + txt);
  console.log("  has failure_class:", txt.includes("failure_class"));
  console.log("  has retry_recommended:", txt.includes("retry_recommended"));
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}

// Path 5: unknown tool
console.log("\n=== PATH 5: unknown tool");
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_unknown_xyz", arguments: {} });
  const txt = r.content?.[0]?.text ?? "";
  console.log("Text:\n" + txt);
  console.log("  has failure_class:", txt.includes("failure_class"));
  console.log("  has retry_recommended:", txt.includes("retry_recommended"));
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}

// Path 6: tool filter
console.log("\n=== PATH 6: tool filter (NOVADA_TOOLS=search, try extract)");
{
  const { client: c } = await makeClient("dummy", { NOVADA_TOOLS: "search" });
  const r = await c.callTool({ name: "novada_extract", arguments: { url: "https://example.com", format: "markdown", render: "auto" } });
  const txt = r.content?.[0]?.text ?? "";
  console.log("Text:\n" + txt);
  console.log("  has failure_class:", txt.includes("failure_class"));
  console.log("  has retry_recommended:", txt.includes("retry_recommended"));
  console.log("  has agent_instruction:", txt.includes("agent_instruction"));
  await c.close();
}
