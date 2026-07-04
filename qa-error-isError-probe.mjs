/**
 * Focused probe: tools that return {status:"error"} JSON but don't set isError:true
 * This is an MCP contract violation — agents that check r.isError will not know an error occurred.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const makeClient = async (key = "dummy") => {
  const env = Object.assign({}, process.env, {
    NOVADA_API_KEY: key,
    NOVADA_DEVELOPER_API_KEY: key,
  });
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });
  const c = new Client({ name: "qa-isError", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { client: c, transport: t };
};

const results = [];

// ── ip_whitelist 'add' without ip ─────────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_ip_whitelist", arguments: { action: "add", product: "1" } });
  const txt = r.content?.[0]?.text ?? "";
  const parsed = JSON.parse(txt);
  console.log("=== ip_whitelist add (no ip):");
  console.log("  isError:", r.isError);
  console.log("  status field:", parsed.status);
  console.log("  agent_instruction:", parsed.agent_instruction?.slice(0, 100));
  results.push({
    scenario: "ip_whitelist add missing ip",
    isError: r.isError,
    statusField: parsed.status,
    hasAgentInstruction: !!parsed.agent_instruction,
    issue: r.isError !== true ? "isError not set to true for error response" : null,
  });
  await c.close();
}

// ── ip_whitelist 'del' without ips ────────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_ip_whitelist", arguments: { action: "del", product: "1" } });
  const txt = r.content?.[0]?.text ?? "";
  const parsed = JSON.parse(txt);
  console.log("\n=== ip_whitelist del (no ips):");
  console.log("  isError:", r.isError);
  console.log("  status field:", parsed.status);
  results.push({
    scenario: "ip_whitelist del missing ips",
    isError: r.isError,
    statusField: parsed.status,
    hasAgentInstruction: !!parsed.agent_instruction,
    issue: r.isError !== true ? "isError not set to true for error response" : null,
  });
  await c.close();
}

// ── ip_whitelist 'remark' without id ─────────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_ip_whitelist", arguments: { action: "remark", product: "1" } });
  const txt = r.content?.[0]?.text ?? "";
  const parsed = JSON.parse(txt);
  console.log("\n=== ip_whitelist remark (no id):");
  console.log("  isError:", r.isError);
  console.log("  status field:", parsed.status);
  results.push({
    scenario: "ip_whitelist remark missing id",
    isError: r.isError,
    statusField: parsed.status,
    hasAgentInstruction: !!parsed.agent_instruction,
    issue: r.isError !== true ? "isError not set to true for error response" : null,
  });
  await c.close();
}

// ── ip_whitelist 'add' with confirm:false (confirmation_required) ─────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_ip_whitelist", arguments: { action: "add", product: "1", ip: "1.2.3.4" } });
  const txt = r.content?.[0]?.text ?? "";
  const parsed = JSON.parse(txt);
  console.log("\n=== ip_whitelist add (confirmation_required):");
  console.log("  isError:", r.isError);
  console.log("  status field:", parsed.status);
  console.log("  agent_instruction:", parsed.agent_instruction?.slice(0, 100));
  results.push({
    scenario: "ip_whitelist add needs confirm (confirmation_required)",
    isError: r.isError,
    statusField: parsed.status,
    hasAgentInstruction: !!parsed.agent_instruction,
    issue: null, // confirmation_required is NOT an error, just a pre-flight gate
  });
  await c.close();
}

// ── proxy_account_create without confirm ──────────────────────────────────────
{
  const { client: c } = await makeClient();
  const r = await c.callTool({ name: "novada_proxy_account_create", arguments: {
    product: "1",
    account: "testaccount",
    password: "password123",
    status: "1",
  }});
  const txt = r.content?.[0]?.text ?? "";
  const parsed = JSON.parse(txt);
  console.log("\n=== proxy_account_create (no confirm):");
  console.log("  isError:", r.isError);
  console.log("  status field:", parsed.status);
  results.push({
    scenario: "proxy_account_create without confirm",
    isError: r.isError,
    statusField: parsed.status,
    hasAgentInstruction: !!parsed.agent_instruction,
    issue: null, // confirmation_required is NOT an error
  });
  await c.close();
}

console.log("\n=== Summary:");
for (const r of results) {
  const flag = r.issue ? "FAIL" : "PASS";
  console.log(`  [${flag}] ${r.scenario}`);
  if (r.issue) console.log(`         ISSUE: ${r.issue}`);
  console.log(`         isError=${r.isError}, statusField=${r.statusField}`);
}

console.log(JSON.stringify(results, null, 2));
