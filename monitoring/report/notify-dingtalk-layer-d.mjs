#!/usr/bin/env node
/**
 * monitoring/report/notify-dingtalk-layer-d.mjs
 *
 * Send ONE DingTalk summary of a Layer D full-tools probe report
 * (monitoring/reports/full-<ts>.json, written by
 * monitoring/smoke/full-tools-probe.mjs). Called by run-daily-report.sh after
 * the daily local run; dependency-free Node >=20.
 *
 * Sends ONLY when the run found a problem (owner 2026-11-27: "没问题就不用发了");
 * an all-healthy run is logged locally and sends nothing — see layerDProblem().
 *
 * Why (2026-11-25): the DingTalk daily report (monitoring/dingtalk, GitHub
 * Actions 01:07Z) checks 6 of the 29 hosted tools and only for "no error",
 * so it showed 1 failure while Layer D found ~10 tools failing every day
 * (2026-11-17 → 11-24) — results that only ever landed in a local Excel file.
 *
 * Usage:
 *   node monitoring/report/notify-dingtalk-layer-d.mjs <report.json>
 *   node monitoring/report/notify-dingtalk-layer-d.mjs --fatal "<reason>"
 *     (the caller could not get a fresh report at all — always sends
 *      "probe could not run" with the reason; review 2026-11-27 HIGH)
 *   node monitoring/report/notify-dingtalk-layer-d.mjs --heartbeat <reportsDir>
 *     (weekly "monitoring is alive" message — owner 2026-11-28: one per week,
 *      since problems-only means silence is otherwise ambiguous; always sent)
 *
 * Env (same names as monitoring/dingtalk/run.mjs):
 *   DINGTALK_WEBHOOK_URL  required to send; UNSET → skip cleanly (exit 0)
 *   DINGTALK_SECRET       optional — 加签 signing
 *   DINGTALK_KEYWORD      optional — keyword-security robots (auto-ensured)
 *   DRY_RUN=1             print the message instead of sending
 *
 * Exit: 0 sent / skipped (healthy run or no webhook) / dry-run · 1 DingTalk or network rejected the send ·
 * 2 bad input (no path, missing or unparseable report — a "could not run"
 * message is still attempted for a missing/unparseable report; if that send
 * fails the exit is 1). The caller only logs this code.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sendDingTalk } from "../dingtalk/send.mjs";

export const MAX_FAILURE_LINES = 15;
export const SEND_TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 90;
// Env values that must never reach the group chat, masked by exact value
// (review D4: a length heuristic alone misses short keys).
const SECRET_ENV_VARS = ["NOVADA_TEST_KEY", "NOVADA_API_KEY", "DINGTALK_SECRET", "DINGTALK_WEBHOOK_URL"];

const DOMAIN_LABEL = Object.freeze({
  "①-mcp-code": "我方",
  "②-gateway": "网关/配置",
  "③-backend": "上游",
});
const DOMAIN_ORDER = ["①-mcp-code", "②-gateway", "③-backend"];

/**
 * First line of an error, known secret values and long token-like runs
 * masked, length-capped. The heuristic is letters+digits only (no "_"/"-"),
 * so snake_case identifiers such as linkedin_company_information_url survive.
 */
function shortError(err, knownSecrets = []) {
  let first = String(err ?? "").split("\n")[0].trim();
  for (const v of knownSecrets) {
    if (typeof v === "string" && v.length >= 8) first = first.split(v).join("<redacted>");
  }
  const masked = first.replace(/[A-Za-z0-9]{32,}/g, "<redacted>");
  return masked.length > MAX_ERROR_CHARS ? `${masked.slice(0, MAX_ERROR_CHARS - 1)}…` : masked;
}

/** fetch with a hard timeout (review D3: an unbounded fetch could stall the daily job). */
export function withTimeout(fetchImpl, ms = SEND_TIMEOUT_MS) {
  return (url, init = {}) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/**
 * Why this run is worth a DingTalk message, or null when everything was healthy.
 * Fail-closed: anything other than a non-empty, all-healthy run counts as a
 * problem — zero rows (probe could not run), FAIL, MISSING, a degraded test key
 * (results untrustworthy), a non-zero probe exitCode, or a status we don't know.
 * @returns {string | null}
 */
const OK_STATUSES = new Set(["PASS", "SLOW", "ASYNC"]);
const KNOWN_STATUSES = new Set([...OK_STATUSES, "FAIL", "MISSING"]);

export function layerDProblem(report) {
  const results = Array.isArray(report?.results) ? report.results : [];
  if (results.length === 0) return "no-results";
  const OK = OK_STATUSES;
  if (results.some((r) => r?.status === "FAIL")) return "fail";
  if (results.some((r) => r?.status === "MISSING")) return "missing";
  if (results.some((r) => !OK.has(r?.status))) return "unknown-status";
  if (Number(report?.summary?.testKeyDegradedCount) > 0) return "test-key-degraded";
  if (report?.exitCode != null && Number(report.exitCode) !== 0) return "nonzero-exit";
  return null;
}

/**
 * @param {{finishedAt?: string, startedAt?: string, results?: object[], summary?: object}} report
 * @param {{knownSecrets?: string[]}} [opts]
 * @returns {{title: string, text: string}}
 */
export function buildLayerDMessage(report, { knownSecrets = [] } = {}) {
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

  // A run that tested nothing (full-tools-probe's FATAL path: tools/list failed,
  // e.g. the site is unreachable — startedAt null, results []) must never render
  // as a health line: "0/0 正常 · 失败 0" read as all-clear during the 2026-11-27 outage.
  if (results.length === 0) {
    const title = `📋 Novada MCP 全量工具探针 — ${date} — ❌ 探针未能运行`;
    const lines = [
      `### ${title}`,
      "",
      `**探针未能运行：一个工具都没测到**${report?.exitCode != null ? `（exitCode ${report.exitCode}）` : ""}。`,
      "",
      report?.summary?.fatalError
        ? `原因：${shortError(report.summary.fatalError, knownSecrets)}`
        : "原因：未知（没有错误信息）",
      "",
      "若原因是连接失败/超时或 tools/list 失败，多半是 mcp.novada.com 不可用——请看同群的 MCP Health 告警；否则是探针或本地定时任务本身出错，请查本机日志。",
      "",
      `_Layer D 每日全量探针 · 本地定时任务 · ${report?.finishedAt ?? ""}_`,
    ];
    return { title, text: lines.join("\n") };
  }

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
      lines.push(`- ${r.name} — ${label}${r.severity ? ` ${r.severity}` : ""} · ${shortError(r.error, knownSecrets)}`);
    }
    if (sorted.length > MAX_FAILURE_LINES) {
      lines.push(`- …另有 ${sorted.length - MAX_FAILURE_LINES} 项，见本地 Excel 日报`);
    }
  }
  if (missing.length > 0) {
    lines.push("", `**缺失工具**（探针清单有、线上 tools/list 没有）: ${missing.join(", ")}`);
  }
  const unknown = results.filter((r) => !KNOWN_STATUSES.has(r?.status));
  if (unknown.length > 0) {
    lines.push("", `**未知状态**（探针返回了本脚本不认识的状态）: ${unknown.map((r) => `${r?.name ?? "?"}=${r?.status ?? "无"}`).join(", ")}`);
  }
  if (report?.exitCode != null && Number(report.exitCode) !== 0) {
    lines.push("", `探针退出码: ${report.exitCode}（非 0）`);
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
  if (reportPath === "--heartbeat") return heartbeatMain(argv[1], env, deps);

  let report;
  let inputError = false;
  if (reportPath === "--fatal") {
    report = fatalReport(argv[1] || "run-daily-report: no fresh report (reason not given)");
  } else {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch (err) {
      console.error(`[notify-layer-d] cannot read report ${reportPath}: ${err?.message || err}`);
      // Unreadable report = nothing measured; still tell the group (fail closed).
      report = fatalReport(`report unreadable: ${err?.message || err}`);
      inputError = true;
    }
  }

  const problem = layerDProblem(report);
  if (problem === null) {
    console.log(`[notify-layer-d] skip: all ${report.results.length} tools healthy — nothing sent (send only on problems)`);
    return 0;
  }

  const knownSecrets = SECRET_ENV_VARS.map((k) => env[k]).filter(Boolean);
  const { title, text } = buildLayerDMessage(report, { knownSecrets });
  const dryRun = env.DRY_RUN === "1";
  if (!env.DINGTALK_WEBHOOK_URL && !dryRun) {
    console.log("[notify-layer-d] skip: DINGTALK_WEBHOOK_URL not set (add it to ~/.novada/monitor.env to enable)");
    return inputError ? 2 : 0;
  }

  const res = await sendDingTalk({
    webhookUrl: env.DINGTALK_WEBHOOK_URL,
    secret: env.DINGTALK_SECRET,
    keyword: env.DINGTALK_KEYWORD,
    title,
    text,
    dryRun,
    fetchFn: withTimeout(deps.fetchFn ?? fetch),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  if (!res.ok) {
    console.error(`[notify-layer-d] send failed: ${JSON.stringify({ errcode: res.errcode, errmsg: res.errmsg, httpStatus: res.httpStatus, error: res.error })}`);
    return 1;
  }
  console.log(`[notify-layer-d] ${res.dryRun ? "dry-run printed" : "sent"}: ${title}`);
  return inputError ? 2 : 0;
}

/** Synthetic "could not run" report for when there is no usable probe report. */
function fatalReport(reason) {
  return { finishedAt: new Date().toISOString(), results: [], exitCode: null, summary: { fatalError: String(reason) } };
}

// ── Weekly heartbeat ──────────────────────────────────────────────────────────
export const HEARTBEAT_WINDOW_MS = 7 * 24 * 3600 * 1000;
const HEALTH_WORKFLOW = "mcp-health-dingtalk.yml";
// Scheduled MCP Health runs per week: crons "37 0,6,12,18 * * *" (4/day) +
// "7 1 * * *" (1/day) in .github/workflows/mcp-health-dingtalk.yml — pinned by
// the selftest against the workflow file.
export const EXPECTED_HEALTH_RUNS_PER_WEEK = 35;

/** Local calendar date (the job runs at a local time) as YYYY-MM-DD. */
export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today and the 6 local dates before it (DST-safe: steps by calendar day at local noon). */
export function expectedLocalDates(now) {
  const base = new Date(now);
  base.setHours(12, 0, 0, 0);
  const out = [];
  for (let k = 0; k < 7; k += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() - k);
    out.push(localDate(d.getTime()));
  }
  return out;
}

/** full-2026-11-27T01-57-45-366Z.json → ms epoch, or null. */
export function reportTimeFromName(name) {
  const m = /^full-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/.exec(name);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Layer D runs on the 7 expected local dates (today + 6 before), from the
 * report files on disk. Counting calendar dates — not a rolling 168 h window,
 * which could include last Monday's report and show 7/7 with a day missing
 * (review round 3 HIGH) — means `days` can never exceed 7.
 */
export function collectLayerDWeek(reportsDir, now) {
  let names;
  try {
    names = readdirSync(reportsDir);
  } catch (err) {
    return { error: `reports dir unreadable: ${err?.code || err?.message || err}` };
  }
  // `days` = expected dates with ≥1 run (manual extra runs don't inflate it).
  const expected = new Set(expectedLocalDates(now));
  let runs = 0, problems = 0, unreadable = 0;
  const days = new Set();
  for (const name of names) {
    const t = reportTimeFromName(name);
    if (t === null || t > now) continue;
    const day = localDate(t);
    if (!expected.has(day)) continue;
    runs += 1;
    days.add(day);
    try {
      if (layerDProblem(JSON.parse(readFileSync(path.join(reportsDir, name), "utf8"))) !== null) problems += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { runs, days: days.size, problems, unreadable };
}

/** MCP Health (GitHub Actions) runs in the last 7 days — public repo, unauthenticated API. */
export async function collectHealthWeek({ repo, now, fetchFn }) {
  const since = new Date(now - HEARTBEAT_WINDOW_MS).toISOString().slice(0, 10);
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${HEALTH_WORKFLOW}/runs?created=%3E%3D${since}&per_page=100`;
  try {
    const res = await fetchFn(url, { headers: { accept: "application/vnd.github+json", "user-agent": "novada-mcp-monitor" } });
    if (!res.ok) return { error: `GitHub API HTTP ${res.status}` };
    const body = await res.json();
    const all = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
    const runs = all.filter((r) => Date.parse(r.created_at) >= now - HEARTBEAT_WINDOW_MS);
    // Only scheduled runs prove the schedule is alive (a manual test run must not mask a disabled cron).
    const scheduled = runs.filter((r) => r.event === "schedule");
    const jobErrors = scheduled.filter((r) => r.status === "completed" && r.conclusion !== "success").length;
    // GitHub's scheduler drops ~1/3 of runs (healthy weeks measured 21–23 of 35),
    // so a count threshold cries wolf (review round 4 HIGH). Instead: each of the
    // 6 full UTC days before today should have ≥1 scheduled run (5 are scheduled
    // per day); a day with 0 is a real gap.
    const seen = new Set(scheduled.map((r) => String(r.created_at).slice(0, 10)));
    const gapDays = [];
    for (let k = 1; k <= 6; k += 1) {
      const day = new Date(now - k * 24 * 3600 * 1000).toISOString().slice(0, 10);
      if (!seen.has(day)) gapDays.push(day);
    }
    return { runs: scheduled.length, jobErrors, gapDays: gapDays.reverse() };
  } catch (err) {
    return { error: `GitHub API: ${err?.name === "TimeoutError" ? "timeout" : err?.message || err}` };
  }
}

/** Pure: the heartbeat text. A source that could not be read is said so, never shown as 0. */
export function buildHeartbeatMessage({ now, layerD, health }) {
  const date = localDate(now);
  const title = `💓 Novada MCP 监控周心跳 — ${date}`;
  const ld = layerD?.error
    ? `- Layer D 每日全量探针（本机）：❓ 未能统计（${layerD.error}）`
    : `- Layer D 每日全量探针（本机）：近 7 天有 **${layerD.days}/7** 天跑过（共 ${layerD.runs} 份报告），其中 ${layerD.problems} 份有问题（应已单独报过）${layerD.unreadable ? `，${layerD.unreadable} 份无法读取` : ""}${layerD.days < 7 ? " ⚠️ 少于 7 天：本机定时任务有几天没跑（关机/睡眠？）" : ""}`;
  const hc = health?.error
    ? `- MCP Health 定时检查（GitHub Actions）：❓ 未能统计（${health.error}）`
    : `- MCP Health 定时检查（GitHub Actions）：近 7 天定时运行 **${health.runs}** 次（排了 ${EXPECTED_HEALTH_RUNS_PER_WEEK} 次，GitHub 常丢约 1/3，属正常）${health.jobErrors ? `，其中 ${health.jobErrors} 次任务本身出错 ⚠️` : ""}${health.gapDays?.length ? ` ⚠️ ${health.gapDays.join("、")} 整天没有运行：定时任务可能被停用` : ""}`;
  const lines = [
    `### ${title}`,
    "",
    "监控仍在运行。平时只在出问题时发消息，这条每周一发一次，用来确认监控本身没停。",
    "",
    ld,
    hc,
    "",
    "_如果哪周一没收到这条，说明本机每日任务没跑（关机/睡眠/配置丢失），请检查。_",
  ];
  return { title, text: lines.join("\n") };
}

async function heartbeatMain(reportsDir, env, deps) {
  const now = deps.now ?? Date.now();
  const fetchFn = withTimeout(deps.fetchFn ?? fetch);
  const layerD = reportsDir ? collectLayerDWeek(reportsDir, now) : { error: "no reports dir given" };
  const health = await collectHealthWeek({ repo: env.MONITOR_GH_REPO || "NovadaLabs/novada-mcp", now, fetchFn });
  const { title, text } = buildHeartbeatMessage({ now, layerD, health });
  const dryRun = env.DRY_RUN === "1";
  if (!env.DINGTALK_WEBHOOK_URL && !dryRun) {
    console.log("[notify-layer-d heartbeat] skip: DINGTALK_WEBHOOK_URL not set");
    return 0;
  }
  const res = await sendDingTalk({ webhookUrl: env.DINGTALK_WEBHOOK_URL, secret: env.DINGTALK_SECRET, keyword: env.DINGTALK_KEYWORD, title, text, dryRun, fetchFn, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
  if (!res.ok) {
    console.error(`[notify-layer-d heartbeat] send failed: ${JSON.stringify({ errcode: res.errcode, errmsg: res.errmsg, httpStatus: res.httpStatus, error: res.error })}`);
    return 1;
  }
  console.log(`[notify-layer-d heartbeat] ${res.dryRun ? "dry-run printed" : "sent"}: ${title}`);
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
