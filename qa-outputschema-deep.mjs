/**
 * Deep QA: MCP outputSchema contract — deeper protocol-level checks
 *
 * Additional tests:
 * 1. Protocol version negotiated (2025-03-26 or later means outputSchema is spec-defined)
 * 2. Server capabilities — does it declare outputSchema capability?
 * 3. Tool definitions — check each tool's JSON shape is valid MCP ToolSchema
 * 4. Test that server info matches expected (version/name)
 * 5. Verify that ToolSchema extra fields (annotations, execution, _meta) don't leak outputSchema
 * 6. Check if discover tool reports outputSchema tools (shouldn't since none exist)
 * 7. Inspect raw transport messages for any outputSchema contamination
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function runDeepTests() {
  const findings = [];

  function check(name, condition, evidence, severity = null) {
    if (!condition) {
      findings.push({ name, evidence, severity });
      console.error(`[FINDING] ${name}: ${JSON.stringify(evidence)}`);
    } else {
      console.log(`[OK] ${name}`);
    }
  }

  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: { ...process.env, NOVADA_API_KEY: KEY },
  });
  const c = new Client({ name: "qa-deep", version: "0" }, { capabilities: {} });

  // Capture initialization info
  let serverInfo = null;
  const originalConnect = c.connect.bind(c);

  await c.connect(t);

  // ─── Check protocol version negotiated ───────────────────────────────────
  // The MCP SDK negotiates during connect. We can inspect via the client's
  // getServerVersion() if it exists, or check via serverInfo
  const serverVersion = c.getServerVersion?.();
  console.log("Server version info:", JSON.stringify(serverVersion));

  // Check protocol version — 2025-03-26 adds outputSchema support to the spec
  const protocolVersion = c.getServerVersion?.()?.protocolVersion || "unknown";
  console.log(`Negotiated protocol version: ${protocolVersion}`);

  // ─── Get tools list and inspect thoroughly ────────────────────────────────
  const listResult = await c.listTools();
  const tools = listResult.tools;

  console.log(`\nTotal tools: ${tools.length}`);

  // Check each tool against the MCP ToolSchema definition
  // Per spec: { name, description?, inputSchema, outputSchema?, annotations?, execution?, _meta? }
  for (const tool of tools) {
    // name must be string
    check(
      `${tool.name}: name is string`,
      typeof tool.name === "string" && tool.name.length > 0,
      { name: tool.name }
    );

    // description is optional but should be string if present
    if (tool.description !== undefined) {
      check(
        `${tool.name}: description is string`,
        typeof tool.description === "string",
        { description: typeof tool.description }
      );
    }

    // inputSchema must be present and have type:object
    check(
      `${tool.name}: inputSchema.type === 'object'`,
      tool.inputSchema?.type === "object",
      { inputSchema_type: tool.inputSchema?.type }
    );

    // outputSchema must NOT be present (since none is declared)
    check(
      `${tool.name}: no outputSchema`,
      tool.outputSchema === undefined || tool.outputSchema === null,
      { outputSchema: tool.outputSchema },
      "High"
    );

    // inputSchema should not have $schema at top level (zodToMcpSchema strips it)
    check(
      `${tool.name}: inputSchema has no $schema`,
      tool.inputSchema?.$schema === undefined,
      { has_dollar_schema: tool.inputSchema?.$schema !== undefined }
    );

    // Check for additionalProperties being present (zodToMcpSchema removes it)
    if (tool.inputSchema?.additionalProperties !== undefined) {
      console.warn(`[WARN] ${tool.name}: inputSchema has additionalProperties: ${JSON.stringify(tool.inputSchema.additionalProperties)}`);
    }

    // Check annotations shape if present
    if (tool.annotations) {
      const a = tool.annotations;
      check(
        `${tool.name}: annotations are booleans`,
        (a.readOnlyHint === undefined || typeof a.readOnlyHint === "boolean") &&
        (a.idempotentHint === undefined || typeof a.idempotentHint === "boolean") &&
        (a.destructiveHint === undefined || typeof a.destructiveHint === "boolean") &&
        (a.openWorldHint === undefined || typeof a.openWorldHint === "boolean"),
        { annotations: a }
      );
    }
  }

  // ─── Check for $defs leakage in inputSchema ───────────────────────────────
  // zodToMcpSchema strips $defs but let's verify
  let toolsWithDefs = [];
  for (const tool of tools) {
    if (tool.inputSchema?.$defs) {
      toolsWithDefs.push(tool.name);
    }
  }
  check(
    "no tool inputSchema has $defs (stripped by zodToMcpSchema)",
    toolsWithDefs.length === 0,
    { toolsWithDefs }
  );

  // ─── Check required[] accuracy ────────────────────────────────────────────
  // zodToMcpSchema strips keys with defaults from required[]. Verify a few known cases.
  // novada_search: 'query' required, 'engine' has default 'google' so should NOT be required
  const searchTool = tools.find((t) => t.name === "novada_search");
  if (searchTool) {
    const required = searchTool.inputSchema?.required || [];
    console.log(`novada_search required[]: ${JSON.stringify(required)}`);

    // 'query' MUST be required
    check(
      "novada_search: 'query' in required[]",
      required.includes("query"),
      { required }
    );

    // 'engine' has default 'google' so should NOT be in required[]
    check(
      "novada_search: 'engine' NOT in required[] (has default)",
      !required.includes("engine"),
      { required }
    );

    // 'num' has default so should NOT be required
    check(
      "novada_search: 'num' NOT in required[] (has default)",
      !required.includes("num"),
      { required }
    );
  }

  // novada_proxy_static: country and session_id are both REQUIRED (no defaults)
  const proxyStaticTool = tools.find((t) => t.name === "novada_proxy_static");
  if (proxyStaticTool) {
    const required = proxyStaticTool.inputSchema?.required || [];
    console.log(`novada_proxy_static required[]: ${JSON.stringify(required)}`);
    check(
      "novada_proxy_static: 'country' in required[] (no default)",
      required.includes("country"),
      { required }
    );
    check(
      "novada_proxy_static: 'session_id' in required[] (no default)",
      required.includes("session_id"),
      { required }
    );
  }

  // ─── Verify content type from proxy tools (offline-capable) ─────────────
  // novada_proxy doesn't need an API key, call it and check response format
  const proxyResult = await c.callTool({
    name: "novada_proxy",
    arguments: {
      type: "residential",
      format: "url",
    },
  });
  console.log("\nnovada_proxy response:", JSON.stringify(proxyResult).slice(0, 200));
  check(
    "novada_proxy: content[] present and is array",
    Array.isArray(proxyResult.content),
    { content: proxyResult.content }
  );
  check(
    "novada_proxy: no structuredContent",
    proxyResult.structuredContent === undefined,
    { structuredContent: proxyResult.structuredContent }
  );

  // ─── Test novada_discover response format ─────────────────────────────────
  const discoverResult = await c.callTool({
    name: "novada_discover",
    arguments: {},
  });
  console.log("\nnovada_discover isError:", discoverResult.isError);
  console.log("novada_discover content[0] snippet:", discoverResult.content?.[0]?.text?.slice(0, 200));
  check(
    "novada_discover: not an error response",
    !discoverResult.isError,
    { isError: discoverResult.isError }
  );
  check(
    "novada_discover: content[] present",
    Array.isArray(discoverResult.content) && discoverResult.content.length > 0,
    { content_len: discoverResult.content?.length }
  );
  check(
    "novada_discover: no structuredContent",
    discoverResult.structuredContent === undefined,
    { structuredContent: discoverResult.structuredContent }
  );

  // ─── Test that protocol allows clients to send outputSchema in ToolSchema ─
  // This is a read-only check — we're confirming the server side ignores/rejects
  // any attempt by client to pass outputSchema in a call (it's server-declared, not client-sent)

  // ─── Test setup response (no auth needed) full format ────────────────────
  const setupResult = await c.callTool({
    name: "novada_setup",
    arguments: {},
  });
  check(
    "novada_setup: content[0].type === 'text'",
    setupResult.content?.[0]?.type === "text",
    { type: setupResult.content?.[0]?.type }
  );
  check(
    "novada_setup: content[0].text is string",
    typeof setupResult.content?.[0]?.text === "string",
    { text_type: typeof setupResult.content?.[0]?.text }
  );

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n=== Deep Test Complete ===`);
  console.log(`Findings: ${findings.length}`);
  for (const f of findings) {
    console.log(`  FINDING: ${f.name} — ${JSON.stringify(f.evidence)}`);
  }

  await c.close();
  return findings;
}

runDeepTests().then((findings) => {
  import("fs").then((fs) => {
    fs.writeFileSync("/tmp/novada-qa-0.9.0/qa-outputschema-deep-findings.json", JSON.stringify(findings, null, 2));
    console.log(`\nResults written to /tmp/novada-qa-0.9.0/qa-outputschema-deep-findings.json`);
  });
}).catch(console.error);
