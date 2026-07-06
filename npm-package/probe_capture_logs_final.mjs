#!/usr/bin/env node
/**
 * Final checks:
 * 1. Confirm huge page returns exactly the same response as page=1
 * 2. Confirm error text is NOT JSON parseable (error format consistency)
 * 3. Check if data.list=null response has agent_instruction suggesting cause
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_JS = path.join(__dirname, "build", "index.js");

const CREDS = {
  NOVADA_API_KEY: "process.env.NOVADA_API_KEY",
};

const TOOL = "novada_capture_logs";

let client, transport;

async function init() {
  transport = new StdioClientTransport({
    command: "node", args: [INDEX_JS], env: { ...process.env, ...CREDS },
  });
  client = new Client({ name: "qa-final", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
}

async function close() { try { await client.close(); } catch {} }

async function call(args) {
  const start = Date.now();
  let result, error;
  try { result = await client.callTool({ name: TOOL, arguments: args }); }
  catch (e) { error = e; }
  return { result, error, elapsed: Date.now() - start };
}

await init();

// 1. Compare page=1 vs page=9999999 responses
const r1 = await call({ page: 1, page_size: 1 });
const r2 = await call({ page: 9999999, page_size: 1 });

const raw1 = r1.result?.content?.[0]?.text ?? "";
const raw2 = r2.result?.content?.[0]?.text ?? "";

try {
  const d1 = JSON.parse(raw1);
  const d2 = JSON.parse(raw2);
  console.log("page=1 list:", JSON.stringify(d1.data?.list));
  console.log("page=9999999 list:", JSON.stringify(d2.data?.list));
  console.log("Same response?", JSON.stringify(d1.data) === JSON.stringify(d2.data));
  // A page way out of bounds returning a non-empty list (even zeros) is suspicious
  // It should return empty list or signal out-of-range
  const p2List = d2.data?.list;
  if (Array.isArray(p2List) && p2List.length > 0) {
    console.log("SUSPICIOUS: page=9999999 returned non-empty list:", JSON.stringify(p2List[0]));
  }
} catch (e) {
  console.log("parse error:", e.message);
}

// 2. Confirm error text is NOT JSON
console.log("\n--- Error format ---");
const rErr = await call({ page: -1 });  // negative page
const rawErr = rErr.result?.content?.[0]?.text ?? "";
console.log("isError:", rErr.result?.isError);
console.log("Is parseable JSON:", (() => { try { JSON.parse(rawErr); return true; } catch { return false; } })());
console.log("Contains agent_instruction:", rawErr.includes("agent_instruction"));
console.log("Full text:", rawErr);

// 3. Null list warning check
console.log("\n--- Null list from inverted dates ---");
const rNull = await call({ start_time: "2026-12-31", end_time: "2026-01-01" });
const rawNull = rNull.result?.content?.[0]?.text ?? "";
try {
  const parsed = JSON.parse(rawNull);
  console.log("status:", parsed.status);
  console.log("data.list:", parsed.data?.list);
  console.log("agent_instruction:", parsed.agent_instruction);
  // Is there any clue to the agent that dates might be wrong?
  const hasWarning = parsed.agent_instruction?.toLowerCase().includes("null") ||
    parsed.agent_instruction?.toLowerCase().includes("empty") ||
    parsed.agent_instruction?.toLowerCase().includes("date") ||
    parsed.agent_instruction?.toLowerCase().includes("range");
  console.log("Has useful null-list guidance:", hasWarning);
} catch {}

// 4. Check same issue with far-future dates (no data yet)
console.log("\n--- Far future dates (should return empty) ---");
const rFuture = await call({ start_time: "2030-01-01", end_time: "2030-12-31" });
const rawFuture = rFuture.result?.content?.[0]?.text ?? "";
try {
  const parsed = JSON.parse(rawFuture);
  console.log("status:", parsed.status);
  console.log("data.list:", JSON.stringify(parsed.data?.list));
} catch {}

await close();
