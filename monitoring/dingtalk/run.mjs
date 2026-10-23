#!/usr/bin/env node
/**
 * monitoring/dingtalk/run.mjs
 *
 * Orchestrator for both DingTalk health-monitoring modes:
 *
 *   node monitoring/dingtalk/run.mjs --mode alert   # free checks, every 15 min
 *   node monitoring/dingtalk/run.mjs --mode daily    # free + billable, once/day
 *
 * Phase 1 only (see design doc §7) — P2 items (OAuth login-failure rate,
 * request-failure-rate, upstream-provider-degradation telemetry queries,
 * Postgres daily_digest_stats()) are explicitly NOT implemented here.
 *
 * Env:
 *   MCP_URL               default https://mcp.novada.com/mcp
 *   NOVADA_TEST_KEY       required for --mode daily (billable checks + novada_setup)
 *   DINGTALK_WEBHOOK_URL  required to actually send (see "fail loudly" below)
 *   DINGTALK_SECRET       optional — enables 加签 signing (recommended)
 *   DINGTALK_KEYWORD      optional — keyword-security robots; auto-ensured, see send.mjs
 *   DRY_RUN=1             print composed message(s) instead of sending; skips state persistence
 *   GITHUB_RUN_URL        optional — included as the actionCard "view run" deep link
 *
 * "Fail loudly" invariant (explicit task requirement for --mode daily,
 * applied here to BOTH modes — see state.mjs's own header on why this
 * project treats "the alerting pipe itself is broken" as the one disaster
 * it must never swallow silently, being the exact class of problem
 * [DingTalk delivery existing but misconfigured] this whole project exists
 * to prevent a repeat of): if DINGTALK_WEBHOOK_URL is unset and DRY_RUN is
 * not "1", this process prints a clear error and exits 1.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_TABLE, runChecks } from "./checks.mjs";
import { sendDingTalk, createRateLimiter } from "./send.mjs";
import { computeNextAlertState, loadState, saveState } from "./state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const GOLDEN_TOOLSLIST_PATH = path.join(REPO_ROOT, "hosted-server/scripts/golden/baseline/toolslist-default.json");

export const MCP_URL = process.env.MCP_URL || "https://mcp.novada.com/mcp";

/** Read the golden tools/list baseline's tool COUNT only (never the tool
 * names/schemas — that's diff-golden.py's job, this is a cheap sanity
 * count check). Returns null (check skipped, not failed) if the file is
 * missing/unparseable — a repo-layout problem, not a product regression. */
export function readExpectedToolCount(filePath = GOLDEN_TOOLSLIST_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** `date -u` formatted into Asia/Shanghai, per design doc §6.1. */
export function shanghaiDateStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function fmtMs(ms) {
  if (ms == null) return "?";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m > 0 ? `${m}m` : ""}`;
}

function worstSeverity(failingResults) {
  const order = ["P0", "P1", "P2", "P3"];
  let worst = null;
  for (const r of failingResults) {
    if (!worst || order.indexOf(r.severity) < order.indexOf(worst)) worst = r.severity;
  }
  return worst;
}

/** English id -> Chinese label, from CHECK_TABLE (the one place that
 * mapping is declared). Falls back to the raw id so a row added without a
 * `labelZh` degrades to something visible rather than "undefined". */
const LABEL_ZH_BY_ID = new Map(CHECK_TABLE.map((r) => [r.id, r.labelZh]));
function zhLabel(id) {
  return LABEL_ZH_BY_ID.get(id) || id;
}

// ── Failure classification (HIGH finding, 2026-10-23 review) ────────────────
//
// An explicit errorCode/errorClass -> annotation table — NEVER keyed off
// `r.id`/tool-name prefixes (the exact anti-pattern the design doc warns
// against and the prior `r.id.startsWith("novada_scrape_")` branch
// committed). `novada_search` and `novada_scrape_google` failing with the
// SAME errorCode get the SAME annotation — see run.test.mjs.
//
// `accountIssue: true` entries are problems with the shared TEST account
// (balance, key validity) — not a `mcp.novada.com` product regression. The
// daily report's "整体状态"/worst-severity computation excludes these (an
// empty test-account wallet must never look like a production outage); they
// get their own "监控账号问题" section instead (owner wants accurate signal,
// 2026-10-23 review finding #3).
const ERROR_CODE_CLASSIFICATION = {
  INSUFFICIENT_BALANCE: { annotation: "测试账号余额不足（不是产品故障）", accountIssue: true },
  INVALID_API_KEY: { annotation: "测试 key 失效", accountIssue: true },
  API_DOWN: { annotation: "上游服务故障", accountIssue: false },
};
const ERROR_CLASS_CLASSIFICATION = {
  network: { annotation: "服务端/网络", accountIssue: false },
  http: { annotation: "服务端/网络", accountIssue: false },
  rpc: { annotation: "服务端/网络", accountIssue: false },
  shape: { annotation: "服务端/网络", accountIssue: false },
};
const UNCLASSIFIED = { annotation: "未分类", accountIssue: false };

/** @param {{errorCode: string|null, errorClass: string|null}} result */
export function classifyFailure(result) {
  if (result.errorCode && ERROR_CODE_CLASSIFICATION[result.errorCode]) return ERROR_CODE_CLASSIFICATION[result.errorCode];
  if (result.errorClass && ERROR_CLASS_CLASSIFICATION[result.errorClass]) return ERROR_CLASS_CLASSIFICATION[result.errorClass];
  return UNCLASSIFIED;
}

// ── Message composers ────────────────────────────────────────────────────────

export function composeAlertMessage(action, checkRow, runUrl) {
  const label = checkRow?.labelZh || checkRow?.label || action.id;
  const title = `🔴 Novada MCP — ${label} failing (${action.severity})`;
  const text = [
    `#### 🔴 ${label}`,
    `**severity:** ${action.severity}`,
    `**consecutive failures:** ${action.consecutiveFailures}`,
    `**failing since:** ${new Date(action.failingSince).toISOString()}`,
  ].join("\n");
  return { kind: "actionCard", title, text, actionCard: runUrl ? { singleTitle: "查看 Actions 运行记录", singleURL: runUrl } : undefined };
}

export function composeRecoveryMessage(action, checkRow, runUrl) {
  const label = checkRow?.labelZh || checkRow?.label || action.id;
  const title = `🟢 Novada MCP — ${label} recovered`;
  const text = [
    `#### 🟢 ${label} recovered`,
    `**outage duration:** ${fmtMs(action.outageMs)}`,
    `**recovered at:** ${new Date(action.recoveredAt).toISOString()}`,
  ].join("\n");
  return { kind: "actionCard", title, text, actionCard: runUrl ? { singleTitle: "查看 Actions 运行记录", singleURL: runUrl } : undefined };
}

export function composeHeartbeatMessage(action, checkRow, runUrl) {
  const label = checkRow?.labelZh || checkRow?.label || action.id;
  const title = `🟡 Novada MCP — ${label} still failing (${action.severity})`;
  const text = [
    `#### 🟡 ${label} — still failing`,
    `**severity:** ${action.severity}`,
    `**outage duration so far:** ${fmtMs(action.outageMs)}`,
  ].join("\n");
  return { kind: "actionCard", title, text, actionCard: runUrl ? { singleTitle: "查看 Actions 运行记录", singleURL: runUrl } : undefined };
}

/**
 * CRITICAL finding (2026-10-23 review): a check that needs auth (e.g.
 * `NOVADA_TEST_KEY` missing from this job's env) must never be reported as
 * an outage. This composes a DISTINCT message — different emoji, different
 * title shape, explicitly says "监控配置缺失" (monitor misconfigured) rather
 * than "failing" — sent via runAlertMode's own send-ONCE bookkeeping
 * (`state.misconfigured`), never through the alert/heartbeat dedupe machine.
 */
export function composeMisconfiguredMessage(checkRow, note, runUrl) {
  const label = checkRow?.labelZh || checkRow?.label || "unknown check";
  const title = `⚙️ Novada MCP — 监控配置缺失: ${label}`;
  const text = [
    `#### ⚙️ ${label}`,
    "**状态:** 监控配置缺失（不是服务故障）",
    `**详情:** ${note}`,
  ].join("\n");
  return { kind: "actionCard", title, text, actionCard: runUrl ? { singleTitle: "查看 Actions 运行记录", singleURL: runUrl } : undefined };
}

/** Renders the full --mode daily markdown report (design doc §6.2 shape). */
export function renderDailyReport({ results, dateStamp, now = new Date() }) {
  const initializeRow = results.find((r) => r.id === "initialize");
  const version = initializeRow?.detail?.version || "unknown";
  const toolsRow = results.find((r) => r.id === "tools_list");
  const toolCount = toolsRow?.detail?.count ?? "unknown";

  const failing = results.filter((r) => !r.ok);
  const classified = failing.map((r) => ({ r, cls: classifyFailure(r) }));
  const productFailing = classified.filter((c) => !c.cls.accountIssue).map((c) => c.r);
  const accountFailing = classified.filter((c) => c.cls.accountIssue).map((c) => c.r);

  // Account-level test-key problems (balance/validity) never count toward
  // "整体状态" — see classifyFailure()'s header comment.
  const overall =
    productFailing.length === 0 ? "✅ all healthy" : `⚠️ ${productFailing.length} check(s) failing (worst: ${worstSeverity(productFailing)})`;

  const tableHeader = "| check | status | latency | note |\n| --- | --- | --- | --- |";
  const tableRows = results.map((r) => {
    const status = r.ok ? "✅ ok" : "❌ fail";
    const note = (r.note || "-").replace(/\|/g, "/").slice(0, 160);
    return `| ${zhLabel(r.id)} | ${status} | ${r.latencyMs}ms | ${note} |`;
  });

  const failureNotes = productFailing.map((r) => `- **${zhLabel(r.id)}**: ${r.note}（${classifyFailure(r).annotation}）`);
  const accountNotes = accountFailing.map((r) => `- **${zhLabel(r.id)}**: ${r.note}（${classifyFailure(r).annotation}）`);

  const lines = [
    `#### 📊 Novada MCP 日报 — ${dateStamp}`,
    "",
    `**整体状态**: ${overall}`,
    `**version**: ${version}`,
    `**tool count**: ${toolCount}`,
    "",
    tableHeader,
    ...tableRows,
  ];
  if (failureNotes.length > 0) {
    lines.push("", "**失败详情**:", ...failureNotes);
  }
  if (accountNotes.length > 0) {
    lines.push("", "**监控账号问题**（不计入整体状态，需人工检查测试账号）:", ...accountNotes);
  }
  lines.push("", "---", `Novada MCP Alerting (Phase 1) · 由 GitHub Actions 自动生成 · ${now.toISOString()}`);

  return {
    title: `Novada MCP 日报 — ${dateStamp}`,
    text: lines.join("\n"),
  };
}

// ── Mode runners ─────────────────────────────────────────────────────────────

function checkRowById(id) {
  return CHECK_TABLE.find((r) => r.id === id);
}

/**
 * --mode alert: free checks only, dedupe/heartbeat/recovery via state.mjs,
 * state persisted on the orphan git branch (skipped entirely under
 * DRY_RUN).
 *
 * @returns {Promise<number>} process exit code
 */
export async function runAlertMode({ ctx, dryRun, webhookUrl, secret, keyword, runUrl, now = Date.now(), io = {} } = {}) {
  const { send = sendDingTalk, load = loadState, save = saveState, rateLimiter = createRateLimiter() } = io;

  const results = await runChecks(ctx, ["free"]);

  // CRITICAL finding (2026-10-23 review): "config"-class failures (this
  // job's env is missing a secret a check needs, e.g. NOVADA_TEST_KEY) must
  // NEVER enter the outage dedupe/heartbeat state machine below — that
  // machine can only ever see them as a never-recovering failure and fires
  // a real P0 alert, then a 🟡 heartbeat every 2h forever. They're split out
  // here and handled by their own send-ONCE "misconfigured" notice instead.
  const configResults = results.filter((r) => r.errorClass === "config");
  const outageResults = results.filter((r) => r.errorClass !== "config");

  const prevState = dryRun ? {} : load();
  const { nextState: dedupeState, actions } = computeNextAlertState(prevState, outageResults, now);

  // Misconfiguration bookkeeping lives in its own `state.misconfigured` map
  // (independent of `state.checks`, the outage dedupe map) — a check already
  // notified as misconfigured doesn't notify again every 15 minutes (that
  // would just be a different flavor of the alert-fatigue bug this whole
  // project exists to prevent); a check that stops being config-failing
  // (secret restored) clears its entry, so a FUTURE recurrence notifies
  // again.
  const prevMisconfigured = prevState?.misconfigured || {};
  const nextMisconfigured = {};
  const misconfiguredToNotify = [];
  for (const r of configResults) {
    nextMisconfigured[r.id] = true;
    if (!prevMisconfigured[r.id]) misconfiguredToNotify.push(r);
  }

  const nextState = { ...dedupeState, misconfigured: nextMisconfigured };

  let sendFailure = false;
  for (const action of actions) {
    const row = checkRowById(action.id);
    let msg;
    if (action.type === "alert") msg = composeAlertMessage(action, row, runUrl);
    else if (action.type === "recovery") msg = composeRecoveryMessage(action, row, runUrl);
    else if (action.type === "heartbeat") msg = composeHeartbeatMessage(action, row, runUrl);
    else continue;

    const res = await send({ webhookUrl, secret, keyword, dryRun, rateLimiter, ...msg });
    if (!res.ok && !dryRun) sendFailure = true;
  }

  for (const r of misconfiguredToNotify) {
    const row = checkRowById(r.id);
    const msg = composeMisconfiguredMessage(row, r.note, runUrl);
    const res = await send({ webhookUrl, secret, keyword, dryRun, rateLimiter, ...msg });
    if (!res.ok && !dryRun) sendFailure = true;
  }

  if (!dryRun) save(nextState);

  for (const r of results) {
    console.log(`[dingtalk/run alert] ${r.ok ? "OK " : "FAIL"} ${r.id} (${r.latencyMs}ms) ${r.note}`);
  }
  if (actions.length > 0) {
    console.log(`[dingtalk/run alert] ${actions.length} action(s): ${actions.map((a) => `${a.type}:${a.id}`).join(", ")}`);
  }
  if (misconfiguredToNotify.length > 0) {
    console.log(`[dingtalk/run alert] ${misconfiguredToNotify.length} misconfigured notice(s): ${misconfiguredToNotify.map((r) => r.id).join(", ")}`);
  }

  return sendFailure ? 1 : 0;
}

/**
 * --mode daily: free + billable checks, one markdown report, always sent
 * (findings or not) — no dedupe/state involved.
 *
 * @returns {Promise<number>} process exit code
 */
export async function runDailyMode({ ctx, dryRun, webhookUrl, secret, keyword, io = {} } = {}) {
  const { send = sendDingTalk, rateLimiter = createRateLimiter() } = io;

  const results = await runChecks(ctx, ["free", "billable"]);
  const dateStamp = shanghaiDateStamp();
  const { title, text } = renderDailyReport({ results, dateStamp });

  const res = await send({ webhookUrl, secret, keyword, dryRun, rateLimiter, kind: "markdown", title, text });

  for (const r of results) {
    console.log(`[dingtalk/run daily] ${r.ok ? "OK " : "FAIL"} ${r.id} (${r.latencyMs}ms) ${r.note}`);
  }

  return !dryRun && !res.ok ? 1 : 0;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { mode: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mode") out.mode = argv[i + 1];
  }
  return out;
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  if (mode !== "alert" && mode !== "daily") {
    console.error('[dingtalk/run] usage: node run.mjs --mode <alert|daily>');
    process.exit(1);
  }

  const dryRun = process.env.DRY_RUN === "1";
  const webhookUrl = process.env.DINGTALK_WEBHOOK_URL || "";
  const secret = process.env.DINGTALK_SECRET || "";
  const keyword = process.env.DINGTALK_KEYWORD || "";
  const runUrl = process.env.GITHUB_RUN_URL || "";
  const apiKey = process.env.NOVADA_TEST_KEY || "";

  // "Fail loudly" invariant — see module doc comment.
  if (!webhookUrl && !dryRun) {
    console.error(
      `[dingtalk/run] FATAL: DINGTALK_WEBHOOK_URL is not set and DRY_RUN!=1 — refusing to run ${mode} mode silently. ` +
        "Configure the DINGTALK_WEBHOOK_URL repo secret, or set DRY_RUN=1 for a local/manual preview run."
    );
    process.exit(1);
  }

  if (mode === "daily" && !apiKey) {
    console.error("[dingtalk/run] FATAL: --mode daily requires NOVADA_TEST_KEY (billable checks need the test key).");
    process.exit(1);
  }

  const ctx = {
    mcpUrl: MCP_URL,
    apiKey: apiKey || undefined,
    timeoutMs: 10_000,
    expectedToolCount: readExpectedToolCount(),
  };

  const exitCode =
    mode === "alert"
      ? await runAlertMode({ ctx, dryRun, webhookUrl, secret, keyword, runUrl })
      : await runDailyMode({ ctx, dryRun, webhookUrl, secret, keyword });

  process.exit(exitCode);
}

const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error(`[dingtalk/run] FATAL (unexpected): ${err?.stack || err}`);
    process.exit(1);
  });
}
