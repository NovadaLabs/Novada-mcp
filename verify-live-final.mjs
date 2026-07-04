#!/usr/bin/env node
/**
 * Final live MCP verification for fix/map-sitemap-truncation.
 * Tests all veto scenarios with known-good candidate sites.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const WORKTREE = "/Users/tongwu/Projects/novada-mcp/.worktrees/fix-map-sitemap-truncation";
const BUILD_INDEX = `${WORKTREE}/build/index.js`;

function startServer(env) {
  return spawn("node", [BUILD_INDEX], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function mcpCall(env, tool, args) {
  return new Promise((resolve, reject) => {
    const proc = startServer(env);
    const pending = new Map();
    let reqId = 1;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: res } = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg);
      }
    });

    function send(obj) { proc.stdin.write(JSON.stringify(obj) + "\n"); }
    async function sw(obj) { return new Promise(res => { pending.set(obj.id, { resolve: res }); send(obj); }); }

    async function run() {
      await sw({ jsonrpc: "2.0", id: reqId++, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "v", version: "1" } } });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const resp = await sw({ jsonrpc: "2.0", id: reqId++, method: "tools/call", params: { name: tool, arguments: args } });
      proc.kill();
      resolve(resp);
    }

    proc.stderr.on("data", () => {});
    proc.on("error", reject);
    run().catch(reject);
  });
}

function getText(resp) {
  const c = resp?.result?.content;
  if (!c) return resp?.error?.message || JSON.stringify(resp);
  return c.map(x => x.text || "").join("");
}

async function main() {
  const apiKey = process.env.NOVADA_API_KEY;
  if (!apiKey) { console.error("ERROR: NOVADA_API_KEY not set"); process.exit(1); }
  const env = { NOVADA_API_KEY: apiKey };

  const results = [];

  // TEST 1: Large site with limit=30 → map_partial, NOT map_complete
  // (The original repro scenario per brief)
  console.log("TEST 1: docs.firecrawl.dev limit=30 max_depth=2 (large site → map_partial expected)");
  const r1 = getText(await mcpCall(env, "novada_map", { url: "https://docs.firecrawl.dev", limit: 30, max_depth: 2 }));
  const t1_no_complete = !r1.includes("map_complete");
  const t1_has_partial = r1.includes("map_partial");
  const t1_url_count = (r1.match(/^\d+\. /gm) || []).length;
  console.log(`  map_complete absent: ${t1_no_complete} (expected: true)`);
  console.log(`  map_partial present: ${t1_has_partial} (expected: true)`);
  console.log(`  URL count: ${t1_url_count} (expected: ~30)`);
  const t1_pass = t1_no_complete && t1_has_partial && t1_url_count > 0;
  console.log(`  RESULT: ${t1_pass ? "PASS" : "FAIL"}\n`);
  results.push(["Test 1 (large site → map_partial, no map_complete)", t1_pass]);

  // TEST 2: search="api" on docs.firecrawl.dev — no old wording, honest hint
  console.log("TEST 2: docs.firecrawl.dev search=api limit=5 (wording check)");
  const r2 = getText(await mcpCall(env, "novada_map", { url: "https://docs.firecrawl.dev", search: "api", limit: 5 }));
  const t2_no_old_wording = !r2.includes("matching URLs in scope");
  const t2_url_count = (r2.match(/^\d+\. /gm) || []).length;
  console.log(`  old wording 'matching URLs in scope' absent: ${t2_no_old_wording} (expected: true)`);
  console.log(`  URL count returned: ${t2_url_count}`);
  // Also check: if results found, new wording should use "match the search filter"
  if (r2.includes("in scope")) {
    const has_new_wording = r2.includes("match the search filter");
    console.log(`  new wording 'match the search filter' present: ${has_new_wording}`);
  }
  const t2_pass = t2_no_old_wording;
  console.log(`  RESULT: ${t2_pass ? "PASS" : "FAIL"}\n`);
  results.push(["Test 2 (search wording — no 'matching URLs in scope')", t2_pass]);

  // TEST 3: Small complete site → map_complete present (veto scenario)
  // Using jsonplaceholder.typicode.com (confirmed 10 URLs, map_complete=true)
  console.log("TEST 3: jsonplaceholder.typicode.com limit=50 (small complete site → map_complete expected)");
  const r3 = getText(await mcpCall(env, "novada_map", { url: "https://jsonplaceholder.typicode.com", limit: 50 }));
  const t3_has_complete = r3.includes("map_complete");
  const t3_no_partial = !r3.includes("map_partial");
  const t3_url_count = (r3.match(/^\d+\. /gm) || []).length;
  console.log(`  map_complete present: ${t3_has_complete} (expected: true)`);
  console.log(`  map_partial absent: ${t3_no_partial} (expected: true)`);
  console.log(`  URL count: ${t3_url_count}`);
  const t3_pass = t3_has_complete && t3_no_partial && t3_url_count > 0;
  console.log(`  RESULT: ${t3_pass ? "PASS" : "FAIL"}\n`);
  results.push(["Test 3 (small complete site → map_complete)", t3_pass]);

  // SUMMARY
  console.log("=== SUMMARY ===");
  let all_pass = true;
  for (const [name, pass] of results) {
    console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
    if (!pass) all_pass = false;
  }
  console.log(`\nOVERALL: ${all_pass ? "PASS" : "FAIL"}`);
  process.exit(all_pass ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
