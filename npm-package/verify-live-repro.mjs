#!/usr/bin/env node
/**
 * Live MCP stdio client for verifying fix/map-sitemap-truncation remediation.
 * Reads NOVADA_API_KEY from environment — never logs secrets.
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

async function mcpSession(env, calls) {
  return new Promise((resolve, reject) => {
    const proc = startServer(env);
    const results = [];
    let reqId = 1;
    let initialized = false;
    let callIndex = 0;
    const pending = new Map();

    const rl = createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }

      // Handle responses
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: res } = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg);
      }
    });

    function send(obj) {
      proc.stdin.write(JSON.stringify(obj) + "\n");
    }

    async function sendAndWait(obj) {
      return new Promise((res) => {
        pending.set(obj.id, { resolve: res });
        send(obj);
      });
    }

    async function run() {
      // Initialize
      const initResp = await sendAndWait({
        jsonrpc: "2.0",
        id: reqId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "verifier", version: "1.0" },
        },
      });

      // Send initialized notification
      send({ jsonrpc: "2.0", method: "notifications/initialized" });

      // Execute each call
      for (const call of calls) {
        const resp = await sendAndWait({
          jsonrpc: "2.0",
          id: reqId++,
          method: "tools/call",
          params: { name: call.tool, arguments: call.args },
        });
        results.push({ call, resp });
      }

      proc.kill();
      resolve(results);
    }

    proc.stderr.on("data", () => {}); // suppress stderr
    proc.on("error", reject);
    run().catch(reject);
  });
}

function extractText(resp) {
  const content = resp?.result?.content;
  if (!content) return resp?.error?.message || JSON.stringify(resp);
  return content.map((c) => c.text || "").join("");
}

async function main() {
  const apiKey = process.env.NOVADA_API_KEY;
  if (!apiKey) {
    console.error("ERROR: NOVADA_API_KEY not set");
    process.exit(1);
  }

  const env = { NOVADA_API_KEY: apiKey };

  console.log("=== LIVE REPRO VERIFICATION ===\n");

  // Test 1: Large site, limit=30, max_depth=2 → map_partial expected, map_complete NOT expected
  console.log("TEST 1: docs.firecrawl.dev limit=30 max_depth=2");
  const results1 = await mcpSession(env, [
    {
      tool: "novada_map",
      args: { url: "https://docs.firecrawl.dev", limit: 30, max_depth: 2 },
    },
  ]);
  const text1 = extractText(results1[0].resp);
  const has_map_complete_1 = text1.includes("map_complete");
  const has_map_partial_1 = text1.includes("map_partial");
  const url_count_1 = (text1.match(/https?:\/\//g) || []).length;
  console.log(`  map_complete present: ${has_map_complete_1} (expected: false)`);
  console.log(`  map_partial present: ${has_map_partial_1} (expected: true)`);
  console.log(`  URL count in output: ${url_count_1}`);
  const test1_pass = !has_map_complete_1 && has_map_partial_1;
  console.log(`  RESULT: ${test1_pass ? "PASS" : "FAIL"}\n`);

  // Test 2: search="api" on docs.firecrawl.dev limit=5
  console.log("TEST 2: docs.firecrawl.dev search=api limit=5");
  const results2 = await mcpSession(env, [
    {
      tool: "novada_map",
      args: { url: "https://docs.firecrawl.dev", search: "api", limit: 5 },
    },
  ]);
  const text2 = extractText(results2[0].resp);
  // Check no "matching URLs in scope" wording (old wording) — should now say "in scope (M match the search filter)"
  const has_old_wording = text2.includes("matching URLs in scope");
  const has_new_wording =
    text2.includes("in scope") && text2.includes("match the search filter");
  console.log(`  old wording 'matching URLs in scope': ${has_old_wording} (expected: false)`);
  console.log(`  new wording 'match the search filter': ${has_new_wording} (expected: true if search results found)`);
  const test2_pass = !has_old_wording;
  console.log(`  RESULT: ${test2_pass ? "PASS" : "FAIL"}\n`);

  // Test 3: Small complete site — should get map_complete
  // Use a tiny site that has very few URLs
  console.log("TEST 3: Small complete site (novada.com/docs/status or similar tiny scope)");
  const results3 = await mcpSession(env, [
    {
      tool: "novada_map",
      args: { url: "https://example.com", limit: 50 },
    },
  ]);
  const text3 = extractText(results3[0].resp);
  const has_map_complete_3 = text3.includes("map_complete");
  const has_map_partial_3 = text3.includes("map_partial");
  const url_count_3 = (text3.match(/https?:\/\//g) || []).length;
  console.log(`  map_complete present: ${has_map_complete_3} (expected: true for tiny site)`);
  console.log(`  map_partial present: ${has_map_partial_3} (expected: false)`);
  console.log(`  URL count: ${url_count_3}`);
  const test3_pass = has_map_complete_3 && !has_map_partial_3;
  console.log(`  RESULT: ${test3_pass ? "PASS" : "FAIL"}\n`);

  console.log("=== SUMMARY ===");
  console.log(`Test 1 (large site → map_partial, no map_complete): ${test1_pass ? "PASS" : "FAIL"}`);
  console.log(`Test 2 (search wording correct): ${test2_pass ? "PASS" : "FAIL"}`);
  console.log(`Test 3 (complete small site → map_complete): ${test3_pass ? "PASS" : "FAIL"}`);

  const all_pass = test1_pass && test2_pass && test3_pass;
  console.log(`\nOVERALL: ${all_pass ? "PASS" : "FAIL"}`);
  process.exit(all_pass ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
