#!/usr/bin/env node
/**
 * QA probe for novada_capture_logs — adversarial red-team
 * Runs as a real MCP client over stdio against build/index.js
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_JS = path.join(__dirname, "build", "index.js");

const CREDS = {
  NOVADA_API_KEY: "process.env.NOVADA_API_KEY",
  NOVADA_PROXY_USER: "tongwu_TRDI7X",
  NOVADA_PROXY_PASS: "_Asd1644asd_",
  NOVADA_BROWSER_WS:
    "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com",
};

const TOOL = "novada_capture_logs";

let client, transport;
const results = [];

async function init() {
  transport = new StdioClientTransport({
    command: "node",
    args: [INDEX_JS],
    env: { ...process.env, ...CREDS },
  });
  client = new Client({ name: "qa-probe", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
}

async function close() {
  try { await client.close(); } catch {}
}

async function call(label, args) {
  const start = Date.now();
  let result, error;
  try {
    result = await client.callTool({ name: TOOL, arguments: args });
  } catch (e) {
    error = e;
  }
  const elapsed = Date.now() - start;
  results.push({ label, args, result, error, elapsed });
  return { result, error, elapsed };
}

async function listTools() {
  const r = await client.listTools();
  return r.tools.find((t) => t.name === TOOL);
}

// ─── Main ──────────────────────────────────────────────────────────────────
await init();

// 0. Introspect schema
const toolDef = await listTools();
console.log("=== Tool schema ===");
console.log(JSON.stringify(toolDef?.inputSchema, null, 2));
console.log();

// 1. Happy path — no args (all defaults)
console.log("--- 1. No args (defaults) ---");
let r = await call("happy_default", {});
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("status:", parsed.status);
    console.log("keys:", Object.keys(parsed.data ?? {}));
    console.log("data sample:", JSON.stringify(parsed.data).slice(0, 300));
    console.log("agent_instruction:", parsed.agent_instruction?.slice(0, 100));
  } catch {
    console.log("raw (not JSON):", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 2. Happy path — with date range and status filter
console.log("--- 2. Valid date range + status=success ---");
r = await call("happy_daterange", {
  start_time: "2026-01-01",
  end_time: "2026-06-30",
  page: 1,
  page_size: 5,
  status: "success",
});
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("status:", parsed.status);
    console.log("data:", JSON.stringify(parsed.data).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 3. Happy path — status=failed
console.log("--- 3. status=failed ---");
r = await call("happy_failed", { status: "failed", page: 1, page_size: 10 });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("status:", parsed.status);
  } catch {}
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 4. Hostile — wrong type for page (string)
console.log("--- 4. page=string (type error) ---");
r = await call("bad_page_type", { page: "one" });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("keys:", Object.keys(parsed));
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 5. Hostile — page=0 (non-positive, violates .positive())
console.log("--- 5. page=0 (boundary: non-positive) ---");
r = await call("bad_page_zero", { page: 0 });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 6. Hostile — page_size=201 (over max 200)
console.log("--- 6. page_size=201 (over max) ---");
r = await call("bad_page_size_over", { page_size: 201 });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 7. Hostile — bad date format (not YYYY-MM-DD)
console.log("--- 7. start_time=bad format ---");
r = await call("bad_date_format", { start_time: "01-01-2026" });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 8. Hostile — invalid status enum
console.log("--- 8. status=invalid_value ---");
r = await call("bad_status_enum", { status: "pending" });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 9. Hostile — unknown extra param (strict schema should reject)
console.log("--- 9. Extra unknown param (strict) ---");
r = await call("bad_unknown_param", { page: 1, foo: "bar" });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 10. Hostile — huge page number (9999999)
console.log("--- 10. page=9999999 (huge) ---");
r = await call("bad_huge_page", { page: 9999999, page_size: 1 });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("status:", parsed.status);
    console.log("data:", JSON.stringify(parsed.data).slice(0, 200));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 11. Hostile — SQL injection in start_time (should be blocked by regex)
console.log("--- 11. start_time=SQL injection ---");
r = await call("sql_inject_start_time", {
  start_time: "2026-01-01'; DROP TABLE logs; --",
});
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 12. Hostile — end_time before start_time (no schema cross-validation)
console.log("--- 12. end_time before start_time ---");
r = await call("inverted_dates", {
  start_time: "2026-12-31",
  end_time: "2026-01-01",
  page: 1,
  page_size: 5,
});
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("status:", parsed.status);
    console.log("data:", JSON.stringify(parsed.data).slice(0, 200));
    console.log("agent_instruction:", parsed.agent_instruction?.slice(0, 100));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 13. Hostile — page_size=0 (boundary: zero, violates .positive())
console.log("--- 13. page_size=0 (boundary) ---");
r = await call("bad_page_size_zero", { page_size: 0 });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 14. Hostile — null for page (explicit null)
console.log("--- 14. page=null ---");
r = await call("null_page", { page: null });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  console.log("isError:", r.result.isError);
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction present:", !!parsed.agent_instruction);
    console.log("text:", JSON.stringify(parsed).slice(0, 300));
  } catch {
    console.log("raw:", raw.slice(0, 300));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

// 15. Inspect output shape: are there required fields in data?
console.log("--- 15. Output shape analysis (page=1 page_size=3) ---");
r = await call("output_shape", { page: 1, page_size: 3 });
console.log("elapsed:", r.elapsed, "ms");
if (r.result) {
  const raw = r.result.content?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(raw);
    console.log("top-level keys:", Object.keys(parsed));
    const data = parsed.data;
    if (data && typeof data === "object") {
      console.log("data keys:", Object.keys(data));
      // Check if data.list or data.data exists
      const listKey = data.list ?? data.data ?? data.records ?? data.items;
      if (Array.isArray(listKey) && listKey.length > 0) {
        console.log("first record keys:", Object.keys(listKey[0]));
        console.log("first record:", JSON.stringify(listKey[0]).slice(0, 400));
      } else {
        console.log("data:", JSON.stringify(data).slice(0, 400));
      }
    }
    console.log("structuredContent:", r.result.structuredContent);
  } catch {
    console.log("raw:", raw.slice(0, 400));
  }
}
if (r.error) console.log("error:", r.error.message);
console.log();

await close();

console.log("=== Summary ===");
for (const res of results) {
  const status = res.error
    ? "THREW"
    : res.result?.isError
    ? "TOOL_ERR"
    : "OK";
  console.log(`[${status}] ${res.label} (${res.elapsed}ms)`);
}
