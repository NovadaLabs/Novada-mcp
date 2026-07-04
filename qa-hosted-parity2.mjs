/**
 * Hosted parity QA — architecture perspective v2.
 * Uses correct SDK import path (dist/esm).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const SERVER = "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function run() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const client = new Client({ name: "parity-audit", version: "0" }, { capabilities: {} });
  await client.connect(transport);

  const results = [];

  // === TEST 1: List tools ===
  console.log("\n=== TEST 1: ListTools ===");
  const toolsList = await client.listTools();
  const toolNames = toolsList.tools.map(t => t.name);
  console.log(`Total tools: ${toolNames.length}`);

  const expectedNewTools = ["novada_session_stats", "novada_search_feedback", "novada_ip_whitelist", "novada_site_copy"];
  for (const name of expectedNewTools) {
    const present = toolNames.includes(name);
    console.log(`${present ? "PASS" : "FAIL"} tool_present: ${name}`);
    results.push({ test: `tool_present_${name}`, pass: present });
  }

  // === TEST 2: zodToMcpSchema required[] fix ===
  console.log("\n=== TEST 2: zodToMcpSchema required[] fix ===");
  const searchTool = toolsList.tools.find(t => t.name === "novada_search");
  if (searchTool) {
    const schema = searchTool.inputSchema;
    const required = schema.required || [];
    const props = schema.properties || {};
    const bogusRequired = required.filter(k => props[k] && "default" in props[k]);
    const pass = bogusRequired.length === 0;
    console.log(`required[] with defaults: ${JSON.stringify(bogusRequired)}`);
    console.log(`${pass ? "PASS" : "FAIL"} zodToMcpSchema_required_fix`);
    results.push({ test: "zodToMcpSchema_required_fix", pass, detail: bogusRequired });

    const hasAdditionalProps = "additionalProperties" in schema;
    console.log(`${!hasAdditionalProps ? "PASS" : "FAIL"} no_additionalProperties: ${hasAdditionalProps}`);
    results.push({ test: "no_additionalProperties", pass: !hasAdditionalProps });
  }

  // === TEST 3: novada_session_stats auth-free ===
  console.log("\n=== TEST 3: session_stats (auth-free) ===");
  try {
    const r = await client.callTool({ name: "novada_session_stats", arguments: {} });
    const text = r.content?.[0]?.text || "";
    const pass = !r.isError && text.includes("session_started");
    console.log(`${pass ? "PASS" : "FAIL"} session_stats_auth_free`);
    console.log("Preview:", text.slice(0, 200));
    results.push({ test: "session_stats_auth_free", pass });
  } catch(e) {
    console.log("FAIL session_stats error:", e.message);
    results.push({ test: "session_stats_auth_free", pass: false });
  }

  // === TEST 4: novada_search_feedback auth-free ===
  console.log("\n=== TEST 4: search_feedback (auth-free) ===");
  try {
    const r = await client.callTool({
      name: "novada_search_feedback",
      arguments: { search_id: "test-123", query: "test query", rating: "good", useful_urls: ["https://example.com"] }
    });
    const text = r.content?.[0]?.text || "";
    const pass = !r.isError;
    console.log(`${pass ? "PASS" : "FAIL"} search_feedback_auth_free`);
    console.log("Preview:", text.slice(0, 200));
    results.push({ test: "search_feedback_auth_free", pass });
  } catch(e) {
    console.log("FAIL search_feedback error:", e.message);
    results.push({ test: "search_feedback_auth_free", pass: false });
  }

  await client.close();

  // === TEST 5: site_copy PRODUCT_UNAVAILABLE when VERCEL env is set ===
  console.log("\n=== TEST 5: site_copy serverless guard (VERCEL=1) ===");
  const t2 = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY, VERCEL: "1", VERCEL_ENV: "production" }),
  });
  const c2 = new Client({ name: "vercel-sim", version: "0" }, { capabilities: {} });
  await c2.connect(t2);

  try {
    const r = await c2.callTool({ name: "novada_site_copy", arguments: { url: "https://example.com" } });
    const text = r.content?.[0]?.text || "";
    const hasGuard = text.includes("PRODUCT_UNAVAILABLE") || text.includes("serverless") || text.includes("read-only");
    const pass = r.isError && hasGuard;
    console.log(`${pass ? "PASS" : "FAIL"} site_copy_serverless_guard isError=${r.isError} hasGuard=${hasGuard}`);
    console.log("Preview:", text.slice(0, 300));
    results.push({ test: "site_copy_serverless_guard", pass });
  } catch(e) {
    console.log("site_copy error:", e.message);
    results.push({ test: "site_copy_serverless_guard", pass: false });
  }
  await c2.close();

  // === LIVE TESTS (only with real key) ===
  if (KEY !== "dummy") {
    const t3 = new StdioClientTransport({
      command: "node",
      args: [SERVER],
      env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
    });
    const c3 = new Client({ name: "live-audit", version: "0" }, { capabilities: {} });
    await c3.connect(t3);

    // === TEST 6: LIVE search ===
    console.log("\n=== TEST 6: LIVE novada_search ===");
    try {
      const r = await c3.callTool({ name: "novada_search", arguments: { query: "novada mcp server" } });
      const text = r.content?.[0]?.text || "";
      const pass = !r.isError && text.length > 100;
      console.log(`${pass ? "PASS" : "FAIL"} live_search length=${text.length}`);
      console.log("Preview:", text.slice(0, 300));
      results.push({ test: "live_search", pass });
    } catch(e) {
      console.log("FAIL live_search:", e.message);
      results.push({ test: "live_search", pass: false });
    }

    // === TEST 7: LIVE ip_whitelist ===
    console.log("\n=== TEST 7: LIVE novada_ip_whitelist (list) ===");
    try {
      const r = await c3.callTool({ name: "novada_ip_whitelist", arguments: { action: "list", product: "1" } });
      const text = r.content?.[0]?.text || "";
      console.log(`ip_whitelist isError=${r.isError}`);
      console.log("Preview:", text.slice(0, 300));
      results.push({ test: "live_ip_whitelist", pass: !r.isError });
    } catch(e) {
      console.log("FAIL ip_whitelist:", e.message);
      results.push({ test: "live_ip_whitelist", pass: false });
    }

    // === TEST 8: LIVE session_stats after calls ===
    console.log("\n=== TEST 8: LIVE session_stats tracking ===");
    try {
      const r = await c3.callTool({ name: "novada_session_stats", arguments: { recent_limit: 5 } });
      const text = r.content?.[0]?.text || "";
      const hasSearch = text.includes("novada_search");
      const pass = !r.isError && hasSearch;
      console.log(`${pass ? "PASS" : "FAIL"} session_stats_tracking hasSearch=${hasSearch}`);
      console.log("Preview:", text.slice(0, 400));
      results.push({ test: "live_session_stats_tracking", pass });
    } catch(e) {
      console.log("FAIL session_stats:", e.message);
      results.push({ test: "live_session_stats_tracking", pass: false });
    }

    await c3.close();
  }

  console.log("\n=== FINAL RESULTS ===");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`${passed}/${results.length} passed`);
  if (failed.length) console.log("FAILURES:", failed.map(f => f.test).join(", "));

  return results;
}

run().catch(e => {
  console.error("Fatal:", e.message || e);
  process.exit(1);
});
