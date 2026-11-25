#!/usr/bin/env node
/**
 * monitoring/report/notify-dingtalk-layer-d.mjs
 *
 * Send ONE DingTalk summary of a Layer D full-tools probe report
 * (monitoring/reports/full-<ts>.json, written by
 * monitoring/smoke/full-tools-probe.mjs). Called by run-daily-report.sh after
 * the daily local run; dependency-free Node >=20.
 *
 * Why (2026-11-25): the DingTalk daily report (monitoring/dingtalk, GitHub
 * Actions 01:07Z) checks 6 of the 29 hosted tools and only for "no error",
 * so it showed 1 failure while Layer D found ~10 tools failing every day
 * (2026-11-17 → 11-24) — results that only ever landed in a local Excel file.
 *
 * Usage:
 *   node monitoring/report/notify-dingtalk-layer-d.mjs <report.json>
 *
 * Env (same names as monitoring/dingtalk/run.mjs):
 *   DINGTALK_WEBHOOK_URL  required to send; UNSET → skip cleanly (exit 0)
 *   DINGTALK_SECRET       optional — 加签 signing
 *   DINGTALK_KEYWORD      optional — keyword-security robots (auto-ensured)
 *   DRY_RUN=1             print the message instead of sending
 *
 * Exit: 0 sent / skipped / dry-run · 1 DingTalk or network rejected the send ·
 * 2 bad input (no path, missing or unparseable report).
 */
import { readFileSync } from "node:fs";
import { sendDingTalk } from "../dingtalk/send.mjs";

export const MAX_FAILURE_LINES = 15;
const MAX_ERROR_CHARS = 90;

const DOMAIN_LABEL = Object.freeze({
  "①-mcp-code": "我方",
  "②-gateway": "网关/配置",
  "③-backend": "上游",
});
const DOMAIN_ORDER = ["①-mcp-code", "②-gateway", "③-backend"];

/** First line of an error, long token-like strings masked, length-capped. */
function shortError(err) {
  const first = String(err ?? "").split("\n")[0].trim();
  const masked = first.replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>");
  return masked.length > MAX_ERROR_CHARS ? `${masked.slice(0, MAX_ERROR_CHARS - 1)}…` : masked;
}

/**
 * @param {{finishedAt?: string, startedAt?: string, results?: object[], summary?: object}} report
 * @returns {{title: string, text: string}}
 */
export function buildLayerDMessage(report) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const summary = report?.summary ?? {};
  const date = String(report?.finishedAt || report?.startedAt || "").slice(0, 10) || "unknown-date";

  const count = (pred) => results.filter(pred).length;
  const healthy = count((r) => r.status === "PASS" || r.status === "SLOW");
  const asyncCount = count((r) => r.status === "ASYNC");
  const failed = results.filter((r) => r.status === "FAIL");
  const missing = results.filter((r) => r.status === "MISSING").map((r) => r.name);
  const byDomain = (d) => failed.filter((r) => r.domain === d).length;
  const otherFail = failed.filter((r) => !DOMAIN_ORDER.includes(r.domain)).length;

  const title = `📋 Novada MCP 全量工具探针 — ${date}`;
  const lines = [`### ${title}`, ""];
  lines.push(
    `**${healthy}/${results.length} 正常** · 失败 ${failed.length}（我方 ${byDomain("①-mcp-code")} / 网关/配置 ${byDomain("②-gateway")} / 上游 ${byDomain("③-backend")}${otherFail ? ` / 未分类 ${otherFail}` : ""}）· 缺失 ${missing.length} · 处理中 ${asyncCount}`
  );
  lines.push("");
  lines.push(`最高严重度（我方）: ${summary.maxOursSeverity ?? "无"}`);
  if (Number(summary.testKeyDegradedCount) > 0) {
    lines.push("");
    lines.push(`⚠️ 测试 key 降级 ${summary.testKeyDegradedCount} 项 — 这些结果反映的是测试账号状态，不代表服务本身`);
  }

  if (failed.length > 0) {
    const rank = (r) => {
      const i = DOMAIN_ORDER.indexOf(r.domain);
      return i === -1 ? DOMAIN_ORDER.length : i;
    };
    const sorted = [...failed].sort((a, b) => rank(a) - rank(b));
    lines.push("", "**失败明细**");
    for (const r of sorted.slice(0, MAX_FAILURE_LINES)) {
      const label = DOMAIN_LABEL[r.domain] ?? "未分类";
      lines.push(`- ${r.name} — ${label}${r.severity ? ` ${r.severity}` : ""} · ${shortError(r.error)}`);
    }
    if (sorted.length > MAX_FAILURE_LINES) {
      lines.push(`- …另有 ${sorted.length - MAX_FAILURE_LINES} 项，见本地 Excel 日报`);
    }
  }
  if (missing.length > 0) {
    lines.push("", `**缺失工具**（探针清单有、线上 tools/list 没有）: ${missing.join(", ")}`);
  }
  lines.push("", `_Layer D 每日全量探针 · 本地定时任务 · ${report?.finishedAt ?? ""}_`);
  return { title, text: lines.join("\n") };
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<void>}} deps
 * @returns {Promise<number>} exit code
 */
export async function main(argv, env, deps = {}) {
  const reportPath = argv[0];
  if (!reportPath) {
    console.error("[notify-layer-d] usage: notify-dingtalk-layer-d.mjs <report.json>");
    return 2;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (err) {
    console.error(`[notify-layer-d] cannot read report ${reportPath}: ${err?.message || err}`);
    return 2;
  }

  const { title, text } = buildLayerDMessage(report);
  const dryRun = env.DRY_RUN === "1";
  if (!env.DINGTALK_WEBHOOK_URL && !dryRun) {
    console.log("[notify-layer-d] skip: DINGTALK_WEBHOOK_URL not set (add it to ~/.novada/monitor.env to enable)");
    return 0;
  }

  const res = await sendDingTalk({
    webhookUrl: env.DINGTALK_WEBHOOK_URL,
    secret: env.DINGTALK_SECRET,
    keyword: env.DINGTALK_KEYWORD,
    title,
    text,
    dryRun,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  if (!res.ok) {
    console.error(`[notify-layer-d] send failed: ${JSON.stringify({ errcode: res.errcode, errmsg: res.errmsg, httpStatus: res.httpStatus, error: res.error })}`);
    return 1;
  }
  console.log(`[notify-layer-d] ${res.dryRun ? "dry-run printed" : "sent"}: ${title}`);
  return 0;
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
