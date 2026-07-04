#!/usr/bin/env node
/**
 * Live MCP stdio client - diagnostic: see raw output for example.com
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
    const pending = new Map();

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
      await sendAndWait({
        jsonrpc: "2.0",
        id: reqId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "verifier", version: "1.0" },
        },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });

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

    proc.stderr.on("data", () => {});
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
  if (!apiKey) { console.error("ERROR: NOVADA_API_KEY not set"); process.exit(1); }

  const env = { NOVADA_API_KEY: apiKey };

  console.log("=== DIAGNOSTIC: example.com raw output ===\n");
  const results = await mcpSession(env, [
    { tool: "novada_map", args: { url: "https://example.com", limit: 50 } },
  ]);
  const text = extractText(results[0].resp);
  console.log(text.substring(0, 2000));

  console.log("\n=== Also check: what does 'discovered total' look like for example.com? ===");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
