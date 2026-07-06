/**
 * Hosted parity QA — architecture perspective.
 * Tests: tool catalog, zodToMcpSchema required[] fix, site_copy guard, session_stats/ip_whitelist/search_feedback absence on hosted.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = process.env.QA_KEY || "dummy";
const SERVER = process.env.SERVER || "/Users/tongwu/Projects/novada-mcp/build/index.js";

async function run() {
  const t = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "parity-audit", version: "0" }, { capabilities: {} });
  await c.connect(t);

  const results = [];

  // === TEST 1: List tools - check counts and names ===
  console.log("\n=== TEST 1: ListTools ===");
  const toolsList = await c.listTools();
  const toolNames = toolsList.tools.map(t => t.name);
  console.log(`Total tools: ${toolNames.length}`);
  console.log("Tools:", toolNames.join(", "));

  // Check expected tools present
  const expectedNewTools = ["novada_session_stats", "novada_search_feedback", "novada_ip_whitelist", "novada_site_copy"];
  for (const name of expectedNewTools) {
    const present = toolNames.includes(name);
    console.log(`${present ? "✓" : "✗"} ${name}: ${present ? "present" : "MISSING"}`);
    results.push({ test: `tool_present_${name}`, pass: present });
  }

  // === TEST 2: zodToMcpSchema required[] fix ===
  console.log("\n=== TEST 2: zodToMcpSchema required[] fix ===");
  // novada_search has optional params with defaults (engine, num, format, etc.)
  const searchTool = toolsList.tools.find(t => t.name === "novada_search");
  if (searchTool) {
    const schema = searchTool.inputSchema;
    const required = schema.required || [];
    const props = schema.properties || {};
    // Find any required[] field that has a default value in properties — this would be a bug
    const bogusRequired = required.filter(k => props[k] && "default" in props[k]);
    console.log(`novada_search required[]: ${JSON.stringify(required)}`);
    console.log(`Params with default that are in required[]: ${JSON.stringify(bogusRequired)}`);
    const pass = bogusRequired.length === 0;
    console.log(`${pass ? "✓" : "✗"} required[] fix: ${pass ? "PASS" : "FAIL - has defaults in required[]"}`);
    results.push({ test: "zodToMcpSchema_required_fix", pass, detail: bogusRequired });

    // Also check additionalProperties is NOT set (npm fix)
    const hasAdditionalProps = "additionalProperties" in schema;
    console.log(`additionalProperties present: ${hasAdditionalProps} (should be absent)`);
    results.push({ test: "zodToMcpSchema_no_additionalProperties", pass: !hasAdditionalProps });
  }

  // === TEST 3: novada_site_copy PRODUCT_UNAVAILABLE guard when VERCEL env is set ===
  console.log("\n=== TEST 3: site_copy serverless guard ===");
  // Run with VERCEL=1 to simulate serverless
  const t2 = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY, VERCEL: "1", VERCEL_ENV: "production" }),
  });
  const c2 = new Client({ name: "parity-audit-vercel", version: "0" }, { capabilities: {} });
  await c2.connect(t2);

  try {
    const siteCopyResult = await c2.callTool({
      name: "novada_site_copy",
      arguments: { url: "https://example.com" },
    });
    const text = siteCopyResult.content?.[0]?.text || "";
    const isError = siteCopyResult.isError;
    const hasProductUnavailable = text.includes("PRODUCT_UNAVAILABLE") || text.includes("serverless");
    console.log(`site_copy with VERCEL=1 isError: ${isError}`);
    console.log(`Contains PRODUCT_UNAVAILABLE/serverless message: ${hasProductUnavailable}`);
    console.log(`Response preview: ${text.slice(0, 200)}`);
    const pass = isError && hasProductUnavailable;
    console.log(`${pass ? "✓" : "✗"} site_copy serverless guard: ${pass ? "PASS" : "FAIL"}`);
    results.push({ test: "site_copy_serverless_guard", pass });
  } catch (e) {
    console.log(`site_copy threw: ${e.message}`);
    results.push({ test: "site_copy_serverless_guard", pass: false, error: e.message });
  }
  await c2.close();

  // === TEST 4: novada_session_stats (auth-free) ===
  console.log("\n=== TEST 4: session_stats (auth-free) ===");
  try {
    const statsResult = await c.callTool({
      name: "novada_session_stats",
      arguments: {},
    });
    const text = statsResult.content?.[0]?.text || "";
    const pass = !statsResult.isError && text.includes("session_started");
    console.log(`session_stats isError: ${statsResult.isError}, has session_started: ${text.includes("session_started")}`);
    console.log(`${pass ? "✓" : "✗"} session_stats: ${pass ? "PASS" : "FAIL"}`);
    results.push({ test: "session_stats_auth_free", pass });
  } catch (e) {
    console.log(`session_stats threw: ${e.message}`);
    results.push({ test: "session_stats_auth_free", pass: false, error: e.message });
  }

  // === TEST 5: novada_setup (auth-free even without key) ===
  console.log("\n=== TEST 5: novada_setup (auth-free) ===");
  const t3 = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: Object.assign({}, process.env, {}), // No API key
  });
  const c3 = new Client({ name: "parity-audit-nokey", version: "0" }, { capabilities: {} });
  await c3.connect(t3);

  try {
    const setupResult = await c3.callTool({
      name: "novada_setup",
      arguments: {},
    });
    const text = setupResult.content?.[0]?.text || "";
    const pass = !setupResult.isError && text.includes("Setup");
    console.log(`novada_setup without key: isError=${setupResult.isError}`);
    console.log(`${pass ? "✓" : "✗"} novada_setup auth-free: ${pass ? "PASS" : "FAIL"}`);
    results.push({ test: "novada_setup_auth_free", pass });
  } catch (e) {
    console.log(`novada_setup threw: ${e.message}`);
    results.push({ test: "novada_setup_auth_free", pass: false, error: e.message });
  }
  await c3.close();

  // === TEST 6: LIVE - novada_search with real key ===
  if (KEY !== "dummy") {
    console.log("\n=== TEST 6: LIVE novada_search ===");
    try {
      const searchResult = await c.callTool({
        name: "novada_search",
        arguments: { query: "novada mcp server web scraping" },
      });
      const text = searchResult.content?.[0]?.text || "";
      const pass = !searchResult.isError && text.length > 100;
      console.log(`search isError: ${searchResult.isError}, length: ${text.length}`);
      console.log(`Preview: ${text.slice(0, 300)}`);
      console.log(`${pass ? "✓" : "✗"} live search: ${pass ? "PASS" : "FAIL"}`);
      results.push({ test: "live_search", pass, preview: text.slice(0, 100) });
    } catch (e) {
      console.log(`live search threw: ${e.message}`);
      results.push({ test: "live_search", pass: false, error: e.message });
    }

    // === TEST 7: LIVE - novada_ip_whitelist ===
    console.log("\n=== TEST 7: LIVE novada_ip_whitelist ===");
    try {
      const whitelistResult = await c.callTool({
        name: "novada_ip_whitelist",
        arguments: { action: "list", product: "1" },
      });
      const text = whitelistResult.content?.[0]?.text || "";
      console.log(`ip_whitelist isError: ${whitelistResult.isError}`);
      console.log(`Preview: ${text.slice(0, 300)}`);
      results.push({ test: "live_ip_whitelist", pass: !whitelistResult.isError, preview: text.slice(0, 100) });
    } catch (e) {
      console.log(`ip_whitelist threw: ${e.message}`);
      results.push({ test: "live_ip_whitelist", pass: false, error: e.message });
    }

    // === TEST 8: LIVE - novada_session_stats after calls ===
    console.log("\n=== TEST 8: LIVE session_stats after real calls ===");
    try {
      const statsResult = await c.callTool({
        name: "novada_session_stats",
        arguments: { recent_limit: 5 },
      });
      const text = statsResult.content?.[0]?.text || "";
      const hasSearch = text.includes("novada_search");
      console.log(`session_stats has search in history: ${hasSearch}`);
      console.log(`Preview: ${text.slice(0, 400)}`);
      results.push({ test: "live_session_stats", pass: !statsResult.isError && hasSearch, preview: text.slice(0, 100) });
    } catch (e) {
      console.log(`session_stats threw: ${e.message}`);
      results.push({ test: "live_session_stats", pass: false, error: e.message });
    }
  }

  await c.close();

  console.log("\n=== RESULTS SUMMARY ===");
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`${passed}/${results.length} tests passed`);
  if (failed.length) {
    console.log("FAILED:", failed.map(f => f.test).join(", "));
  }

  return results;
}

run().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
