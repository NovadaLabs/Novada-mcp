/**
 * Gateway cap removal (owner decision 2026-10-29) — regression fence.
 *
 * Replaces test/paid-tier-cap.test.mjs (deleted 2026-10-29): that whole file
 * tested the paid-tier gateway cap exemption mechanism (enforceGatewayCap,
 * resolvePlan, shouldAllowOverCap, classifyPlanFromUsageRecord,
 * fetchAggregateBalance/parseBalanceValue, the approval-gate preview-charge
 * exemption, PLAN_TTL_PRO_S / PLAN_TTL_FREE_S / PREFETCH_THRESHOLD) — all of
 * which was deleted along with the monthly free-call cap it existed to
 * gate/exempt. Only
 * CAP_EXEMPT_TOOLS survives (it now drives which gateway-status-footer line a
 * tool gets, see api/mcp.ts's buildStatusFooter) — those unit tests are
 * migrated here verbatim.
 *
 * Runs on plain Node ≥22.18 (`node --test`) — imports api/_plan.ts directly
 * via Node's built-in type stripping (mcp.ts itself is never imported by
 * tests — module-load side effects: Sentry.init, @vercel/kv, env-var
 * stripping — so its absence of a cap is proven via STATIC source checks
 * below, same convention as kv-fail-open.test.mjs / telemetry.test.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CAP_EXEMPT_TOOLS } from "../api/_plan.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const PLAN_TS = join(__dirname, "..", "api", "_plan.ts");

/**
 * Strip block + line comments (same technique telemetry.test.mjs's
 * FAILURE_CLASS_MIRROR drift guard uses) so the "symbol is actually gone"
 * checks below search only live CODE, not the deliberate explanatory prose
 * this change leaves behind (both _plan.ts's and mcp.ts's header comments
 * name every removed symbol on purpose, as a historical pointer — a bare
 * substring search would false-positive on that prose).
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ─── UNIT — CAP_EXEMPT_TOOLS (migrated verbatim from paid-tier-cap.test.mjs) ─

test("CAP_EXEMPT_TOOLS: setup + discover + account + every account alias", () => {
  for (const name of [
    "novada_setup", "novada_discover", "novada_account",
    "novada_wallet_balance", "novada_wallet_usage_record", "novada_traffic_daily",
    "novada_plan_balance_all", "novada_capture_logs", "novada_account_summary",
    "novada_health", "novada_health_all",
  ]) {
    assert.ok(CAP_EXEMPT_TOOLS.has(name), `${name} must be cap-exempt`);
  }
});

test("CAP_EXEMPT_TOOLS: content tools are NOT exempt (they are billable)", () => {
  for (const name of ["novada_search", "novada_extract", "novada_scrape", "novada_proxy_account_create"]) {
    assert.ok(!CAP_EXEMPT_TOOLS.has(name), `${name} must NOT be cap-exempt`);
  }
});

// ─── STATIC — _plan.ts no longer defines any cap/quota machinery ────────────

test("_plan.ts: every cap/quota symbol removed 2026-10-29 is actually gone from source", () => {
  const src = stripComments(readFileSync(PLAN_TS, "utf8"));
  for (const sym of [
    "enforceGatewayCap", "resolvePlan", "shouldAllowOverCap",
    "classifyPlanFromUsageRecord", "fetchAggregateBalance", "parseBalanceValue",
    "isApprovalGatePreviewCall", "APPROVAL_GATED_TOOLS", "PREFETCH_THRESHOLD",
    "PLAN_TTL_PRO_S", "PLAN_TTL_FREE_S", "PLAN_STALE_RETENTION_S",
  ]) {
    assert.ok(!src.includes(sym), `_plan.ts must no longer define/export ${sym} (outside comments)`);
  }
  assert.ok(src.includes("CAP_EXEMPT_TOOLS"), "_plan.ts must still export CAP_EXEMPT_TOOLS");
  assert.ok(src.includes("ACCOUNT_TOOL_NAMES"), "_plan.ts must still export ACCOUNT_TOOL_NAMES");
});

// ─── STATIC — mcp.ts: no cap check exists, so a 1001st+ call is never rejected
// and no KV quota key is ever written/incremented for it ─────────────────────

test("mcp.ts: no cap-enforcement import or call site remains", () => {
  const src = stripComments(readFileSync(MCP_TS, "utf8"));
  for (const needle of [
    "enforceGatewayCap", "decrementQuota", "refundQuota", "resolvePlan(",
    "fetchAggregateBalance", "FREE_PLAN_MONTHLY_QUOTA", "monthlyQuota",
    "SETUP_GATE", "isApprovalGatePreviewCall",
  ]) {
    assert.ok(!src.includes(needle), `mcp.ts must no longer reference ${needle} (outside comments)`);
  }
});

test("mcp.ts: a 1001st+ (or any-th) call is never rejected for being over a free-call cap", () => {
  const src = readFileSync(MCP_TS, "utf8");
  // There is no "cap_blocked" rejection path, no over-cap error text, and no
  // monthly-quota KV key format (`${tokenHash}:${monthKey()}`) left to write
  // to — so no call, at any volume, can be rejected by a gateway cap anymore.
  assert.ok(!src.includes('outcome: "cap_blocked"'), "no cap_blocked outcome may be scheduled");
  assert.ok(!src.includes("## Free Gateway Cap Reached"), "the cap-rejection message must not exist");
  assert.ok(!src.includes("free_gateway_cap_reached"), "the cap-rejection agent_instruction marker must not exist");
  assert.ok(!/monthKey\s*\(/.test(src), "the per-token monthly KV key helper (monthKey) must not exist — nothing increments a quota counter");
});

test("mcp.ts: _meta.quota_remaining is never attached to a tool result", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.ok(!src.includes("_meta: { quota_remaining"), "no tool result may carry _meta.quota_remaining");
  assert.ok(!src.includes("quota_remaining: remaining"), "no leftover 'remaining' quota plumbing may exist");
});

test("mcp.ts: buildStatusFooter takes only a tool name (no gate/monthlyQuota object)", () => {
  const src = readFileSync(MCP_TS, "utf8");
  assert.match(src, /function buildStatusFooter\(toolName: string\): string/, "buildStatusFooter must be a pure function of the tool name only");
  assert.match(src, /CAP_EXEMPT_TOOLS\.has\(toolName\)/, "buildStatusFooter must decide the footer via CAP_EXEMPT_TOOLS");
});
