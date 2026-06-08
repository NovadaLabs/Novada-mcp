#!/usr/bin/env node
// KR-6 smoke test harness — invokes each new tool function directly against the
// real developer-api.novada.com (no MCP transport, no host). Designed so an
// agent can pipe it through jq or read the structured JSON output.
//
// Usage:
//   node workspace/kr6-smoke/run-smoke.mjs <tool> [params-json]
// Examples:
//   node workspace/kr6-smoke/run-smoke.mjs wallet_balance
//   node workspace/kr6-smoke/run-smoke.mjs wallet_usage_record '{"page":1,"page_size":5}'
//   node workspace/kr6-smoke/run-smoke.mjs proxy_account_create '{"username":"smoketest","password":"smokepass1234"}'  # no confirm → dry-run preview
//   node workspace/kr6-smoke/run-smoke.mjs proxy_account_list   '{"page":1,"page_size":5}'
//   node workspace/kr6-smoke/run-smoke.mjs traffic_daily        '{"start_time":"2026-05-25","end_time":"2026-06-03"}'
//   node workspace/kr6-smoke/run-smoke.mjs plan_balance_all
//   node workspace/kr6-smoke/run-smoke.mjs capture_logs         '{"page":1,"page_size":5}'

import { novadaWalletBalance } from "../../build/tools/wallet_balance.js";
import { novadaWalletUsageRecord } from "../../build/tools/wallet_usage_record.js";
import { novadaProxyAccountCreate } from "../../build/tools/proxy_account_create.js";
import { novadaProxyAccountList } from "../../build/tools/proxy_account_list.js";
import { novadaTrafficDaily } from "../../build/tools/traffic_daily.js";
import { novadaPlanBalanceAll } from "../../build/tools/plan_balance_all.js";
import { novadaCaptureLogs } from "../../build/tools/capture_logs.js";
import { novadaAccountSummary } from "../../build/tools/account_summary.js";

const TOOLS = {
  wallet_balance: novadaWalletBalance,
  wallet_usage_record: novadaWalletUsageRecord,
  proxy_account_create: novadaProxyAccountCreate,
  proxy_account_list: novadaProxyAccountList,
  traffic_daily: novadaTrafficDaily,
  plan_balance_all: novadaPlanBalanceAll,
  capture_logs: novadaCaptureLogs,
  account_summary: novadaAccountSummary,
};

const tool = process.argv[2];
const paramsRaw = process.argv[3] ?? "{}";

if (!tool || !(tool in TOOLS)) {
  console.error("usage: node run-smoke.mjs <tool> [params-json]");
  console.error("tools: " + Object.keys(TOOLS).join(", "));
  process.exit(2);
}

let params;
try {
  params = JSON.parse(paramsRaw);
} catch (e) {
  console.error("Failed to parse params JSON:", e.message);
  process.exit(2);
}

const t0 = Date.now();
try {
  const out = await TOOLS[tool](params);
  const ms = Date.now() - t0;
  console.log(JSON.stringify({
    smoke: "ok",
    tool,
    latency_ms: ms,
    result: tryParseJson(out),
  }, null, 2));
} catch (err) {
  const ms = Date.now() - t0;
  console.log(JSON.stringify({
    smoke: "error",
    tool,
    latency_ms: ms,
    error: {
      name: err?.name,
      code: err?.code,
      message: err?.message,
      agent_instruction: err?.agent_instruction,
      retryable: err?.retryable,
    },
  }, null, 2));
}

function tryParseJson(s) {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return s; }
}
