#!/usr/bin/env node
/**
 * Deep follow-up probe for novada_capture_logs
 * Focuses on: schema required-vs-defaults mismatch, null list handling,
 * error JSON structure, data pagination reality, and timeout behavior.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_JS = path.join(__dirname, "build", "index.js");

const CREDS = {
  NOVADA_API_KEY: "1f35b477c9e1802778ec64aee2a6adfa",
  NOVADA_PROXY_USER: "tongwu_TRDI7X",
  NOVADA_PROXY_PASS: "_Asd1644asd_",
  NOVADA_BROWSER_WS:
    "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com",
};

const TOOL = "novada_capture_logs";

let client, transport;

async function init() {
  transport = new StdioClientTransport({
    command: "node",
    args: [INDEX_JS],
    env: { ...process.env, ...CREDS },
  });
  client = new Client({ name: "qa-deep", version: "0.0.1" }, { capabilities: {} });
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
  console.log(`\n=== ${label} === (${elapsed}ms)`);
  if (error) {
    console.log("THREW:", error.message);
    return { result, error, elapsed };
  }
  if (result) {
    console.log("isError:", result.isError);
    console.log("content[0].type:", result.content?.[0]?.type);
    const raw = result.content?.[0]?.text ?? "";
    try {
      const parsed = JSON.parse(raw);
      console.log("parsed keys:", Object.keys(parsed));
      if (parsed.error) console.log("error field:", parsed.error);
      if (parsed.agent_instruction) console.log("agent_instruction:", parsed.agent_instruction.slice(0, 120));
      if (parsed.data) console.log("data:", JSON.stringify(parsed.data).slice(0, 400));
    } catch {
      console.log("raw (not JSON):", raw.slice(0, 400));
    }
  }
  return { result, error, elapsed };
}

await init();

// A. Confirm: tool schema says page+page_size are "required" — but sending {} succeeds (defaults apply)
// This is a mismatch: inputSchema required != actual behavior
console.log("\n=== A. Schema says required=[page,page_size] but sending {} works ===");
const rA = await call("empty_args_with_schema_required", {});
// No output needed here, already in call()

// B. Inverted dates — end < start — what does API return?
console.log("\n=== B. end_time < start_time API behavior ===");
const rB = await call("inverted_dates_detail", {
  start_time: "2026-12-31",
  end_time: "2026-01-01",
  page: 1,
  page_size: 5,
});
// Expected: an error from API or at minimum a warning in output
// Already observed: status=ok, data={list:null} — check if agent_instruction warns

// C. Inspect if error responses have consistent JSON structure
console.log("\n=== C. Error response format check (isError=true) ===");
const rC = await call("error_format_check", { page: "bad" });
if (rC.result) {
  console.log("Full content array:", JSON.stringify(rC.result.content));
  // Is it a valid JSON with agent_instruction? Or plain text?
  const raw = rC.result.content?.[0]?.text ?? "";
  console.log("Is JSON parseable:", (() => { try { JSON.parse(raw); return true; } catch { return false; } })());
  console.log("Has agent_instruction in text:", raw.includes("agent_instruction"));
  console.log("Raw text:", raw);
}

// D. page_size=1 with page=200 (should silently return empty list, or error?)
console.log("\n=== D. page=200, page_size=1 (deep pagination) ===");
const rD = await call("deep_pagination", { page: 200, page_size: 1 });

// E. page=1, page_size=200 (max allowed) — does it work?
console.log("\n=== E. page_size=200 (boundary max) ===");
const rE = await call("max_page_size", { page: 1, page_size: 200 });

// F. Check if status=all is forwarded to server (code says: skip status when "all")
// The code has: if (params.status && params.status !== "all") { baseBody.status = params.status; }
// So status="all" is NOT forwarded to the server. Does server default to all?
console.log("\n=== F. status=all explicit (not forwarded to server, check behavior) ===");
const rF = await call("status_all_explicit", { status: "all", page: 1, page_size: 5 });

// G. Float page number — coercion behavior
console.log("\n=== G. page=1.5 (float, schema says integer) ===");
const rG = await call("float_page", { page: 1.5 });

// H. Check if data.list=null causes downstream agent parsing errors
// The inverted dates returns null list — check if agent_instruction warns the agent
console.log("\n=== H. null list — is there a warning/agent_instruction? ===");
const rH = await call("null_list_warning", {
  start_time: "2026-12-31",
  end_time: "2026-01-01",
});
if (rH.result) {
  const raw = rH.result.content?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(raw);
    console.log("agent_instruction:", parsed.agent_instruction);
    console.log("data.list:", parsed.data?.list);
    console.log("Has null-list warning:", JSON.stringify(parsed).includes("null") || JSON.stringify(parsed).includes("empty"));
  } catch {}
}

// I. Verify: no secrets (NOVADA_API_KEY) in error responses
console.log("\n=== I. Secret leak check in errors ===");
const rI = await call("secret_leak_bad_param", { page: "bad_string" });
if (rI.result) {
  const raw = rI.result.content?.[0]?.text ?? "";
  const hasApiKey = raw.includes("1f35b477c9e1802778ec64aee2a6adfa");
  const hasProxy = raw.includes("tongwu_TRDI7X");
  console.log("API key leaked:", hasApiKey);
  console.log("Proxy user leaked:", hasProxy);
}

await close();
