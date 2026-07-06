/**
 * Edge case tests for outputSchema contract:
 * 1. What happens if we inject outputSchema via a custom tool call? (server should reject)
 * 2. Tool count consistency: TOOLS array vs registry (38 in ACTIVE_TOOLS)
 * 3. MCP protocol version: does the server advertise protocol version that supports outputSchema?
 * 4. Empty required[] case (if any tool has no required fields, required should be absent or [])
 * 5. Check what happens when content[0].text = "" (empty string) — is isError:false misleading?
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function runEdgeTests() {
  const results = { tests: [], details: {} };

  function record(name, passed, details) {
    results.tests.push({ name, passed, details });
    if (!passed) {
      console.error(`FAIL: ${name} — ${JSON.stringify(details)}`);
    } else {
      console.log(`PASS: ${name}`);
    }
  }

  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: { ...process.env, NOVADA_API_KEY: KEY },
  });
  const c = new Client({ name: "qa-edge", version: "0" }, { capabilities: {} });
  await c.connect(t);

  // ─── Check protocol version via server info ────────────────────────────────
  const serverVer = c.getServerVersion?.() || {};
  console.log("Server info:", JSON.stringify(serverVer, null, 2));
  results.details.serverVersion = serverVer;

  // ─── Tool count edge: TOOLS array (39 or 38?) vs registry (39 names in registry.ts) ───
  const listResult = await c.listTools();
  const tools = listResult.tools;
  const toolNames = tools.map((t) => t.name);
  console.log(`\nTools loaded (${tools.length}): ${toolNames.join(", ")}`);
  results.details.toolCount = tools.length;
  results.details.toolNames = toolNames;

  // The registry shows 38 tools (excluding session_stats and search_feedback which are in index.ts but not registry)
  // Let me check if novada_account_summary is present (it's in the TOOLS array but may not be in registry)
  record(
    "novada_account_summary present in tools list",
    toolNames.includes("novada_account_summary"),
    { present: toolNames.includes("novada_account_summary") }
  );

  // ─── Empty string content check ───────────────────────────────────────────
  // Some tools that succeed offline return empty or near-empty content
  // This isn't a structuredContent issue but is worth flagging
  const setupResult = await c.callTool({ name: "novada_setup", arguments: {} });
  const setupText = setupResult.content?.[0]?.text || "";
  record(
    "novada_setup: content text is non-empty",
    setupText.length > 0,
    { text_length: setupText.length }
  );
  record(
    "novada_setup: isError is not true",
    setupResult.isError !== true,
    { isError: setupResult.isError }
  );

  // ─── Test novada_session_stats with recent_limit param ────────────────────
  const statsResult = await c.callTool({ name: "novada_session_stats", arguments: { recent_limit: 5 } });
  record(
    "novada_session_stats: with recent_limit=5 — content present",
    Array.isArray(statsResult.content) && statsResult.content.length > 0,
    { first_100: statsResult.content?.[0]?.text?.slice(0, 100) }
  );
  record(
    "novada_session_stats: no structuredContent",
    statsResult.structuredContent === undefined,
    {}
  );

  // ─── Test tools that return isError:true still have content[] ─────────────
  // Test proxy tools (no proxy endpoint configured)
  const proxyTests = [
    { name: "novada_proxy_residential", args: { format: "url" } },
    { name: "novada_proxy_isp", args: { format: "url" } },
    { name: "novada_proxy_datacenter", args: { format: "url" } },
    { name: "novada_proxy_mobile", args: { format: "url" } },
  ];

  for (const pt of proxyTests) {
    const pr = await c.callTool({ name: pt.name, arguments: pt.args });
    record(
      `${pt.name}: content[] present (no proxy configured)`,
      Array.isArray(pr.content) && pr.content.length > 0,
      { text: pr.content?.[0]?.text?.slice(0, 80) }
    );
    record(
      `${pt.name}: no structuredContent`,
      pr.structuredContent === undefined,
      {}
    );
  }

  // ─── Test novada_proxy_static and novada_proxy_dedicated (have required params) ──
  const proxyStaticResult = await c.callTool({
    name: "novada_proxy_static",
    arguments: { country: "us", session_id: "test123", format: "url" },
  });
  record(
    "novada_proxy_static: content[] present",
    Array.isArray(proxyStaticResult.content) && proxyStaticResult.content.length > 0,
    { text: proxyStaticResult.content?.[0]?.text?.slice(0, 80) }
  );

  const proxyDedicatedResult = await c.callTool({
    name: "novada_proxy_dedicated",
    arguments: { session_id: "test456", format: "url" },
  });
  record(
    "novada_proxy_dedicated: content[] present",
    Array.isArray(proxyDedicatedResult.content) && proxyDedicatedResult.content.length > 0,
    { text: proxyDedicatedResult.content?.[0]?.text?.slice(0, 80) }
  );

  // ─── Check EVERY tool can be called without crash (basic smoke) ───────────
  // Only test tools that are auth-free or have minimal required params
  const minimalCallTests = [
    { name: "novada_discover", args: {} },
    { name: "novada_health", args: {} },  // needs API key, will get auth error
    { name: "novada_search_feedback", args: { search_id: "x", query: "test", rating: "ok" } },
  ];

  for (const test of minimalCallTests) {
    const r = await c.callTool({ name: test.name, arguments: test.args });
    record(
      `${test.name}: valid content[] shape`,
      Array.isArray(r.content),
      { content_len: r.content?.length, isError: r.isError }
    );
    record(
      `${test.name}: no structuredContent`,
      r.structuredContent === undefined,
      {}
    );
  }

  // ─── Check inputSchema properties for all tools: no "outputSchema" key leaks ──
  // The zodToMcpSchema function strips $schema, $defs, additionalProperties.
  // But outputSchema is a field on the Tool definition, not inputSchema.
  // This test ensures that the inputSchema itself doesn't accidentally define
  // an 'outputSchema' property inside it (that would just be confusing, not a bug).
  const toolsWithOutputSchemaProperty = tools.filter(
    (t) => t.inputSchema?.properties?.outputSchema !== undefined
  );
  record(
    "no tool inputSchema has a property named 'outputSchema'",
    toolsWithOutputSchemaProperty.length === 0,
    { found: toolsWithOutputSchemaProperty.map((t) => t.name) }
  );

  // ─── Summary ───────────────────────────────────────────────────────────────
  const passed = results.tests.filter((t) => t.passed).length;
  const failed = results.tests.filter((t) => !t.passed).length;
  console.log(`\n=== Edge Test Summary: ${passed} passed, ${failed} failed ===`);

  await c.close();
  return results;
}

runEdgeTests().then((r) => {
  import("fs").then((fs) => {
    fs.writeFileSync("/tmp/novada-qa-0.9.0/qa-outputschema-edge-results.json", JSON.stringify(r, null, 2));
    console.log("Written to /tmp/novada-qa-0.9.0/qa-outputschema-edge-results.json");
  });
}).catch(console.error);
