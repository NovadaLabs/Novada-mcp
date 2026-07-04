#!/usr/bin/env node
/**
 * Live MCP stdio client - find a site that returns map_complete.
 * Tests a known small site with sitemap that returns few URLs.
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

  // Try several candidate small sites to find one that gives map_complete
  const candidates = [
    { url: "https://info.cern.ch", limit: 50 },
    { url: "https://neverssl.com", limit: 50 },
    { url: "https://httpbin.org", limit: 50 },
    { url: "https://jsonplaceholder.typicode.com", limit: 50 },
  ];

  for (const c of candidates) {
    console.log(`Testing: ${c.url} limit=${c.limit}`);
    const resp = await mcpCall(env, "novada_map", c);
    const text = getText(resp);
    const has_complete = text.includes("map_complete");
    const has_partial = text.includes("map_partial");
    const urls = (text.match(/^\d+\. /gm) || []).length;
    console.log(`  map_complete: ${has_complete}, map_partial: ${has_partial}, url_count: ${urls}`);
    if (has_complete && !has_partial) {
      console.log(`  >>> FOUND CANDIDATE for map_complete test: ${c.url}`);
    }
    console.log("");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
