#!/usr/bin/env node
/**
 * measure-tools-list.mjs — W-B1 (F-1 P1 / F-7) payload-size instrumentation.
 *
 * Spawns the BUILT stdio server (build/index.js), performs the real MCP
 * initialize -> initialized -> tools/list handshake over stdio (newline-
 * delimited JSON-RPC, matching @modelcontextprotocol/sdk's ReadBuffer format —
 * see node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js), and
 * reports:
 *   - total tools/list payload bytes (JSON.stringify(result.tools), utf8)
 *   - per-tool bytes, sorted desc (top 15 printed; full table with --full)
 *   - a token estimate (bytes / 4 — the same rough heuristic used across this
 *     audit's other measurements; not a real tokenizer)
 *
 * No NOVADA_API_KEY needed — ListToolsRequestSchema's handler in src/index.ts
 * returns ACTIVE_TOOLS unconditionally, before any API-key gate.
 *
 * Usage:
 *   node scripts/measure-tools-list.mjs                 # full 38-tool default
 *   node scripts/measure-tools-list.mjs --groups=core,account,meta
 *   node scripts/measure-tools-list.mjs --tools=novada_search,novada_extract
 *   node scripts/measure-tools-list.mjs --full           # print every tool, not just top 15
 *   node scripts/measure-tools-list.mjs --json           # machine-readable output only
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "..", "build", "index.js");

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=", 2)[1];
const has = (name) => argv.includes(`--${name}`);

const groups = flag("groups");
const tools = flag("tools");
const topN = Number(flag("top") ?? "15");
const printFull = has("full");
const jsonOut = has("json");

/** Byte length of a UTF-8 string. */
function byteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Run one MCP stdio session: initialize -> notifications/initialized ->
 * tools/list. Returns the parsed tools/list `result`.
 */
async function fetchToolsList(env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  const pending = new Map(); // id -> resolve
  let nextId = 1;
  let stderrBuf = "";

  child.stderr.on("data", (d) => {
    stderrBuf += d.toString("utf8");
  });

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    // eslint-disable-next-line no-cond-assign
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // not JSON-RPC (shouldn't happen on stdout)
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const resolve = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  function send(method, params) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    child.stdin.write(payload);
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timed out waiting for response to ${method} (id=${id}). stderr so far:\n${stderrBuf}`));
        }
      }, 15_000);
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  try {
    await send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "measure-tools-list", version: "0.0.0" },
    });
    notify("notifications/initialized", {});
    const listResp = await send("tools/list", {});
    if (listResp.error) {
      throw new Error(`tools/list returned an error: ${JSON.stringify(listResp.error)}`);
    }
    return listResp.result;
  } finally {
    child.stdin.end();
    child.kill();
  }
}

function report(result, label) {
  const tools = result.tools ?? [];
  const perTool = tools
    .map((t) => ({ name: t.name, bytes: byteLen(JSON.stringify(t)) }))
    .sort((a, b) => b.bytes - a.bytes);
  const totalBytes = perTool.reduce((sum, t) => sum + t.bytes, 0);
  // Whole-array bytes (includes the enclosing [ , ] and separators, so this is
  // the honest "what actually goes over the wire in tools/list" number — very
  // slightly larger than the sum of per-tool bytes above, which is why both are
  // reported).
  const arrayBytes = byteLen(JSON.stringify(tools));
  const tokenEstimate = Math.round(arrayBytes / 4);
  const titledCount = tools.filter((t) => typeof t.title === "string" && t.title.trim().length > 0).length;

  const summary = {
    label,
    tool_count: tools.length,
    total_bytes_array: arrayBytes,
    total_bytes_sum_per_tool: totalBytes,
    token_estimate: tokenEstimate,
    tools_with_title: titledCount,
    top: perTool.slice(0, topN),
    all: printFull ? perTool : undefined,
  };

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  console.log(`\n=== ${label} ===`);
  console.log(`tool_count:        ${summary.tool_count}`);
  console.log(`total bytes:       ${arrayBytes.toLocaleString()}  (~${tokenEstimate.toLocaleString()} tokens @ 4 bytes/token)`);
  console.log(`tools with title:  ${titledCount} / ${summary.tool_count}`);
  console.log(`\nTop ${Math.min(topN, perTool.length)} tools by byte size:`);
  const nameWidth = Math.max(...perTool.slice(0, topN).map((t) => t.name.length), 10);
  for (const t of perTool.slice(0, topN)) {
    const pct = ((t.bytes / arrayBytes) * 100).toFixed(1);
    console.log(`  ${t.name.padEnd(nameWidth)}  ${t.bytes.toString().padStart(7)} bytes  (${pct}%)`);
  }
  if (printFull) {
    console.log(`\nFull table (${perTool.length} tools):`);
    for (const t of perTool) {
      console.log(`  ${t.name.padEnd(nameWidth)}  ${t.bytes.toString().padStart(7)} bytes`);
    }
  }
  return summary;
}

async function main() {
  const env = {};
  if (groups) env.NOVADA_GROUPS = groups;
  if (tools) env.NOVADA_TOOLS = tools;
  const label = groups
    ? `NOVADA_GROUPS=${groups}`
    : tools
      ? `NOVADA_TOOLS=${tools}`
      : "DEFAULT (no filter — all tools)";
  const result = await fetchToolsList(env);
  report(result, label);
}

main().catch((err) => {
  console.error("measure-tools-list failed:", err.message ?? err);
  process.exit(1);
});
